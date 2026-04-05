import { describe, expect, it } from "vitest";

import {
  allocateExtractionBatch,
  createExtractionBudget,
  hasExtractionBudgetRemaining,
} from "./extraction-budget";

describe("extraction budget", () => {
  it("allocates batches without exceeding the remaining call budget", () => {
    const budget = createExtractionBudget(2);

    const first = allocateExtractionBatch(budget, ["a", "b", "c"]);
    expect(first.allowedItems).toEqual(["a", "b"]);
    expect(first.skippedCount).toBe(1);
    expect(hasExtractionBudgetRemaining(budget)).toBe(false);

    const second = allocateExtractionBatch(budget, ["d"]);
    expect(second.allowedItems).toEqual([]);
    expect(second.skippedCount).toBe(1);
  });

  it("treats non-positive budgets as exhausted from the start", () => {
    const budget = createExtractionBudget(-3);

    expect(hasExtractionBudgetRemaining(budget)).toBe(false);
    expect(allocateExtractionBatch(budget, [1, 2, 3])).toEqual({
      allowedItems: [],
      skippedCount: 3,
    });
  });
});
