import type { ThreadLifecyclePhase } from "@/lib/types";

export type DataGridEmptyState = {
  kind: "loading" | "filtered" | "empty";
  message: string;
};

export function describeDataGridEmptyState(input: {
  visibleCount: number;
  totalCount: number;
  phase: ThreadLifecyclePhase;
}): DataGridEmptyState | null {
  const { visibleCount, totalCount, phase } = input;
  if (visibleCount > 0) return null;

  if (totalCount > 0) {
    return {
      kind: "filtered",
      message: "No rows match the current filters.",
    };
  }

  if (phase === "queued" || phase === "running") {
    return {
      kind: "loading",
      message: "Research is running. Rows will appear as extraction completes.",
    };
  }

  if (phase === "failed") {
    return {
      kind: "empty",
      message: "Research stopped before any rows were produced.",
    };
  }

  if (phase === "canceled") {
    return {
      kind: "empty",
      message: "Research was canceled before any rows were produced.",
    };
  }

  return {
    kind: "empty",
    message: "No rows are available for this research thread yet.",
  };
}
