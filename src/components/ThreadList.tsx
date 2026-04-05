import { Plus, Search, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Thread } from "@/lib/types";

interface ThreadListProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onStopRun?: (threadId: string, runId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  className?: string;
}

const phaseLabels: Record<string, string> = {
  preview: "Preview",
  queued: "Queued",
  running: "Running…",
  complete: "Complete",
  failed: "Failed",
  canceled: "Canceled",
};

export function ThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onStopRun,
  onDeleteThread,
  className,
}: ThreadListProps) {
  return (
    <div
      className={cn(
        "w-full min-w-0 max-w-[252px] shrink-0 border-r bg-sidebar flex flex-col h-full min-h-0 overflow-hidden",
        className,
      )}
    >
      <div className="p-2.5 border-b shrink-0">
        <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs h-7 min-w-0" onClick={onNewThread}>
          <Plus className="h-3 w-3 shrink-0" />
          New Research
        </Button>
      </div>
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
        <ul className="p-1.5 space-y-0.5 w-full max-w-full min-w-0 list-none">
          {threads.map((t) => {
            const isActive = t.id === activeThreadId;
            const run = t.latestRun;
            const canStop =
              Boolean(onStopRun && run?.id && (run.status === "queued" || run.status === "running"));
            return (
              <li key={t.id} className="min-w-0 max-w-full">
                <div
                  className={cn(
                    "flex items-stretch gap-0.5 rounded-md border border-transparent",
                    isActive ? "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border/40" : "hover:bg-sidebar-accent/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectThread(t.id)}
                    className={cn(
                      "flex-1 min-w-0 text-left px-2 py-2 rounded-md transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      !isActive && "text-sidebar-foreground",
                    )}
                  >
                    <div className="flex items-start gap-2 w-full min-w-0 max-w-full">
                      <Search className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1 basis-0 overflow-hidden max-w-full">
                        <span className="text-[11px] font-medium leading-tight block w-full truncate" title={t.query}>
                          {t.query}
                        </span>
                        <div className="flex items-center gap-1.5 mt-1 min-w-0 max-w-full">
                          <span className="text-[9px] text-muted-foreground truncate min-w-0">
                            {phaseLabels[t.phase] ?? t.phase}
                          </span>
                          {(t.results.length > 0 || (t.latestRun?.progress.totalRows ?? 0) > 0) && (
                            <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                              · {t.results.length || t.latestRun?.progress.totalRows || 0} rows
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                  <div className="flex flex-col justify-center gap-0.5 shrink-0 py-1 pr-1">
                    {canStop && run?.id ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        aria-label={`Stop run for thread`}
                        title="Stop run"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopRun?.(t.id, run.id);
                        }}
                      >
                        <Square className="h-3 w-3 fill-current" />
                      </Button>
                    ) : null}
                    {onDeleteThread ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label="Delete thread"
                        title="Delete thread"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteThread(t.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
