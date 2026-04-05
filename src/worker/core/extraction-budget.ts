export type ExtractionBudget = {
  remainingCalls: number;
};

export function createExtractionBudget(maxCalls: number): ExtractionBudget {
  return {
    remainingCalls: Math.max(0, Math.floor(maxCalls)),
  };
}

export function hasExtractionBudgetRemaining(budget: ExtractionBudget): boolean {
  return budget.remainingCalls > 0;
}

export function allocateExtractionBatch<T>(
  budget: ExtractionBudget,
  items: T[],
): {
  allowedItems: T[];
  skippedCount: number;
} {
  if (budget.remainingCalls <= 0) {
    return {
      allowedItems: [],
      skippedCount: items.length,
    };
  }

  const allowedItems = items.slice(0, budget.remainingCalls);
  budget.remainingCalls -= allowedItems.length;
  return {
    allowedItems,
    skippedCount: Math.max(0, items.length - allowedItems.length),
  };
}
