import type { RowStatus } from "../../lib/contracts";
import type { ExtractedEntityRow } from "../domain/dedup";
import type { BraveWebResult } from "../providers/brave";
import type { SourceClass } from "../providers/fetch";

const LIST_LIKE_HINT =
  /\b(best|top|guide|directory|industry|category|companies|startups|restaurants|updated|review|compare|list|forum)\b/i;
const DOCUMENT_PATH_HINT = /\/(blog|news|posts|article|articles|guides?|directory|industry|category|location)\//i;

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

function candidatePathPenalty(url: string): number {
  return DOCUMENT_PATH_HINT.test(url) ? 2 : 0;
}

function textPenalty(text: string): number {
  return LIST_LIKE_HINT.test(text) ? 3 : 0;
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

export function rankDiscoveryCandidate(query: string, result: BraveWebResult): number {
  const haystack = `${result.title} ${result.description} ${result.url}`.toLowerCase();
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term)).length;
  const exactUrl = safeUrl(result.url) ?? result.url;

  let score = matchedTerms * 2;
  score -= textPenalty(result.title);
  score -= textPenalty(result.description);
  score -= candidatePathPenalty(exactUrl);

  if (exactUrl.split("/").length <= 5) score += 1;
  if (!LIST_LIKE_HINT.test(result.title) && !LIST_LIKE_HINT.test(result.description)) score += 1;

  return score;
}

export function selectDiscoveryBatch(
  query: string,
  candidates: BraveWebResult[],
  limit: number,
): BraveWebResult[] {
  const ranked = [...candidates].sort((left, right) => {
    const scoreDelta = rankDiscoveryCandidate(query, right) - rankDiscoveryCandidate(query, left);
    if (scoreDelta !== 0) return scoreDelta;
    return left.url.localeCompare(right.url);
  });
  const selected: BraveWebResult[] = [];
  const seenDomains = new Set<string>();

  for (const candidate of ranked) {
    const domain = hostFor(candidate.url) || candidate.url;
    if (seenDomains.has(domain)) continue;
    selected.push(candidate);
    seenDomains.add(domain);
    if (selected.length >= Math.max(0, limit)) return selected;
  }

  for (const candidate of ranked) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(0, limit)) break;
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
}): number {
  const {
    iteration,
    targetResults,
    currentRows,
    remainingExtractionCalls,
    maxSourcesPerRun,
    pendingAnchors = 0,
    preferFollowUps = false,
  } = options;
  if (remainingExtractionCalls <= 0 || maxSourcesPerRun <= 0) return 0;

  const remainingRows = Math.max(0, targetResults - currentRows);
  const baseLimit = iteration === 0
    ? Math.max(3, Math.min(5, Math.ceil(Math.max(1, Math.min(targetResults, 12)) / 3)))
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
