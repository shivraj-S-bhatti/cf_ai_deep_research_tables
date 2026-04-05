import { handleApiRequest } from "./app";
import { vi } from "vitest";

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  env?: Record<string, unknown>,
): Promise<Response> {
  return handleApiRequest(
    new Request(`http://localhost:8080${path}`, {
      method,
      headers: {
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env as never,
  );
}

async function apiJson<T>(method: string, path: string, body?: unknown, env?: Record<string, unknown>): Promise<T> {
  const response = await apiRequest(method, path, body, env);
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

async function waitForRun(runId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const run = await apiJson<{
      status: string;
      stage: string;
    }>("GET", `/api/v1/runs/${runId}`);
    if (["complete", "failed", "canceled"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Run ${runId} did not finish in time.`);
}

describe("Worker API vertical slice", () => {
  it("previews, runs, and exports a grounded fixture-backed query", async () => {
    const preview = await apiJson<{
      entityType: string;
      criteria: Array<{ label: string }>;
      columns: Array<{ label: string }>;
    }>("POST", "/api/v1/query-plans/preview", {
      query: "YC W24 healthcare startups",
      targetResults: 25,
    });

    expect(preview.entityType).toBe("company");
    expect(preview.criteria.length).toBeGreaterThan(0);
    expect(preview.columns.some((column) => column.label === "Website")).toBe(true);

    const created = await apiJson<{
      threadId: string;
      runId: string | null;
      phase: string;
    }>("POST", "/api/v1/threads", {
      query: "YC W24 healthcare startups",
      targetResults: 25,
      criteria: preview.criteria,
      columns: preview.columns,
    });

    expect(created.phase).toBe("preview");
    expect(created.runId).toBeNull();

    const started = await apiJson<{
      threadId: string;
      runId: string;
      phase: string;
    }>("POST", `/api/v1/threads/${created.threadId}/runs`);

    expect(started.phase).toBe("queued");

    const earlyResults = await apiJson<{
      rows: Array<{ processingState: string }>;
      run: { status: string };
    }>("GET", `/api/v1/runs/${started.runId}/results?include_rejected=true`);

    expect(["queued", "running"]).toContain(earlyResults.run.status);

    const finalRun = await waitForRun(started.runId);
    expect(finalRun.status).toBe("complete");

    const finalResults = await apiJson<{
      rows: Array<{
        id: string;
        status: string;
        processingState: string;
        canonicalName: string;
      }>;
      cells: Array<{ rowId: string; state: string; primaryEvidenceId: string | null }>;
    }>("GET", `/api/v1/runs/${started.runId}/results`);

    expect(finalResults.rows.some((row) => row.processingState === "finalized")).toBe(true);
    const acceptedRow = finalResults.rows.find((row) => row.status === "accepted");
    expect(acceptedRow).toBeDefined();

    const rowDetail = await apiJson<{
      cells: Array<{ state: string; primaryEvidenceId: string | null }>;
      evidence: Array<{ id: string }>;
      sources: Array<{ id: string }>;
    }>("GET", `/api/v1/runs/${started.runId}/results/${acceptedRow!.id}`);

    expect(
      rowDetail.cells.some(
        (cell) => cell.state === "filled" && typeof cell.primaryEvidenceId === "string",
      ),
    ).toBe(true);
    expect(rowDetail.evidence.length).toBeGreaterThan(0);
    expect(rowDetail.sources.length).toBeGreaterThan(0);

    const debugSummary = await apiJson<{
      checkpoints: Array<{ reached: boolean }>;
      traceSummary: { totalEvents: number };
    }>("GET", `/api/v1/runs/${started.runId}/debug`);

    expect(debugSummary.checkpoints.some((checkpoint) => checkpoint.reached)).toBe(true);
    expect(debugSummary.traceSummary.totalEvents).toBeGreaterThan(0);

    const trace = await apiJson<{
      events: Array<{ stage: string }>;
      total: number;
    }>("GET", `/api/v1/runs/${started.runId}/debug/trace?page=1&page_size=20`);

    expect(trace.total).toBeGreaterThan(0);
    expect(trace.events.length).toBeGreaterThan(0);

    const csvResponse = await apiRequest(
      "GET",
      `/api/v1/runs/${started.runId}/export?format=csv`,
    );
    expect(csvResponse.ok).toBe(true);
    const csv = await csvResponse.text();
    expect(csv).toContain("Entity,URL");
    expect(csv).toContain(acceptedRow!.canonicalName);
  });

  it("clears the stale run reference when the config is refreshed", async () => {
    const preview = await apiJson<{
      criteria: Array<{ label: string }>;
      columns: Array<{ label: string }>;
    }>("POST", "/api/v1/query-plans/preview", {
      query: "Open source LLM projects with >1k stars",
      targetResults: 25,
    });

    const created = await apiJson<{
      threadId: string;
    }>("POST", "/api/v1/threads", {
      query: "Open source LLM projects with >1k stars",
      targetResults: 25,
      criteria: preview.criteria,
      columns: preview.columns,
    });

    const started = await apiJson<{ runId: string }>(
      "POST",
      `/api/v1/threads/${created.threadId}/runs`,
    );

    await waitForRun(started.runId);

    const refreshed = await apiJson<{
      thread: { phase: string; latestRunId: string | null; queryRaw: string };
    }>("PATCH", `/api/v1/threads/${created.threadId}/config`, {
      query: "Top pizza places in Brooklyn",
    });

    expect(refreshed.thread.phase).toBe("preview");
    expect(refreshed.thread.latestRunId).toBeNull();
    expect(refreshed.thread.queryRaw).toBe("Top pizza places in Brooklyn");
  });

  it("runs live pipeline with mocked providers", async () => {
    const originalFetch = globalThis.fetch;
    const geminiPayload = (json: unknown) => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
    });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("api.search.brave.com")) {
        return new Response(JSON.stringify({
          web: {
            results: [
              {
                title: "Awesome LLMs",
                url: "https://example.com/awesome-llms",
                description: "Top open source LLM projects",
              },
            ],
          },
        }), { status: 200 });
      }
      if (url.includes("r.jina.ai/")) {
        return new Response(JSON.stringify({
          data: {
            url: "https://example.com/awesome-llms",
            title: "Awesome LLMs",
            description: "Top open source LLM projects",
            content: "1. Project Alpha - https://github.com/acme/alpha\n2. Project Beta - https://github.com/acme/beta",
          },
        }), { status: 200 });
      }
      if (url.includes("generativelanguage.googleapis.com") || url.includes("aiplatform.googleapis.com")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          systemInstruction?: { parts?: Array<{ text?: string }> };
        };
        const systemText = body.systemInstruction?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
        if (systemText.toLowerCase().includes("planning a grounded entity discovery run")) {
          return new Response(JSON.stringify(geminiPayload({
            entity_type: "project",
            hard_filters: ["Open source"],
            soft_signals: ["Active maintenance"],
            columns: [
              { key: "repo", label: "Repo", kind: "identity", value_type: "url" },
              { key: "license", label: "License", kind: "enrichment", value_type: "string" },
              { key: "evidence_count", label: "Evidence", kind: "criterion_summary", value_type: "number" },
            ],
            search_queries: ["open source llm projects github"],
            budgets: { search_budget: 1, fetch_budget: 4, verification_budget: 2 },
            notes: "mock plan",
          })), { status: 200 });
        }
        if (
          systemText.toLowerCase().includes("extract")
          && !systemText.toLowerCase().includes("already-extracted row")
          && !systemText.toLowerCase().includes("research supervisor")
        ) {
          return new Response(JSON.stringify(geminiPayload({
            entities: [
              {
                canonical_name: "Project Alpha",
                canonical_url: "https://github.com/acme/alpha",
                row_status: "uncertain",
                score: 0.8,
                row_summary: "Grounded from list.",
                cells: [
                  { key: "repo", value_text: "https://github.com/acme/alpha", state: "filled", confidence: 0.9, reason_code: null, evidence_text: "https://github.com/acme/alpha" },
                  { key: "license", value_text: "MIT", state: "filled", confidence: 0.6, reason_code: null, evidence_text: "MIT" },
                ],
                criteria: [{ label: "Open source", verdict: "pass", summary: "Public GitHub repository.", confidence: 0.9, evidence_text: "github.com" }],
              },
              {
                canonical_name: "Project Beta",
                canonical_url: "https://github.com/acme/beta",
                row_status: "uncertain",
                score: 0.75,
                row_summary: "Grounded from list.",
                cells: [{ key: "repo", value_text: "https://github.com/acme/beta", state: "filled", confidence: 0.9, reason_code: null, evidence_text: "https://github.com/acme/beta" }],
                criteria: [{ label: "Open source", verdict: "pass", summary: "Public GitHub repository.", confidence: 0.9, evidence_text: "github.com" }],
              },
            ],
          })), { status: 200 });
        }
        if (systemText.toLowerCase().includes("research supervisor")) {
          return new Response(JSON.stringify(geminiPayload({
            action: "done",
            queries: [],
            urls: [],
            focus_columns: [],
            reasoning: "Enough rows for this run.",
          })), { status: 200 });
        }
        if (systemText.toLowerCase().includes("rewrite search queries")) {
          return new Response(JSON.stringify(geminiPayload({ queries: ["open source llm projects github stars"] })), { status: 200 });
        }
        return new Response(JSON.stringify(geminiPayload({
          row_status: "accepted",
          score: 0.9,
          row_summary: "Looks grounded.",
          criteria: [{ label: "Open source", verdict: "pass", summary: "Grounded", confidence: 0.9, evidence_text: "GitHub public repo" }],
        })), { status: 200 });
      }
      return new Response("Not mocked", { status: 404 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const env = {
        AGENTIC_RUNTIME_MODE: "live",
        BRAVE_API_KEY: "test-brave",
        GEMINI_API_KEY: "test-gemini",
        JINA_API_KEY: "test-jina",
      };

      const preview = await apiJson<{
        criteria: Array<{ label: string }>;
        columns: Array<{ label: string }>;
      }>("POST", "/api/v1/query-plans/preview", {
        query: "open source llm projects with >1k stars",
        targetResults: 5,
      }, env);
      expect(preview.criteria.some((criterion) => /entity appears relevant/i.test(criterion.label))).toBe(false);

      const created = await apiJson<{ threadId: string }>("POST", "/api/v1/threads", {
        query: "open source llm projects with >1k stars",
        targetResults: 5,
        criteria: preview.criteria,
        columns: preview.columns,
      }, env);

      const started = await apiJson<{ runId: string }>("POST", `/api/v1/threads/${created.threadId}/runs`, undefined, env);
      const finalRun = await waitForRun(started.runId);
      expect(["complete", "failed"]).toContain(finalRun.status);

      const finalResults = await apiJson<{
        rows: Array<{ canonicalName: string; processingState: string }>;
      }>("GET", `/api/v1/runs/${started.runId}/results?include_rejected=true`, undefined, env);
      if (finalRun.status === "complete") {
        expect(finalResults.rows.some((row) => row.processingState === "finalized")).toBe(true);
        expect(finalResults.rows.some((row) => row.canonicalName.includes("Project Alpha"))).toBe(true);
      } else {
        const trace = await apiJson<{ total: number }>(
          "GET",
          `/api/v1/runs/${started.runId}/debug/trace?page=1&page_size=20`,
          undefined,
          env,
        );
        expect(trace.total).toBeGreaterThan(0);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("prunes wrong YC cohort pages without poisoning same-host sibling sources", async () => {
    const originalFetch = globalThis.fetch;
    const geminiPayload = (json: unknown) => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
    });
    const extractRequests: string[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("api.search.brave.com")) {
        return new Response(JSON.stringify({
          web: {
            results: [
              {
                title: "Y Combinator Spring 2026 batch",
                url: "https://www.ycombinator.com/companies/spring-2026",
                description: "Healthcare companies from Spring 2026.",
              },
              {
                title: "Y Combinator W24 batch",
                url: "https://www.ycombinator.com/companies/w24",
                description: "Healthcare companies from W24.",
              },
            ],
          },
        }), { status: 200 });
      }
      if (url.includes("r.jina.ai/")) {
        if (url.includes("spring-2026")) {
          return new Response(JSON.stringify({
            data: {
              url: "https://www.ycombinator.com/companies/spring-2026",
              title: "Y Combinator Spring 2026 batch",
              description: "Healthcare companies from Spring 2026.",
              content: "Spring 2026 batch companies. Healthcare startups and biotech companies. This page is clearly about the Spring 2026 cohort and not the requested Winter 2024 cohort.",
            },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          data: {
            url: "https://www.ycombinator.com/companies/w24",
            title: "Y Combinator W24 batch",
            description: "Healthcare companies from W24.",
            content: "W24 batch companies. Vera Health - https://verahealth.example.com. This page is the correct W24 cohort page for healthcare startups and includes grounded company links.",
          },
        }), { status: 200 });
      }
      if (url.includes("generativelanguage.googleapis.com") || url.includes("aiplatform.googleapis.com")) {
        const bodyText = String(init?.body ?? "");
        const body = JSON.parse(bodyText) as {
          systemInstruction?: { parts?: Array<{ text?: string }> };
        };
        const systemText = body.systemInstruction?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
        if (systemText.toLowerCase().includes("planning a grounded entity discovery run")) {
          return new Response(JSON.stringify(geminiPayload({
            entity_type: "company",
            hard_filters: ["Entity appears relevant to \"YC W24 healthcare startups\""],
            soft_signals: [],
            columns: [
              { key: "website", label: "Website", kind: "identity", value_type: "url" },
              { key: "description", label: "Description", kind: "enrichment", value_type: "string" },
              { key: "evidence_count", label: "Evidence", kind: "criterion_summary", value_type: "number" },
            ],
            search_queries: ["yc w24 healthcare startups"],
            budgets: { search_budget: 1, fetch_budget: 4, verification_budget: 2 },
            notes: "mock yc plan",
          })), { status: 200 });
        }
        if (systemText.toLowerCase().includes("extract")) {
          extractRequests.push(bodyText);
          return new Response(JSON.stringify(geminiPayload({
            entities: [
              {
                canonical_name: "Vera Health",
                canonical_url: "https://verahealth.example.com",
                row_status: "uncertain",
                score: 0.82,
                row_summary: "Company listed on the W24 batch page.",
                cells: [
                  { key: "website", value_text: "https://verahealth.example.com", state: "filled", confidence: 0.92, reason_code: null, evidence_text: "https://verahealth.example.com" },
                  { key: "description", value_text: "Healthcare startup in YC W24.", state: "filled", confidence: 0.81, reason_code: null, evidence_text: "Healthcare startup in YC W24." },
                ],
                criteria: [
                  {
                    label: "Entity appears relevant to \"YC W24 healthcare startups\"",
                    verdict: "pass",
                    summary: "The company appears on the YC W24 batch page.",
                    confidence: 0.95,
                    evidence_text: "W24 batch companies. Vera Health",
                  },
                ],
              },
            ],
          })), { status: 200 });
        }
        if (systemText.toLowerCase().includes("research supervisor")) {
          return new Response(JSON.stringify(geminiPayload({
            action: "done",
            queries: [],
            urls: [],
            focus_columns: [],
            reasoning: "Enough rows for this run.",
          })), { status: 200 });
        }
        if (systemText.toLowerCase().includes("rewrite search queries")) {
          return new Response(JSON.stringify(geminiPayload({ queries: ["yc w24 healthcare startups companies"] })), { status: 200 });
        }
        return new Response(JSON.stringify(geminiPayload({
          row_status: "accepted",
          score: 0.94,
          row_summary: "Confirmed from the W24 batch page.",
          criteria: [
            {
              label: "Entity appears relevant to \"YC W24 healthcare startups\"",
              verdict: "pass",
              summary: "Confirmed from source evidence.",
              confidence: 0.94,
              evidence_text: "W24 batch companies. Vera Health",
            },
          ],
        })), { status: 200 });
      }
      return new Response("Not mocked", { status: 404 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const env = {
        AGENTIC_RUNTIME_MODE: "live",
        BRAVE_API_KEY: "test-brave",
        GEMINI_API_KEY: "test-gemini",
        JINA_API_KEY: "test-jina",
      };

      const preview = await apiJson<{
        criteria: Array<{ label: string }>;
        columns: Array<{ label: string }>;
      }>("POST", "/api/v1/query-plans/preview", {
        query: "YC W24 healthcare startups",
        targetResults: 5,
      }, env);

      const created = await apiJson<{ threadId: string }>("POST", "/api/v1/threads", {
        query: "YC W24 healthcare startups",
        targetResults: 5,
        criteria: preview.criteria,
        columns: preview.columns,
        preview: {
          entityType: "company",
          criteria: preview.criteria as never,
          columns: preview.columns as never,
          searchQueries: [{ id: "sq-1", text: "yc w24 healthcare startups" }],
          budgets: { searchBudget: 1, fetchBudget: 4, verificationBudget: 2 },
          notes: "mock yc plan",
        },
      }, env);

      const started = await apiJson<{ runId: string }>("POST", `/api/v1/threads/${created.threadId}/runs`, undefined, env);
      const finalRun = await waitForRun(started.runId);
      expect(finalRun.status).toBe("complete");

      const finalResults = await apiJson<{
        rows: Array<{
          canonicalName: string;
          canonicalUrl: string;
          status: string;
          processingState: string;
          statusReasonCode?: string | null;
          statusReasonSummary?: string | null;
        }>;
      }>("GET", `/api/v1/runs/${started.runId}/results?include_rejected=true`, undefined, env);

      expect(finalResults.rows).toHaveLength(2);
      expect(finalResults.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            canonicalName: "Vera Health",
            status: "accepted",
            processingState: "finalized",
          }),
          expect.objectContaining({
            canonicalUrl: "https://www.ycombinator.com/companies/spring-2026",
            status: "rejected",
            processingState: "finalized",
            statusReasonCode: "source_scope_pruned",
          }),
        ]),
      );

      const prunedRow = finalResults.rows.find((row) => row.statusReasonCode === "source_scope_pruned");
      expect(prunedRow?.statusReasonSummary).toContain("W24");
      expect(prunedRow?.statusReasonSummary).toContain("S26");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails preview when live planner returns no criteria", async () => {
    const originalFetch = globalThis.fetch;
    const geminiPayload = (json: unknown) => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
    });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("generativelanguage.googleapis.com") || url.includes("aiplatform.googleapis.com")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          systemInstruction?: { parts?: Array<{ text?: string }> };
        };
        const systemText = body.systemInstruction?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
        if (systemText.toLowerCase().includes("planning a grounded entity discovery run")) {
          return new Response(JSON.stringify(geminiPayload({
            entity_type: "company",
            hard_filters: [],
            soft_signals: [],
            columns: [{ key: "website", label: "Website", kind: "identity", value_type: "url" }],
            search_queries: ["yc w24 healthcare startups"],
            budgets: { search_budget: 1, fetch_budget: 3, verification_budget: 1 },
            notes: "mock empty criteria",
          })), { status: 200 });
        }
      }
      return new Response("Not mocked", { status: 404 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const env = {
        AGENTIC_RUNTIME_MODE: "live",
        BRAVE_API_KEY: "test-brave",
        GEMINI_API_KEY: "test-gemini",
      };
      const response = await apiRequest("POST", "/api/v1/query-plans/preview", {
        query: "YC W24 healthcare startups",
        targetResults: 10,
      }, env);
      expect(response.ok).toBe(false);
      const payload = await response.json() as { error?: { message?: string } };
      expect(payload.error?.message ?? "").toMatch(/no criteria/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
