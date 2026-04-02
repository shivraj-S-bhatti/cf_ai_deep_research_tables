import { ExternalLink, Globe, Loader2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import type { SearchResult, Enrichment } from "@/lib/types";

interface DataGridProps {
  results: SearchResult[];
  enrichments: Enrichment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function DataGrid({ results, enrichments, selectedId, onSelect }: DataGridProps) {
  return (
    <div className="border rounded-md overflow-hidden text-xs">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-8 text-[10px] font-medium text-muted-foreground px-2">#</TableHead>
            <TableHead className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider min-w-[140px]">Name</TableHead>
            <TableHead className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">URL</TableHead>
            <TableHead className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider w-20">Status</TableHead>
            <TableHead className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider w-16">
              <Globe className="h-3 w-3 inline mr-1" />
              Srcs
            </TableHead>
            {enrichments.map((col) => (
              <TableHead key={col.id} className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {col.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((row, i) => {
            const isSelected = selectedId === row.id;
            return (
              <TableRow
                key={row.id}
                onClick={() => onSelect(row.id)}
                className={`cursor-pointer h-8 transition-colors ${
                  isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/20"
                }`}
              >
                <TableCell className="text-[10px] text-muted-foreground px-2 font-mono">{i + 1}</TableCell>
                <TableCell className="font-medium text-xs py-1.5">{row.name}</TableCell>
                <TableCell className="py-1.5">
                  <a
                    href={`https://${row.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:underline text-xs inline-flex items-center gap-0.5"
                  >
                    {row.url}
                    <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                  </a>
                </TableCell>
                <TableCell className="py-1.5">
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="py-1.5 text-center">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {row.sourcesVisited.length}
                  </span>
                </TableCell>
                {enrichments.map((col) => {
                  const ev = row.enrichments[col.name];
                  if (!ev) return <TableCell key={col.id} className="text-muted-foreground py-1.5">—</TableCell>;
                  if (ev.status === "extracting") {
                    return (
                      <TableCell key={col.id} className="py-1.5">
                        <span className="inline-flex items-center gap-1 text-muted-foreground italic text-[11px]">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        </span>
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={col.id} className="text-xs py-1.5">
                      {ev.value}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
