import { DurableObject } from "cloudflare:workers";
import type { ThreadSnapshot } from "../../lib/contracts";
import type { WorkerEnv } from "../index";
import { errorResponse, jsonResponse, readJson } from "../utils/http";

type RegistryState = {
  threadOrder: string[];
  threads: Record<string, ThreadSnapshot>;
  runOwners: Record<string, string>;
};

type SyncThreadRequest = {
  snapshot: ThreadSnapshot;
  runIds: string[];
};

type DeleteThreadRequest = {
  threadId: string;
};

const REGISTRY_STORAGE_KEY = "thread_registry_state";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyRegistryState(): RegistryState {
  return {
    threadOrder: [],
    threads: {},
    runOwners: {},
  };
}

export class ThreadRegistryDurableObject extends DurableObject<WorkerEnv> {
  private state: RegistryState = emptyRegistryState();

  constructor(ctx: unknown, env: WorkerEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<RegistryState>(REGISTRY_STORAGE_KEY);
      this.state = stored ? clone(stored) : emptyRegistryState();
    });
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put(REGISTRY_STORAGE_KEY, this.state);
  }

  private upsertThread(snapshot: ThreadSnapshot, runIds: string[]): void {
    this.state.threads[snapshot.thread.id] = clone(snapshot);
    this.state.threadOrder = [
      snapshot.thread.id,
      ...this.state.threadOrder.filter((threadId) => threadId !== snapshot.thread.id),
    ];
    for (const [runId, threadId] of Object.entries(this.state.runOwners)) {
      if (threadId === snapshot.thread.id) {
        delete this.state.runOwners[runId];
      }
    }
    for (const runId of runIds) {
      this.state.runOwners[runId] = snapshot.thread.id;
    }
  }

  private deleteThread(threadId: string): boolean {
    if (!this.state.threads[threadId]) return false;
    delete this.state.threads[threadId];
    this.state.threadOrder = this.state.threadOrder.filter((entry) => entry !== threadId);
    for (const [runId, ownerThreadId] of Object.entries(this.state.runOwners)) {
      if (ownerThreadId === threadId) {
        delete this.state.runOwners[runId];
      }
    }
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (request.method === "GET" && url.pathname === "/internal/threads") {
        const threads = this.state.threadOrder
          .map((threadId) => this.state.threads[threadId])
          .filter((value): value is ThreadSnapshot => Boolean(value))
          .map((snapshot) => clone(snapshot));
        return jsonResponse({ threads });
      }

      if (request.method === "GET" && url.pathname === "/internal/diagnostics") {
        return jsonResponse({
          threadCount: this.state.threadOrder.length,
          runOwnerCount: Object.keys(this.state.runOwners).length,
          threads: this.state.threadOrder
            .map((threadId) => this.state.threads[threadId])
            .filter((value): value is ThreadSnapshot => Boolean(value))
            .map((snapshot) => ({
              threadId: snapshot.thread.id,
              queryRaw: snapshot.thread.queryRaw,
              phase: snapshot.thread.phase,
              latestRunId: snapshot.thread.latestRunId,
              statusSummary: snapshot.thread.statusSummary,
            })),
        });
      }

      if (request.method === "GET" && parts[0] === "internal" && parts[1] === "runs" && parts[2] && parts[3] === "owner") {
        const threadId = this.state.runOwners[parts[2]] ?? null;
        return jsonResponse({ threadId });
      }

      if (request.method === "POST" && url.pathname === "/internal/sync-thread") {
        const body = await readJson<SyncThreadRequest>(request);
        this.upsertThread(body.snapshot, body.runIds);
        await this.persist();
        return jsonResponse({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/internal/delete-thread") {
        const body = await readJson<DeleteThreadRequest>(request);
        const deleted = this.deleteThread(body.threadId);
        if (deleted) {
          await this.persist();
        }
        return jsonResponse({ deleted });
      }

      return errorResponse(requestId, 404, "registry_route_not_found", "Registry route not found.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected registry error";
      return errorResponse(requestId, 500, "registry_error", message);
    }
  }
}
