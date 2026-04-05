import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import type { SearchProcessingState, SearchStatus } from "@/lib/types";

export function StatusBadge({
  status,
  processingState,
}: {
  status: SearchStatus;
  processingState: SearchProcessingState;
}) {
  const baseClass =
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-4";

  if (processingState === "pending") {
    return (
      <span className={`${baseClass} border-border bg-muted/50 text-muted-foreground`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Queued
      </span>
    );
  }

  if (processingState === "fetching") {
    return (
      <span className={`${baseClass} border-sky-200 bg-sky-50 text-sky-700`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Fetching
      </span>
    );
  }

  if (processingState === "extracting" || processingState === "extracting_anchor") {
    return (
      <span className={`${baseClass} border-violet-200 bg-violet-50 text-violet-700`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {processingState === "extracting_anchor" ? "Extracting anchor" : "Extracting"}
      </span>
    );
  }

  if (processingState === "refining" || processingState === "corroborating") {
    return (
      <span className={`${baseClass} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        <Loader2 className="h-3 w-3 animate-spin opacity-60" />
        {processingState === "corroborating" ? "Corroborating" : "Refining"}
      </span>
    );
  }

  if (processingState === "verifying") {
    return (
      <span className={`${baseClass} border-amber-200 bg-amber-50 text-amber-700`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Validating
      </span>
    );
  }

  if (processingState === "failed") {
    return (
      <span className={`${baseClass} border-destructive/20 bg-destructive/10 text-destructive`}>
        <X className="h-3 w-3" />
        Failed
      </span>
    );
  }

  switch (status) {
    case "accepted":
      return (
        <span className={`${baseClass} border-emerald-200 bg-emerald-50 text-emerald-700`}>
          <Check className="h-3 w-3" />
          Accepted
        </span>
      );
    case "rejected":
      return (
        <span className={`${baseClass} border-destructive/20 bg-destructive/10 text-destructive`}>
          <X className="h-3 w-3" />
          Rejected
        </span>
      );
    case "uncertain":
      return (
        <span className={`${baseClass} border-amber-200 bg-amber-50 text-amber-700`}>
          <AlertTriangle className="h-3 w-3" />
          Uncertain
        </span>
      );
    case "conflict":
      return (
        <span className={`${baseClass} border-orange-200 bg-orange-50 text-orange-700`}>
          <AlertTriangle className="h-3 w-3" />
          Conflict
        </span>
      );
  }
}
