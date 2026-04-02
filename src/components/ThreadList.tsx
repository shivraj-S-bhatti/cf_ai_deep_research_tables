import { Plus, MessageSquare, Search, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Thread } from "@/lib/types";

interface ThreadListProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
}

const phaseLabels: Record<string, string> = {
  search: "Draft",
  preview: "Preview",
  running: "Running…",
  complete: "Complete",
};

export function ThreadList({ threads, activeThreadId, onSelectThread, onNewThread }: ThreadListProps) {
  return (
    <div className="w-[220px] shrink-0 border-r bg-sidebar flex flex-col">
      <div className="p-2.5 border-b">
        <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs h-7" onClick={onNewThread}>
          <Plus className="h-3 w-3" />
          New Research
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-0.5">
          {threads.map((t) => {
            const isActive = t.id === activeThreadId;
            return (
              <button
                key={t.id}
                onClick={() => onSelectThread(t.id)}
                className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                }`}
              >
                <div className="flex items-start gap-2">
                  <Search className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium truncate leading-tight">{t.query}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[9px] text-muted-foreground">{phaseLabels[t.phase]}</span>
                      {t.results.length > 0 && (
                        <span className="text-[9px] text-muted-foreground">
                          · {t.results.length} results
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
