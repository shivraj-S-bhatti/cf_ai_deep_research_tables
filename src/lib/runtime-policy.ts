import type {
  Criterion,
  CriterionEvaluation,
  ProcessingState,
  ResultRow,
  RowStatus,
} from "./contracts";

export const DEFAULT_REJECT_CONFIDENCE_MIN = 0.8;
export const DEFAULT_ACCEPT_CONFIDENCE_MIN = 0.65;

export type SourceScopeEligibility = "eligible" | "out_of_scope_hard";

export type SourceScopeSourceMeta = {
  title: string;
  snippet: string;
};

export type SourceScopeDecision = {
  eligibility: SourceScopeEligibility;
  pruneKey: string | null;
  reasonCode: "source_scope_pruned" | null;
  reasonSummary: string | null;
};

export type FinalStatusThresholds = {
  rejectConfidenceMin: number;
  acceptConfidenceMin: number;
};

export type ProductCountSummary = {
  accepted: number;
  rejected: number;
  uncertain: number;
  conflict: number;
  finalizedCount: number;
  inFlightCount: number;
};

const TERMINAL_PROCESSING_STATES = new Set<ProcessingState>(["finalized", "failed"]);
const COHORT_PATTERN = /\b(?:w|s|f)\s?\d{2}\b|\b(?:winter|spring|summer|fall)\s?\d{2,4}\b/gi;
const YEAR_PATTERN = /\b20\d{2}\b/g;

function normalizeCohortToken(token: string): string | null {
  const normalized = token.toLowerCase().replace(/\s+/g, "");
  const shortMatch = /^(w|s|f)(\d{2})$/.exec(normalized);
  if (shortMatch) {
    return `${shortMatch[1]}${shortMatch[2]}`;
  }

  const longMatch = /^(winter|spring|summer|fall)(\d{2,4})$/.exec(normalized);
  if (!longMatch) return null;

  const prefix =
    longMatch[1] === "winter" ? "w" : longMatch[1] === "fall" ? "f" : "s";
  return `${prefix}${longMatch[2].slice(-2)}`;
}

function formatCohortToken(token: string): string {
  const normalized = normalizeCohortToken(token) ?? token.toLowerCase();
  return normalized.toUpperCase();
}

function extractCohortTokens(text: string): string[] {
  const matches = text.match(COHORT_PATTERN) ?? [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const match of matches) {
    const token = normalizeCohortToken(match);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

function extractYearTokens(text: string): string[] {
  const matches = text.match(YEAR_PATTERN) ?? [];
  return [...new Set(matches)];
}

function cohortTokenToYear(token: string): string | null {
  const normalized = normalizeCohortToken(token);
  if (!normalized) return null;
  return `20${normalized.slice(-2)}`;
}

function looksLikeDocumentInsteadOfEntity(row: Pick<ResultRow, "entityType" | "canonicalName" | "canonicalUrl" | "lineage">): boolean {
  if (row.entityType === "news_item" || row.entityType === "website") {
    return false;
  }

  const title = row.canonicalName.toLowerCase();
  const url = row.canonicalUrl.toLowerCase();
  if (/(^the\s+\d+)|\bbest\b|\btop\b|\bguide\b|\bupdated\b|\breview\b/.test(title)) {
    return true;
  }
  if (/(\/blog\/|\/news\/|\/posts\/|\/article\/)/.test(url)) {
    return true;
  }
  return false;
}

export function classifySourceScopeDecision(
  query: string,
  sourceMeta: SourceScopeSourceMeta,
  normalizedSourceUrl: string,
): SourceScopeDecision {
  const normalizedQuery = query.toLowerCase();
  const hasYcIntent = normalizedQuery.includes("yc") || normalizedQuery.includes("y combinator");
  if (!hasYcIntent) {
    return {
      eligibility: "eligible",
      pruneKey: null,
      reasonCode: null,
      reasonSummary: null,
    };
  }

  const requestedCohorts = extractCohortTokens(normalizedQuery);
  if (requestedCohorts.length === 0) {
    return {
      eligibility: "eligible",
      pruneKey: null,
      reasonCode: null,
      reasonSummary: null,
    };
  }

  const sourceText = `${normalizedSourceUrl} ${sourceMeta.title} ${sourceMeta.snippet}`.toLowerCase();
  const sourceCohorts = extractCohortTokens(sourceText);
  const requestedYears = requestedCohorts
    .map(cohortTokenToYear)
    .filter((value): value is string => Boolean(value));
  const sourceYears = extractYearTokens(sourceText);
  if (sourceCohorts.length === 0) {
    if (requestedYears.length > 0 && sourceYears.length > 0 && !sourceYears.some((year) => requestedYears.includes(year))) {
      return {
        eligibility: "out_of_scope_hard",
        pruneKey: normalizedSourceUrl,
        reasonCode: "source_scope_pruned",
        reasonSummary: `Source year mismatch: requested ${requestedYears.join(", ")}, found ${sourceYears.slice(0, 3).join(", ")}.`,
      };
    }
    return {
      eligibility: "eligible",
      pruneKey: null,
      reasonCode: null,
      reasonSummary: null,
    };
  }

  const requested = requestedCohorts[0];
  if (sourceCohorts.includes(requested)) {
    return {
      eligibility: "eligible",
      pruneKey: null,
      reasonCode: null,
      reasonSummary: null,
    };
  }

  const found = sourceCohorts.slice(0, 3).map(formatCohortToken).join(", ");
  return {
    eligibility: "out_of_scope_hard",
    pruneKey: normalizedSourceUrl,
    reasonCode: "source_scope_pruned",
    reasonSummary: `Source cohort mismatch: requested ${formatCohortToken(requested)}, found ${found}.`,
  };
}

export function deriveFinalStatus(
  row: Pick<ResultRow, "status" | "entityType" | "canonicalName" | "canonicalUrl" | "lineage">,
  evaluations: CriterionEvaluation[],
  criteria: Criterion[],
  thresholds: Partial<FinalStatusThresholds> = {},
): RowStatus {
  const rejectConfidenceMin = thresholds.rejectConfidenceMin ?? DEFAULT_REJECT_CONFIDENCE_MIN;
  const acceptConfidenceMin = thresholds.acceptConfidenceMin ?? DEFAULT_ACCEPT_CONFIDENCE_MIN;
  const hardCriteriaIds = new Set(
    criteria.filter((criterion) => criterion.kind === "hard_filter").map((criterion) => criterion.id),
  );
  const hardEvaluations = evaluations.filter((evaluation) => hardCriteriaIds.has(evaluation.criterionId));
  const hasGrounding = row.lineage.groundedBySourceIds.length > 0;

  if (!hasGrounding && row.status !== "rejected") {
    return "uncertain";
  }

  if (hardEvaluations.length === 0) {
    return row.status === "rejected" ? "rejected" : "uncertain";
  }
  if (hardEvaluations.some((evaluation) => evaluation.verdict === "conflict")) return "conflict";
  if (hardEvaluations.some((evaluation) => evaluation.verdict === "uncertain")) return "uncertain";

  const hasStrongFail = hardEvaluations.some(
    (evaluation) => evaluation.verdict === "fail" && evaluation.confidence >= rejectConfidenceMin,
  );
  if (hasStrongFail) return "rejected";

  const hasWeakHardSignal = hardEvaluations.some(
    (evaluation) => evaluation.confidence < acceptConfidenceMin,
  );
  if (hasWeakHardSignal) return "uncertain";

  const hasAnyFail = hardEvaluations.some((evaluation) => evaluation.verdict === "fail");
  if (hasAnyFail) return "uncertain";

  if (looksLikeDocumentInsteadOfEntity(row)) return "uncertain";
  return "accepted";
}

export function isRowTerminal(row: Pick<ResultRow, "processingState">): boolean {
  return TERMINAL_PROCESSING_STATES.has(row.processingState);
}

export function isRowInFlight(row: Pick<ResultRow, "processingState">): boolean {
  return !isRowTerminal(row);
}

export function summarizeProductCounts<TRow extends Pick<ResultRow, "status" | "processingState">>(
  rows: TRow[],
): ProductCountSummary {
  const summary: ProductCountSummary = {
    accepted: 0,
    rejected: 0,
    uncertain: 0,
    conflict: 0,
    finalizedCount: 0,
    inFlightCount: 0,
  };

  for (const row of rows) {
    if (isRowInFlight(row)) {
      summary.inFlightCount += 1;
      continue;
    }
    if (row.processingState !== "finalized") {
      continue;
    }

    summary.finalizedCount += 1;
    summary[row.status] += 1;
  }

  return summary;
}
