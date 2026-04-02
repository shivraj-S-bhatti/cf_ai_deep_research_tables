import { useState } from "react";
import { Search, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SearchCriterion } from "@/lib/mock-data";

interface SearchBarProps {
  criteria: SearchCriterion[];
  onSearch: (query: string) => void;
}

export function SearchBar({ criteria, onSearch }: SearchBarProps) {
  const [query, setQuery] = useState(
    "AI engineers in new york that are great at design and have worked at a post Series-A startup"
  );
  const [targetResults, setTargetResults] = useState("25");
  const [showCriteria, setShowCriteria] = useState(true);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe who you're looking for..."
            className="pl-10 h-11 text-sm"
          />
        </div>
        <Select value={targetResults} onValueChange={setTargetResults}>
          <SelectTrigger className="w-[100px] h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={() => onSearch(query)}
          className="h-11 px-6 gap-2"
        >
          <Sparkles className="h-4 w-4" />
          Start Search
        </Button>
      </div>

      <div>
        <button
          onClick={() => setShowCriteria(!showCriteria)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showCriteria ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          Search Criteria ({criteria.length} rules)
        </button>
        {showCriteria && (
          <div className="mt-2 pl-4 space-y-1.5 border-l-2 border-border">
            {criteria.map((c, i) => (
              <div key={c.id} className="flex items-start gap-2 text-sm">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono shrink-0">
                  {i + 1}
                </Badge>
                <span className="text-muted-foreground">{c.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
