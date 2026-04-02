import { useState } from "react";
import { Filter, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

interface ActionToolbarProps {
  matchCount: number;
  totalCount: number;
  onAddEnrichment: (name: string) => void;
  onFilterMatches: () => void;
  onExportCsv: () => void;
  filterActive: boolean;
}

export function ActionToolbar({
  matchCount, totalCount, onAddEnrichment, onFilterMatches, onExportCsv, filterActive,
}: ActionToolbarProps) {
  const [newCol, setNewCol] = useState("");
  const [open, setOpen] = useState(false);

  const handleExtract = () => {
    if (newCol.trim()) {
      onAddEnrichment(newCol.trim());
      setNewCol("");
      setOpen(false);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground font-mono">
          {matchCount}/{totalCount} matches
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant={filterActive ? "secondary" : "outline"}
          size="sm"
          onClick={onFilterMatches}
          className="gap-1 text-[11px] h-7"
        >
          <Filter className="h-3 w-3" />
          Matches only
        </Button>
        <Button variant="outline" size="sm" onClick={onExportCsv} className="gap-1 text-[11px] h-7">
          <Download className="h-3 w-3" />
          CSV
        </Button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" className="gap-1 text-[11px] h-7">
              <Plus className="h-3 w-3" />
              Enrichment
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="end">
            <div className="space-y-2">
              <p className="text-[11px] font-medium">Add enrichment column</p>
              <Input
                placeholder='e.g. "GitHub Link"'
                value={newCol}
                onChange={(e) => setNewCol(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExtract()}
                className="text-xs h-8"
              />
              <Button size="sm" className="w-full h-7 text-xs" onClick={handleExtract}>
                Extract
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
