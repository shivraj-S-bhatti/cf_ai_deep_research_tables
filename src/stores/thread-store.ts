import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type {
  ColumnSpec,
  Criterion,
  PreviewResponse,
  RowDetailsResponse,
  RunResultsResponse,
  ThreadDetailsResponse,
} from "@/lib/contracts";
import {
  type Enrichment,
  type SearchCell,
  type SearchResult,
  type Thread,
} from "@/lib/types";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function buildRowCells(rowId: string, results: RunResultsResponse): Record<string, SearchCell> {
  return Object.fromEntries(
    results.columns.map((column) => {
      const cell = results.cells.find((entry) => entry.rowId === rowId && entry.columnKey === column.key) ?? {
        id: `${rowId}:${column.key}`,
        rowId,
        columnKey: column.key,
        valueText: null,
        valueJson: null,
        state: "pending",
        confidence: 0,
        reasonCode: null,
        primaryEvidenceId: null,
      };

      return [
        column.key,
        {
          ...cell,
          label: column.label,
          sources: [],
        } satisfies SearchCell,
      ];
    }),
  );
}

function composeResultSummary(rowId: string, results: RunResultsResponse): SearchResult | null {
  const row = results.rows.find((entry) => entry.id === rowId);
  if (!row) return null;
  return {
    ...row,
    name: row.canonicalName,
    url: row.canonicalUrl.replace(/^https?:\/\//, ""),
    evaluations: [],
    cells: buildRowCells(row.id, results),
    sourcesVisited: [],
    matchScore: Math.round(row.score * 100),
  };
}

function composeThread(snapshot: ThreadDetailsResponse, results: SearchResult[]): Thread {
  return {
    id: snapshot.thread.id,
    query: snapshot.thread.queryRaw,
    phase: snapshot.thread.phase,
    entityType: snapshot.thread.entityType,
    criteria: snapshot.criteria,
    columns: snapshot.columns,
    results,
    targetResults: snapshot.thread.targetResults,
    createdAt: snapshot.thread.createdAt,
    updatedAt: snapshot.thread.updatedAt,
    latestRunId: snapshot.thread.latestRunId,
    latestRun: snapshot.latestRun,
    metrics: snapshot.latestRun?.metrics ?? null,
    statusSummary: snapshot.thread.statusSummary,
  };
}

function summaryThread(snapshot: ThreadDetailsResponse): Thread {
  return composeThread(snapshot, []);
}

function pollDelayMs(thread: Thread | null): number {
  if (!thread?.latestRun) return 2000;
  const elapsed = thread.latestRun.metrics.elapsedMs ?? 0;
  if (elapsed > 30000) return 5000;
  if (elapsed > 15000) return 3500;
  return 2000;
}

function clampTargetResults(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(25, Math.round(value)));
}

export function useThreadStore() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [creatingPreviewThread, setCreatingPreviewThread] = useState(false);
  const [refreshingPreviewThreadId, setRefreshingPreviewThreadId] = useState<string | null>(null);
  const [startingRunThreadId, setStartingRunThreadId] = useState<string | null>(null);
  const threadsRef = useRef<Thread[]>(threads);
  const activeThreadIdRef = useRef<string | null>(null);
  const hydrateAbortRef = useRef<AbortController | null>(null);
  const hydrateTargetRef = useRef<string | null>(null);
  const listReloadSeqRef = useRef(0);

  useLayoutEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useLayoutEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const upsertThread = useCallback((thread: Thread) => {
    setThreads((previous) => {
      const next = previous.filter((entry) => entry.id !== thread.id);
      return [thread, ...next].sort((left, right) => right.updatedAt - left.updatedAt);
    });
  }, []);

  const hydrateThread = useCallback(
    async (threadId: string): Promise<Thread | null> => {
      if (hydrateTargetRef.current === threadId && hydrateAbortRef.current) {
        return null;
      }

      hydrateAbortRef.current?.abort();
      const controller = new AbortController();
      hydrateAbortRef.current = controller;
      hydrateTargetRef.current = threadId;

      try {
        const snapshot = await apiClient.getThread(threadId);
        if (!snapshot.latestRun) {
          const thread = summaryThread(snapshot);
          upsertThread(thread);
          return thread;
        }

        const results = await apiClient.getRunResults(snapshot.latestRun.id, true, controller.signal);
        const rows = results.rows
          .map((row) => composeResultSummary(row.id, results))
          .filter((row): row is SearchResult => Boolean(row));
        const thread = composeThread(
          {
            ...snapshot,
            latestRun: results.run,
          },
          rows,
        );
        upsertThread(thread);
        return thread;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return null;
        }
        throw error;
      } finally {
        if (hydrateTargetRef.current === threadId) {
          hydrateTargetRef.current = null;
        }
      }
    },
    [upsertThread],
  );

  const reloadThreadSummaries = useCallback(async () => {
    const seq = ++listReloadSeqRef.current;
    try {
      const list = await apiClient.listThreads();
      if (seq !== listReloadSeqRef.current) return;
      setThreads((previous) => {
        const previousById = new Map(previous.map((thread) => [thread.id, thread]));
        const merged = list.threads.map((snapshot) =>
          previousById.get(snapshot.thread.id) ?? summaryThread(snapshot),
        );
        const currentActiveId = activeThreadIdRef.current;
        if (currentActiveId && !merged.some((t) => t.id === currentActiveId)) {
          const kept = previous.find((t) => t.id === currentActiveId);
          if (kept) {
            merged.push(kept);
            merged.sort((a, b) => b.updatedAt - a.updatedAt);
          }
        }
        return merged;
      });
      if (!activeThreadIdRef.current && list.threads[0]) {
        setActiveThreadId(list.threads[0].thread.id);
      }
    } finally {
      if (seq === listReloadSeqRef.current) {
        setThreadsLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    void reloadThreadSummaries().catch(() => undefined);
  }, [reloadThreadSummaries]);

  useEffect(() => {
    if (!activeThreadId) return;
    if (!threads.some((t) => t.id === activeThreadId)) {
      setActiveThreadId(threads[0]?.id ?? null);
    }
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) return;
    void hydrateThread(activeThreadId);
  }, [activeThreadId, hydrateThread]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  useEffect(() => {
    if (!activeThread?.latestRun || !["queued", "running"].includes(activeThread.latestRun.status)) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void hydrateThread(activeThread.id);
    }, pollDelayMs(activeThread));
    return () => window.clearTimeout(timeout);
  }, [activeThread, hydrateThread]);

  const createThread = useCallback(
    async (query: string) => {
      setCreatingPreviewThread(true);
      try {
        let preview: PreviewResponse;
        try {
          preview = await apiClient.previewQuery({
            query,
            targetResults: 10,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "planner failed";
          throw new Error(`Could not generate criteria from planner: ${message}`);
        }
        const response = await apiClient.createThread({
          query,
          targetResults: 10,
          criteria: preview.criteria,
          columns: preview.columns,
          preview,
        });
        const thread = await hydrateThread(response.threadId);
        setActiveThreadId(response.threadId);
        return thread;
      } finally {
        setCreatingPreviewThread(false);
      }
    },
    [hydrateThread],
  );

  const refreshQueryPlan = useCallback(
    async (threadId: string, query: string) => {
      setRefreshingPreviewThreadId(threadId);
      try {
        const thread = threads.find((entry) => entry.id === threadId);
        const targetResults = clampTargetResults(thread?.targetResults ?? 10);
        let preview: PreviewResponse;
        try {
          preview = await apiClient.previewQuery({
            query,
            targetResults,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "planner failed";
          throw new Error(`Could not refresh criteria from planner: ${message}`);
        }
        await apiClient.updateThreadConfig(threadId, {
          query,
          targetResults,
          criteria: preview.criteria,
          columns: preview.columns,
          preview,
        });
        return hydrateThread(threadId);
      } finally {
        setRefreshingPreviewThreadId((current) => (current === threadId ? null : current));
      }
    },
    [hydrateThread, threads],
  );

  const replaceCriteria = useCallback(
    async (threadId: string, criteria: Criterion[]) => {
      await apiClient.updateThreadConfig(threadId, { criteria });
      return hydrateThread(threadId);
    },
    [hydrateThread],
  );

  const replaceColumns = useCallback(
    async (threadId: string, columns: ColumnSpec[]) => {
      await apiClient.updateThreadConfig(threadId, { columns });
      return hydrateThread(threadId);
    },
    [hydrateThread],
  );

  const updateTarget = useCallback(
    async (threadId: string, targetResults: number) => {
      await apiClient.updateThreadConfig(threadId, { targetResults: clampTargetResults(targetResults) });
      return hydrateThread(threadId);
    },
    [hydrateThread],
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      await apiClient.cancelRun(runId);
    },
    [],
  );

  const deleteThread = useCallback(async (threadId: string) => {
    await apiClient.deleteThread(threadId);
    const next = threadsRef.current.filter((t) => t.id !== threadId);
    setThreads(next);
    setActiveThreadId((cur) => (cur === threadId ? next[0]?.id ?? null : cur));
  }, []);

  const startRun = useCallback(
    async (threadId: string) => {
      setStartingRunThreadId(threadId);
      try {
        await apiClient.createRun(threadId);
        return hydrateThread(threadId);
      } finally {
        setStartingRunThreadId((current) => (current === threadId ? null : current));
      }
    },
    [hydrateThread],
  );

  const addCriterion = useCallback(
    async (threadId: string, criterion: Criterion) => {
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return null;
      return replaceCriteria(threadId, [
        ...thread.criteria,
        {
          ...criterion,
          id: criterion.id || `${threadId}:criterion:${Date.now()}`,
          kind: criterion.kind ?? "hard_filter",
          orderIndex: thread.criteria.length,
        },
      ]);
    },
    [replaceCriteria, threads],
  );

  const removeCriterion = useCallback(
    async (threadId: string, criterionId: string) => {
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return null;
      return replaceCriteria(
        threadId,
        thread.criteria.filter((criterion) => criterion.id !== criterionId),
      );
    },
    [replaceCriteria, threads],
  );

  const addEnrichment = useCallback(
    async (threadId: string, enrichment: Enrichment) => {
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return null;
      const key = enrichment.key || slugify(enrichment.label || "column");
      return replaceColumns(threadId, [
        ...thread.columns,
        {
          id: enrichment.id || `${threadId}:column:${key}`,
          threadId,
          key,
          label: enrichment.label,
          kind: "enrichment",
          valueType: enrichment.valueType ?? "string",
          preferredSources: enrichment.preferredSources ?? ["official"],
          requiresVerification: enrichment.requiresVerification ?? true,
          allowInference: enrichment.allowInference ?? false,
          nullPolicy: enrichment.nullPolicy ?? "dash",
          orderIndex: thread.columns.length,
        },
      ]);
    },
    [replaceColumns, threads],
  );

  const removeEnrichment = useCallback(
    async (threadId: string, enrichmentId: string) => {
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return null;
      return replaceColumns(
        threadId,
        thread.columns.filter((column) => column.id !== enrichmentId),
      );
    },
    [replaceColumns, threads],
  );

  const fetchRowDetails = useCallback(
    async (runId: string, rowId: string, signal?: AbortSignal): Promise<RowDetailsResponse> => {
      return apiClient.getRowDetails(runId, rowId, signal);
    },
    [],
  );

  const activeRun = useMemo(() => {
    for (const thread of threads) {
      if (
        thread.latestRun &&
        (thread.latestRun.status === "running" || thread.latestRun.status === "queued")
      ) {
        return { threadId: thread.id, runId: thread.latestRun.id, query: thread.query };
      }
    }
    return null;
  }, [threads]);

  return {
    threads,
    threadsLoaded,
    creatingPreviewThread,
    refreshingPreviewThreadId,
    startingRunThreadId,
    activeThread,
    activeThreadId,
    activeRun,
    setActiveThreadId,
    createThread,
    hydrateThread,
    fetchRowDetails,
    refreshQueryPlan,
    replaceCriteria,
    replaceColumns,
    updateTarget,
    startRun,
    cancelRun,
    deleteThread,
    addCriterion,
    removeCriterion,
    addEnrichment,
    removeEnrichment,
  };
}
