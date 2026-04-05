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
      searchQueries: Array<{ text: string }>;
      budgets: {
        searchBudget: number;
        fetchBudget: number;
        verificationBudget: number;
      };
      notes: string;
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
      preview,
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
      entityType: string;
      criteria: Array<{ label: string }>;
      columns: Array<{ label: string }>;
      searchQueries: Array<{ text: string }>;
      budgets: {
        searchBudget: number;
        fetchBudget: number;
        verificationBudget: number;
      };
      notes: string;
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
      preview,
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

  it("creates a draft thread immediately and blocks run start until preview is ready", async () => {
    const created = await apiJson<{
      threadId: string;
      runId: string | null;
      phase: string;
    }>("POST", "/api/v1/threads", {
      query: "Open source LLM projects with >1k stars",
      targetResults: 10,
    });

    expect(created.phase).toBe("preview");
    expect(created.runId).toBeNull();

    const snapshot = await apiJson<{
      thread: { statusSummary: string; entityType: string };
      plan: { searchQueries: Array<{ text: string }> };
      criteria: unknown[];
      columns: unknown[];
    }>("GET", `/api/v1/threads/${created.threadId}`);

    expect(snapshot.thread.statusSummary).toBe("Building preview…");
    expect(snapshot.thread.entityType).toBe("unknown");
    expect(snapshot.plan.searchQueries).toHaveLength(0);
    expect(snapshot.criteria).toHaveLength(0);
    expect(snapshot.columns).toHaveLength(0);

    const response = await apiRequest("POST", `/api/v1/threads/${created.threadId}/runs`);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "preview_pending",
      },
    });
  });

  it("reuses an existing preview thread for the same normalized query", async () => {
    const first = await apiJson<{
      threadId: string;
      phase: string;
    }>("POST", "/api/v1/threads", {
      query: "Open source LLM projects with >1k stars",
      targetResults: 10,
    });

    const second = await apiJson<{
      threadId: string;
      phase: string;
    }>("POST", "/api/v1/threads", {
      query: "  open   source llm projects with >1k stars ",
      targetResults: 10,
    });

    expect(first.phase).toBe("preview");
    expect(second.threadId).toBe(first.threadId);
  });

  it("exposes isolate and run diagnostics for operator verification", async () => {
    const health = await apiJson<{
      ok: boolean;
      instanceId: string;
    }>("GET", "/api/v1/health");
    expect(health.ok).toBe(true);
    expect(typeof health.instanceId).toBe("string");

    const runtimeDiagnostics = await apiJson<{
      instanceId: string;
      threadCount: number;
      inflightRunIds: string[];
    }>("GET", "/api/v1/debug/runtime");
    expect(runtimeDiagnostics.instanceId).toBe(health.instanceId);
    expect(Array.isArray(runtimeDiagnostics.inflightRunIds)).toBe(true);
    expect(runtimeDiagnostics.threadCount).toBeGreaterThanOrEqual(0);
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
        entityType: string;
        criteria: Array<{ label: string }>;
        columns: Array<{ label: string }>;
        searchQueries: Array<{ text: string }>;
        budgets: {
          searchBudget: number;
          fetchBudget: number;
          verificationBudget: number;
        };
        notes: string;
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
        preview,
      }, env);

      const started = await apiJson<{ runId: string }>("POST", `/api/v1/threads/${created.threadId}/runs`, undefined, env);
      const finalRun = await waitForRun(started.runId);
      expect(["complete", "failed"]).toContain(finalRun.status);

      const diagnostics = await apiJson<{
        instanceId: string;
        inflight: boolean;
        counts: { events: number };
      }>("GET", `/api/v1/runs/${started.runId}/debug/diagnostics`, undefined, env);
      expect(typeof diagnostics.instanceId).toBe("string");
      expect(diagnostics.counts.events).toBeGreaterThan(0);

      const finalResults = await apiJson<{
        rows: Array<{ canonicalName: string; processingState: string }>;
      }>("GET", `/api/v1/runs/${started.runId}/results?include_rejected=true`, undefined, env);
      const trace = await apiJson<{
        total: number;
        events: Array<{
          payloadJson?: {
            query?: string;
            sourceUrl?: string;
            toolCalls?: Array<{ input?: string; output?: string }>;
          };
        }>;
      }>("GET", `/api/v1/runs/${started.runId}/debug/trace?page=1&page_size=50`, undefined, env);
      expect(trace.total).toBeGreaterThan(0);
      if (finalRun.status === "complete" && finalResults.rows.length > 0) {
        expect(finalResults.rows.some((row) => row.processingState === "finalized")).toBe(true);
        expect(finalResults.rows.some((row) => row.canonicalName.includes("Project Alpha"))).toBe(true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("cancels a live run cooperatively while preserving terminal state", async () => {
    const originalFetch = globalThis.fetch;
    let releaseFetch: (() => void) | null = null;
    let fetchStartedResolve: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      fetchStartedResolve = resolve;
    });

    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("api.search.brave.com")) {
        return new Response(JSON.stringify({
          web: {
            results: [
              {
                title: "Best Pizza Williamsburg",
                url: "https://example.com/best-pizza-williamsburg",
                description: "Candidate source",
              },
            ],
          },
        }), { status: 200 });
      }
      if (url.includes("r.jina.ai/")) {
        fetchStartedResolve?.();
        return await new Promise<Response>((resolve, reject) => {
          releaseFetch = () => {
            resolve(new Response(JSON.stringify({
              data: {
                url: "https://example.com/best-pizza-williamsburg",
                title: "Best Pizza Williamsburg",
                description: "Candidate source",
                content: "Best Pizza Williamsburg official site https://bestpizza.example.com",
              },
            }), { status: 200 }));
          };
          const signal = init?.signal;
          const onAbort = () => {
            reject(signal?.reason ?? new DOMException("Request aborted.", "AbortError"));
          };
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      return new Response("Not mocked", { status: 404 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const criteria = [
        {
          id: "preview:criterion:relevance",
          label: "Entity appears relevant to \"Top pizza places in Brooklyn\"",
          kind: "hard_filter" as const,
          color: "hsl(220, 80%, 50%)",
          orderIndex: 0,
        },
      ];
      const columns = [
        {
          id: "preview:column:website",
          key: "website",
          label: "Website",
          kind: "identity" as const,
          valueType: "url" as const,
          preferredSources: ["official"],
          requiresVerification: true,
          allowInference: false,
          nullPolicy: "dash" as const,
          orderIndex: 0,
        },
      ];
      const env = {
        AGENTIC_RUNTIME_MODE: "live",
        BRAVE_API_KEY: "test-brave",
        GEMINI_API_KEY: "test-gemini",
        JINA_API_KEY: "test-jina",
      };

      const created = await apiJson<{ threadId: string }>("POST", "/api/v1/threads", {
        query: "Top pizza places in Brooklyn",
        targetResults: 5,
        criteria,
        columns,
        preview: {
          entityType: "business",
          criteria,
          columns,
          searchQueries: [{ id: "sq-1", text: "top pizza places in brooklyn" }],
          budgets: { searchBudget: 1, fetchBudget: 2, verificationBudget: 1 },
          notes: "mock plan",
        },
      }, env);

      const started = await apiJson<{ runId: string }>(
        "POST",
        `/api/v1/threads/${created.threadId}/runs`,
        undefined,
        env,
      );
      await fetchStarted;

      const canceled = await apiJson<{ status: string }>(
        "POST",
        `/api/v1/runs/${started.runId}/cancel`,
        undefined,
        env,
      );
      expect(canceled.status).toBe("canceled");

      releaseFetch?.();

      const finalRun = await waitForRun(started.runId);
      expect(finalRun.status).toBe("canceled");

      const diagnostics = await apiJson<{
        run: { status: string };
        recentEvents: Array<{ message: string }>;
      }>("GET", `/api/v1/runs/${started.runId}/debug/diagnostics`, undefined, env);
      expect(diagnostics.run.status).toBe("canceled");
      expect(diagnostics.recentEvents.some((event) => /Cancellation requested/i.test(event.message))).toBe(true);
    } finally {
      releaseFetch?.();
      globalThis.fetch = originalFetch;
    }
  });

  it("honors the configured provider timeout for live previews", async () => {
    const originalFetch = globalThis.fetch;
    const geminiPayload = (json: unknown) => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
    });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("generativelanguage.googleapis.com") || url.includes("aiplatform.googleapis.com")) {
        return await new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response(JSON.stringify(geminiPayload({
              entity_type: "company",
              hard_filters: ["Is a real company"],
              soft_signals: ["Has grounded evidence"],
              columns: [
                { key: "website", label: "Website", kind: "identity", value_type: "url" },
              ],
              search_queries: ["slow preview timeout query"],
              budgets: { search_budget: 1, fetch_budget: 3, verification_budget: 1 },
              notes: "slow mock plan",
            })), { status: 200 }));
          }, 2600);
        });
      }
      return new Response("Not mocked", { status: 404 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const env = {
        AGENTIC_RUNTIME_MODE: "live",
        BRAVE_API_KEY: "test-brave",
        GEMINI_API_KEY: "test-gemini",
        PROVIDER_TIMEOUT_MS: "4000",
      };
      const startedAt = Date.now();
      const preview = await apiJson<{
        criteria: Array<{ label: string }>;
        columns: Array<{ label: string }>;
      }>("POST", "/api/v1/query-plans/preview", {
        query: "slow preview timeout query",
        targetResults: 5,
      }, env);

      expect(preview.criteria).toHaveLength(2);
      expect(preview.columns).toHaveLength(1);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the configured Gemini planner model for live previews", async () => {
    const originalFetch = globalThis.fetch;
    const geminiPayload = (json: unknown) => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
    });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("gemini-2.5-flash-lite")) {
        return new Response(JSON.stringify(geminiPayload({
          entity_type: "project",
          hard_filters: ["Project is open source"],
          soft_signals: ["Project is an LLM"],
          columns: [
            { key: "name", label: "Project Name", kind: "identity", value_type: "string" },
          ],
          search_queries: ["open source llm projects"],
          budgets: { search_budget: 1, fetch_budget: 3, verification_budget: 1 },
          notes: "lite mock plan",
        })), { status: 200 });
      }
      return new Response("unexpected model", { status: 404 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const env = {
        AGENTIC_RUNTIME_MODE: "live",
        BRAVE_API_KEY: "test-brave",
        GEMINI_API_KEY: "test-gemini",
        GEMINI_PLANNER_MODEL: "gemini-2.5-flash-lite",
        PREVIEW_PLANNER_PROVIDER: "gemini",
        PREVIEW_PLANNER_TIMEOUT_MS: "4000",
        PREVIEW_PLANNER_MAX_ATTEMPTS: "1",
      };
      const preview = await apiJson<{
        entityType: string;
      }>("POST", "/api/v1/query-plans/preview", {
        query: "open source llm projects",
        targetResults: 5,
      }, env);

      expect(preview.entityType).toBe("project");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("supports Groq as the preview planner provider", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("api.groq.com/openai/v1/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  entity_type: "project",
                  hard_filters: ["Project is open source"],
                  soft_signals: ["Project is an LLM"],
                  columns: [
                    { key: "name", label: "Project Name", kind: "identity", value_type: "string" },
                    { key: "url", label: "Project URL", kind: "identity", value_type: "url" },
                  ],
                  search_queries: ["open source llm projects with 1k stars"],
                  budgets: { search_budget: 2, fetch_budget: 4, verification_budget: 1 },
                  notes: "groq mock plan",
                }),
              },
            },
          ],
        }), { status: 200 });
      }
      return new Response("Not mocked", { status: 404 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const env = {
        AGENTIC_RUNTIME_MODE: "live",
        BRAVE_API_KEY: "test-brave",
        GROQ_API_KEY: "test-groq",
        PREVIEW_PLANNER_PROVIDER: "groq",
        PREVIEW_PLANNER_MODEL: "openai/gpt-oss-20b",
        PREVIEW_PLANNER_TIMEOUT_MS: "4000",
        PREVIEW_PLANNER_MAX_ATTEMPTS: "1",
      };
      const preview = await apiJson<{
        entityType: string;
        criteria: Array<{ label: string }>;
      }>("POST", "/api/v1/query-plans/preview", {
        query: "Open source LLM projects with >1k stars",
        targetResults: 10,
      }, env);

      expect(preview.entityType).toBe("project");
      expect(preview.criteria[0]?.label).toBe("Project is open source");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    let supervisorCalls = 0;
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
        if (url.includes("verahealth.example.com")) {
          return new Response(JSON.stringify({
            data: {
              url: "https://verahealth.example.com",
              title: "Vera Health",
              description: "Clinical decision-support platform for providers.",
              content: "Vera Health is a healthcare startup in YC W24. Website: https://verahealth.example.com. Clinical decision-support platform for providers.",
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
          if (bodyText.includes("Source URL: https://verahealth.example.com")) {
            return new Response(JSON.stringify(geminiPayload({
              entities: [
                {
                  canonical_name: "Vera Health",
                  canonical_url: "https://verahealth.example.com",
                  row_status: "accepted",
                  score: 0.93,
                  row_summary: "Company website confirms the product and batch.",
                  cells: [
                    { key: "website", value_text: "https://verahealth.example.com", state: "filled", confidence: 0.96, reason_code: null, evidence_text: "https://verahealth.example.com" },
                    { key: "description", value_text: "Healthcare startup in YC W24.", state: "filled", confidence: 0.88, reason_code: null, evidence_text: "Vera Health is a healthcare startup in YC W24." },
                  ],
                  criteria: [
                    {
                      label: "Entity appears relevant to \"YC W24 healthcare startups\"",
                      verdict: "pass",
                      summary: "The company website confirms the W24 healthcare startup.",
                      confidence: 0.96,
                      evidence_text: "Vera Health is a healthcare startup in YC W24.",
                    },
                  ],
                },
              ],
            })), { status: 200 });
          }
          if (bodyText.includes("Source URL: https://verahealth.example.com/")) {
            return new Response(JSON.stringify(geminiPayload({
              entities: [
                {
                  canonical_name: "Vera Health",
                  canonical_url: "https://verahealth.example.com",
                  row_status: "accepted",
                  score: 0.93,
                  row_summary: "Company website confirms the product and batch.",
                  cells: [
                    { key: "website", value_text: "https://verahealth.example.com", state: "filled", confidence: 0.96, reason_code: null, evidence_text: "https://verahealth.example.com" },
                    { key: "description", value_text: "Healthcare startup in YC W24.", state: "filled", confidence: 0.88, reason_code: null, evidence_text: "Vera Health is a healthcare startup in YC W24." },
                  ],
                  criteria: [
                    {
                      label: "Entity appears relevant to \"YC W24 healthcare startups\"",
                      verdict: "pass",
                      summary: "The company website confirms the W24 healthcare startup.",
                      confidence: 0.96,
                      evidence_text: "Vera Health is a healthcare startup in YC W24.",
                    },
                  ],
                },
              ],
            })), { status: 200 });
          }
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
          supervisorCalls += 1;
          if (supervisorCalls === 1) {
            return new Response(JSON.stringify(geminiPayload({
              action: "fetch_more",
              queries: [],
              urls: [],
              focus_columns: ["Website", "Description"],
              reasoning: "Follow the extracted company page before deciding.",
            })), { status: 200 });
          }
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
          sourceCount: number;
          statusReasonCode?: string | null;
          statusReasonSummary?: string | null;
        }>;
      }>("GET", `/api/v1/runs/${started.runId}/results?include_rejected=true`, undefined, env);

      expect(finalResults.rows).toHaveLength(1);
      expect(finalResults.rows[0]).toEqual(
        expect.objectContaining({
          canonicalName: "Vera Health",
          canonicalUrl: "https://verahealth.example.com/",
          status: "accepted",
          processingState: "finalized",
        }),
      );
      expect(finalResults.rows.every((row) => row.sourceCount > 0)).toBe(true);
      expect(finalResults.rows.some((row) => row.statusReasonCode === "source_scope_pruned")).toBe(false);
      expect(
        extractRequests.some(
          (request) =>
            request.includes("Source URL: https://verahealth.example.com")
            || request.includes("Source URL: https://verahealth.example.com/"),
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("aborts in-flight fetches when the live run wall clock expires", async () => {
    const originalFetch = globalThis.fetch;
    let abortedFetches = 0;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("api.search.brave.com")) {
        return new Response(JSON.stringify({
          web: {
            results: [
              {
                title: "Best Pizza Williamsburg",
                url: "https://example.com/best-pizza-williamsburg",
                description: "Candidate source",
              },
            ],
          },
        }), { status: 200 });
      }
      if (url.includes("r.jina.ai/")) {
        return await new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          const onAbort = () => {
            abortedFetches += 1;
            reject(signal?.reason ?? new DOMException("Request aborted.", "AbortError"));
          };
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      return new Response("Not mocked", { status: 404 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const criteria = [
        {
          id: "preview:criterion:relevance",
          label: "Entity appears relevant to \"Top pizza places in Brooklyn\"",
          kind: "hard_filter" as const,
          color: "hsl(220, 80%, 50%)",
          orderIndex: 0,
        },
      ];
      const columns = [
        {
          id: "preview:column:website",
          key: "website",
          label: "Website",
          kind: "identity" as const,
          valueType: "url" as const,
          preferredSources: ["official"],
          requiresVerification: true,
          allowInference: false,
          nullPolicy: "dash" as const,
          orderIndex: 0,
        },
      ];
      const env = {
        AGENTIC_RUNTIME_MODE: "live",
        BRAVE_API_KEY: "test-brave",
        GEMINI_API_KEY: "test-gemini",
        MAX_RUN_WALL_CLOCK_MS: "80",
        PROVIDER_TIMEOUT_MS: "1000",
      };

      const created = await apiJson<{ threadId: string }>("POST", "/api/v1/threads", {
        query: "Top pizza places in Brooklyn",
        targetResults: 5,
        criteria,
        columns,
        preview: {
          entityType: "business",
          criteria,
          columns,
          searchQueries: [{ id: "sq-1", text: "top pizza places in brooklyn" }],
          budgets: { searchBudget: 1, fetchBudget: 2, verificationBudget: 1 },
          notes: "mock plan",
        },
      }, env);

      const started = await apiJson<{ runId: string }>(
        "POST",
        `/api/v1/threads/${created.threadId}/runs`,
        undefined,
        env,
      );
      const finalRun = await waitForRun(started.runId);
      expect(finalRun.status).toBe("failed");

      const runDetails = await apiJson<{ errorCode: string | null }>(
        "GET",
        `/api/v1/runs/${started.runId}`,
        undefined,
        env,
      );
      expect(runDetails.errorCode).toBe("wall_clock_exceeded");

      const finalResults = await apiJson<{
        rows: Array<{ processingState: string }>;
      }>(
        "GET",
        `/api/v1/runs/${started.runId}/results?include_rejected=true`,
        undefined,
        env,
      );
      expect(finalResults.rows).toHaveLength(0);
      expect(finalResults.rows.every((row) => ["finalized", "failed"].includes(row.processingState))).toBe(true);
      expect(abortedFetches).toBeGreaterThan(0);
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
