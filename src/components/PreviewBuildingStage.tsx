import { Loader2, ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PreviewBuildingStageProps {
  query: string;
  isBuilding: boolean;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}

export function PreviewBuildingStage({
  query,
  isBuilding,
  error,
  onRetry,
  onBack,
}: PreviewBuildingStageProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-2xl rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <h2 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-foreground">
              {isBuilding ? "Building structured preview" : "Preview build failed"}
            </h2>
          </div>
          {isBuilding ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
        </div>

        <div className="rounded-xl border bg-muted/20 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Query</p>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{query}</p>
        </div>

        <div className="mt-5 space-y-2">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <>
              <p className="text-sm text-foreground">Planning criteria, columns, and search coverage.</p>
              <p className="text-sm text-muted-foreground">
                The workspace opens immediately; the preview will hydrate as soon as the planner returns.
              </p>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          {!isBuilding ? (
            <Button type="button" onClick={onRetry}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
