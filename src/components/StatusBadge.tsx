import { Loader2, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SearchStatus } from "@/lib/mock-data";

export function StatusBadge({ status }: { status: SearchStatus }) {
  switch (status) {
    case "match":
      return (
        <Badge className="bg-success/15 text-success border-success/20 hover:bg-success/20 gap-1 font-medium text-xs">
          <Check className="h-3 w-3" />
          Match
        </Badge>
      );
    case "miss":
      return (
        <Badge className="bg-destructive/15 text-destructive border-destructive/20 hover:bg-destructive/20 gap-1 font-medium text-xs">
          <X className="h-3 w-3" />
          Miss
        </Badge>
      );
    case "verifying":
      return (
        <Badge variant="outline" className="gap-1 font-medium text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Verifying…
        </Badge>
      );
  }
}
