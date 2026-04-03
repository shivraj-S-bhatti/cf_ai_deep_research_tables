import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Expand, Loader2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import {
  isBlankTerminalCell,
  isPendingCell,
  isWeakTerminalCell,
  type ColumnDefinition,
  type SearchResult,
} from "@/lib/types";

interface DataGridProps {
  results: SearchResult[];
  columns: ColumnDefinition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const LONG_TEXT_LABEL = /(description|reasoning|summary|notes|snippet|about)/i;

function partitionRows(results: SearchResult[]) {
  const primary: SearchResult[] = [];
  const unmatched: SearchResult[] = [];

  for (const row of results) {
    if (row.status === "rejected" && row.processingState === "finalized") {
      unmatched.push(row);
    } else {
      primary.push(row);
    }
  }

  return { primary, unmatched };
}

function shouldAllowExpand(column: ColumnDefinition, value: string): boolean {
  if (!value) return false;
  if (LONG_TEXT_LABEL.test(column.label) || LONG_TEXT_LABEL.test(column.key)) return true;
  return value.length > 90;
}

function renderCellBase(row: SearchResult, column: ColumnDefinition) {
  const cell = row.cells[column.key];

  if (isPendingCell(cell)) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  if (isBlankTerminalCell(cell)) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  if (isWeakTerminalCell(cell)) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        {cell.valueText ?? cell.state}
      </span>
    );
  }

  if (column.valueType === "url" && cell.valueText) {
    return (
      <a
        href={cell.valueText}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline inline-flex items-center gap-0.5 text-[13px] leading-5"
        onClick={(event) => event.stopPropagation()}
      >
        {cell.valueText.replace(/^https?:\/\//, "")}
        <ExternalLink className="h-3 w-3 opacity-50" />
      </a>
    );
  }

  return <span className="text-[13px] leading-5">{cell?.valueText ?? "—"}</span>;
}

export function DataGrid({ results, columns, selectedId, onSelect }: DataGridProps) {
  const { primary, unmatched } = partitionRows(results);
  const totalColumns = columns.length + 5;
  const [expanded, setExpanded] = useState<{ rowId: string; columnKey: string } | null>(null);

  const expandedPayload = useMemo(() => {
    if (!expanded) return null;
    const row = results.find((entry) => entry.id === expanded.rowId);
    const column = columns.find((entry) => entry.key === expanded.columnKey);
    if (!row || !column) return null;
    const cell = row.cells[column.key];
    return { row, column, cell };
  }, [expanded, results, columns]);

  const renderRow = (row: SearchResult, indexLabel: string, muted = false) => {
    const isSelected = selectedId === row.id;
    return (
      <TableRow
        key={row.id}
        onClick={() => onSelect(row.id)}
        className={`cursor-pointer h-11 transition-colors ${
          isSelected
            ? "bg-primary/5 border-l-2 border-l-primary"
            : muted
              ? "bg-muted/25 text-muted-foreground hover:bg-muted/35"
              : "hover:bg-muted/20"
        }`}
      >
        <TableCell className="text-[11px] text-muted-foreground px-2 font-mono py-2">{indexLabel}</TableCell>
        <TableCell className={`font-semibold text-[13px] py-2 ${muted ? "text-foreground/75" : ""}`}>
          {row.name}
        </TableCell>
        <TableCell className="py-2">
          <a
            href={row.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline text-[13px] inline-flex items-center gap-0.5"
          >
            {row.url}
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
        </TableCell>
        <TableCell className="py-2">
          <StatusBadge status={row.status} processingState={row.processingState} />
        </TableCell>
        <TableCell className="py-2 text-center">
          <span className="text-[11px] text-muted-foreground font-mono">
            {row.sourceCount}
          </span>
        </TableCell>
        {columns.map((col) => (
          <TableCell key={col.id} className={`text-[13px] py-2 ${muted ? "text-foreground/75" : ""}`}>
            {(() => {
              const cell = row.cells[col.key];
              const value = cell?.valueText ?? "";
              const expandable = cell && shouldAllowExpand(col, value);

              if (!expandable) return renderCellBase(row, col);

              return (
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="truncate leading-5">{value || "—"}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-border p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpanded({ rowId: row.id, columnKey: col.key });
                    }}
                    title={`Expand ${col.label}`}
                    aria-label={`Expand ${col.label}`}
                  >
                    <Expand className="h-3 w-3" />
                  </button>
                </div>
              );
            })()}
          </TableCell>
        ))}
      </TableRow>
    );
  };

  return (
    <>
      <div className="h-full min-h-0 border rounded-md overflow-hidden bg-background">
      <Table className="min-w-[960px]">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-8 text-[11px] font-semibold text-muted-foreground px-2 uppercase tracking-[0.08em]">#</TableHead>
            <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] min-w-[160px]">Name</TableHead>
            <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">URL</TableHead>
            <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] w-24">Status</TableHead>
            <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] w-16">
              Srcs
            </TableHead>
            {columns.map((col) => (
              <TableHead key={col.id} className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] min-w-[140px]">
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {primary.map((row, index) => renderRow(row, String(index + 1)))}
          {unmatched.length > 0 && (
            <>
              <TableRow className="bg-muted/35 hover:bg-muted/35">
                <TableCell colSpan={totalColumns} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">
                      Unmatched candidates
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {unmatched.length} rejected after validation
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    These entities were discovered and evaluated, but failed the final match criteria.
                  </p>
                </TableCell>
              </TableRow>
              {unmatched.map((row, index) => renderRow(row, `u${index + 1}`, true))}
            </>
          )}
        </TableBody>
      </Table>
      </div>
      <Dialog open={Boolean(expandedPayload)} onOpenChange={(open) => !open && setExpanded(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          {expandedPayload && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base leading-6">
                  {expandedPayload.row.name} · {expandedPayload.column.label}
                </DialogTitle>
              </DialogHeader>
              <div className="overflow-auto pr-1 space-y-4">
                <p className="text-sm leading-6 whitespace-pre-wrap">
                  {expandedPayload.cell?.valueText ?? "No value available."}
                </p>
                {expandedPayload.cell?.sources?.length ? (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground font-semibold">
                      References ({expandedPayload.cell.sources.length})
                    </p>
                    <div className="space-y-2">
                      {expandedPayload.cell.sources.map((source) => (
                        <a
                          key={source.id}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-md border p-2 hover:bg-muted/40"
                        >
                          <p className="text-sm font-medium truncate">{source.title}</p>
                          <p className="text-xs text-primary truncate">{source.url}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{source.snippet}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
