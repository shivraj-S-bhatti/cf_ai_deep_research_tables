import type {
  CreateThreadRequest,
  PreviewRequest,
  UpdateThreadConfigRequest,
} from "../../lib/contracts";
import type { WorkerEnv, WorkerExecutionContext, DurableObjectStubLike } from "../index";
import { getRuntime } from "./runtime";
import { makeId } from "../utils/ids";
import { emptyResponse, errorResponse, jsonResponse, readJson, textResponse } from "../utils/http";

function getPathname(request: Request): string {
  return new URL(request.url).pathname;
}

function getPathParts(request: Request): string[] {
  return getPathname(request).split("/").filter(Boolean);
}

declare global {
  var __agenticSearchWorkerInstanceId: string | undefined;
}

function getWorkerInstanceId(): string {
  if (!globalThis.__agenticSearchWorkerInstanceId) {
    globalThis.__agenticSearchWorkerInstanceId = crypto.randomUUID();
  }
  return globalThis.__agenticSearchWorkerInstanceId;
}

function hasDurableInfra(
  env?: WorkerEnv,
): env is WorkerEnv & { THREAD_RUNTIME: NonNullable<WorkerEnv["THREAD_RUNTIME"]>; THREAD_REGISTRY: NonNullable<WorkerEnv["THREAD_REGISTRY"]> } {
  return Boolean(env?.THREAD_RUNTIME && env?.THREAD_REGISTRY);
}

function buildForwardRequest(
  pathWithQuery: string,
  method: string,
  body?: unknown,
): Request {
  return new Request(`https://thread-runtime${pathWithQuery}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function forwardJson<T>(stub: DurableObjectStubLike, pathWithQuery: string, method: string, body?: unknown): Promise<T> {
  const response = await stub.fetch(buildForwardRequest(pathWithQuery, method, body));
  if (!response.ok) {
    throw await response.json();
  }
  return response.json() as Promise<T>;
}

async function resolveThreadOwner(env: WorkerEnv & { THREAD_REGISTRY: NonNullable<WorkerEnv["THREAD_REGISTRY"]> }, runId: string): Promise<string | null> {
  const registry = env.THREAD_REGISTRY.getByName("registry");
  const response = await registry.fetch(buildForwardRequest(`/internal/runs/${runId}/owner`, "GET"));
  if (!response.ok) return null;
  const payload = (await response.json()) as { threadId: string | null };
  return payload.threadId;
}

async function handleApiRequestDurable(
  request: Request,
  env: WorkerEnv & { THREAD_RUNTIME: NonNullable<WorkerEnv["THREAD_RUNTIME"]>; THREAD_REGISTRY: NonNullable<WorkerEnv["THREAD_REGISTRY"]> },
  _ctx: WorkerExecutionContext | undefined,
  requestId: string,
): Promise<Response> {
  const runtime = getRuntime(env);
  const url = new URL(request.url);
  const parts = getPathParts(request);
  const registry = env.THREAD_REGISTRY.getByName("registry");

  if (request.method === "GET" && getPathname(request) === "/api/v1/health") {
    return jsonResponse(
      {
        ok: true,
        requestId,
        instanceId: getWorkerInstanceId(),
        infra: "durable_objects",
        now: Date.now(),
      },
      200,
    );
  }

  if (request.method === "GET" && getPathname(request) === "/api/v1/debug/runtime") {
    const response = await registry.fetch(buildForwardRequest("/internal/diagnostics", "GET"));
    const diagnostics = response.ok ? await response.json() : { threadCount: 0, runOwnerCount: 0, threads: [] };
    return jsonResponse(
      {
        instanceId: getWorkerInstanceId(),
        now: Date.now(),
        infra: "durable_objects",
        ...(diagnostics as object),
      },
      200,
      { "x-request-id": requestId },
    );
  }

  if (request.method === "POST" && getPathname(request) === "/api/v1/query-plans/preview") {
    const body = await readJson<PreviewRequest>(request);
    return jsonResponse(await runtime.preview(body), 200, { "x-request-id": requestId });
  }

  if (request.method === "GET" && getPathname(request) === "/api/v1/threads") {
    const response = await registry.fetch(buildForwardRequest("/internal/threads", "GET"));
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
        "x-request-id": requestId,
      },
    });
  }

  if (request.method === "POST" && getPathname(request) === "/api/v1/threads") {
    const body = await readJson<CreateThreadRequest>(request);
    const threadId = makeId("thr");
    const stub = env.THREAD_RUNTIME.getByName(threadId);
    const created = await forwardJson(stub, "/internal/bootstrap", "POST", {
      ...body,
      threadId,
    });
    return jsonResponse(created, 200, { "x-request-id": requestId });
  }

  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "threads" && parts[3]) {
    const threadId = parts[3];
    const stub = env.THREAD_RUNTIME.getByName(threadId);

    if (request.method === "GET" && parts.length === 4) {
      const response = await stub.fetch(buildForwardRequest("/internal/thread", "GET"));
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
          "x-request-id": requestId,
        },
      });
    }

    if (request.method === "DELETE" && parts.length === 4) {
      const response = await stub.fetch(buildForwardRequest("/internal/thread", "DELETE"));
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
          "x-request-id": requestId,
        },
      });
    }

    if (request.method === "PATCH" && parts[4] === "config") {
      const body = await readJson<UpdateThreadConfigRequest>(request);
      const response = await stub.fetch(buildForwardRequest("/internal/thread/config", "PATCH", body));
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
          "x-request-id": requestId,
        },
      });
    }

    if (request.method === "POST" && parts[4] === "runs") {
      const response = await stub.fetch(buildForwardRequest("/internal/thread/runs", "POST"));
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
          "x-request-id": requestId,
        },
      });
    }
  }

  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "runs" && parts[3]) {
    const runId = parts[3];
    const threadId = await resolveThreadOwner(env, runId);
    if (!threadId) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
    const stub = env.THREAD_RUNTIME.getByName(threadId);
    const suffix = url.pathname.replace(`/api/v1`, "/internal");
    const pathWithQuery = `${suffix}${url.search}`;
    const response = await stub.fetch(buildForwardRequest(pathWithQuery, request.method));
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
        "content-disposition": response.headers.get("content-disposition") ?? "",
        "x-request-id": requestId,
      },
    });
  }

  if (request.method === "OPTIONS") {
    return emptyResponse(204, {
      allow: "GET,POST,PATCH,DELETE,OPTIONS",
    });
  }

  return errorResponse(requestId, 404, "route_not_found", "Route not found.");
}

async function handleApiRequestLegacy(
  request: Request,
  env: WorkerEnv | undefined,
  ctx: WorkerExecutionContext | undefined,
  requestId: string,
): Promise<Response> {
  const runtime = getRuntime(env);
  const url = new URL(request.url);
  const parts = getPathParts(request);

  if (request.method === "GET" && getPathname(request) === "/api/v1/health") {
    return jsonResponse({ ok: true, requestId, instanceId: runtime.getInstanceId(), now: Date.now() });
  }

  if (request.method === "GET" && getPathname(request) === "/api/v1/debug/runtime") {
    return jsonResponse(runtime.getRuntimeDiagnostics(), 200, { "x-request-id": requestId });
  }

  if (request.method === "POST" && getPathname(request) === "/api/v1/query-plans/preview") {
    const body = await readJson<PreviewRequest>(request);
    return jsonResponse(await runtime.preview(body), 200, { "x-request-id": requestId });
  }

  if (request.method === "GET" && getPathname(request) === "/api/v1/threads") {
    return jsonResponse(runtime.listThreads(), 200, { "x-request-id": requestId });
  }

  if (request.method === "POST" && getPathname(request) === "/api/v1/threads") {
    const body = await readJson<CreateThreadRequest>(request);
    return jsonResponse(runtime.createThread(body), 200, { "x-request-id": requestId });
  }

  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "threads" && parts[3]) {
    const threadId = parts[3];

    if (request.method === "GET" && parts.length === 4) {
      const thread = runtime.getThread(threadId);
      if (!thread) return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
      return jsonResponse(thread, 200, { "x-request-id": requestId });
    }

    if (request.method === "DELETE" && parts.length === 4) {
      const ok = runtime.deleteThread(threadId);
      if (!ok) return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
      return jsonResponse({ deleted: true }, 200, { "x-request-id": requestId });
    }

    if (request.method === "PATCH" && parts[4] === "config") {
      const body = await readJson<UpdateThreadConfigRequest>(request);
      const thread = runtime.updateThreadConfig(threadId, body);
      if (!thread) return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
      return jsonResponse(thread, 200, { "x-request-id": requestId });
    }

    if (request.method === "POST" && parts[4] === "runs") {
      const run = runtime.createRun(threadId);
      if (!run) {
        const thread = runtime.getThread(threadId);
        if (thread) {
          return errorResponse(requestId, 409, "preview_pending", "Preview is still building for this thread.");
        }
        return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
      }
      const inflight = runtime.getInflightPromise(run.runId);
      if (ctx && inflight) {
        ctx.waitUntil(inflight);
      }
      return jsonResponse(run, 200, { "x-request-id": requestId });
    }
  }

  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "runs" && parts[3]) {
    const runId = parts[3];

    if (request.method === "GET" && parts.length === 4) {
      const run = runtime.getRun(runId);
      if (!run) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
      return jsonResponse(run, 200, { "x-request-id": requestId });
    }

    if (request.method === "GET" && parts[4] === "debug" && parts.length === 5) {
      const debug = runtime.getRunDebug(runId);
      if (!debug) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
      return jsonResponse(debug, 200, { "x-request-id": requestId });
    }

    if (request.method === "GET" && parts[4] === "debug" && parts[5] === "diagnostics") {
      const diagnostics = runtime.getRunDiagnostics(runId);
      if (!diagnostics) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
      return jsonResponse(diagnostics, 200, { "x-request-id": requestId });
    }

    if (request.method === "GET" && parts[4] === "debug" && parts[5] === "trace") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("page_size") ?? "50");
      const trace = runtime.getRunTrace(runId, page, pageSize);
      if (!trace) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
      return jsonResponse(trace, 200, { "x-request-id": requestId });
    }

    if (request.method === "GET" && parts[4] === "events") {
      return jsonResponse(runtime.getRunEvents(runId), 200, { "x-request-id": requestId });
    }

    if (request.method === "GET" && parts[4] === "results" && parts.length === 5) {
      const includeRejected = url.searchParams.get("include_rejected") === "true";
      const results = runtime.getRunResults(runId, includeRejected);
      if (!results) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
      return jsonResponse(results, 200, { "x-request-id": requestId });
    }

    if (request.method === "GET" && parts[4] === "results" && parts[5]) {
      const rowDetails = runtime.getRowDetails(runId, parts[5]);
      if (!rowDetails) return errorResponse(requestId, 404, "row_not_found", "Row not found.");
      return jsonResponse(rowDetails, 200, { "x-request-id": requestId });
    }

    if (request.method === "POST" && parts[4] === "cancel") {
      const run = runtime.cancelRun(runId);
      if (!run) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
      return jsonResponse(run, 200, { "x-request-id": requestId });
    }

    if (request.method === "GET" && parts[4] === "export") {
      const format = url.searchParams.get("format");
      if (format !== "csv" && format !== "json") {
        return errorResponse(requestId, 400, "invalid_export_format", "Export format must be csv or json.");
      }
      const artifact = runtime.exportRun(runId, format);
      if (!artifact) return errorResponse(requestId, 404, "run_not_found", "Run not found.");
      return textResponse(artifact.content, 200, {
        "content-type": artifact.contentType,
        "content-disposition": `attachment; filename="${artifact.downloadName}"`,
        "x-request-id": requestId,
      });
    }
  }

  if (request.method === "OPTIONS") {
    return emptyResponse(204, {
      allow: "GET,POST,PATCH,OPTIONS",
    });
  }

  return errorResponse(requestId, 404, "route_not_found", "Route not found.");
}

export async function handleApiRequest(
  request: Request,
  env?: WorkerEnv,
  ctx?: WorkerExecutionContext,
): Promise<Response> {
  const requestId = crypto.randomUUID();

  try {
    if (hasDurableInfra(env)) {
      return await handleApiRequestDurable(request, env, ctx, requestId);
    }
    return await handleApiRequestLegacy(request, env, ctx, requestId);
  } catch (error) {
    const message =
      typeof error === "object" && error && "error" in error
        ? JSON.stringify(error)
        : error instanceof Error
          ? error.message
          : "Unexpected error";
    return errorResponse(requestId, 500, "internal_error", message);
  }
}
