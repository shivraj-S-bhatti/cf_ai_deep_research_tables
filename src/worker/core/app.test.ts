import { handleApiRequest } from "./app";

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return handleApiRequest(
    new Request(`http://localhost:8080${path}`, {
      method,
      headers: {
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

async function apiJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, path, body);
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
});
