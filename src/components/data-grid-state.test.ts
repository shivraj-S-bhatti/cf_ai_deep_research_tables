import { describe, expect, it } from "vitest";

import { describeDataGridEmptyState } from "./data-grid-state";

describe("describeDataGridEmptyState", () => {
  it("shows loading only while a run is active and no rows exist yet", () => {
    expect(describeDataGridEmptyState({
      visibleCount: 0,
      totalCount: 0,
      phase: "running",
      run: {
        status: "running",
        stage: "extraction",
        progress: {
          queriesCompleted: 1,
          sourcesFetched: 3,
          rowsCreated: 0,
          cellsResolved: 0,
          totalQueries: 1,
          totalRows: 0,
        },
        metrics: {
          searchCalls: 1,
          fetchCalls: 3,
          llmCalls: 0,
          cacheHits: 0,
          cacheMisses: 0,
          estimatedCostUsd: 0,
          budgetConsumedUsd: 0,
          elapsedMs: 20000,
          stageDurationsMs: {},
          providerBreakdown: [],
        },
      },
      targetResults: 10,
    })).toEqual({
      kind: "loading",
      title: "Extracting candidate anchors",
      message: "1/1 queries complete · 3 pages fetched · no grounded rows yet",
      note: "Fetched pages, but still waiting on the first extraction response. This may be stalled.",
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
