import type { DatasetSortDir, DatasetSortKey, SearchResult, TableFilterCondition } from "./types";

function fieldValue(row: SearchResult, field: TableFilterCondition["field"]): string {
  switch (field) {
    case "name":
      return row.name;
    case "url":
      return row.url;
    case "status":
      return row.status;
    default:
      return "";
  }
}

export function rowMatchesCondition(row: SearchResult, c: TableFilterCondition): boolean {
  const raw = fieldValue(row, c.field);
  const v = c.value.trim();
  const lower = raw.toLowerCase();
  const needle = v.toLowerCase();

  switch (c.operator) {
    case "contains":
      return lower.includes(needle);
    case "does_not_contain":
      return !lower.includes(needle);
    case "equals":
      return lower === needle;
    case "does_not_equal":
      return lower !== needle;
    case "is_empty":
      return raw.trim() === "";
    case "is_not_empty":
      return raw.trim() !== "";
    default:
      return true;
  }
}

export function applyTableFilters(
  rows: SearchResult[],
  conditions: TableFilterCondition[],
): SearchResult[] {
  if (conditions.length === 0) return rows;
  return rows.filter((row) => conditions.every((c) => rowMatchesCondition(row, c)));
}

export function sortDatasetRows(
  rows: SearchResult[],
  key: DatasetSortKey | null,
  dir: DatasetSortDir,
): SearchResult[] {
  if (!key) return rows;
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = fieldValue(a, key);
    const vb = fieldValue(b, key);
    return va.localeCompare(vb, undefined, { sensitivity: "base" }) * mult;
  });
}
