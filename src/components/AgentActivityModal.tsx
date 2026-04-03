import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Database,
  Download,
  Eye,
  Loader2,
  Search,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { AgentStep } from "@/lib/types";

const stageIcons: Record<string, ReactNode> = {
  planning: <Activity className="h-3.5 w-3.5" />,
  discovery: <Search className="h-3.5 w-3.5" />,
  fetch: <Database className="h-3.5 w-3.5" />,
  extraction: <Eye className="h-3.5 w-3.5" />,
  evaluation: <CheckCircle2 className="h-3.5 w-3.5" />,
  canonicalization: <Activity className="h-3.5 w-3.5" />,
  verification: <AlertCircle className="h-3.5 w-3.5" />,
  ranking: <CheckCircle2 className="h-3.5 w-3.5" />,
  export: <Download className="h-3.5 w-3.5" />,
};

const stepColors: Record<string, string> = {
  planning: "border-l-primary",
  discovery: "border-l-warning",
  fetch: "border-l-accent-foreground",
  extraction: "border-l-success",
  evaluation: "border-l-success",
  canonicalization: "border-l-muted-foreground",
  verification: "border-l-amber-500",
  ranking: "border-l-primary",
  export: "border-l-emerald-500",
};

interface AgentActivityModalProps {
  steps: AgentStep[];
}

function formatUsd(value: number | undefined) {
  return typeof value === "number" ? `$${value.toFixed(4)}` : "—";
}

function formatDuration(value: number | undefined) {
  return typeof value === "number" ? `${value} ms` : "—";
}

function statusBadge(step: AgentStep) {
  switch (step.eventStatus) {
    case "started":
      return (
        <Badge variant="outline" className="gap-1 text-[9px] uppercase tracking-wider">
          <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
          Started
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="secondary" className="text-[9px] uppercase tracking-wider">
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-[9px] uppercase tracking-wider">
          Failed
        </Badge>
      );
    case "skipped":
      return (
        <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
          Skipped
        </Badge>
      );
  }
}

function computeActiveCount(steps: AgentStep[]) {
  const latestByStage = new Map<string, AgentStep>();
  for (const step of steps) {
    latestByStage.set(step.type, step);
  }
  return [...latestByStage.values()].filter((step) => step.eventStatus === "started").length;
}

export function AgentActivityModal({ steps }: AgentActivityModalProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const runningCount = useMemo(() => computeActiveCount(steps), [steps]);

  const toggleStep = (id: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
          <Activity className="h-3 w-3" />
          Execution
          {runningCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono">
              {runningCount} active
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,1100px)] max-w-5xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Execution Trace
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            Stage logs, tool calls, reasoning summaries, reward proxies, and raw payloads for the current run.
          </p>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-3 space-y-2">
            {steps.length === 0 && (
              <div className="rounded-md border border-dashed px-4 py-8 text-center text-[11px] text-muted-foreground">
                Start a run to inspect stage-by-stage execution details.
              </div>
            )}
            {steps.map((step) => {
              const expanded = expandedSteps.has(step.id);
              return (
                <div
                  key={step.id}
                  className={`border-l-2 ${stepColors[step.type] || "border-l-border"} rounded-r-md border bg-card/60`}
                >
                  <button
                    onClick={() => toggleStep(step.id)}
                    className="w-full flex items-start gap-2.5 p-3 text-left hover:bg-muted/20 rounded-r-md transition-colors"
                  >
                    <div className="mt-0.5 shrink-0 text-muted-foreground">
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </div>
                    <div className="shrink-0 mt-0.5 text-muted-foreground">{stageIcons[step.type]}</div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium">{step.title}</span>
                        <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                          {step.actor}
                        </Badge>
                        {statusBadge(step)}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">{step.type}</span>
                        {step.checkpoint && (
                          <>
                            <span>•</span>
                            <span>{step.checkpoint}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                  {expanded && (
                    <div className="px-9 pb-3 space-y-3">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{step.detail}</p>

                      {step.reasoning && (
                        <section className="space-y-1">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                            Reasoning Summary
                          </span>
                          <div className="rounded-md border bg-muted/25 px-2.5 py-2 text-[11px] leading-relaxed">
                            {step.reasoning}
                          </div>
                        </section>
                      )}

                      {step.toolCalls && step.toolCalls.length > 0 && (
                        <section className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <Wrench className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                              Tool Calls
                            </span>
                          </div>
                          <div className="grid gap-2">
                            {step.toolCalls.map((tool, index) => (
                              <div key={`${tool.name}:${index}`} className="rounded-md border bg-background/70 p-2 space-y-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge variant="secondary" className="font-mono text-[10px]">
                                    {tool.name}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">{formatDuration(tool.latencyMs)}</span>
                                  <span className="text-[10px] text-muted-foreground">{formatUsd(tool.costUsd)}</span>
                                  {tool.cacheHit && (
                                    <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                                      Cache hit
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">{tool.summary}</p>
                                {(tool.input || tool.output) && (
                                  <div className="grid gap-2 md:grid-cols-2">
                                    {tool.input && (
                                      <div className="rounded border bg-muted/20 p-2">
                                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                                          Input
                                        </div>
                                        <pre className="whitespace-pre-wrap break-words text-[10px] font-mono text-foreground/90">
                                          {tool.input}
                                        </pre>
                                      </div>
                                    )}
                                    {tool.output && (
                                      <div className="rounded border bg-muted/20 p-2">
                                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                                          Output
                                        </div>
                                        <pre className="whitespace-pre-wrap break-words text-[10px] font-mono text-foreground/90">
                                          {tool.output}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {step.rewards && step.rewards.length > 0 && (
                        <section className="space-y-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                            Reward Proxies
                          </span>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {step.rewards.map((reward) => (
                              <div key={reward.label} className="rounded-md border bg-background/70 px-2.5 py-2">
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                  {reward.label}
                                </div>
                                <div className="mt-1 font-mono text-[11px]">{reward.value}</div>
                                {reward.hint && (
                                  <div className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                                    {reward.hint}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {step.metrics && step.metrics.length > 0 && (
                        <section className="space-y-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                            Provider Ledger
                          </span>
                          <div className="space-y-1">
                            {step.metrics.map((metric) => (
                              <div
                                key={`${metric.providerName}:${metric.operation}`}
                                className="flex items-center justify-between rounded bg-muted/35 px-2 py-1 text-[10px] font-mono gap-2"
                              >
                                <span className="truncate">
                                  {metric.providerName}:{metric.operation}
                                </span>
                                <span className="shrink-0">{metric.requestCount}</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      <details className="rounded-md border bg-muted/15 px-2.5 py-2">
                        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          Raw Payload
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] font-mono text-foreground/90">
                          {JSON.stringify(step.payload ?? {}, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
