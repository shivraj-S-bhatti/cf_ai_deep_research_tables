import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RowDetailsResponse } from "@/lib/contracts";
import { summarizeProductCounts } from "@/lib/runtime-policy";
import { runLoadingHeadline } from "@/lib/run-stage-copy";
import {
  isBlankTerminalCell,
  isPendingCell,
  isWeakTerminalCell,
  type Criterion,
  type Enrichment,
  type SearchCell,
  type SearchResult,
  type Thread,
} from "@/lib/types";

const COLORS = [
  "hsl(220, 80%, 50%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 60%, 50%)",
  "hsl(350, 70%, 50%)",
];

interface WorkspaceSidebarProps {
  thread: Thread;
  selectedResult: SearchResult | null;
  selectedRowDetail: RowDetailsResponse | null;
  selectedRowLoading: boolean;
  debugHref: string | null;
  onUpdateThreadQueryAndCriteria: (query: string) => void;
  onAddCriterion: (c: Criterion) => void;
  onRemoveCriterion: (id: string) => void;
  onAddEnrichment: (e: Enrichment) => void;
  onRemoveEnrichment: (id: string) => void;
  onUpdateTarget: (n: number) => void;
  onClearSelection: () => void;
}

function formatDuration(ms: number | null | undefined) {
  if (!ms || ms < 1000) return `${ms ?? 0} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Matches default server `MAX_RUN_WALL_CLOCK_MS` (8 min) for honest “time left” copy. */
const SERVER_RUN_BUDGET_MS = 480_000;

function formatClock(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function formatUsd(value: number | null | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function buildSourceLookups(detail: RowDetailsResponse | null) {
  const sourcesById = new Map(detail?.sources.map((source) => [source.id, source]) ?? []);
  const evidenceById = new Map(detail?.evidence.map((evidence) => [evidence.id, evidence]) ?? []);
  return { sourcesById, evidenceById };
}

function sourcesForEvidence(detail: RowDetailsResponse | null, evidenceId: string | null) {
  if (!detail || !evidenceId) return [];
  const { sourcesById, evidenceById } = buildSourceLookups(detail);
  const evidence = evidenceById.get(evidenceId);
  if (!evidence) return [];
  const source = sourcesById.get(evidence.sourceDocumentId);
  return source ? [source] : [];
}

function dedupeSources<T extends { id: string; url: string; title: string }>(sources: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const source of sources) {
    const key = `${source.url}::${source.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function summarizeCellState(cell: SearchCell | undefined) {
  if (!cell || cell.state === "pending") {
    return {
      label: "Pending",
      detail: "This cell is still gathering evidence and may resolve as the run advances.",
      value: "Pending…",
      tone: "text-muted-foreground italic",
    };
  }

  if (cell.state === "not_found") {
    return {
      label: "Not found",
      detail: "The system looked for this field and did not find enough grounded evidence to fill it.",
      value: "—",
      tone: "text-muted-foreground",
    };
  }

  if (cell.state === "unsupported") {
    return {
      label: "Unsupported",
      detail: "This field is not reasonably groundable for this entity or query with the current source strategy.",
      value: "—",
      tone: "text-muted-foreground",
    };
  }

  if (cell.state === "uncertain") {
    return {
      label: "Uncertain",
      detail: "A possible value exists, but the evidence remains too weak to promote confidently.",
      value: cell.valueText ?? "Uncertain",
      tone: "text-amber-600",
    };
  }

  if (cell.state === "conflict") {
    return {
      label: "Conflict",
      detail: "Credible sources disagree, so the value is kept explicitly conflicted.",
      value: cell.valueText ?? "Conflict",
      tone: "text-amber-600",
    };
  }

  return {
    label: "Filled",
    detail: "This value is grounded to retained evidence and visible in the row detail view.",
    value: cell.valueText ?? "—",
    tone: "text-foreground font-medium",
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-background/80 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-[11px]">{value}</div>
    </div>
  );
}

export function WorkspaceSidebar({
  thread,
  selectedResult,
  selectedRowDetail,
  selectedRowLoading,
  debugHref,
  onUpdateThreadQueryAndCriteria,
  onAddCriterion,
  onRemoveCriterion,
  onAddEnrichment,
  onRemoveEnrichment,
  onUpdateTarget,
  onClearSelection,
}: WorkspaceSidebarProps) {
  const [queryDraft, setQueryDraft] = useState(thread.query);
  const [newCriterion, setNewCriterion] = useState("");
  const [newEnrichment, setNewEnrichment] = useState("");
  const [expandedSources, setExpandedSources] = useState(true);
  const [, setRunClockTick] = useState(0);

  useEffect(() => {
    setQueryDraft(thread.query);
  }, [thread.id, thread.query]);

  const run = thread.latestRun;
  const runIsActive = Boolean(run && (run.status === "queued" || run.status === "running"));
  useEffect(() => {
    if (!runIsActive) return;
    const id = window.setInterval(() => setRunClockTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [runIsActive]);

  const elapsedLiveMs =
    runIsActive && run?.startedAt
      ? Date.now() - run.startedAt
      : (thread.metrics?.elapsedMs ?? run?.metrics?.elapsedMs ?? 0);
  const budgetRemainingMs = Math.max(0, SERVER_RUN_BUDGET_MS - elapsedLiveMs);

  const handleQueryBlur = () => {
    const q = queryDraft.trim();
    if (q && q !== thread.query) {
      onUpdateThreadQueryAndCriteria(q);
    }
  };

  const handleAddCriterion = () => {
    if (!newCriterion.trim()) return;
    onAddCriterion({
      id: `c${Date.now()}`,
      label: newCriterion.trim(),
      kind: "hard_filter",
      color: COLORS[thread.criteria.length % COLORS.length],
    });
    setNewCriterion("");
  };

  const handleAddEnrichment = () => {
    if (!newEnrichment.trim()) return;
    const label = newEnrichment.trim();
    onAddEnrichment({
      id: `e${Date.now()}`,
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label,
      kind: "enrichment",
      valueType: "string",
      preferredSources: ["official"],
      requiresVerification: true,
      allowInference: false,
      nullPolicy: "dash",
      orderIndex: thread.columns.length,
    });
    setNewEnrichment("");
  };

  const productCounts = summarizeProductCounts(thread.results);
  const acceptedCount = productCounts.accepted;
  const rejectedCount = productCounts.rejected;
  const unresolvedCount = productCounts.uncertain + productCounts.conflict;
  const analyzed = productCounts.finalizedCount;
  const target = thread.targetResults;
  const progressPct =
    target > 0 ? Math.min(100, Math.round((analyzed / target) * 100)) : analyzed > 0 ? 100 : 0;
  const cacheLookups = (thread.metrics?.cacheHits ?? 0) + (thread.metrics?.cacheMisses ?? 0);
  const cacheHitRate =
    cacheLookups > 0 ? Math.round(((thread.metrics?.cacheHits ?? 0) / cacheLookups) * 100) : 0;
  const selectedSources = useMemo(
    () => dedupeSources(selectedRowDetail?.sources ?? []),
    [selectedRowDetail],
  );
  const runBanner = runLoadingHeadline({
    phase: thread.phase,
    stage: run?.stage ?? "idle",
    statusSummary: thread.statusSummary,
  });

  const detailCells = useMemo(() => {
    if (!selectedResult) return [];
    return thread.columns.map((column) => {
      const detailCell = selectedRowDetail?.cells.find((entry) => entry.columnKey === column.key);
      const baseCell = selectedResult.cells[column.key];
      const cell = detailCell
        ? {
            ...baseCell,
            ...detailCell,
            label: column.label,
            sources: sourcesForEvidence(selectedRowDetail, detailCell.primaryEvidenceId).map((source) => ({
              id: source.id,
              url: source.url,
              title: source.title,
              snippet: source.snippet,
              favicon: source.favicon,
              visitedAt: new Date(source.fetchedAt).toISOString(),
              trustTier: source.trustTier,
            })),
          }
        : baseCell;
      return { column, cell };
    });
  }, [selectedResult, selectedRowDetail, thread.columns]);

  return (
    <div className="w-[360px] shrink-0 border-l bg-card flex flex-col min-h-0 animate-in slide-in-from-right-4 duration-200">
      <Tabs defaultValue="search" className="flex-1 flex flex-col min-h-0">
        <TabsList className="rounded-none border-b bg-transparent h-9 px-2 justify-start gap-1 shrink-0 overflow-x-auto">
          <TabsTrigger value="search" className="text-[11px] h-7 px-2.5 rounded-none">
            Search
          </TabsTrigger>
          <TabsTrigger value="details" className="text-[11px] h-7 px-2.5 rounded-none">
            Details
          </TabsTrigger>
          <TabsTrigger value="sources" className="text-[11px] h-7 px-2.5 rounded-none">
            Sources
            {selectedSources.length > 0 ? ` (${selectedSources.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="run" className="text-[11px] h-7 px-2.5 rounded-none">
            Run
          </TabsTrigger>
        </TabsList>
        {run ? (
          <div className="shrink-0 border-b bg-muted/20 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-foreground">{runBanner.headline}</p>
                {runBanner.subline ? (
                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{runBanner.subline}</p>
                ) : null}
              </div>
              <Badge variant={runIsActive ? "secondary" : "outline"} className="shrink-0 text-[10px] font-mono">
                {runIsActive ? formatClock(budgetRemainingMs) : run.status}
              </Badge>
            </div>
            {runIsActive ? (
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {formatClock(elapsedLiveMs)} elapsed · hard stop in up to {formatClock(budgetRemainingMs)}
              </p>
            ) : null}
          </div>
        ) : null}

        <TabsContent value="search" className="mt-0 flex-1 min-h-0 overflow-y-auto">
          <div className="p-3 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Topic / query
              </label>
              <Textarea
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                onBlur={handleQueryBlur}
                className="text-xs min-h-[72px] resize-y"
                placeholder="Describe what you want to find…"
              />
              <p className="text-[9px] text-muted-foreground">
                Editing the query refreshes the generated plan and clears the stale run view.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Criteria ({thread.criteria.length})
              </label>
              <div className="space-y-1.5">
                {thread.criteria.map((criterion) => (
                  <div
                    key={criterion.id}
                    className="flex items-start gap-2 text-[11px] px-2 py-1.5 rounded-md border group"
                    style={{ borderLeftColor: criterion.color, borderLeftWidth: 3 }}
                  >
                    <div className="flex-1 min-w-0 leading-snug">
                      <div>{criterion.label}</div>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
                        {criterion.kind === "hard_filter"
                          ? "Hard filter"
                          : criterion.kind === "heuristic"
                            ? "Heuristic"
                            : "Soft signal"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveCriterion(criterion.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    >
                      <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={newCriterion}
                  onChange={(e) => setNewCriterion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCriterion()}
                  placeholder="Add criterion…"
                  className="text-xs h-8"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-xs shrink-0 px-2"
                  onClick={handleAddCriterion}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Output columns
              </label>
              <div className="flex flex-wrap gap-1">
                {thread.columns.map((column) => (
                  <Badge key={column.id} variant="secondary" className="gap-1 text-[10px] font-normal">
                    {column.label}
                    <button type="button" onClick={() => onRemoveEnrichment(column.id)}>
                      <X className="h-2.5 w-2.5 hover:text-destructive" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={newEnrichment}
                  onChange={(e) => setNewEnrichment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddEnrichment()}
                  placeholder='e.g. "Pricing", "License", "Location"'
                  className="text-xs h-8"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 px-2"
                  onClick={handleAddEnrichment}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  Find more results
                </span>
                <Select
                  value={String(thread.targetResults)}
                  onValueChange={(v) => onUpdateTarget(Number(v))}
                >
                  <SelectTrigger className="h-7 w-[72px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="15">15</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Progress value={progressPct} className="h-2" />
              <p className="text-[10px] text-muted-foreground font-mono">
                {acceptedCount} accepted · {analyzed} / {target} analyzed
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="details" className="mt-0 flex-1 min-h-0 overflow-y-auto">
          {!selectedResult ? (
            <div className="p-6 text-center space-y-2">
              <SearchIcon className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Select a row to inspect grounded criteria checks, null states, and evidence-backed fields.
              </p>
            </div>
          ) : selectedRowLoading ? (
            <div className="p-6 text-center space-y-2">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">Loading row details…</p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="border-b px-3 py-2.5 flex items-start justify-between gap-2 sticky top-0 bg-card z-10">
                <div className="min-w-0">
                  <h3 className="font-semibold text-xs truncate">{selectedResult.name}</h3>
                  <a
                    href={selectedResult.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 truncate max-w-full"
                  >
                    {selectedResult.url}
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-[10px] shrink-0" onClick={onClearSelection}>
                  Clear
                </Button>
              </div>
              <div className="p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Criteria
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                    {(selectedRowDetail?.evaluations.filter((evaluation) => evaluation.verdict === "pass").length ?? 0)}/
                    {selectedRowDetail?.evaluations.length ?? 0} passed
                  </span>
                </div>

                {(selectedRowDetail?.evaluations ?? []).map((evaluation) => {
                  const criterion = thread.criteria.find((entry) => entry.id === evaluation.criterionId);
                  const sources = sourcesForEvidence(selectedRowDetail, evaluation.primaryEvidenceId);
                  return (
                    <div key={evaluation.id} className="space-y-1.5 rounded border bg-background/70 p-2">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {evaluation.verdict === "pass" ? (
                            <div className="h-4 w-4 rounded-full bg-success/15 flex items-center justify-center">
                              <Check className="h-2.5 w-2.5 text-success" />
                            </div>
                          ) : (
                            <div className="h-4 w-4 rounded-full bg-muted flex items-center justify-center">
                              <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium leading-tight">
                            {criterion?.label ?? evaluation.criterionId}
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                            {evaluation.summary}
                          </div>
                          {sources.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {sources.map((source) => (
                                <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
                                  <Badge variant="outline" className="text-[9px] gap-1 max-w-[220px]">
                                    <span className="truncate">{source.title}</span>
                                  </Badge>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <Separator />

                <div className="space-y-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Cells
                  </span>
                  <div className="space-y-2">
                    {detailCells.map(({ column, cell }) => {
                      const summary = summarizeCellState(cell);
                      return (
                        <div key={column.id} className="rounded border bg-background/70 p-2 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-muted-foreground">{column.label}</span>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                                {summary.label}
                              </Badge>
                              <span className={`text-[11px] truncate text-right ${summary.tone}`}>
                                {summary.value}
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            {summary.detail}
                          </p>
                          {cell?.sources.length ? (
                            <div className="flex flex-wrap gap-1">
                              {cell.sources.map((source) => (
                                <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
                                  <Badge variant="secondary" className="text-[9px] gap-1 max-w-[220px]">
                                    <span className="truncate">{source.title}</span>
                                  </Badge>
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="sources" className="mt-0 flex-1 min-h-0 overflow-y-auto">
          {!selectedResult ? (
            <div className="p-6 text-center space-y-2">
              <Globe className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Select a row to inspect the source documents that fed the row detail.
              </p>
            </div>
          ) : selectedRowLoading ? (
            <div className="p-6 text-center space-y-2">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">Loading sources…</p>
            </div>
          ) : (
            <div className="p-3 space-y-1">
              <div className="flex items-center gap-1 mb-2">
                <button
                  type="button"
                  onClick={() => setExpandedSources(!expandedSources)}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                >
                  {expandedSources ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {selectedSources.length} sources visited
                </button>
              </div>
              {expandedSources &&
                selectedSources.map((source) => (
                  <a
                    key={source.id}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <div className="mt-0.5 shrink-0">
                      {source.favicon ? (
                        <img src={source.favicon} alt="" className="h-3.5 w-3.5 rounded-sm" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-0.5 flex-1">
                      <p className="text-[11px] font-medium truncate group-hover:text-primary transition-colors">
                        {source.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">{source.url}</p>
                      <p className="text-[10px] text-muted-foreground italic line-clamp-2">
                        {source.snippet}
                      </p>
                    </div>
                  </a>
                ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="run" className="mt-0 flex-1 min-h-0 overflow-y-auto">
          <div className="p-3 space-y-4">
            <div
              data-testid="run-execution-summary"
              className="space-y-2 rounded-md border bg-muted/20 p-2.5"
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                <span>Execution</span>
                <span className="font-mono normal-case">{thread.latestRun?.stage ?? "idle"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <Metric label="Stage" value={thread.latestRun?.stage ?? "idle"} />
                <Metric
                  label="Elapsed"
                  value={
                    runIsActive && run?.startedAt
                      ? formatClock(Date.now() - run.startedAt)
                      : formatDuration(thread.metrics?.elapsedMs)
                  }
                />
                <Metric label="Rows discovered" value={String(thread.latestRun?.progress.rowsCreated ?? 0)} />
                <Metric label="Rows accepted" value={String(acceptedCount)} />
                <Metric label="Search calls" value={String(thread.metrics?.searchCalls ?? 0)} />
                <Metric label="Fetch calls" value={String(thread.metrics?.fetchCalls ?? 0)} />
                <Metric label="LLM calls" value={String(thread.metrics?.llmCalls ?? 0)} />
                <Metric label="Cache hit" value={`${cacheHitRate}%`} />
                <Metric label="Cost" value={formatUsd(thread.metrics?.estimatedCostUsd)} />
                <Metric label="Unresolved" value={String(unresolvedCount)} />
                <Metric label="Rejected" value={String(rejectedCount)} />
                <Metric
                  label="Rows"
                  value={`${thread.latestRun?.progress.rowsCreated ?? 0}/${thread.latestRun?.progress.totalRows ?? 0}`}
                />
              </div>
            </div>

            {selectedResult && (
              <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
                <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  Selected row lineage
                </div>
                <div className="grid gap-2 text-[10px]">
                  <Metric label="Origin class" value={selectedResult.lineage.sourceOriginClass} />
                  <Metric
                    label="Suggested by"
                    value={String(selectedResult.lineage.suggestedBySourceIds.length)}
                  />
                  <Metric
                    label="Grounded by"
                    value={String(selectedResult.lineage.groundedBySourceIds.length)}
                  />
                  <Metric label="Status" value={selectedResult.status} />
                </div>
                {selectedResult.statusReasonSummary ? (
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {selectedResult.statusReasonSummary}
                  </p>
                ) : null}
              </div>
            )}

            {debugHref && (
              <div className="rounded-md border bg-muted/20 p-2.5 space-y-2">
                <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  Advanced debugging
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Open the separate debug workspace for trace inspection, provider ledger details, raw payloads, and function-level execution logs.
                </p>
                <Button asChild variant="outline" size="sm" className="h-8 text-[11px]">
                  <a href={debugHref} target="_blank" rel="noreferrer">
                    Open debug workspace
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
