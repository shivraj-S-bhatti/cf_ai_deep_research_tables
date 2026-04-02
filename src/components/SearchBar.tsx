import { useState } from "react";
import { Search, Sparkles, Pencil, X, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Thread, Criterion } from "@/lib/types";

interface SearchBarProps {
  thread: Thread;
  onUpdateQuery: (query: string) => void;
}

export function SearchBar({ thread, onUpdateQuery }: SearchBarProps) {
  const [showCriteria, setShowCriteria] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={thread.query}
            onChange={(e) => onUpdateQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
            readOnly
          />
        </div>
      </div>
      <button
        onClick={() => setShowCriteria(!showCriteria)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {showCriteria ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        {thread.criteria.length} criteria
      </button>
      {showCriteria && (
        <div className="space-y-1 pl-3 border-l-2 border-border">
          {thread.criteria.map((c, i) => (
            <div key={c.id} className="flex items-center gap-1.5 text-[11px]">
              <span className="font-mono text-[9px] text-muted-foreground w-3">{i + 1}</span>
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
              <span className="text-muted-foreground">{c.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
