export function normalizeQueryKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/>\s*(\d+)\s*k\b/g, (_, count: string) => `gt ${Number(count) * 1000}`)
    .replace(/>\s*(\d[\d,]*)\b/g, (_, count: string) => `gt ${count.replace(/,/g, "")}`)
    .replace(/\bmore than\s+(\d[\d,]*)\b/g, (_, count: string) => `gt ${count.replace(/,/g, "")}`)
    .replace(/\bover\s+(\d[\d,]*)\b/g, (_, count: string) => `gt ${count.replace(/,/g, "")}`)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");
}
