import { useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface InitialSearchProps {
  onSearch: (query: string) => void;
}

export function InitialSearch({ onSearch }: InitialSearchProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = () => {
    if (query.trim()) onSearch(query.trim());
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-2xl space-y-6 px-4">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">What are you researching?</h1>
          <p className="text-sm text-muted-foreground">
            Describe what you're looking for in natural language. The agent will search, verify, and structure the results.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="e.g. AI engineers in New York with design experience at post Series-A startups"
            className="pl-10 h-12 text-sm"
          />
        </div>
        <div className="flex justify-center">
          <Button onClick={handleSubmit} className="gap-2 h-10 px-6" disabled={!query.trim()}>
            <Sparkles className="h-4 w-4" />
            Start Research
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          {[
            "AI engineers in NY with design experience",
            "YC W24 healthcare startups",
            "Open source LLM projects with >1k stars",
          ].map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setQuery(suggestion)}
              className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
