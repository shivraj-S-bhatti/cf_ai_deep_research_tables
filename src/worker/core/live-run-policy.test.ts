import { describe, expect, it } from "vitest";
import type { ExtractedEntityRow } from "../domain/dedup";
import {
  buildCorroborationQueries,
  classifyDiscoveryIntent,
  collectFollowUpUrls,
  computeFetchBatchSize,
  coerceRowStatusForSource,
  discoverySearchResultLimit,
  expandDiscoveryQueries,
  extractionTimeoutMsForIntent,
  isGroundingSourceClass,
  selectDiscoveryBatch,
  shouldStopGreedyRefinement,
  shouldStopExploration,
} from "./live-run-policy";

function makeExtractedRow(overrides: Partial<ExtractedEntityRow> = {}): ExtractedEntityRow {
  return {
    canonicalName: "Acme Health",
    canonicalUrl: "https://acme-health.example.com",
    candidateWebsite: "https://acme-health.example.com",
    followUpUrls: [],
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

  it("builds small deterministic corroboration queries once an anchor exists", () => {
    expect(
      buildCorroborationQueries({
        anchorName: "Acme Health",
        query: "YC W24 healthcare startups",
        entityType: "company",
        candidateWebsite: "https://acme-health.example.com/about",
      }),
    ).toEqual([
      "\"Acme Health\"",
      "\"Acme Health\" company",
      "\"Acme Health\" YC W24 healthcare startups",
      "\"Acme Health\" site:acme-health.example.com",
    ]);
  });

  it("prefers non-list search results when selecting a fetch batch", () => {
    const selected = selectDiscoveryBatch(
      {
        query: "yc w24 healthcare startups",
        entityType: "company",
        candidates: [
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
        limit: 1,
      },
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.url).toBe("https://acme-health.example.com");
  });

  it("classifies OSS repo discovery separately from general web discovery", () => {
    expect(
      classifyDiscoveryIntent({
        query: "Open source LLM projects with >1k stars",
        entityType: "project",
        criteriaLabels: ["Open source", "LLM", "Stars > 1000"],
      }),
    ).toBe("project_repo");
  });

  it("expands project queries with github-first search variants", () => {
    const queries = expandDiscoveryQueries({
      query: "Open source LLM projects with >1k stars",
      entityType: "project",
      plannedQueries: [{ id: "q1", text: "open source llm projects with >1k stars" }],
      criteriaLabels: ["Open source", "LLM", "Stars > 1000"],
    });

    expect(queries.map((query) => query.text)).toEqual([
      "open source llm projects with >1k stars",
      "Open source LLM projects with >1k stars github",
      "Open source LLM projects with >1k stars site:github.com",
      "open source llm github repository stars",
      "github llm repository stars >1000",
      "open source llm repository github stars >1000",
    ]);
  });

  it("does not collapse distinct GitHub repos into a single host bucket", () => {
    const selected = selectDiscoveryBatch({
      query: "Open source LLM projects with >1k stars",
      entityType: "project",
      criteriaLabels: ["Open source", "LLM", "Stars > 1000"],
      candidates: [
        {
          title: "open-llm-leaderboard",
          url: "https://github.com/spaces/open-llm-leaderboard",
          description: "Leaderboard",
        },
        {
          title: "vllm-project/vllm",
          url: "https://github.com/vllm-project/vllm",
          description: "Open-source inference engine for LLMs.",
        },
        {
          title: "ggerganov/llama.cpp",
          url: "https://github.com/ggerganov/llama.cpp",
          description: "Port of LLaMA models in C/C++.",
        },
      ],
      limit: 2,
    });

    expect(selected.map((result) => result.url)).toEqual([
      "https://github.com/vllm-project/vllm",
      "https://github.com/ggerganov/llama.cpp",
    ]);
  });

  it("keeps leaderboard pages out of the first repo shortlist when repo pages exist", () => {
    const selected = selectDiscoveryBatch({
      query: "Open source LLM projects with >1k stars",
      entityType: "project",
      criteriaLabels: ["Open source", "LLM", "Stars > 1000"],
      candidates: [
        {
          title: "Open LLM Leaderboard",
          url: "https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard",
          description: "Leaderboard of top open models.",
        },
        {
          title: "vllm-project/vllm",
          url: "https://github.com/vllm-project/vllm",
          description: "Open-source inference engine for LLMs.",
        },
        {
          title: "ggerganov/llama.cpp",
          url: "https://github.com/ggerganov/llama.cpp",
          description: "Port of LLaMA models in C/C++.",
        },
      ],
      limit: 2,
    });

    expect(selected.map((result) => result.url)).toEqual([
      "https://github.com/vllm-project/vllm",
      "https://github.com/ggerganov/llama.cpp",
    ]);
  });

  it("widens search breadth but shortens weak-page extraction time for repo queries", () => {
    expect(discoverySearchResultLimit(5, "project_repo")).toBe(10);
    expect(extractionTimeoutMsForIntent("roundup", "project_repo", 20_000)).toBe(4_000);
    expect(extractionTimeoutMsForIntent("entity_page", "project_repo", 20_000)).toBe(8_000);
  });

  it("keeps fetch batches intentionally small so refinement can loop", () => {
    expect(
      computeFetchBatchSize({
        iteration: 0,
        targetResults: 10,
        currentRows: 0,
        remainingExtractionCalls: 6,
        maxSourcesPerRun: 20,
        intent: "project_repo",
      }),
    ).toBe(2);
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
    expect(
      computeFetchBatchSize({
        iteration: 1,
        targetResults: 10,
        currentRows: 2,
        remainingExtractionCalls: 6,
        maxSourcesPerRun: 20,
        intent: "project_repo",
      }),
    ).toBe(1);
  });

  it("stops exploration once the grounded row target is reached", () => {
    expect(shouldStopExploration(10, 10)).toBe(true);
    expect(shouldStopExploration(11, 10)).toBe(true);
    expect(shouldStopExploration(9, 10)).toBe(false);
  });

  it("greedily stops repo refinement after a no-yield discovery miss once rows exist", () => {
    expect(
      shouldStopGreedyRefinement({
        intent: "project_repo",
        groundedRows: 2,
        targetResults: 10,
        pendingAnchors: 0,
        consecutiveNoGroundingIterations: 1,
        broadDiscoveryMisses: 1,
      }),
    ).toBe(true);

    expect(
      shouldStopGreedyRefinement({
        intent: "project_repo",
        groundedRows: 0,
        targetResults: 10,
        pendingAnchors: 0,
        consecutiveNoGroundingIterations: 1,
        broadDiscoveryMisses: 1,
      }),
    ).toBe(false);
  });
});
