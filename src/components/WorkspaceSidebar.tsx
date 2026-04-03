import { useState, useEffect, useMemo, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Plus,
  Search as SearchIcon,
  Wrench,
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

const CHECKPOINTS = [
  "plan persisted",
  "candidate rows created",
  "sources fetched",
  "cells extracted",
  "criteria evaluated",
  "final ranking committed",
] as const;

const TOOL_SCHEMAS: Record<
  string,
  {
    args: string;
    returns: string;
    description: string;
  }
> = {
  plan_query: {
    args: "query: string",
    returns: "entity_type, filters, columns, search_queries, budgets",
    description: "Normalize the raw research question into a structured run plan.",
  },
  cache_lookup: {
    args: "cache_key: string",
    returns: "cache hit | cache miss",
    description: "Check whether a reusable search or page artifact already exists.",
  },
  search_query: {
    args: "query: string",
    returns: "candidate documents",
    description: "Issue a discovery query and retrieve broad candidate documents.",
  },
  fetch_source: {
    args: "url: string",
    returns: "normalized source document",
    description: "Fetch, normalize, and retain the source needed for grounding.",
  },
  extract_candidate: {
    args: "row_id: string",
    returns: "cell values + null states + evidence links",
    description: "Resolve row cells from the retrieved source set.",
  },
  evaluate_candidate: {
    args: "row_id: string",
    returns: "criterion verdicts",
    description: "Score hard filters and soft signals against grounded evidence.",
  },
  verify_candidate: {
    args: "row_id: string",
    returns: "validated row state",
    description: "Run a second pass for uncertain or conflicting candidates.",
  },
  rank_results: {
    args: "rows: ResultRow[]",
    returns: "ranked accepted + unmatched partitions",
    description: "Finalize the result table and unmatched section.",
  },
  export_results: {
    args: "run_id: string",
    returns: "csv, json",
    description: "Serialize the final accepted set into export artifacts.",
  },
};

interface WorkspaceSidebarProps {
  thread: Thread;
  selectedResult: SearchResult | null;
  onUpdateThreadQueryAndCriteria: (query: string) => void;
  onAddCriterion: (c: Criterion) => void;
  onRemoveCriterion: (id: string) => void;
  onAddEnrichment: (e: Enrichment) => void;
  onRemoveEnrichment: (id: string) => void;
  onUpdateTarget: (n: number) => void;
  onClearSelection: () => void;
}

type RewardSignal = {
  label: string;
  value: string;
  hint?: string;
};

type AggregatedToolCall = {
  name: string;
  count: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  cacheHits: number;
  summary: string;
};

function formatDuration(ms: number | null | undefined) {
  if (!ms || ms < 1000) return `${ms ?? 0} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatUsd(value: number | null | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function summarizeCellState(cell: SearchCell | undefined): {
  label: string;
  detail: string;
  value: ReactNode;
  tone: string;
} {
  if (!cell || cell.state === "pending") {
    return {
      label: "Pending",
      detail: "This cell is still in-flight and may resolve as more evidence lands.",
      value: "Pending…",
      tone: "text-muted-foreground italic",
    };
  }

  if (cell.state === "not_found") {
    return {
      label: "Not found",
      detail: "The system looked through the retrieved evidence and did not find a grounded value for this field.",
      value: "—",
      tone: "text-muted-foreground",
    };
  }

  if (cell.state === "unsupported") {
    return {
      label: "Unsupported",
      detail: "This field is not reasonably groundable for this entity/query with the current source strategy.",
      value: "—",
      tone: "text-muted-foreground",
    };
  }

  if (cell.state === "uncertain") {
    return {
      label: "Uncertain",
      detail: "The system found a possible value, but the supporting evidence is too weak to promote it confidently.",
      value: cell.valueText ?? "Uncertain",
      tone: "text-amber-600",
    };
  }

  if (cell.state === "conflict") {
    return {
      label: "Conflict",
      detail: "Multiple credible sources disagree on this value, so the field is kept explicitly conflicted.",
      value: cell.valueText ?? "Conflict",
      tone: "text-amber-600",
    };
  }

  return {
    label: "Filled",
    detail: "This value is grounded to at least one retained evidence snippet.",
    value: cell.valueText ?? "—",
    tone: "text-foreground font-medium",
  };
}

function buildRewardSignals(thread: Thread): RewardSignal[] {
  const stepRewards = [...thread.agentSteps].reverse().find((step) => step.rewards?.length)?.rewards;
  if (stepRewards && stepRewards.length > 0) {
    return stepRewards;
  }

  const allCells = thread.results.flatMap((result) => Object.values(result.cells));
  const resolvedCells = allCells.filter((cell) => cell.state !== "pending");
  const filledCells = resolvedCells.filter((cell) => cell.state === "filled");
  const blankCells = resolvedCells.filter(
    (cell) => cell.state === "not_found" || cell.state === "unsupported",
  );
  const weakCells = resolvedCells.filter(
    (cell) => cell.state === "uncertain" || cell.state === "conflict",
  );
  const finalizedRows = thread.results.filter((row) => row.processingState === "finalized");
  const accepted = finalizedRows.filter((row) => row.status === "accepted").length;
  const rejected = finalizedRows.filter((row) => row.status === "rejected").length;

  const groundedCellRate =
    resolvedCells.length > 0 ? `${Math.round((filledCells.length / resolvedCells.length) * 100)}%` : "0%";
  const abstentionRate =
    resolvedCells.length > 0 ? `${Math.round((blankCells.length / resolvedCells.length) * 100)}%` : "0%";
  const weakStateRate =
    resolvedCells.length > 0 ? `${Math.round((weakCells.length / resolvedCells.length) * 100)}%` : "0%";
  const targetCoverage =
    thread.targetResults > 0 ? `${Math.round((accepted / thread.targetResults) * 100)}%` : "0%";
  const selectivity =
    finalizedRows.length > 0 ? `${Math.round((rejected / finalizedRows.length) * 100)}%` : "0%";

  return [
    { label: "grounded_cell_rate", value: groundedCellRate, hint: "Filled cells over resolved cells." },
    { label: "abstention_rate", value: abstentionRate, hint: "Explicit not_found or unsupported cells." },
    { label: "weak_state_rate", value: weakStateRate, hint: "Uncertain or conflict cells." },
    { label: "target_coverage", value: targetCoverage, hint: "Accepted rows against requested results." },
    { label: "selectivity", value: selectivity, hint: "Rejected rows over finalized candidates." },
  ];
}

function aggregateToolCalls(thread: Thread): AggregatedToolCall[] {
  const summary = new Map<string, AggregatedToolCall>();

  for (const step of thread.agentSteps) {
    for (const tool of step.toolCalls ?? []) {
      const current = summary.get(tool.name) ?? {
        name: tool.name,
        count: 0,
        totalCostUsd: 0,
        avgLatencyMs: 0,
        cacheHits: 0,
        summary: tool.summary,
      };

      const totalLatency = current.avgLatencyMs * current.count + (tool.latencyMs ?? 0);
      current.count += 1;
      current.totalCostUsd += tool.costUsd ?? 0;
      current.avgLatencyMs = current.count > 0 ? totalLatency / current.count : 0;
      current.cacheHits += tool.cacheHit ? 1 : 0;
      current.summary = tool.summary;
      summary.set(tool.name, current);
    }
  }

  return [...summary.values()].sort((left, right) => right.count - left.count);
}

function checkpointReached(thread: Thread, checkpoint: string) {
  return thread.agentSteps.some((step) => step.checkpoint === checkpoint);
}

export function WorkspaceSidebar({
  thread,
  selectedResult,
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

  useEffect(() => {
    setQueryDraft(thread.query);
  }, [thread.id, thread.query]);

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

  const acceptedCount = thread.results.filter((r) => r.status === "accepted").length;
  const rejectedCount = thread.results.filter((r) => r.status === "rejected").length;
  const unresolvedCount = thread.results.filter((r) => r.status === "uncertain" || r.status === "conflict").length;
  const analyzed = thread.latestRun?.progress.totalRows ?? thread.results.length;
  const target = thread.targetResults;
  const progressPct =
    target > 0 ? Math.min(100, Math.round((analyzed / target) * 100)) : analyzed > 0 ? 100 : 0;
  const cacheLookups = (thread.metrics?.cacheHits ?? 0) + (thread.metrics?.cacheMisses ?? 0);
  const cacheHitRate =
    cacheLookups > 0 ? Math.round(((thread.metrics?.cacheHits ?? 0) / cacheLookups) * 100) : 0;

  const rewardSignals = useMemo(() => buildRewardSignals(thread), [thread]);
  const toolCalls = useMemo(() => aggregateToolCalls(thread), [thread]);
  const actorSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const step of thread.agentSteps) {
      counts.set(step.actor, (counts.get(step.actor) ?? 0) + 1);
    }
    return [...counts.entries()].map(([actor, count]) => ({ actor, count }));
  }, [thread.agentSteps]);
  const reasoningTrail = useMemo(
    () => thread.agentSteps.filter((step) => step.reasoning).slice(-6).reverse(),
    [thread.agentSteps],
  );

  return (
    <div className="w-[360px] shrink-0 border-l bg-card flex flex-col min-h-0 animate-in slide-in-from-right-4 duration-200">
      <Tabs defaultValue="search" className="flex-1 flex flex-col min-h-0">
        <TabsList className="rounded-none border-b bg-transparent h-9 px-2 justify-start gap-1 shrink-0 overflow-x-auto">
          <TabsTrigger
            value="search"
            className="text-[11px] h-7 px-2.5 data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
          >
            Search
          </TabsTrigger>
          <TabsTrigger
            value="details"
            className="text-[11px] h-7 px-2.5 data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
          >
            Details
          </TabsTrigger>
          <TabsTrigger
            value="sources"
            className="text-[11px] h-7 px-2.5 data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
          >
            Sources
            {selectedResult ? ` (${selectedResult.sourcesVisited.length})` : ""}
          </TabsTrigger>
          <TabsTrigger
            value="internals"
            className="text-[11px] h-7 px-2.5 data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
          >
            Internals
          </TabsTrigger>
        </TabsList>

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
                {thread.criteria.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-2 text-[11px] px-2 py-1.5 rounded-md border group"
                    style={{ borderLeftColor: c.color, borderLeftWidth: 3 }}
                  >
                    <div className="flex-1 min-w-0 leading-snug">
                      <div>{c.label}</div>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
                        {c.kind === "hard_filter" ? "Hard filter" : "Soft signal"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveCriterion(c.id)}
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
                Output Columns
              </label>
              <div className="flex flex-wrap gap-1">
                {thread.columns.map((e) => (
                  <Badge key={e.id} variant="secondary" className="gap-1 text-[10px] font-normal">
                    {e.label}
                    <button type="button" onClick={() => onRemoveEnrichment(e.id)}>
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
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Progress value={progressPct} className="h-2" />
              <p className="text-[10px] text-muted-foreground font-mono">
                {acceptedCount} accepted · {analyzed} / {target} analyzed
              </p>
            </div>

            {thread.latestRun && (
              <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  <span>Execution</span>
                  <span className="font-mono normal-case">{thread.latestRun.stage}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <Metric label="Search" value={String(thread.metrics?.searchCalls ?? 0)} />
                  <Metric label="Fetch" value={String(thread.metrics?.fetchCalls ?? 0)} />
                  <Metric label="LLM" value={String(thread.metrics?.llmCalls ?? 0)} />
                  <Metric label="Cache hit" value={`${cacheHitRate}%`} />
                  <Metric label="Cost" value={formatUsd(thread.metrics?.estimatedCostUsd)} />
                  <Metric label="Elapsed" value={formatDuration(thread.metrics?.elapsedMs)} />
                  <Metric label="Accepted" value={String(acceptedCount)} />
                  <Metric label="Rejected" value={String(rejectedCount)} />
                  <Metric label="Unresolved" value={String(unresolvedCount)} />
                  <Metric
                    label="Rows"
                    value={`${thread.latestRun.progress.rowsCreated}/${thread.latestRun.progress.totalRows}`}
                  />
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="details" className="mt-0 flex-1 min-h-0 overflow-y-auto">
          {!selectedResult ? (
            <div className="p-6 text-center space-y-2">
              <SearchIcon className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Select a row in the table to inspect grounded criteria checks, explicit null states, and cell-level evidence.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="border-b px-3 py-2.5 flex items-start justify-between gap-2 sticky top-0 bg-card z-10">
                <div className="min-w-0">
                  <h3 className="font-semibold text-xs truncate">{selectedResult.name}</h3>
                  <a
                    href={`https://${selectedResult.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 truncate max-w-full"
                  >
                    {selectedResult.url}
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px] shrink-0"
                  onClick={onClearSelection}
                >
                  Clear
                </Button>
              </div>
              <div className="p-3 space-y-3">
                <DetailsEvaluations thread={thread} result={selectedResult} />
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="sources" className="mt-0 flex-1 min-h-0 overflow-y-auto">
          {!selectedResult ? (
            <div className="p-6 text-center space-y-2">
              <Globe className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Select a row to see which source documents were fetched for that entity.
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-1">
              <div className="flex items-center gap-1 mb-2">
                <button
                  type="button"
                  onClick={() => setExpandedSources(!expandedSources)}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                >
                  {expandedSources ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {selectedResult.sourcesVisited.length} sources visited
                </button>
              </div>
              {expandedSources &&
                selectedResult.sourcesVisited.map((src, i) => (
                  <a
                    key={i}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <div className="mt-0.5 shrink-0">
                      {src.favicon ? (
                        <img src={src.favicon} alt="" className="h-3.5 w-3.5 rounded-sm" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-0.5 flex-1">
                      <p className="text-[11px] font-medium truncate group-hover:text-primary transition-colors">
                        {src.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">{src.url}</p>
                      <p className="text-[10px] text-muted-foreground italic line-clamp-2">
                        {src.snippet}
                      </p>
                    </div>
                  </a>
                ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="internals" className="mt-0 flex-1 min-h-0 overflow-y-auto">
          <div className="p-3 space-y-4">
            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <div className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  Product-critical metrics
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <Metric label="Stage" value={thread.latestRun?.stage ?? "idle"} />
                <Metric label="Elapsed" value={formatDuration(thread.metrics?.elapsedMs)} />
                <Metric label="Search calls" value={String(thread.metrics?.searchCalls ?? 0)} />
                <Metric label="Fetch calls" value={String(thread.metrics?.fetchCalls ?? 0)} />
                <Metric label="LLM calls" value={String(thread.metrics?.llmCalls ?? 0)} />
                <Metric label="Cache hit rate" value={`${cacheHitRate}%`} />
                <Metric label="Rows discovered" value={String(thread.latestRun?.progress.rowsCreated ?? 0)} />
                <Metric label="Rows accepted" value={String(acceptedCount)} />
                <Metric label="Cells resolved" value={String(thread.latestRun?.progress.cellsResolved ?? 0)} />
                <Metric label="Estimated cost" value={formatUsd(thread.metrics?.estimatedCostUsd)} />
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Durable checkpoints
              </span>
              <div className="space-y-1.5">
                {CHECKPOINTS.map((checkpoint) => {
                  const reached = checkpointReached(thread, checkpoint);
                  return (
                    <div key={checkpoint} className="flex items-center gap-2 text-[11px]">
                      <div
                        className={`h-4 w-4 rounded-full flex items-center justify-center ${
                          reached ? "bg-success/15" : "bg-muted"
                        }`}
                      >
                        {reached ? (
                          <Check className="h-2.5 w-2.5 text-success" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                        )}
                      </div>
                      <span className={reached ? "text-foreground" : "text-muted-foreground"}>
                        {checkpoint}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Reward proxies
              </span>
              <div className="grid gap-2 grid-cols-2">
                {rewardSignals.map((reward) => (
                  <div key={reward.label} className="rounded border bg-background/80 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      {reward.label}
                    </div>
                    <div className="font-mono text-[11px] mt-0.5">{reward.value}</div>
                    {reward.hint && (
                      <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                        {reward.hint}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                These are runtime proxies, not true offline eval metrics like labeled precision/recall/F1.
              </p>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Actors in play
              </span>
              <div className="flex flex-wrap gap-1.5">
                {actorSummary.map(({ actor, count }) => (
                  <Badge key={actor} variant="outline" className="text-[10px] gap-1">
                    {actor}
                    <span className="font-mono text-[9px] text-muted-foreground">{count}</span>
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <div className="flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  Tool surface
                </span>
              </div>
              <div className="space-y-2">
                {toolCalls.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Start a run to populate the concrete tool ledger.
                  </p>
                )}
                {toolCalls.map((tool) => {
                  const schema = TOOL_SCHEMAS[tool.name];
                  return (
                    <div key={tool.name} className="rounded border bg-background/80 p-2 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {tool.name}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{tool.count} calls</span>
                        <span className="text-[10px] text-muted-foreground">
                          avg {formatDuration(Math.round(tool.avgLatencyMs))}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatUsd(tool.totalCostUsd)}
                        </span>
                        {tool.cacheHits > 0 && (
                          <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                            {tool.cacheHits} cache hits
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {schema?.description ?? tool.summary}
                      </p>
                      {schema && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <MiniSchema label="Args" value={schema.args} />
                          <MiniSchema label="Returns" value={schema.returns} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Provider ledger
              </span>
              <div className="space-y-1">
                {(thread.metrics?.providerBreakdown ?? []).map((metric) => (
                  <div
                    key={`${metric.providerName}:${metric.operation}`}
                    className="flex items-center justify-between rounded bg-background/80 px-2 py-1.5 text-[10px] font-mono gap-2"
                  >
                    <span className="truncate">
                      {metric.providerName}:{metric.operation}
                    </span>
                    <span className="shrink-0">{metric.requestCount}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Recent reasoning summaries
              </span>
              <div className="space-y-2">
                {reasoningTrail.map((step) => (
                  <div key={step.id} className="rounded border bg-background/80 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                        {step.actor}
                      </Badge>
                      <span className="text-[11px] font-medium">{step.title}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                      {step.reasoning}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-background/80 px-2 py-1.5">
      <div className="text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="font-mono text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function MiniSchema({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/20 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-[10px] font-mono text-foreground/90">{value}</div>
    </div>
  );
}

function DetailsEvaluations({ thread, result }: { thread: Thread; result: SearchResult }) {
  const passedCount = result.evaluations.filter((e) => e.verdict === "pass").length;

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Criteria
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">
          {passedCount}/{result.evaluations.length} passed
        </span>
      </div>

      {result.evaluations.map((ev, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 shrink-0">
              {ev.verdict === "pass" ? (
                <div className="h-4 w-4 rounded-full bg-success/15 flex items-center justify-center">
                  <Check className="h-2.5 w-2.5 text-success" />
                </div>
              ) : ev.verdict === "fail" ? (
                <div className="h-4 w-4 rounded-full bg-destructive/15 flex items-center justify-center">
                  <X className="h-2.5 w-2.5 text-destructive" />
                </div>
              ) : (
                <div className="h-4 w-4 rounded-full bg-amber-500/15 flex items-center justify-center">
                  <AlertTriangle className="h-2.5 w-2.5 text-amber-600" />
                </div>
              )}
            </div>
            <div className="space-y-1 min-w-0 flex-1">
              <p className="text-[11px] font-medium leading-tight">{ev.rule}</p>
              <p className="text-[10px] italic text-muted-foreground leading-relaxed">{ev.summary}</p>
              <div className="flex flex-wrap gap-1">
                {ev.sources.map((src, j) => (
                  <a key={j} href={src.url} target="_blank" rel="noopener noreferrer">
                    <Badge
                      variant="outline"
                      className="text-[9px] gap-0.5 hover:bg-muted cursor-pointer h-4 px-1 max-w-[220px]"
                    >
                      {src.favicon && <img src={src.favicon} alt="" className="h-2.5 w-2.5 shrink-0" />}
                      <span className="truncate">{src.title}</span>
                    </Badge>
                  </a>
                ))}
              </div>
            </div>
          </div>
          {i < result.evaluations.length - 1 && <Separator className="my-1" />}
        </div>
      ))}

      {thread.columns.length > 0 && (
        <>
          <Separator />
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Cells
            </span>
            <div className="space-y-2">
              {thread.columns.map((column) => {
                const cell = result.cells[column.key];
                const summary = summarizeCellState(cell);

                return (
                  <div key={column.id} className="rounded border bg-background/70 p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground shrink-0">{column.label}</span>
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
                    {cell?.sources && cell.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {cell.sources.map((source) => (
                          <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
                            <Badge variant="secondary" className="text-[9px] gap-1 max-w-[220px]">
                              {source.favicon && <img src={source.favicon} alt="" className="h-2.5 w-2.5 shrink-0" />}
                              <span className="truncate">{source.title}</span>
                            </Badge>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
