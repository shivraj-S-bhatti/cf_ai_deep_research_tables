import { X, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { SearchResult } from "@/lib/mock-data";

interface ProvenanceSidebarProps {
  result: SearchResult | null;
  onClose: () => void;
}

export function ProvenanceSidebar({ result, onClose }: ProvenanceSidebarProps) {
  if (!result) return null;

  return (
    <div className="w-[380px] shrink-0 border-l bg-card overflow-y-auto animate-in slide-in-from-right-4 duration-200">
      <div className="sticky top-0 bg-card border-b px-4 py-3 flex items-center justify-between z-10">
        <div>
          <h3 className="font-semibold text-sm">{result.name}</h3>
          <a
            href={`https://${result.url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            {result.url}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Criteria Evaluations
        </h4>
        {result.evaluations.map((ev, i) => (
          <div key={i}>
            <div className="flex items-start gap-2.5 py-3">
              <div className="mt-0.5 shrink-0">
                {ev.passed ? (
                  <div className="h-5 w-5 rounded-full bg-success/15 flex items-center justify-center">
                    <Check className="h-3 w-3 text-success" />
                  </div>
                ) : (
                  <div className="h-5 w-5 rounded-full bg-destructive/15 flex items-center justify-center">
                    <X className="h-3 w-3 text-destructive" />
                  </div>
                )}
              </div>
              <div className="space-y-1.5 min-w-0">
                <p className="text-sm font-medium leading-tight">{ev.rule}</p>
                <p className="text-xs italic text-muted-foreground leading-relaxed">
                  {ev.snippet}
                </p>
                <a
                  href={ev.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block"
                >
                  <Badge variant="outline" className="text-[10px] gap-1 hover:bg-muted cursor-pointer">
                    [{i + 1}] {ev.source}
                  </Badge>
                </a>
              </div>
            </div>
            {i < result.evaluations.length - 1 && <Separator />}
          </div>
        ))}
      </div>
    </div>
  );
}
