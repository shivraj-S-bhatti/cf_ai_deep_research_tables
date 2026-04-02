import { ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import type { SearchResult } from "@/lib/mock-data";

interface DataGridProps {
  results: SearchResult[];
  enrichments: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function DataGrid({ results, enrichments, selectedId, onSelect }: DataGridProps) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-[200px] font-semibold text-xs uppercase tracking-wider">Name</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">URL</TableHead>
            <TableHead className="w-[120px] font-semibold text-xs uppercase tracking-wider">Status</TableHead>
            {enrichments.map((col) => (
              <TableHead key={col} className="font-semibold text-xs uppercase tracking-wider">
                {col}
                <span className="ml-1 text-[10px] text-primary font-normal normal-case">new</span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((row) => (
            <TableRow
              key={row.id}
              onClick={() => onSelect(row.id)}
              className={`cursor-pointer transition-colors ${
                selectedId === row.id
                  ? "bg-primary/5"
                  : "hover:bg-muted/30"
              }`}
            >
              <TableCell className="font-medium text-sm">{row.name}</TableCell>
              <TableCell>
                <a
                  href={`https://${row.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-primary hover:underline text-sm inline-flex items-center gap-1"
                >
                  {row.url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </TableCell>
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              {enrichments.map((col) => (
                <TableCell key={col} className="text-sm text-muted-foreground italic">
                  {row.status === "verifying" ? "Extracting…" : "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
