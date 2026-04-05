import type { CellState, CriterionVerdict } from "../../lib/contracts";
import type { SourceClass } from "../providers/fetch";

export type ExtractedEntityRow = {
  canonicalName: string;
  canonicalUrl: string | null;
  candidateWebsite: string | null;
  rowStatus: "accepted" | "rejected" | "uncertain" | "conflict";
  score: number;
  rowSummary: string;
  sourceUrl: string;
  sourceClass: SourceClass;
  followUpUrls: string[];
  cells: Array<{
    key: string;
    valueText: string | null;
    state: CellState;
    confidence: number;
    reasonCode: string | null;
    evidenceText: string | null;
  }>;
  criteria: Array<{
    label: string;
    verdict: CriterionVerdict;
    summary: string;
    confidence: number;
    evidenceText: string | null;
  }>;
};

export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/['\u2018\u2019\u2032`]/g, "")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function jaccardTokens(a: string, b: string): number {
  const aTokens = new Set(normalizeName(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function chooseStatus(statuses: Array<ExtractedEntityRow["rowStatus"]>): ExtractedEntityRow["rowStatus"] {
  if (statuses.includes("conflict")) return "conflict";
  if (statuses.includes("uncertain")) return "uncertain";
  if (statuses.includes("rejected") && !statuses.includes("accepted")) return "rejected";
  if (statuses.includes("accepted")) return "accepted";
  return "uncertain";
}

export function dedupeAndMerge(rows: ExtractedEntityRow[]): ExtractedEntityRow[] {
  const groups: ExtractedEntityRow[][] = [];
  for (const row of rows) {
    const idx = groups.findIndex((group) => {
      const pivot = group[0];
      const sameNorm = normalizeName(pivot.canonicalName) === normalizeName(row.canonicalName);
      const tokenOverlap = jaccardTokens(pivot.canonicalName, row.canonicalName) >= 0.5;
      return sameNorm || tokenOverlap;
    });
    if (idx >= 0) groups[idx].push(row);
    else groups.push([row]);
  }

  return groups.map((group) => {
    const sortedByScore = [...group].sort((a, b) => b.score - a.score);
    const seed = sortedByScore[0];
    const mergedCells = new Map<string, ExtractedEntityRow["cells"][number]>();
    const mergedCriteria = new Map<string, ExtractedEntityRow["criteria"][number]>();
    for (const row of group) {
      for (const cell of row.cells) {
        const current = mergedCells.get(cell.key);
        if (!current || cell.confidence > current.confidence) mergedCells.set(cell.key, cell);
      }
      for (const criterion of row.criteria) {
        const current = mergedCriteria.get(criterion.label);
        if (!current || criterion.confidence > current.confidence) {
          mergedCriteria.set(criterion.label, criterion);
        }
      }
    }
    return {
      canonicalName: seed.canonicalName,
      canonicalUrl: seed.canonicalUrl ?? group.find((row) => row.canonicalUrl)?.canonicalUrl ?? null,
      candidateWebsite:
        seed.candidateWebsite
        ?? group.find((row) => row.candidateWebsite)?.candidateWebsite
        ?? null,
      rowStatus: chooseStatus(group.map((row) => row.rowStatus)),
      score: Math.max(...group.map((row) => row.score)),
      rowSummary: seed.rowSummary,
      sourceUrl: seed.sourceUrl,
      sourceClass: seed.sourceClass,
      followUpUrls: [...new Set(group.flatMap((row) => row.followUpUrls))].slice(0, 5),
      cells: [...mergedCells.values()],
      criteria: [...mergedCriteria.values()],
    };
  });
}
