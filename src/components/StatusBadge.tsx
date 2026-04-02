import { Loader2, Check, X } from "lucide-react";
import type { SearchStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: SearchStatus }) {
  switch (status) {
    case "match":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
          <Check className="h-3 w-3" />
          Match
        </span>
      );
    case "miss":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
          <X className="h-3 w-3" />
          Miss
        </span>
      );
    case "verifying":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Verifying
        </span>
      );
    case "queued":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          Queued
        </span>
      );
  }
}
