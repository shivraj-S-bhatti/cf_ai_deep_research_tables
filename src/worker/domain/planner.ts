import type {
  ColumnSpec,
  CreateThreadRequest,
  Criterion,
  PreviewRequest,
  PreviewResponse,
  QueryPlan,
  ResearchThread,
} from "../../lib/contracts";
import {
  buildColumnsForScenario,
  buildCriteriaForScenario,
  findScenario,
  normalizeFixtureQuery,
} from "../fixtures/scenarios";
import { makeId, slugify } from "../utils/ids";

function normalizeCriterion(criterion: Criterion, threadId: string, index: number): Criterion {
  return {
    id: criterion.id || `${threadId}:criterion:${index}`,
    threadId,
    label: criterion.label,
    kind: criterion.kind,
    color: criterion.color,
    fieldHint: criterion.fieldHint ?? null,
    operatorHint: criterion.operatorHint ?? null,
    valueHint: criterion.valueHint ?? null,
    rankWeight: criterion.rankWeight ?? null,
    orderIndex: criterion.orderIndex ?? index,
  };
}

function normalizeColumn(column: ColumnSpec, threadId: string, index: number): ColumnSpec {
  return {
    id: column.id || `${threadId}:column:${column.key || slugify(column.label)}`,
    threadId,
    key: column.key || slugify(column.label),
    label: column.label,
    kind: column.kind,
    valueType: column.valueType,
    preferredSources: column.preferredSources ?? [],
    requiresVerification: column.requiresVerification ?? true,
    allowInference: column.allowInference ?? false,
    nullPolicy: column.nullPolicy ?? "dash",
    orderIndex: column.orderIndex ?? index,
  };
}

export function previewQuery(input: PreviewRequest): PreviewResponse {
  const previewThreadId = `preview:${slugify(input.query) || "query"}`;
  const scenario = findScenario(input.query);
  const criteria = buildCriteriaForScenario(scenario, previewThreadId);
  const columns = buildColumnsForScenario(scenario, previewThreadId);

  return {
    entityType: scenario.entityType,
    criteria,
    columns,
    searchQueries: scenario.searchQueries.map((text, index) => ({
      id: `${previewThreadId}:search:${index}`,
      text,
    })),
    budgets: scenario.budgets,
    notes: scenario.notes,
  };
}

export function buildThreadBundle(input: CreateThreadRequest): {
  thread: ResearchThread;
  plan: QueryPlan;
  criteria: Criterion[];
  columns: ColumnSpec[];
} {
  const threadId = makeId("thr");
  const now = Date.now();
  const resolvedPreview =
    input.preview ??
    previewQuery({
      query: input.query,
      targetResults: input.targetResults,
    });
  const criteria = input.criteria.map((criterion, index) =>
    normalizeCriterion(criterion, threadId, index),
  );
  const columns = input.columns.map((column, index) => normalizeColumn(column, threadId, index));

  const thread: ResearchThread = {
    id: threadId,
    createdAt: now,
    updatedAt: now,
    queryRaw: input.query,
    queryNormalized: normalizeFixtureQuery(input.query),
    phase: "preview",
    targetResults: input.targetResults,
    entityType: resolvedPreview.entityType,
    statusSummary: "Ready to review the generated plan.",
    latestRunId: null,
  };

  const plan: QueryPlan = {
    id: makeId("plan"),
    threadId,
    entityType: resolvedPreview.entityType,
    hardFilters: criteria.filter((criterion) => criterion.kind === "hard_filter"),
    softSignals: criteria.filter((criterion) => criterion.kind === "soft_signal"),
    columns,
    searchQueries: resolvedPreview.searchQueries.map((searchQuery, index) => ({
      id: searchQuery.id || `${threadId}:search:${index}`,
      text: searchQuery.text,
    })),
    searchBudget: resolvedPreview.budgets.searchBudget,
    fetchBudget: resolvedPreview.budgets.fetchBudget,
    verificationBudget: resolvedPreview.budgets.verificationBudget,
    notes: resolvedPreview.notes,
  };

  return { thread, plan, criteria, columns };
}

export function rebuildThreadBundle(
  thread: ResearchThread,
  existingPlan: QueryPlan,
  patch: Partial<CreateThreadRequest>,
): {
  thread: ResearchThread;
  plan: QueryPlan;
  criteria: Criterion[];
  columns: ColumnSpec[];
} {
  const nextQuery = patch.query ?? thread.queryRaw;
  const nextTargetResults = patch.targetResults ?? thread.targetResults;
  const resolvedPreview =
    patch.preview ??
    previewQuery({
      query: nextQuery,
      targetResults: nextTargetResults,
    });
  const baseCriteria =
    patch.criteria ?? resolvedPreview.criteria.map((criterion) => ({
      ...criterion,
      threadId: thread.id,
    }));
  const baseColumns =
    patch.columns ?? resolvedPreview.columns.map((column) => ({
      ...column,
      threadId: thread.id,
    }));

  const criteria = baseCriteria.map((criterion, index) =>
    normalizeCriterion(criterion, thread.id, index),
  );
  const columns = baseColumns.map((column, index) => normalizeColumn(column, thread.id, index));

  return {
    thread: {
      ...thread,
      updatedAt: Date.now(),
      queryRaw: nextQuery,
      queryNormalized: normalizeFixtureQuery(nextQuery),
      targetResults: nextTargetResults,
      entityType: resolvedPreview.entityType,
      phase: "preview",
      latestRunId: null,
      statusSummary: "Plan refreshed. Review criteria and columns before running.",
    },
    plan: {
      ...existingPlan,
      entityType: resolvedPreview.entityType,
      hardFilters: criteria.filter((criterion) => criterion.kind === "hard_filter"),
      softSignals: criteria.filter((criterion) => criterion.kind === "soft_signal"),
      columns,
      searchQueries: resolvedPreview.searchQueries.map((searchQuery, index) => ({
        id: searchQuery.id || `${thread.id}:search:${index}`,
        text: searchQuery.text,
      })),
      searchBudget: resolvedPreview.budgets.searchBudget,
      fetchBudget: resolvedPreview.budgets.fetchBudget,
      verificationBudget: resolvedPreview.budgets.verificationBudget,
      notes: resolvedPreview.notes,
    },
    criteria,
    columns,
  };
}
