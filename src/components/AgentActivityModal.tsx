import { useState } from "react";
import {
  Bot, ChevronDown, ChevronRight, Search, Pencil, CheckCircle2, AlertCircle, Loader2, Lightbulb, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { AgentStep } from "@/lib/types";

const agentIcons: Record<string, React.ReactNode> = {
  Rewriter: <Pencil className="h-3 w-3" />,
  Search: <Search className="h-3 w-3" />,
  Evaluator: <CheckCircle2 className="h-3 w-3" />,
  Extractor: <Wrench className="h-3 w-3" />,
};

const stepColors: Record<string, string> = {
  rewrite: "border-l-primary",
  search: "border-l-warning",
  evaluate: "border-l-success",
  extract: "border-l-accent-foreground",
  reasoning: "border-l-muted-foreground",
};

interface AgentActivityModalProps {
  steps: AgentStep[];
}

export function AgentActivityModal({ steps }: AgentActivityModalProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const runningCount = steps.filter((s) => s.status === "running").length;

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
          <Bot className="h-3 w-3" />
          Agent Activity
          {runningCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono">
              {runningCount} active
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Agent Activity
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1">
            {steps.map((step) => {
              const expanded = expandedSteps.has(step.id);
              return (
                <div
                  key={step.id}
                  className={`border-l-2 ${stepColors[step.type] || "border-l-border"} rounded-r-md`}
                >
                  <button
                    onClick={() => toggleStep(step.id)}
                    className="w-full flex items-start gap-2 p-2 text-left hover:bg-muted/30 rounded-r-md transition-colors"
                  >
                    <div className="mt-0.5 shrink-0 text-muted-foreground">
                      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </div>
                    <div className="shrink-0 mt-0.5">{agentIcons[step.agent]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium">{step.title}</span>
                        {step.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
                        {step.status === "error" && <AlertCircle className="h-2.5 w-2.5 text-destructive" />}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{step.agent} Agent</span>
                    </div>
                  </button>
                  {expanded && (
                    <div className="px-8 pb-2 space-y-2">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{step.detail}</p>
                      {step.toolCalls && step.toolCalls.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Tool Calls</span>
                          {step.toolCalls.map((tc, i) => (
                            <div key={i} className="bg-muted/50 rounded p-1.5 font-mono text-[10px] space-y-0.5">
                              <div className="flex items-center gap-1">
                                <Wrench className="h-2.5 w-2.5 text-muted-foreground" />
                                <span className="font-medium">{tc.name}</span>
                              </div>
                              <div className="text-muted-foreground pl-3.5 break-all">{tc.input}</div>
                              {tc.output && (
                                <div className="text-success pl-3.5 break-all">→ {tc.output}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
