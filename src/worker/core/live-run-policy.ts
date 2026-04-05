import type { RowStatus, SearchQuery } from "../../lib/contracts";
import type { ExtractedEntityRow } from "../domain/dedup";
import type { BraveWebResult } from "../providers/brave";
import type { SourceClass } from "../providers/fetch";

const LIST_LIKE_HINT =
  /\b(best|top|guide|directory|industry|category|companies|startups|restaurants|updated|review|compare|list|forum)\b/i;
const DOCUMENT_PATH_HINT = /\/(blog|news|posts|article|articles|guides?|directory|industry|category|location)\//i;
const PROJECT_REPO_HINT =
  /\b(open[- ]source|oss|github|repo|repos|repository|repositories|license|commit|commits|stars?|star count|forks?)\b/i;
const PROJECT_ENTITY_HINT = /\b(llm|model|models|sdk|library|libraries|framework|tool|tools|project|projects)\b/i;

export type DiscoveryIntent = "general" | "project_repo";

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function hostFor(value: string | null | undefined): string {
  const next = safeUrl(value);
  if (!next) return "";
  try {
    return new URL(next).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pathSegments(value: string | null | undefined): string[] {
  const next = safeUrl(value);
  if (!next) return [];
  try {
    return new URL(next).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function knownRepoHost(host: string): boolean {
  return host === "github.com" || host === "gitlab.com" || host === "huggingface.co";
}

function isRepoLikeUrl(value: string | null | undefined): boolean {
  const host = hostFor(value);
  const segments = pathSegments(value);
  if (!knownRepoHost(host)) return false;
  if (host === "github.com" || host === "gitlab.com") {
    if (segments.length !== 2) return false;
    return !["topics", "collections", "orgs", "search", "marketplace", "features", "trending"].includes(segments[0]!);
  }
  if (host === "huggingface.co") {
    if (segments.length < 2) return false;
    return !["spaces", "collections", "docs", "learn", "blog", "open-llm-leaderboard"].includes(segments[0]!);
  }
  return false;
}

function repoFamilyKey(value: string): string {
  const host = hostFor(value);
  const segments = pathSegments(value).slice(0, 2);
  return `${host}/${segments.join("/")}`;
}

function candidatePathPenalty(url: string, intent: DiscoveryIntent): number {
  const basePenalty = DOCUMENT_PATH_HINT.test(url) ? 2 : 0;
  if (intent !== "project_repo") return basePenalty;
  const lower = url.toLowerCase();
  if (isRepoLikeUrl(url)) return 0;
  if (
    lower.includes("/topics/")
    || lower.includes("leaderboard")
    || lower.includes("awesome")
    || lower.includes("/collections/")
    || lower.includes("/trending")
  ) {
    return basePenalty + 7;
  }
  return basePenalty + 2;
}

function textPenalty(text: string, intent: DiscoveryIntent): number {
  const basePenalty = LIST_LIKE_HINT.test(text) ? 3 : 0;
  if (intent !== "project_repo") return basePenalty;
  const lower = text.toLowerCase();
  if (lower.includes("leaderboard") || lower.includes("awesome") || lower.includes("top ") || lower.includes("best ")) {
    return basePenalty + 6;
  }
  return basePenalty;
}

function repoSpecificBoost(result: BraveWebResult): number {
  const lower = `${result.title} ${result.description}`.toLowerCase();
  let score = 0;
  if (isRepoLikeUrl(result.url)) score += 10;
  if (hostFor(result.url) === "github.com") score += 4;
  if (hostFor(result.url) === "huggingface.co") score += 2;
  if (/\b(stars?|license|readme|repository|github)\b/.test(lower)) score += 2;
  if (/\b(leaderboard|awesome|top|best|list|directory|compare)\b/.test(lower)) score -= 6;
  return score;
}

function diversityKey(url: string, intent: DiscoveryIntent): string {
  if (intent === "project_repo" && isRepoLikeUrl(url)) {
    return repoFamilyKey(url);
  }
  return hostFor(url) || url;
}

function isPreferredProjectRepoCandidate(result: BraveWebResult): boolean {
  if (isRepoLikeUrl(result.url)) return true;
  const lower = `${result.title} ${result.description} ${result.url}`.toLowerCase();
  return /\b(github|gitlab|hugging\s?face|model card|repository|repo|readme|license)\b/.test(lower)
    && !/\b(leaderboard|awesome|top|best|directory|list|compare|trending|collection)\b/.test(lower);
}

export function classifyDiscoveryIntent(options: {
  query: string;
  entityType: string;
  criteriaLabels?: string[];
}): DiscoveryIntent {
  const haystack = `${options.query} ${options.criteriaLabels?.join(" ") ?? ""}`.toLowerCase();
  if (
    options.entityType === "project"
    && PROJECT_REPO_HINT.test(haystack)
    && PROJECT_ENTITY_HINT.test(haystack)
  ) {
    return "project_repo";
  }
  return "general";
}

export function expandDiscoveryQueries(options: {
  query: string;
  entityType: string;
  plannedQueries: SearchQuery[];
  criteriaLabels?: string[];
}): SearchQuery[] {
  const intent = classifyDiscoveryIntent({
    query: options.query,
    entityType: options.entityType,
    criteriaLabels: options.criteriaLabels,
  });
  const seen = new Set<string>();
  const expanded: SearchQuery[] = [];
  const push = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    expanded.push({
      id: `live:search:${expanded.length}`,
      text: trimmed,
    });
  };

  for (const query of options.plannedQueries) {
    push(query.text);
  }
  if (intent === "project_repo") {
    push(`${options.query} github`);
    push(`${options.query} site:github.com`);
    push(`open source llm github repository stars`);
    push(`github llm repository stars >1000`);
    push(`open source llm repository github stars >1000`);
  }
  return expanded.slice(0, intent === "project_repo" ? 6 : Math.max(1, options.plannedQueries.length));
}

export function discoverySearchResultLimit(baseCount: number, intent: DiscoveryIntent): number {
  if (intent === "project_repo") {
    return Math.max(baseCount, 10);
  }
  return baseCount;
}

export function extractionTimeoutMsForIntent(
  sourceClass: SourceClass,
  intent: DiscoveryIntent,
  requestTimeoutMs: number,
): number {
  if (intent === "project_repo") {
    if (sourceClass === "entity_page" || sourceClass === "official_site") {
      return Math.min(requestTimeoutMs, 8_000);
    }
    return Math.min(requestTimeoutMs, 4_000);
  }
  if (sourceClass === "entity_page" || sourceClass === "official_site") {
    return Math.min(requestTimeoutMs, 12_000);
  }
  return Math.min(requestTimeoutMs, 8_000);
}

export function isGroundingSourceClass(sourceClass: SourceClass): boolean {
  return sourceClass === "entity_page" || sourceClass === "official_site";
}

export function isCandidateOnlySourceClass(sourceClass: SourceClass): boolean {
  return !isGroundingSourceClass(sourceClass);
}

export function coerceRowStatusForSource(
  sourceClass: SourceClass,
  rowStatus: ExtractedEntityRow["rowStatus"],
): RowStatus {
  if (isGroundingSourceClass(sourceClass)) return rowStatus;
  return rowStatus === "conflict" ? "conflict" : "uncertain";
}

export function collectFollowUpUrls(
  row: Pick<ExtractedEntityRow, "canonicalUrl" | "candidateWebsite" | "followUpUrls" | "cells" | "sourceUrl" | "sourceClass">,
): string[] {
  if (isGroundingSourceClass(row.sourceClass)) return [];

  const urls = new Set<string>();
  const sourceUrl = safeUrl(row.sourceUrl);

  const pushIfDistinct = (value: string | null | undefined): void => {
    const next = safeUrl(value);
    if (!next || next === sourceUrl) return;
    urls.add(next);
  };

  pushIfDistinct(row.candidateWebsite);
  pushIfDistinct(row.canonicalUrl);
  for (const url of row.followUpUrls ?? []) {
    pushIfDistinct(url);
  }
  for (const cell of row.cells) {
    if (cell.state !== "filled") continue;
    pushIfDistinct(cell.valueText);
  }

  return [...urls].slice(0, 4);
}

export function buildCorroborationQueries(options: {
  anchorName: string;
  query: string;
  entityType: string;
  candidateWebsite?: string | null;
}): string[] {
  const { anchorName, query, entityType, candidateWebsite } = options;
  const quotedName = `"${anchorName}"`;
  const queries = new Set<string>([
    `${quotedName}`,
    `${quotedName} ${entityType}`,
    `${quotedName} ${query}`,
  ]);

  const host = hostFor(candidateWebsite);
  if (host) {
    queries.add(`${quotedName} site:${host}`);
  }

  return [...queries].slice(0, 4);
}

export function rankDiscoveryCandidate(
  query: string,
  result: BraveWebResult,
  options?: {
    entityType?: string;
    criteriaLabels?: string[];
  },
): number {
  const intent = classifyDiscoveryIntent({
    query,
    entityType: options?.entityType ?? "unknown",
    criteriaLabels: options?.criteriaLabels,
  });
  const haystack = `${result.title} ${result.description} ${result.url}`.toLowerCase();
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term)).length;
  const exactUrl = safeUrl(result.url) ?? result.url;

  let score = matchedTerms * 2;
  score -= textPenalty(result.title, intent);
  score -= textPenalty(result.description, intent);
  score -= candidatePathPenalty(exactUrl, intent);

  if (exactUrl.split("/").length <= 5) score += 1;
  if (!LIST_LIKE_HINT.test(result.title) && !LIST_LIKE_HINT.test(result.description)) score += 1;
  if (intent === "project_repo") {
    score += repoSpecificBoost(result);
  }

  return score;
}

export function selectDiscoveryBatch(
  options: {
    query: string;
    entityType?: string;
    criteriaLabels?: string[];
    candidates: BraveWebResult[];
    limit: number;
  },
): BraveWebResult[] {
  const intent = classifyDiscoveryIntent({
    query: options.query,
    entityType: options.entityType ?? "unknown",
    criteriaLabels: options.criteriaLabels,
  });
  const ranked = [...options.candidates].sort((left, right) => {
    const scoreDelta = rankDiscoveryCandidate(options.query, right, {
      entityType: options.entityType,
      criteriaLabels: options.criteriaLabels,
    }) - rankDiscoveryCandidate(options.query, left, {
      entityType: options.entityType,
      criteriaLabels: options.criteriaLabels,
    });
    if (scoreDelta !== 0) return scoreDelta;
    return left.url.localeCompare(right.url);
  });
  const selected: BraveWebResult[] = [];
  const seenFamilies = new Set<string>();
  const tiers = intent === "project_repo"
    ? [
        ranked.filter((candidate) => isPreferredProjectRepoCandidate(candidate)),
        ranked.filter((candidate) => !isPreferredProjectRepoCandidate(candidate) && !LIST_LIKE_HINT.test(`${candidate.title} ${candidate.description}`)),
        ranked.filter((candidate) => LIST_LIKE_HINT.test(`${candidate.title} ${candidate.description}`)),
      ]
    : [ranked];

  for (const tier of tiers) {
    for (const candidate of tier) {
      const family = diversityKey(candidate.url, intent);
      if (seenFamilies.has(family)) continue;
      selected.push(candidate);
      seenFamilies.add(family);
      if (selected.length >= Math.max(0, options.limit)) return selected;
    }
  }

  for (const candidate of ranked) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(0, options.limit)) break;
  }

  return selected;
}

export function computeFetchBatchSize(options: {
  iteration: number;
  targetResults: number;
  currentRows: number;
  remainingExtractionCalls: number;
  maxSourcesPerRun: number;
  pendingAnchors?: number;
  preferFollowUps?: boolean;
  intent?: DiscoveryIntent;
}): number {
  const {
    iteration,
    targetResults,
    currentRows,
    remainingExtractionCalls,
    maxSourcesPerRun,
    pendingAnchors = 0,
    preferFollowUps = false,
    intent = "general",
  } = options;
  if (remainingExtractionCalls <= 0 || maxSourcesPerRun <= 0) return 0;

  const remainingRows = Math.max(0, targetResults - currentRows);
  const baseLimit = iteration === 0
    ? intent === "project_repo"
      ? 2
      : Math.max(3, Math.min(5, Math.ceil(Math.max(1, Math.min(targetResults, 12)) / 3)))
    : intent === "project_repo" && !preferFollowUps
      ? currentRows > 0 ? 1 : 2
    : preferFollowUps || pendingAnchors > 0
      ? 2
      : 3;
  const desired = remainingRows > 0
    ? Math.min(baseLimit, remainingRows)
    : 1;

  return Math.max(1, Math.min(desired, remainingExtractionCalls, maxSourcesPerRun));
}

export function shouldStopExploration(currentRows: number, targetResults: number): boolean {
  return targetResults > 0 && currentRows >= targetResults;
}

export function shouldStopGreedyRefinement(options: {
  intent: DiscoveryIntent;
  groundedRows: number;
  targetResults: number;
  pendingAnchors: number;
  consecutiveNoGroundingIterations: number;
  broadDiscoveryMisses: number;
}): boolean {
  if (shouldStopExploration(options.groundedRows, options.targetResults)) {
    return true;
  }
  if (options.intent !== "project_repo") {
    return options.consecutiveNoGroundingIterations >= 3;
  }
  if (options.groundedRows > 0 && options.pendingAnchors === 0 && options.broadDiscoveryMisses >= 1) {
    return true;
  }
  return options.consecutiveNoGroundingIterations >= 2;
}
