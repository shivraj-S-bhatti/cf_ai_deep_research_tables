import { describe, expect, it } from "vitest";
import type { Criterion, CriterionEvaluation, ResultRow } from "./contracts";
import {
  classifySourceScopeDecision,
  deriveFinalStatus,
  isRowInFlight,
  isRowTerminal,
  summarizeProductCounts,
} from "./runtime-policy";

function makeRow(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    id: "row-1",
    runId: "run-1",
    canonicalName: "Project Alpha",
    canonicalUrl: "https://example.com/project-alpha",
    entityType: "company",
    status: "uncertain",
    processingState: "refining",
    score: 0.5,
    rank: null,
    sourceCount: 1,
    duplicateOfRowId: null,
    statusReasonCode: null,
    statusReasonSummary: null,
    lineage: {
      suggestedBySourceIds: [],
      groundedBySourceIds: [],
      sourceOriginClass: "official",
    },
    ...overrides,
  };
}

function makeCriteria(): Criterion[] {
  return [
    {
      id: "criterion-1",
      label: "Entity appears relevant",
      description: "",
      kind: "hard_filter",
      color: "#000000",
    },
  ];
}

function makeEvaluation(overrides: Partial<CriterionEvaluation> = {}): CriterionEvaluation {
  return {
    id: "eval-1",
    rowId: "row-1",
    criterionId: "criterion-1",
    verdict: "pass",
    summary: "Grounded",
    confidence: 0.9,
    primaryEvidenceId: null,
    ...overrides,
  };
}

describe("runtime policy", () => {
  it("hard-prunes YC cohort mismatches with the exact source URL", () => {
    const decision = classifySourceScopeDecision(
      "YC W24 healthcare startups",
      {
        title: "Y Combinator Spring 2026 batch",
        snippet: "Browse the latest Spring 2026 healthcare companies.",
      },
      "https://www.ycombinator.com/companies/spring-2026",
    );

    expect(decision.eligibility).toBe("out_of_scope_hard");
    expect(decision.pruneKey).toBe("https://www.ycombinator.com/companies/spring-2026");
    expect(decision.reasonCode).toBe("source_scope_pruned");
    expect(decision.reasonSummary).toContain("W24");
    expect(decision.reasonSummary).toContain("S26");
  });

  it("does not poison same-host sibling sources when the cohort matches", () => {
    const pruned = classifySourceScopeDecision(
      "YC W24 healthcare startups",
      {
        title: "Y Combinator Spring 2026 batch",
        snippet: "",
      },
      "https://www.ycombinator.com/companies/spring-2026",
    );
    const eligible = classifySourceScopeDecision(
      "YC W24 healthcare startups",
      {
        title: "Y Combinator W24 batch",
        snippet: "",
      },
      "https://www.ycombinator.com/companies/w24",
    );

    expect(pruned.eligibility).toBe("out_of_scope_hard");
    expect(pruned.pruneKey).toBe("https://www.ycombinator.com/companies/spring-2026");
    expect(eligible.eligibility).toBe("eligible");
    expect(eligible.pruneKey).toBeNull();
  });

  it("keeps low-confidence hard fails uncertain", () => {
    const status = deriveFinalStatus(
      makeRow(),
      [makeEvaluation({ verdict: "fail", confidence: 0.55 })],
      makeCriteria(),
    );

    expect(status).toBe("uncertain");
  });

  it("rejects only strong hard-filter failures", () => {
    const status = deriveFinalStatus(
      makeRow(),
      [makeEvaluation({ verdict: "fail", confidence: 0.92 })],
      makeCriteria(),
    );

    expect(status).toBe("rejected");
  });

  it("downgrades document-like rows to uncertain instead of rejecting them", () => {
    const status = deriveFinalStatus(
      makeRow({
        status: "accepted",
        canonicalName: "Top healthcare startups in YC",
        canonicalUrl: "https://example.com/blog/top-healthcare-startups",
        lineage: {
          suggestedBySourceIds: [],
          groundedBySourceIds: [],
          sourceOriginClass: "roundup",
        },
      }),
      [makeEvaluation({ verdict: "pass", confidence: 0.95 })],
      makeCriteria(),
    );

    expect(status).toBe("uncertain");
  });

  it("counts only finalized rows as accepted or analyzed", () => {
    const summary = summarizeProductCounts([
      makeRow({ status: "accepted", processingState: "refining" }),
      makeRow({ id: "row-2", status: "accepted", processingState: "finalized" }),
      makeRow({ id: "row-3", status: "rejected", processingState: "finalized" }),
      makeRow({ id: "row-4", status: "conflict", processingState: "verifying" }),
    ]);

    expect(summary.accepted).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.finalizedCount).toBe(2);
    expect(summary.inFlightCount).toBe(2);
    expect(isRowTerminal(makeRow({ processingState: "finalized" }))).toBe(true);
    expect(isRowInFlight(makeRow({ processingState: "fetching" }))).toBe(true);
  });
});
