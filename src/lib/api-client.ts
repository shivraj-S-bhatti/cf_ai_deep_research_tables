import type {
  CreateRunResponse,
  CreateThreadRequest,
  CreateThreadResponse,
  PreviewRequest,
  PreviewResponse,
  RowDetailsResponse,
  RunDebugSummary,
  RunEventsResponse,
  RunResultsResponse,
  RunTraceResponse,
  ResearchRun,
  ThreadDetailsResponse,
  ThreadsListResponse,
  UpdateThreadConfigRequest,
} from "./contracts";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as {
        error?: {
          message?: string;
        };
      };
      message = payload.error?.message ?? message;
    } catch {
      // Ignore response parsing failures.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function getRunTracePage(
  runId: string,
  page = 1,
  pageSize = 50,
  signal?: AbortSignal,
): Promise<RunTraceResponse> {
  return requestJson(`/api/v1/runs/${runId}/debug/trace?page=${page}&page_size=${pageSize}`, {
    signal,
  });
}

export const apiClient = {
  previewQuery(input: PreviewRequest): Promise<PreviewResponse> {
    return requestJson("/api/v1/query-plans/preview", {
      method: "POST",
      body: JSON.stringify({
        query: input.query,
        targetResults: input.targetResults,
      }),
    });
  },

  listThreads(): Promise<ThreadsListResponse> {
    return requestJson("/api/v1/threads");
  },

  createThread(input: CreateThreadRequest): Promise<CreateThreadResponse> {
    return requestJson("/api/v1/threads", {
      method: "POST",
      body: JSON.stringify({
        query: input.query,
        targetResults: input.targetResults,
        criteria: input.criteria,
        columns: input.columns,
        preview: input.preview,
      }),
    });
  },

  getThread(threadId: string): Promise<ThreadDetailsResponse> {
    return requestJson(`/api/v1/threads/${threadId}`);
  },

  deleteThread(threadId: string): Promise<{ deleted: boolean }> {
    return requestJson(`/api/v1/threads/${threadId}`, { method: "DELETE" });
  },

  updateThreadConfig(
    threadId: string,
    input: UpdateThreadConfigRequest,
  ): Promise<ThreadDetailsResponse> {
    return requestJson(`/api/v1/threads/${threadId}/config`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  createRun(threadId: string): Promise<CreateRunResponse> {
    return requestJson(`/api/v1/threads/${threadId}/runs`, {
      method: "POST",
    });
  },

  getRun(runId: string): Promise<ResearchRun> {
    return requestJson(`/api/v1/runs/${runId}`);
  },

  getRunEvents(runId: string): Promise<RunEventsResponse> {
    return requestJson(`/api/v1/runs/${runId}/events`);
  },

  getRunResults(
    runId: string,
    includeRejected = false,
    signal?: AbortSignal,
  ): Promise<RunResultsResponse> {
    return requestJson(`/api/v1/runs/${runId}/results?include_rejected=${includeRejected}`, {
      signal,
    });
  },

  getRowDetails(runId: string, rowId: string, signal?: AbortSignal): Promise<RowDetailsResponse> {
    return requestJson(`/api/v1/runs/${runId}/results/${rowId}`, { signal });
  },

  getRunDebug(runId: string, signal?: AbortSignal): Promise<RunDebugSummary> {
    return requestJson(`/api/v1/runs/${runId}/debug`, { signal });
  },

  getRunTrace(
    runId: string,
    page = 1,
    pageSize = 50,
    signal?: AbortSignal,
  ): Promise<RunTraceResponse> {
    return getRunTracePage(runId, page, pageSize, signal);
  },

  async getFullRunTrace(
    runId: string,
    signal?: AbortSignal,
    pageSize = 100,
  ): Promise<RunTraceResponse> {
    const firstPage = await getRunTracePage(runId, 1, pageSize, signal);
    if (firstPage.total <= firstPage.events.length) {
      return firstPage;
    }

    const pageCount = Math.ceil(firstPage.total / pageSize);
    const remainingPages = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) => getRunTracePage(runId, index + 2, pageSize, signal)),
    );

    return {
      ...firstPage,
      events: [firstPage.events, ...remainingPages.map((page) => page.events)].flat(),
      page: 1,
      pageSize: Math.max(firstPage.pageSize, firstPage.total),
    };
  },

  cancelRun(runId: string): Promise<ResearchRun> {
    return requestJson(`/api/v1/runs/${runId}/cancel`, {
      method: "POST",
    });
  },

  async exportRun(runId: string, format: "csv" | "json"): Promise<Blob> {
    const response = await fetch(`/api/v1/runs/${runId}/export?format=${format}`);
    if (!response.ok) {
      throw new Error(`Failed to export ${format}.`);
    }
    return response.blob();
  },
};
