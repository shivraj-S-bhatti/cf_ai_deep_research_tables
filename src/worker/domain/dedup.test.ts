import { dedupeAndMerge, jaccardTokens, normalizeName, type ExtractedEntityRow } from "./dedup";

function makeRow(overrides: Partial<ExtractedEntityRow>): ExtractedEntityRow {
  return {
    canonicalName: "L'Industrie Pizzeria",
    canonicalUrl: "https://example.com/lindustrie",
    rowStatus: "uncertain",
    score: 0.7,
    rowSummary: "summary",
    sourceUrl: "https://example.com/source",
    sourceClass: "roundup",
    cells: [
      {
        key: "name",
        valueText: "L'Industrie Pizzeria",
        state: "filled",
        confidence: 0.8,
        reasonCode: null,
        evidenceText: "L'Industrie Pizzeria",
      },
    ],
    criteria: [
      {
        label: "Located in Brooklyn",
        verdict: "pass",
        summary: "Brooklyn address.",
        confidence: 0.7,
        evidenceText: "Brooklyn",
      },
    ],
    ...overrides,
  };
}

describe("dedup helpers", () => {
  it("normalizes apostrophe variants consistently", () => {
    expect(normalizeName("L’Industrie Pizzeria")).toBe(normalizeName("L'Industrie Pizzeria"));
  });

  it("computes token overlap for close names", () => {
    const score = jaccardTokens("Paulie Gee's", "Paulie Gees");
    expect(score).toBeGreaterThan(0.5);
  });

  it("deduplicates and keeps highest-confidence cell values", () => {
    const rows = [
      makeRow({
        canonicalName: "L'Industrie Pizzeria",
        score: 0.6,
        cells: [
          {
            key: "rating",
            valueText: "9.1",
            state: "filled",
            confidence: 0.6,
            reasonCode: null,
            evidenceText: "9.1",
          },
        ],
      }),
      makeRow({
        canonicalName: "L’Industrie",
        score: 0.9,
        cells: [
          {
            key: "rating",
            valueText: "9.3",
            state: "filled",
            confidence: 0.9,
            reasonCode: null,
            evidenceText: "9.3",
          },
        ],
      }),
    ];

    const merged = dedupeAndMerge(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.9);
    expect(merged[0].cells.find((cell) => cell.key === "rating")?.valueText).toBe("9.3");
  });
});
