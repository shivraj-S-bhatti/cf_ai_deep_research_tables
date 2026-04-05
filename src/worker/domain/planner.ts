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

function normalizeTargetResults(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(25, Math.round(value)));
}

function humanizeCriterionLabel(label: string): string {
  const safeLabel = typeof label === "string" ? label : String(label ?? "");
  const trimmed = safeLabel.trim();
  if (!trimmed) return trimmed;

  const normalized = trimmed
    .replace(/_/g, " ")
    .replace(/\btrue\b/gi, "")
    .replace(/\bfalse\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const colonMatch = normalized.match(/^([a-z0-9 ]+)\s*:\s*(.+)$/i);
  if (colonMatch) {
    const field = colonMatch[1].trim();
    const value = colonMatch[2].trim();
    return `${field.charAt(0).toUpperCase()}${field.slice(1)} ${value}`.trim();
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeCriterion(criterion: Criterion, threadId: string, index: number): Criterion {
  const normalizedKind: Criterion["kind"] =
    criterion.kind === "hard_filter" || criterion.kind === "soft_signal" || criterion.kind === "heuristic"
      ? criterion.kind
      : "soft_signal";
  return {
    id: criterion.id || `${threadId}:criterion:${index}`,
    threadId,
    label: humanizeCriterionLabel(criterion.label),
    kind: normalizedKind,
    color: criterion.color,
    fieldHint: criterion.fieldHint ?? null,
    operatorHint: criterion.operatorHint ?? null,
    valueHint: criterion.valueHint ?? null,
    rankWeight: criterion.rankWeight ?? null,
    orderIndex: criterion.orderIndex ?? index,
  };
}

function normalizeColumn(column: ColumnSpec, threadId: string, index: number): ColumnSpec {
  const safeLabel = typeof column.label === "string" ? column.label : `Column ${index + 1}`;
  const safeKeySource = typeof column.key === "string" && column.key.trim()
    ? column.key
    : safeLabel;
  const normalizedKind: ColumnSpec["kind"] =
    column.kind === "identity" || column.kind === "criterion_summary" || column.kind === "enrichment"
      ? column.kind
      : "enrichment";
  const normalizedValueType: ColumnSpec["valueType"] =
    column.valueType === "string"
    || column.valueType === "number"
    || column.valueType === "date"
    || column.valueType === "enum"
    || column.valueType === "url"
    || column.valueType === "bool"
    || column.valueType === "json"
      ? column.valueType
      : "string";
  return {
    id: column.id || `${threadId}:column:${slugify(safeKeySource)}`,
    threadId,
    key: slugify(safeKeySource),
    label: safeLabel,
    kind: normalizedKind,
    valueType: normalizedValueType,
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

export function buildThreadBundle(input: CreateThreadRequest, threadId = makeId("thr")): {
  thread: ResearchThread;
  plan: QueryPlan;
  criteria: Criterion[];
  columns: ColumnSpec[];
} {
  const now = Date.now();
  const normalizedTargetResults = normalizeTargetResults(input.targetResults);
  const resolvedPreview =
    input.preview ??
    previewQuery({
      query: input.query,
      targetResults: normalizedTargetResults,
    });
  const baseCriteria = input.criteria ?? resolvedPreview.criteria;
  const baseColumns = input.columns ?? resolvedPreview.columns;
  const criteria = baseCriteria.map((criterion, index) =>
    normalizeCriterion(criterion, threadId, index),
  );
  const columns = baseColumns.map((column, index) => normalizeColumn(column, threadId, index));

  const thread: ResearchThread = {
    id: threadId,
    createdAt: now,
    updatedAt: now,
    queryRaw: input.query,
    queryNormalized: normalizeFixtureQuery(input.query),
    phase: "preview",
    targetResults: normalizedTargetResults,
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
  const nextTargetResults = normalizeTargetResults(patch.targetResults ?? thread.targetResults);
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
