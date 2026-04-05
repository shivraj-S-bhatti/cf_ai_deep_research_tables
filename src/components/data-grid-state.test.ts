import { describe, expect, it } from "vitest";

import { describeDataGridEmptyState } from "./data-grid-state";

describe("describeDataGridEmptyState", () => {
  it("shows loading only while a run is active and no rows exist yet", () => {
    expect(describeDataGridEmptyState({
      visibleCount: 0,
      totalCount: 0,
      phase: "running",
    })).toEqual({
      kind: "loading",
      message: "Research is running. Rows will appear as extraction completes.",
    });
  });

  it("shows filtered copy when rows exist but are hidden", () => {
    expect(describeDataGridEmptyState({
      visibleCount: 0,
      totalCount: 4,
      phase: "complete",
    })).toEqual({
      kind: "filtered",
      message: "No rows match the current filters.",
    });
  });

  it("does not show loading copy after failure", () => {
    expect(describeDataGridEmptyState({
      visibleCount: 0,
      totalCount: 0,
      phase: "failed",
    })).toEqual({
      kind: "empty",
      message: "Research stopped before any rows were produced.",
    });
  });
});
