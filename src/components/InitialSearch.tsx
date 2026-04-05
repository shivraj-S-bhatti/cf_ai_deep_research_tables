import { useState } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface InitialSearchProps {
  onSearch: (query: string) => void;
  isSubmitting?: boolean;
}

const SAMPLE_CARDS: { title: string; query: string; blurb: string; tags: string[] }[] = [
  {
    title: "YC W24 healthcare startups",
    query: "YC W24 healthcare startups",
    blurb: "Track funding, geography, and traction.",
    tags: ["Startups", "Health"],
  },
  {
    title: "Open-source LLM repos, 1k+ stars",
    query: "Open source LLM projects with >1k stars",
    blurb: "Compare momentum across active projects.",
    tags: ["OSS", "ML"],
  },
  {
    title: "Top pizza spots in Brooklyn",
    query: "Top pizza places in Brooklyn",
    blurb: "Compile ranked options with evidence links.",
    tags: ["Local", "Food"],
  },
];

export function InitialSearch({ onSearch, isSubmitting = false }: InitialSearchProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = () => {
    if (query.trim()) onSearch(query.trim());
  };

  return (
    <div className="flex-1 flex items-center justify-center overflow-y-auto py-10 sm:py-12">
      <div className="w-full max-w-5xl space-y-8 px-4 sm:space-y-10 sm:px-6">
        <div className="space-y-2 text-center">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Research, structured.
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Get sourced datasets you can iterate.
          </p>
        </div>

        <div className="rounded-xl border border-border/80 bg-card py-1.5 pl-2.5 pr-1.5 shadow-sm sm:pl-3 sm:pr-2 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[min(100%,12rem)] min-h-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isSubmitting && handleSubmit()}
              placeholder="e.g. YC W24 healthcare startups"
              className="h-9 max-h-9 border-0 bg-transparent pl-8 pr-2 text-sm shadow-none placeholder:text-muted-foreground/80 focus-visible:ring-0 sm:h-10 sm:max-h-10 sm:text-[15px]"
              disabled={isSubmitting}
            />
          </div>
          <Button
            type="button"
            onClick={handleSubmit}
            className="h-9 shrink-0 gap-1.5 px-4 text-sm font-medium sm:h-10 sm:px-5"
            disabled={!query.trim() || isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            )}
            {isSubmitting ? "Building preview…" : "Start Research"}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {SAMPLE_CARDS.map((card, index) => (
            <button
              key={card.query}
              type="button"
              onClick={() => setQuery(card.query)}
              className="group flex min-h-[160px] flex-col rounded-2xl border border-border/80 bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[188px] sm:p-5"
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                Sample {index + 1}
              </span>
              <span className="mt-2 line-clamp-3 text-base font-semibold leading-snug text-foreground">
                {card.title}
              </span>
              <span className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {card.blurb}
              </span>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                {card.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-border/80 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}
