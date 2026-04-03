import { useState } from "react";
import {
  Download,
  Filter,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentActivityModal } from "@/components/AgentActivityModal";
import type {
  AgentStep,
  DatasetSortDir,
  DatasetSortKey,
  TableFilterCondition,
  TableFilterField,
  TableFilterOperator,
} from "@/lib/types";

const FIELD_LABELS: Record<TableFilterField, string> = {
  name: "Name",
  url: "URL",
  status: "Status",
};

const OPERATORS: { value: TableFilterOperator; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "does_not_contain", label: "does not contain" },
  { value: "equals", label: "equals" },
  { value: "does_not_equal", label: "does not equal" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

function needsValue(op: TableFilterOperator): boolean {
  return op !== "is_empty" && op !== "is_not_empty";
}

interface ActionToolbarProps {
  acceptedCount: number;
  totalCount: number;
  onExportCsv: () => void;
  agentSteps: AgentStep[];
  tableFilters: TableFilterCondition[];
  onAddTableFilter: () => void;
  onRemoveTableFilter: (id: string) => void;
  onUpdateTableFilter: (id: string, patch: Partial<TableFilterCondition>) => void;
  sortKey: DatasetSortKey | null;
  sortDir: DatasetSortDir;
  onSortChange: (key: DatasetSortKey | null, dir: DatasetSortDir) => void;
}

export function ActionToolbar({
  acceptedCount,
  totalCount,
  onExportCsv,
  agentSteps,
  tableFilters,
  onAddTableFilter,
  onRemoveTableFilter,
  onUpdateTableFilter,
  sortKey,
  sortDir,
  onSortChange,
}: ActionToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] text-muted-foreground font-mono truncate">
          {acceptedCount} accepted · {totalCount} visible
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 justify-end">
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={tableFilters.length > 0 ? "secondary" : "outline"}
              size="sm"
              className="gap-1 text-[11px] h-7"
            >
              <Filter className="h-3 w-3" />
              Filter
              {tableFilters.length > 0 && (
                <span className="font-mono text-[9px] opacity-80">({tableFilters.length})</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(100vw-2rem,22rem)] p-3" align="end">
            <p className="text-[11px] font-medium mb-2">Filter rows</p>
            <p className="text-[9px] text-muted-foreground mb-2">
              All conditions use <span className="font-mono">AND</span>.
            </p>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-0.5">
              {tableFilters.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2"
                >
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-muted-foreground w-10 shrink-0">Where</span>
                    <Select
                      value={row.field}
                      onValueChange={(v) =>
                        onUpdateTableFilter(row.id, { field: v as TableFilterField })
                      }
                    >
                      <SelectTrigger className="h-7 flex-1 min-w-[5rem] text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(FIELD_LABELS) as TableFilterField[]).map((f) => (
                          <SelectItem key={f} value={f} className="text-xs">
                            {FIELD_LABELS[f]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Select
                    value={row.operator}
                    onValueChange={(v) =>
                      onUpdateTableFilter(row.id, { operator: v as TableFilterOperator })
                    }
                  >
                    <SelectTrigger className="h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {needsValue(row.operator) && (
                    <Input
                      placeholder="Value"
                      value={row.value}
                      onChange={(e) => onUpdateTableFilter(row.id, { value: e.target.value })}
                      className="h-7 text-xs"
                    />
                  )}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[10px] gap-1 text-destructive"
                      onClick={() => onRemoveTableFilter(row.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full mt-2 h-8 text-[11px] gap-1"
              onClick={onAddTableFilter}
            >
              <Plus className="h-3 w-3" />
              Add condition
            </Button>
          </PopoverContent>
        </Popover>

        <Select
          value={sortKey ?? "none"}
          onValueChange={(v) => {
            if (v === "none") onSortChange(null, sortDir);
            else onSortChange(v as DatasetSortKey, sortDir);
          }}
        >
          <SelectTrigger className="h-7 w-[128px] text-[11px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">
              No sort
            </SelectItem>
            <SelectItem value="name" className="text-xs">
              Name
            </SelectItem>
            <SelectItem value="url" className="text-xs">
              URL
            </SelectItem>
            <SelectItem value="status" className="text-xs">
              Status
            </SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={onExportCsv} className="gap-1 text-[11px] h-7">
          <Download className="h-3 w-3" />
          CSV
        </Button>

        <AgentActivityModal steps={agentSteps} />
      </div>
    </div>
  );
}
