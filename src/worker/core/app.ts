import type {
  CreateThreadRequest,
  PreviewRequest,
  UpdateThreadConfigRequest,
} from "../../lib/contracts";
import type { WorkerEnv, WorkerExecutionContext } from "../index";
import { getRuntime } from "./runtime";
import { emptyResponse, errorResponse, jsonResponse, readJson, textResponse } from "../utils/http";

function getPathname(request: Request): string {
  return new URL(request.url).pathname;
}

function getPathParts(request: Request): string[] {
  return getPathname(request).split("/").filter(Boolean);
}

export async function handleApiRequest(
  request: Request,
  env?: WorkerEnv,
  ctx?: WorkerExecutionContext,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const runtime = getRuntime(env);
  const url = new URL(request.url);
  const parts = getPathParts(request);

  try {
    if (request.method === "GET" && getPathname(request) === "/api/v1/health") {
      return jsonResponse({ ok: true, requestId, now: Date.now() });
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
        if (!run) return errorResponse(requestId, 404, "thread_not_found", "Thread not found.");
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return errorResponse(requestId, 500, "internal_error", message);
  }
}
