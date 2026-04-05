import type { ResearchRun } from "@/lib/contracts";
import type { ThreadLifecyclePhase } from "@/lib/types";
import { describeActiveRunState, describePotentialStall } from "@/lib/run-stage-copy";

export type DataGridEmptyState = {
  kind: "loading" | "filtered" | "empty";
  title?: string;
  message: string;
  note?: string;
};

export function describeDataGridEmptyState(input: {
  visibleCount: number;
  totalCount: number;
  phase: ThreadLifecyclePhase;
  run?: Pick<ResearchRun, "status" | "stage" | "progress" | "metrics"> | null;
  targetResults?: number;
}): DataGridEmptyState | null {
  const { visibleCount, totalCount, phase, run, targetResults = 0 } = input;
  if (visibleCount > 0) return null;

  if (totalCount > 0) {
    return {
      kind: "filtered",
      message: "No rows match the current filters.",
    };
  }

  if (phase === "queued" || phase === "running") {
    if (run) {
      const active = describeActiveRunState({ run, targetResults });
      return {
        kind: "loading",
        title: active.title,
        message: active.detail,
        note: describePotentialStall(run) ?? active.note,
      };
    }
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
