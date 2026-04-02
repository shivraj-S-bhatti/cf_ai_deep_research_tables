import { useState } from "react";
import { Filter, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ActionToolbarProps {
  matchCount: number;
  totalCount: number;
  onAddEnrichment: (name: string) => void;
  onFilterMatches: () => void;
  onExportCsv: () => void;
}

export function ActionToolbar({
  matchCount,
  totalCount,
  onAddEnrichment,
  onFilterMatches,
  onExportCsv,
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
        <span className="text-sm text-muted-foreground">
          {matchCount} matches / {totalCount} results
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onFilterMatches} className="gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Filter Matches
        </Button>
        <Button variant="outline" size="sm" onClick={onExportCsv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Enrichment
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="end">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">New Enrichment Column</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add a custom column to extract from the web
                </p>
              </div>
              <Input
                placeholder='e.g. "GitHub Link", "Email"'
                value={newCol}
                onChange={(e) => setNewCol(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExtract()}
              />
              <Button size="sm" className="w-full" onClick={handleExtract}>
                Extract
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
