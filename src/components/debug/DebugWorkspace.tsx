import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RunDebugSummary, RunTraceResponse } from "@/lib/contracts";
import { apiClient } from "@/lib/api-client";
import { mapActivityEventToAgentStep } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatUsd(value: number | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function formatDuration(ms: number | undefined | null) {
  if (!ms || ms < 1000) return `${ms ?? 0} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function groupTrace(trace: RunTraceResponse) {
  const steps = trace.events.map(mapActivityEventToAgentStep);
  const groups: Array<{
    key: string;
    title: string;
    type: string;
    count: number;
    steps: typeof steps;
  }> = [];

  for (const step of steps) {
    const key = `${step.type}:${step.title}:${step.eventStatus}`;
    const current = groups.at(-1);
    if (current && current.key === key) {
      current.count += 1;
      current.steps.push(step);
      continue;
    }
    groups.push({
      key,
      title: step.title,
      type: step.type,
      count: 1,
      steps: [step],
    });
  }

  return groups;
}

function filterTraceForRow(
  trace: RunTraceResponse | null,
  filter: { rowName: string; rowId: string } | null,
): RunTraceResponse | null {
  if (!trace || !filter?.rowName.trim()) return trace;
  const name = filter.rowName.trim();
  const events = trace.events.filter((e) => {
    if (e.message.includes(name)) return true;
    const rowId = e.payloadJson?.rowId;
    if (typeof rowId === "string" && rowId === filter.rowId) return true;
    const candidate = e.payloadJson?.candidateName;
    if (typeof candidate === "string" && candidate.includes(name)) return true;
    return false;
  });
  return { ...trace, events };
}

export type DebugWorkspaceTraceFilter = { rowName: string; rowId: string };

export type DebugWorkspaceProps = {
  threadId: string;
  runId: string | null;
  mode: "page" | "drawer";
  /** Shown in drawer header when thread snapshot is not loaded */
  threadQuery?: string | null;
  traceFilter?: DebugWorkspaceTraceFilter | null;
  onClearTraceFilter?: () => void;
  onClose?: () => void;
  /** Full-page URL for “open in new tab” */
  debugFullPageHref?: string | null;
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/15 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xs">{value}</div>
    </div>
  );
}

export function DebugWorkspace({
  threadId,
  runId,
  mode,
  threadQuery,
  traceFilter,
  onClearTraceFilter,
  onClose,
  debugFullPageHref,
}: DebugWorkspaceProps) {
  const [debugSummary, setDebugSummary] = useState<RunDebugSummary | null>(null);
  const [trace, setTrace] = useState<RunTraceResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) {
      setDebugSummary(null);
      setTrace(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const loadDebugWorkspace = async () => {
      const [debugPayload, tracePayload] = await Promise.all([
        apiClient.getRunDebug(runId, controller.signal),
        apiClient.getFullRunTrace(runId, controller.signal),
      ]);
      setDebugSummary(debugPayload);
      setTrace(tracePayload);
    };

    void loadDebugWorkspace()
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Failed to load debug workspace", error);
          setDebugSummary(null);
          setTrace(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [runId]);

  useEffect(() => {
    if (!runId || !debugSummary || !["queued", "running"].includes(debugSummary.run.status)) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const [nextSummary, nextTrace] = await Promise.all([
          apiClient.getRunDebug(runId, controller.signal),
          apiClient.getFullRunTrace(runId, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setDebugSummary(nextSummary);
          setTrace(nextTrace);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Failed to refresh debug workspace", error);
        }
      }
    }, 3000);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [debugSummary, runId]);

  const filteredTrace = useMemo(() => filterTraceForRow(trace, traceFilter ?? null), [trace, traceFilter]);

  const groupedTrace = useMemo(() => (filteredTrace ? groupTrace(filteredTrace) : []), [filteredTrace]);

  const traceEventCount = filteredTrace?.events.length ?? 0;
  const traceTotal = trace?.total ?? 0;

  const inner = !runId ? (
    <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
      No run is available for this thread yet.
    </div>
  ) : loading ? (
    <div className="rounded-md border p-8 text-center">
      <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
    </div>
  ) : !debugSummary ? (
    <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
      No debug payload returned.
    </div>
  ) : (
    <Tabs defaultValue="summary" className="flex flex-col min-h-0 flex-1">
      <TabsList className="h-9 shrink-0 w-full justify-start overflow-x-auto">
        <TabsTrigger value="summary" className="text-[11px]">
          Summary
        </TabsTrigger>
        <TabsTrigger value="ledger" className="text-[11px]">
          Ledger
        </TabsTrigger>
        <TabsTrigger value="trace" className="text-[11px]">
          Trace ({traceEventCount}
          {traceFilter?.rowName && traceEventCount !== traceTotal ? ` / ${traceTotal}` : ""})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="summary" className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground border rounded-md bg-muted/20 px-3 py-2">
          <span>
            <span className="font-medium text-foreground">Stage</span>{" "}
            <span className="font-mono">{debugSummary.run.stage}</span>
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="font-medium text-foreground">Elapsed</span>{" "}
            {formatDuration(debugSummary.run.metrics.elapsedMs)}
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="font-medium text-foreground">Cost</span>{" "}
            {formatUsd(debugSummary.run.metrics.estimatedCostUsd)}
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="font-medium text-foreground">Rows</span>{" "}
            <span className="font-mono">
              {debugSummary.run.progress.rowsCreated}/{debugSummary.run.progress.totalRows || "—"}
            </span>
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="font-medium text-foreground">LLM</span>{" "}
            <span className="font-mono">{debugSummary.run.metrics.llmCalls}</span>
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="font-medium text-foreground">Search</span>{" "}
            <span className="font-mono">{debugSummary.run.metrics.searchCalls}</span>
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="font-medium text-foreground">Fetch</span>{" "}
            <span className="font-mono">{debugSummary.run.metrics.fetchCalls}</span>
          </span>
        </div>

        <details className="rounded-md border bg-card" open>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Checkpoints</summary>
          <div className="border-t px-3 py-2 space-y-2 text-xs">
            {debugSummary.checkpoints.map((checkpoint) => (
              <div key={checkpoint.label} className="flex items-center justify-between rounded border px-2 py-1.5">
                <span>{checkpoint.label}</span>
                <Badge variant={checkpoint.reached ? "secondary" : "outline"} className="text-[10px]">
                  {checkpoint.reached ? "reached" : "pending"}
                </Badge>
              </div>
            ))}
          </div>
        </details>
      </TabsContent>

      <TabsContent value="ledger" className="mt-3 flex-1 min-h-0 overflow-y-auto">
        <h2 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          Provider ledger
        </h2>
        <div className="space-y-2 text-xs">
          {debugSummary.providerBreakdown.map((metric) => (
            <div key={`${metric.providerName}:${metric.operation}`} className="rounded border p-2 bg-card">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono truncate">
                  {metric.providerName}:{metric.operation}
                </span>
                <span className="shrink-0">{metric.requestCount}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {metric.tokenIn} in · {metric.tokenOut} out · {formatUsd(metric.estimatedCostUsd)}
              </div>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="trace" className="mt-3 flex-1 min-h-0 overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between gap-2 shrink-0 mb-2">
          <h2 className="text-sm font-medium">Trace</h2>
          {filteredTrace && (
            <div className="text-xs text-muted-foreground font-mono">
              page {filteredTrace.page} · {filteredTrace.events.length} events
              {traceTotal > 0 && traceEventCount !== traceTotal ? ` (of ${traceTotal} total)` : ""}
            </div>
          )}
        </div>
        {traceFilter?.rowName ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
            <Badge variant="secondary" className="font-normal">
              Row: {traceFilter.rowName}
            </Badge>
            {traceEventCount === 0 ? (
              <span className="text-muted-foreground">No trace lines matched this row.</span>
            ) : null}
            {onClearTraceFilter ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onClearTraceFilter}>
                Show full trace
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-2 min-h-0 overflow-y-auto pr-1 flex-1">
          {groupedTrace.map((group) => {
            const key = group.key;
            const isExpanded = expanded.has(key);
            return (
              <div key={key} className="rounded-md border bg-card">
                <button
                  type="button"
                  onClick={() => {
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <span className="text-sm font-medium">{group.title}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {group.type}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {group.count} event{group.count === 1 ? "" : "s"} grouped
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t px-3 py-3 space-y-3">
                    {group.steps.map((step) => (
                      <div key={step.id} className="rounded border bg-muted/15 p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {step.actor}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {step.eventStatus}
                          </Badge>
                        </div>
                        <div className="text-sm">{step.detail}</div>
                        {step.reasoning && (
                          <div className="text-xs text-muted-foreground leading-relaxed">{step.reasoning}</div>
                        )}
                        {step.toolCalls?.length ? (
                          <div className="space-y-2">
                            {step.toolCalls.map((tool, index) => (
                              <div key={`${tool.name}:${index}`} className="rounded border bg-background p-2">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <Badge variant="secondary" className="font-mono text-[10px]">
                                    {tool.name}
                                  </Badge>
                                  <span>{formatDuration(tool.latencyMs)}</span>
                                  <span>{formatUsd(tool.costUsd)}</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{tool.summary}</p>
                                {(tool.input || tool.output) && (
                                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                                    {tool.input && (
                                      <pre className="rounded border bg-muted/20 p-2 text-[10px] font-mono whitespace-pre-wrap break-words">
                                        {tool.input}
                                      </pre>
                                    )}
                                    {tool.output && (
                                      <pre className="rounded border bg-muted/20 p-2 text-[10px] font-mono whitespace-pre-wrap break-words">
                                        {tool.output}
                                      </pre>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <details className="rounded border bg-background px-2 py-1.5">
                          <summary className="cursor-pointer text-xs text-muted-foreground">Raw payload</summary>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] font-mono">
                            {JSON.stringify(step.payload ?? {}, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </TabsContent>
    </Tabs>
  );

  if (mode === "drawer") {
    return (
      <div className={cn("flex flex-col h-full min-h-0 bg-background")}>
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 shrink-0 bg-card">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">Debug workspace</h1>
            {threadQuery ? (
              <p className="text-[11px] text-muted-foreground truncate" title={threadQuery}>
                {threadQuery}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {debugFullPageHref ? (
              <Button asChild variant="outline" size="sm" className="h-8 text-[11px] gap-1">
                <a href={debugFullPageHref} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" />
                  New tab
                </a>
              </Button>
            ) : null}
            {onClose ? (
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close debug panel">
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-3 flex flex-col">{inner}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Button asChild variant="ghost" size="sm" className="px-0 text-xs">
              <Link to="/">
                <ArrowLeft className="h-3 w-3 mr-1" />
                Back to workspace
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Debug workspace</h1>
              <p className="text-sm text-muted-foreground">
                Full execution trace, provider ledger, checkpoints, and raw payloads for engineer-facing inspection.
              </p>
            </div>
          </div>
          {threadQuery ? (
            <div className="rounded-md border bg-card px-3 py-2 text-right max-w-[360px]">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Thread</div>
              <div className="text-sm font-medium">{threadQuery}</div>
            </div>
          ) : null}
        </div>
        {inner}
      </div>
    </div>
  );
}
