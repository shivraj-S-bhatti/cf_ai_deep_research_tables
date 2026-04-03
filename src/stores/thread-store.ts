import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type {
  ColumnSpec,
  Criterion,
  RowDetailsResponse,
  RunResultsResponse,
  ThreadDetailsResponse,
} from "@/lib/contracts";
import {
  mapActivityEventToAgentStep,
  sourceFromDocument,
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

function buildSourceLookups(detail: RowDetailsResponse) {
  const sourcesById = new Map(detail.sources.map((source) => [source.id, sourceFromDocument(source)]));
  const evidenceById = new Map(detail.evidence.map((evidence) => [evidence.id, evidence]));
  return { sourcesById, evidenceById };
}

function sourcesForEvidence(detail: RowDetailsResponse, evidenceId: string | null) {
  if (!evidenceId) return [];
  const { sourcesById, evidenceById } = buildSourceLookups(detail);
  const evidence = evidenceById.get(evidenceId);
  if (!evidence) return [];
  const source = sourcesById.get(evidence.sourceDocumentId);
  return source ? [source] : [];
}

function composeResult(
  rowDetail: RowDetailsResponse,
  results: RunResultsResponse,
): SearchResult {
  const cells = Object.fromEntries(
    results.columns.map((column) => {
      const cell = rowDetail.cells.find((entry) => entry.columnKey === column.key) ?? {
        id: `${rowDetail.row.id}:${column.key}`,
        rowId: rowDetail.row.id,
        columnKey: column.key,
        valueText: null,
        valueJson: null,
        state: "pending",
        confidence: 0,
        reasonCode: null,
        primaryEvidenceId: null,
      };
      const mapped: SearchCell = {
        ...cell,
        label: column.label,
        sources: sourcesForEvidence(rowDetail, cell.primaryEvidenceId),
      };
      return [column.key, mapped];
    }),
  );

  return {
    ...rowDetail.row,
    name: rowDetail.row.canonicalName,
    url: rowDetail.row.canonicalUrl.replace(/^https?:\/\//, ""),
    evaluations: rowDetail.evaluations.map((evaluation) => ({
      criterionId: evaluation.criterionId,
      rule:
        rowDetail.criteria.find((criterion) => criterion.id === evaluation.criterionId)?.label ??
        "Criterion",
      verdict: evaluation.verdict,
      summary: evaluation.summary,
      confidence: evaluation.confidence,
      primaryEvidenceId: evaluation.primaryEvidenceId,
      sources: sourcesForEvidence(rowDetail, evaluation.primaryEvidenceId),
    })),
    cells,
    sourcesVisited: rowDetail.sources.map((source) => sourceFromDocument(source)),
    matchScore: Math.round(rowDetail.row.score * 100),
  };
}

function composeThread(
  snapshot: ThreadDetailsResponse,
  results: SearchResult[],
  steps: Thread["agentSteps"],
): Thread {
  return {
    id: snapshot.thread.id,
    query: snapshot.thread.queryRaw,
    phase: snapshot.thread.phase,
    entityType: snapshot.thread.entityType,
    criteria: snapshot.criteria,
    columns: snapshot.columns,
    results,
    agentSteps: steps,
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
  return composeThread(snapshot, [], []);
}

export function useThreadStore() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const upsertThread = useCallback((thread: Thread) => {
    setThreads((previous) => {
      const next = previous.filter((entry) => entry.id !== thread.id);
      return [thread, ...next].sort((left, right) => right.updatedAt - left.updatedAt);
    });
  }, []);

  const hydrateThread = useCallback(
    async (threadId: string): Promise<Thread | null> => {
      const snapshot = await apiClient.getThread(threadId);
      if (!snapshot.latestRun) {
        const thread = summaryThread(snapshot);
        upsertThread(thread);
        return thread;
      }

      const results = await apiClient.getRunResults(snapshot.latestRun.id, true);
      const rowDetails = await Promise.all(
        results.rows.map((row) => apiClient.getRowDetails(results.run.id, row.id)),
      );
      const events = await apiClient.getRunEvents(results.run.id);
      const thread = composeThread(
        {
          ...snapshot,
          latestRun: results.run,
        },
        rowDetails.map((detail) => composeResult(detail, results)),
        events.events.map(mapActivityEventToAgentStep),
      );
      upsertThread(thread);
      return thread;
    },
    [upsertThread],
  );

  const reloadThreadSummaries = useCallback(async () => {
    const list = await apiClient.listThreads();
    setThreads((previous) => {
      const previousById = new Map(previous.map((thread) => [thread.id, thread]));
      return list.threads.map((snapshot) => previousById.get(snapshot.thread.id) ?? summaryThread(snapshot));
    });
    if (!activeThreadId && list.threads[0]) {
      setActiveThreadId(list.threads[0].thread.id);
    }
  }, [activeThreadId]);

  useEffect(() => {
    void reloadThreadSummaries();
  }, [reloadThreadSummaries]);

  useEffect(() => {
    if (!activeThreadId) return;
    void hydrateThread(activeThreadId);
  }, [activeThreadId, hydrateThread]);

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;

  useEffect(() => {
    if (!activeThread?.latestRun || !["queued", "running"].includes(activeThread.latestRun.status)) {
      return;
    }
    const interval = window.setInterval(() => {
      void hydrateThread(activeThread.id);
    }, 700);
    return () => window.clearInterval(interval);
  }, [activeThread, hydrateThread]);

  const createThread = useCallback(
    async (query: string) => {
      const preview = await apiClient.previewQuery({
        query,
        targetResults: 25,
      });
      const response = await apiClient.createThread({
        query,
        targetResults: 25,
        criteria: preview.criteria,
        columns: preview.columns,
        preview,
      });
      setActiveThreadId(response.threadId);
      return hydrateThread(response.threadId);
    },
    [hydrateThread],
  );

  const refreshQueryPlan = useCallback(
    async (threadId: string, query: string) => {
      const thread = threads.find((entry) => entry.id === threadId);
      const targetResults = thread?.targetResults ?? 25;
      const preview = await apiClient.previewQuery({
        query,
        targetResults,
      });
      await apiClient.updateThreadConfig(threadId, {
        query,
        targetResults,
        criteria: preview.criteria,
        columns: preview.columns,
        preview,
      });
      return hydrateThread(threadId);
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
      await apiClient.updateThreadConfig(threadId, { targetResults });
      return hydrateThread(threadId);
    },
    [hydrateThread],
  );

  const startRun = useCallback(
    async (threadId: string) => {
      await apiClient.createRun(threadId);
      return hydrateThread(threadId);
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

  return {
    threads,
    activeThread,
    activeThreadId,
    setActiveThreadId,
    createThread,
    hydrateThread,
    refreshQueryPlan,
    replaceCriteria,
    replaceColumns,
    updateTarget,
    startRun,
    addCriterion,
    removeCriterion,
    addEnrichment,
    removeEnrichment,
  };
}
