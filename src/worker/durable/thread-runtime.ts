import { DurableObject } from "cloudflare:workers";
import type {
  CreateThreadRequest,
  UpdateThreadConfigRequest,
} from "../../lib/contracts";
import type { WorkerEnv } from "../index";
import { AgenticSearchRuntime } from "../core/runtime";
import { MemoryResearchStore, type MemoryResearchStoreSnapshot } from "../storage/memory-store";
import { errorResponse, jsonResponse, readJson, textResponse } from "../utils/http";

const SNAPSHOT_STORAGE_KEY = "thread_runtime_snapshot";

type BootstrapThreadRequest = CreateThreadRequest & {
  threadId: string;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class ThreadRuntimeDurableObject extends DurableObject<WorkerEnv> {
  private runtime!: AgenticSearchRuntime;
  private threadId: string | null = null;
  private persistDirty = false;
  private persistPromise: Promise<void> | null = null;

  constructor(ctx: unknown, env: WorkerEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const snapshot = await this.ctx.storage.get<MemoryResearchStoreSnapshot>(SNAPSHOT_STORAGE_KEY);
      const store = new MemoryResearchStore(snapshot ?? null, () => this.schedulePersist());
      this.runtime = new AgenticSearchRuntime(env, { store });
      if (snapshot?.threads?.[0]?.thread?.id) {
        this.threadId = snapshot.threads[0].thread.id;
      }
      if (snapshot) {
        this.runtime.recoverInterruptedRuns();
        await this.persistNow();
      }
    });
  }

  private schedulePersist(): void {
    this.persistDirty = true;
    if (this.persistPromise) return;
    this.persistPromise = Promise.resolve()
      .then(async () => {
        while (this.persistDirty) {
          this.persistDirty = false;
          await this.persistNow();
        }
      })
      .catch((error) => {
        console.error("[thread-runtime-do] persist failed", error);
      })
      .finally(() => {
        this.persistPromise = null;
      });
  }

  private async persistNow(): Promise<void> {
    if (!this.runtime) return;
    await this.ctx.storage.put(SNAPSHOT_STORAGE_KEY, clone(this.runtime.exportState()));
    await this.syncRegistry();
  }

  private registryStub() {
    return this.env.THREAD_REGISTRY?.getByName("registry") ?? null;
  }

  private async syncRegistry(): Promise<void> {
    if (!this.threadId) return;
    const registry = this.registryStub();
    if (!registry) return;
    const snapshot = this.runtime.getThread(this.threadId);
    if (!snapshot) return;
    const runIds = this.runtime
      .exportState()
      .runs
      .filter((run) => run.run.threadId === this.threadId)
      .map((run) => run.run.id);
    await registry.fetch(
      new Request("https://registry/internal/sync-thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snapshot,
          runIds,
        }),
      }),
    );
  }

  private async deleteFromRegistry(threadId: string): Promise<void> {
    const registry = this.registryStub();
    if (!registry) return;
    await registry.fetch(
      new Request("https://registry/internal/delete-thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId }),
      }),
    );
  }

  private ensureThreadBootstrapped(requestId: string) {
    if (!this.threadId) {
      return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
    }
    return null;
  }

  async fetch(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (request.method === "POST" && url.pathname === "/internal/bootstrap") {
        const body = await readJson<BootstrapThreadRequest>(request);
        this.threadId = body.threadId;
        const created = this.runtime.createThread(body, { threadId: body.threadId });
        await this.persistNow();
        return jsonResponse(created, 200, { "x-request-id": requestId });
      }

      if (request.method === "GET" && url.pathname === "/internal/runtime") {
        return jsonResponse(this.runtime.getRuntimeDiagnostics(), 200, { "x-request-id": requestId });
      }

      if (request.method === "GET" && url.pathname === "/internal/thread") {
        const missing = this.ensureThreadBootstrapped(requestId);
        if (missing) return missing;
        const thread = this.runtime.getThread(this.threadId!);
        if (!thread) return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
        return jsonResponse(thread, 200, { "x-request-id": requestId });
      }

      if (request.method === "DELETE" && url.pathname === "/internal/thread") {
        const missing = this.ensureThreadBootstrapped(requestId);
        if (missing) return missing;
        const threadId = this.threadId!;
        const ok = this.runtime.deleteThread(threadId);
        if (!ok) return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
        await this.ctx.storage.put(SNAPSHOT_STORAGE_KEY, clone(this.runtime.exportState()));
        await this.deleteFromRegistry(threadId);
        return jsonResponse({ deleted: true }, 200, { "x-request-id": requestId });
      }

      if (request.method === "PATCH" && url.pathname === "/internal/thread/config") {
        const missing = this.ensureThreadBootstrapped(requestId);
        if (missing) return missing;
        const body = await readJson<UpdateThreadConfigRequest>(request);
        const thread = this.runtime.updateThreadConfig(this.threadId!, body);
        if (!thread) return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
        await this.persistNow();
        return jsonResponse(thread, 200, { "x-request-id": requestId });
      }

      if (request.method === "POST" && url.pathname === "/internal/thread/runs") {
        const missing = this.ensureThreadBootstrapped(requestId);
        if (missing) return missing;
        const run = this.runtime.createRun(this.threadId!);
        if (!run) {
          const thread = this.runtime.getThread(this.threadId!);
          if (thread) {
            return errorResponse(requestId, 409, "preview_pending", "Preview is still building for this thread.");
          }
          return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
        }
        await this.persistNow();
        const inflight = this.runtime.getInflightPromise(run.runId);
        this.ctx.waitUntil?.(inflight ?? Promise.resolve());
        return jsonResponse(run, 200, { "x-request-id": requestId });
      }

      if (parts[0] === "internal" && parts[1] === "runs" && parts[2]) {
        const runId = parts[2];

        if (request.method === "GET" && parts.length === 3) {
          const run = this.runtime.getRun(runId);
          if (!run) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
          return jsonResponse(run, 200, { "x-request-id": requestId });
        }

        if (request.method === "GET" && parts[3] === "debug" && parts.length === 4) {
          const debug = this.runtime.getRunDebug(runId);
          if (!debug) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
          return jsonResponse(debug, 200, { "x-request-id": requestId });
        }

        if (request.method === "GET" && parts[3] === "debug" && parts[4] === "diagnostics") {
          const diagnostics = this.runtime.getRunDiagnostics(runId);
          if (!diagnostics) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
          return jsonResponse(diagnostics, 200, { "x-request-id": requestId });
        }

        if (request.method === "GET" && parts[3] === "debug" && parts[4] === "trace") {
          const page = Number(url.searchParams.get("page") ?? "1");
          const pageSize = Number(url.searchParams.get("page_size") ?? "50");
          const trace = this.runtime.getRunTrace(runId, page, pageSize);
          if (!trace) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
          return jsonResponse(trace, 200, { "x-request-id": requestId });
        }

        if (request.method === "GET" && parts[3] === "events") {
          return jsonResponse(this.runtime.getRunEvents(runId), 200, { "x-request-id": requestId });
        }

        if (request.method === "GET" && parts[3] === "results" && parts.length === 4) {
          const includeRejected = url.searchParams.get("include_rejected") === "true";
          const results = this.runtime.getRunResults(runId, includeRejected);
          if (!results) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
          return jsonResponse(results, 200, { "x-request-id": requestId });
        }

        if (request.method === "GET" && parts[3] === "results" && parts[4]) {
          const rowDetails = this.runtime.getRowDetails(runId, parts[4]);
          if (!rowDetails) return errorResponse(requestId, 404, "row_not_found", "Row not found.");
          return jsonResponse(rowDetails, 200, { "x-request-id": requestId });
        }

        if (request.method === "POST" && parts[3] === "cancel") {
          const run = this.runtime.cancelRun(runId);
          if (!run) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
          await this.persistNow();
          return jsonResponse(run, 200, { "x-request-id": requestId });
        }

        if (request.method === "GET" && parts[3] === "export") {
          const format = url.searchParams.get("format");
          if (format !== "csv" && format !== "json") {
            return errorResponse(requestId, 400, "invalid_export_format", "Export format must be csv or json.");
          }
          const artifact = this.runtime.exportRun(runId, format);
          if (!artifact) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
          return textResponse(artifact.content, 200, {
            "content-type": artifact.contentType,
            "content-disposition": `attachment; filename="${artifact.downloadName}"`,
            "x-request-id": requestId,
          });
        }
      }

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            allow: "GET,POST,PATCH,DELETE,OPTIONS",
          },
        });
      }

      return errorResponse(requestId, 404, "thread_runtime_route_not_found", "Thread runtime route not found.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected thread runtime error";
      return errorResponse(requestId, 500, "thread_runtime_error", message);
    }
  }
}
