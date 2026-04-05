import { describe, expect, it } from "vitest";
import type { ExtractedEntityRow } from "../domain/dedup";
import {
  collectFollowUpUrls,
  computeFetchBatchSize,
  coerceRowStatusForSource,
  isGroundingSourceClass,
  selectDiscoveryBatch,
  shouldStopExploration,
} from "./live-run-policy";

function makeExtractedRow(overrides: Partial<ExtractedEntityRow> = {}): ExtractedEntityRow {
  return {
    canonicalName: "Acme Health",
    canonicalUrl: "https://acme-health.example.com",
    rowStatus: "accepted",
    score: 0.8,
    rowSummary: "Grounded candidate.",
    sourceUrl: "https://example.com/best-healthcare-startups",
    sourceClass: "roundup",
    cells: [
      {
        key: "website",
        valueText: "https://acme-health.example.com",
        state: "filled",
        confidence: 0.9,
        reasonCode: null,
        evidenceText: "https://acme-health.example.com",
      },
    ],
    criteria: [],
    ...overrides,
  };
}

describe("live run policy", () => {
  it("treats only entity pages and official sites as grounding sources", () => {
    expect(isGroundingSourceClass("entity_page")).toBe(true);
    expect(isGroundingSourceClass("official_site")).toBe(true);
    expect(isGroundingSourceClass("directory")).toBe(false);
    expect(isGroundingSourceClass("roundup")).toBe(false);
    expect(isGroundingSourceClass("forum")).toBe(false);
  });

  it("forces list-derived rows to remain uncertain", () => {
    expect(coerceRowStatusForSource("roundup", "accepted")).toBe("uncertain");
    expect(coerceRowStatusForSource("directory", "rejected")).toBe("uncertain");
    expect(coerceRowStatusForSource("entity_page", "accepted")).toBe("accepted");
    expect(coerceRowStatusForSource("entity_page", "rejected")).toBe("rejected");
  });

  it("extracts follow-up URLs from list-derived candidates", () => {
    const urls = collectFollowUpUrls(makeExtractedRow());
    expect(urls).toEqual(["https://acme-health.example.com/"]);

    const groundingUrls = collectFollowUpUrls(
      makeExtractedRow({
        sourceClass: "entity_page",
        sourceUrl: "https://acme-health.example.com/company",
      }),
    );
    expect(groundingUrls).toEqual([]);
  });

  it("prefers non-list search results when selecting a fetch batch", () => {
    const selected = selectDiscoveryBatch(
      "yc w24 healthcare startups",
      [
        {
          title: "Best healthcare startups in YC",
          url: "https://example.com/best-healthcare-startups",
          description: "A roundup of top healthcare startups.",
        },
        {
          title: "Acme Health | YC W24",
          url: "https://acme-health.example.com",
          description: "Healthcare infrastructure for clinics.",
        },
      ],
      1,
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.url).toBe("https://acme-health.example.com");
  });

  it("keeps fetch batches intentionally small so refinement can loop", () => {
    expect(
      computeFetchBatchSize({
        iteration: 0,
        targetResults: 10,
        currentRows: 0,
        remainingExtractionCalls: 6,
        maxSourcesPerRun: 20,
      }),
    ).toBe(4);
    expect(
      computeFetchBatchSize({
        iteration: 1,
        targetResults: 10,
        currentRows: 4,
        remainingExtractionCalls: 2,
        maxSourcesPerRun: 20,
        preferFollowUps: true,
      }),
    ).toBe(2);
  });

  it("stops exploration once the candidate row target is reached", () => {
    expect(shouldStopExploration(10, 10)).toBe(true);
    expect(shouldStopExploration(11, 10)).toBe(true);
    expect(shouldStopExploration(9, 10)).toBe(false);
  });
});
