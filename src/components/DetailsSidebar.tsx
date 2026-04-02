import { useState } from "react";
import { X, Check, ExternalLink, Globe, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SearchResult } from "@/lib/types";

interface DetailsSidebarProps {
  result: SearchResult | null;
  onClose: () => void;
}

export function DetailsSidebar({ result, onClose }: DetailsSidebarProps) {
  const [expandedSources, setExpandedSources] = useState(true);

  if (!result) return null;

  const passedCount = result.evaluations.filter((e) => e.passed).length;

  return (
    <div className="w-[340px] shrink-0 border-l bg-card flex flex-col animate-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="border-b px-3 py-2.5 flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold text-xs truncate">{result.name}</h3>
          <a
            href={`https://${result.url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
          >
            {result.url}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Tabs defaultValue="details" className="flex-1 flex flex-col">
        <TabsList className="rounded-none border-b bg-transparent h-8 px-3 justify-start gap-3">
          <TabsTrigger value="details" className="text-[11px] h-7 px-2 data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
            Details
          </TabsTrigger>
          <TabsTrigger value="sources" className="text-[11px] h-7 px-2 data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
            Sources ({result.sourcesVisited.length})
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value="details" className="mt-0 p-3 space-y-3">
            {/* Score summary */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Criteria</span>
              <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                {passedCount}/{result.evaluations.length} passed
              </span>
            </div>

            {result.evaluations.map((ev, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">
                    {ev.passed ? (
                      <div className="h-4 w-4 rounded-full bg-success/15 flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-success" />
                      </div>
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-destructive/15 flex items-center justify-center">
                        <X className="h-2.5 w-2.5 text-destructive" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="text-[11px] font-medium leading-tight">{ev.rule}</p>
                    <p className="text-[10px] italic text-muted-foreground leading-relaxed">
                      {ev.snippet}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {ev.sources.map((src, j) => (
                        <a
                          key={j}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Badge variant="outline" className="text-[9px] gap-0.5 hover:bg-muted cursor-pointer h-4 px-1">
                            {src.favicon && <img src={src.favicon} alt="" className="h-2.5 w-2.5" />}
                            {src.title}
                          </Badge>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
                {i < result.evaluations.length - 1 && <Separator className="my-1" />}
              </div>
            ))}

            {/* Enrichments */}
            {Object.keys(result.enrichments).length > 0 && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Enrichments</span>
                  {Object.entries(result.enrichments).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{key}</span>
                      <span className={val.status === "extracting" ? "italic text-muted-foreground" : "font-medium"}>
                        {val.value}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="sources" className="mt-0 p-3 space-y-1">
            <div className="flex items-center gap-1 mb-2">
              <button
                onClick={() => setExpandedSources(!expandedSources)}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                {expandedSources ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {result.sourcesVisited.length} sources visited
              </button>
            </div>
            {expandedSources &&
              result.sourcesVisited.map((src, i) => (
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
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[11px] font-medium truncate group-hover:text-primary transition-colors">
                      {src.title}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{src.url}</p>
                    <p className="text-[10px] text-muted-foreground italic line-clamp-2">{src.snippet}</p>
                  </div>
                </a>
              ))}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
