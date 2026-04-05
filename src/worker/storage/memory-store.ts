import type {
  ActivityEvent,
  ActivityStage,
  ColumnSpec,
  Criterion,
  CriterionEvaluation,
  ExportArtifact,
  QueryPlan,
  ResearchRun,
  ResearchThread,
  ResultCell,
  ResultRow,
  RowDetailsResponse,
  RunDebugSummary,
  RunMetrics,
  RunProgress,
  RunResultsResponse,
  RunTraceResponse,
  ThreadSnapshot,
  UsageRecord,
  UsageSummary,
  SourceDocument,
  Evidence,
} from "../../lib/contracts";
import { isRowInFlight, summarizeProductCounts } from "../../lib/runtime-policy";

const CHECKPOINTS = [
  "plan persisted",
  "candidate rows created",
  "sources fetched",
  "cells extracted",
  "criteria evaluated",
  "final ranking committed",
] as const;

type RunRecord = {
  run: ResearchRun;
  rows: Map<string, ResultRow>;
  cellsByRow: Map<string, Map<string, ResultCell>>;
  evaluationsByRow: Map<string, CriterionEvaluation[]>;
  sources: Map<string, SourceDocument>;
  evidence: Map<string, Evidence>;
  events: ActivityEvent[];
  usage: UsageRecord[];
  exports: Map<string, ExportArtifact>;
  rowSourceIds: Map<string, Set<string>>;
  rowEvidenceIds: Map<string, Set<string>>;
};

type ThreadRecord = {
  thread: ResearchThread;
  plan: QueryPlan;
  criteria: Criterion[];
  columns: ColumnSpec[];
};

function emptyProgress(totalQueries = 0): RunProgress {
  return {
    queriesCompleted: 0,
    sourcesFetched: 0,
    rowsCreated: 0,
    cellsResolved: 0,
    totalQueries,
    totalRows: 0,
  };
}

function emptyMetrics(): RunMetrics {
  return {
    searchCalls: 0,
    fetchCalls: 0,
    llmCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    estimatedCostUsd: 0,
    budgetConsumedUsd: 0,
    elapsedMs: 0,
    stageDurationsMs: {},
    providerBreakdown: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryResearchStore {
  private readonly threads = new Map<string, ThreadRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly threadOrder: string[] = [];

  listThreadSnapshots(): ThreadSnapshot[] {
    return this.threadOrder
      .map((threadId) => this.getThreadSnapshot(threadId))
      .filter((value): value is ThreadSnapshot => value !== null);
  }

  getThreadSnapshot(threadId: string): ThreadSnapshot | null {
    const record = this.threads.get(threadId);
    if (!record) return null;
    return {
      thread: clone(record.thread),
      plan: clone(record.plan),
      latestRun: record.thread.latestRunId
        ? clone(this.runs.get(record.thread.latestRunId)?.run ?? null)
        : null,
      criteria: clone(record.criteria),
      columns: clone(record.columns),
    };
  }

  getThreadRecord(threadId: string): ThreadRecord | null {
    const record = this.threads.get(threadId);
    return record ? clone(record) : null;
  }

  /** Drop oldest threads (and their latest run record) when over limit. Does not clear preview/search caches. */
  pruneOldestThreadsIfOver(maxThreads: number): void {
    if (maxThreads <= 0) return;
    while (this.threadOrder.length > maxThreads) {
      const removeId = this.threadOrder.pop();
      if (!removeId) break;
      const record = this.threads.get(removeId);
      if (record?.thread.latestRunId) {
        this.runs.delete(record.thread.latestRunId);
      }
      this.threads.delete(removeId);
    }
  }

  createThread(record: ThreadRecord): ThreadSnapshot {
    this.threads.set(record.thread.id, clone(record));
    this.threadOrder.unshift(record.thread.id);
    return this.getThreadSnapshot(record.thread.id)!;
  }

  /** Removes the thread and its latest run record (if any). */
  deleteThread(threadId: string): boolean {
    const record = this.threads.get(threadId);
    if (!record) return false;
    if (record.thread.latestRunId) {
      this.runs.delete(record.thread.latestRunId);
    }
    this.threads.delete(threadId);
    const idx = this.threadOrder.indexOf(threadId);
    if (idx >= 0) {
      this.threadOrder.splice(idx, 1);
    }
    return true;
  }

  updateThread(
    threadId: string,
    next: Partial<ThreadRecord>,
  ): ThreadSnapshot | null {
    const current = this.threads.get(threadId);
    if (!current) return null;
    this.threads.set(threadId, {
      thread: next.thread ? clone(next.thread) : current.thread,
      plan: next.plan ? clone(next.plan) : current.plan,
      criteria: next.criteria ? clone(next.criteria) : current.criteria,
      columns: next.columns ? clone(next.columns) : current.columns,
    });
    return this.getThreadSnapshot(threadId);
  }

  createRun(run: ResearchRun): ResearchRun {
    this.runs.set(run.id, {
      run: clone(run),
      rows: new Map(),
      cellsByRow: new Map(),
      evaluationsByRow: new Map(),
      sources: new Map(),
      evidence: new Map(),
      events: [],
      usage: [],
      exports: new Map(),
      rowSourceIds: new Map(),
      rowEvidenceIds: new Map(),
    });

    const thread = this.threads.get(run.threadId);
    if (thread) {
      thread.thread.latestRunId = run.id;
      thread.thread.phase = "queued";
      thread.thread.updatedAt = Date.now();
      thread.thread.statusSummary = "Queued for execution.";
    }

    return clone(run);
  }

  getRun(runId: string): ResearchRun | null {
    return clone(this.runs.get(runId)?.run ?? null);
  }

  updateRun(runId: string, updater: (run: ResearchRun) => ResearchRun): ResearchRun | null {
    const record = this.runs.get(runId);
    if (!record) return null;
    record.run = clone(updater(clone(record.run)));
    this.syncThreadFromRun(record.run);
    return clone(record.run);
  }

  setRunStageDuration(runId: string, stage: ActivityStage, durationMs: number): void {
    this.updateRun(runId, (run) => ({
      ...run,
      metrics: {
        ...run.metrics,
        stageDurationsMs: {
          ...run.metrics.stageDurationsMs,
          [stage]: durationMs,
        },
      },
    }));
  }

  addActivity(runId: string, event: ActivityEvent): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.events.push(clone(event));
  }

  listEvents(runId: string): ActivityEvent[] {
    const record = this.runs.get(runId);
    if (!record) return [];
    return clone(record.events).sort((a, b) => a.createdAt - b.createdAt);
  }

  getDebugSummary(runId: string): RunDebugSummary | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const events = this.listEvents(runId);
    const reached = new Set(
      events
        .map((event) => event.payloadJson.checkpoint)
        .filter((value): value is string => typeof value === "string"),
    );
    const stageCounts = events.reduce<RunDebugSummary["traceSummary"]["stageCounts"]>((counts, event) => {
      counts[event.stage] = (counts[event.stage] ?? 0) + 1;
      return counts;
    }, {});

    return {
      run,
      checkpoints: CHECKPOINTS.map((label) => ({
        label,
        reached: reached.has(label),
      })),
      providerBreakdown: clone(run.metrics.providerBreakdown),
      traceSummary: {
        totalEvents: events.length,
        stageCounts,
      },
      recentEvents: events.slice(-10),
    };
  }

  getTrace(runId: string, page = 1, pageSize = 50): RunTraceResponse | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const events = this.listEvents(runId);
    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, Math.min(200, pageSize));
    const startIndex = (safePage - 1) * safePageSize;
    return {
      runId,
      page: safePage,
      pageSize: safePageSize,
      total: events.length,
      events: events.slice(startIndex, startIndex + safePageSize),
    };
  }

  addUsage(runId: string, usage: UsageRecord): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.usage.push(clone(usage));

    const providerBreakdown = new Map<string, UsageSummary>();
    let searchCalls = 0;
    let fetchCalls = 0;
    let llmCalls = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    let estimatedCostUsd = 0;

    for (const entry of record.usage) {
      const key = `${entry.providerName}:${entry.operation}`;
      const summary = providerBreakdown.get(key) ?? {
        providerName: entry.providerName,
        operation: entry.operation,
        requestCount: 0,
        tokenIn: 0,
        tokenOut: 0,
        estimatedCostUsd: 0,
        cacheHits: 0,
      };
      summary.requestCount += entry.requestCount;
      summary.tokenIn += entry.tokenIn;
      summary.tokenOut += entry.tokenOut;
      summary.estimatedCostUsd = Number(
        (summary.estimatedCostUsd + entry.estimatedCostUsd).toFixed(6),
      );
      if (entry.cacheHit) summary.cacheHits += 1;
      providerBreakdown.set(key, summary);

      if (entry.providerKind === "search") searchCalls += entry.requestCount;
      if (entry.providerKind === "fetch") fetchCalls += entry.requestCount;
      if (entry.providerKind === "llm") llmCalls += entry.requestCount;
      if (entry.providerKind === "cache") {
        if (entry.cacheHit) cacheHits += entry.requestCount;
        else cacheMisses += entry.requestCount;
      }
      estimatedCostUsd = Number((estimatedCostUsd + entry.estimatedCostUsd).toFixed(6));
    }

    this.updateRun(runId, (run) => ({
      ...run,
      metrics: {
        ...run.metrics,
        searchCalls,
        fetchCalls,
        llmCalls,
        cacheHits,
        cacheMisses,
        estimatedCostUsd,
        budgetConsumedUsd: estimatedCostUsd,
        providerBreakdown: [...providerBreakdown.values()],
      },
    }));
  }

  upsertRow(runId: string, row: ResultRow): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.rows.set(row.id, clone(row));
    this.updateRun(runId, (run) => ({
      ...run,
      progress: {
        ...run.progress,
        rowsCreated: record.rows.size,
        totalRows: Math.max(run.progress.totalRows, record.rows.size),
      },
    }));
    this.syncThreadFromRun(record.run);
  }

  getRow(runId: string, rowId: string): ResultRow | null {
    return clone(this.runs.get(runId)?.rows.get(rowId) ?? null);
  }

  listRows(runId: string): ResultRow[] {
    const record = this.runs.get(runId);
    if (!record) return [];
    return [...record.rows.values()]
      .map((row) => clone(row))
      .sort((a, b) => {
        const rankA = a.rank ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.rank ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return b.score - a.score;
      });
  }

  upsertCell(runId: string, cell: ResultCell): void {
    const record = this.runs.get(runId);
    if (!record) return;
    const cells = record.cellsByRow.get(cell.rowId) ?? new Map<string, ResultCell>();
    cells.set(cell.columnKey, clone(cell));
    record.cellsByRow.set(cell.rowId, cells);

    const resolvedCount = [...record.cellsByRow.values()].reduce((count, rowCells) => {
      return count + [...rowCells.values()].filter((entry) => entry.state !== "pending").length;
    }, 0);

    this.updateRun(runId, (run) => ({
      ...run,
      progress: {
        ...run.progress,
        cellsResolved: resolvedCount,
      },
    }));

    if (cell.primaryEvidenceId) {
      const evidenceIds = record.rowEvidenceIds.get(cell.rowId) ?? new Set<string>();
      evidenceIds.add(cell.primaryEvidenceId);
      record.rowEvidenceIds.set(cell.rowId, evidenceIds);
    }
  }

  listCells(runId: string): ResultCell[] {
    const record = this.runs.get(runId);
    if (!record) return [];
    return [...record.cellsByRow.values()].flatMap((rowCells) =>
      [...rowCells.values()].map((cell) => clone(cell)),
    );
  }

  addEvaluation(runId: string, evaluation: CriterionEvaluation): void {
    const record = this.runs.get(runId);
    if (!record) return;
    const evaluations = record.evaluationsByRow.get(evaluation.rowId) ?? [];
    const next = evaluations.filter((entry) => entry.id !== evaluation.id);
    next.push(clone(evaluation));
    record.evaluationsByRow.set(evaluation.rowId, next);
    if (evaluation.primaryEvidenceId) {
      const evidenceIds = record.rowEvidenceIds.get(evaluation.rowId) ?? new Set<string>();
      evidenceIds.add(evaluation.primaryEvidenceId);
      record.rowEvidenceIds.set(evaluation.rowId, evidenceIds);
    }
  }

  addSource(runId: string, rowId: string, source: SourceDocument): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.sources.set(source.id, clone(source));
    const sourceIds = record.rowSourceIds.get(rowId) ?? new Set<string>();
    sourceIds.add(source.id);
    record.rowSourceIds.set(rowId, sourceIds);
    this.updateRun(runId, (run) => ({
      ...run,
      progress: {
        ...run.progress,
        sourcesFetched: record.sources.size,
      },
    }));
  }

  getSource(runId: string, sourceId: string): SourceDocument | null {
    return clone(this.runs.get(runId)?.sources.get(sourceId) ?? null);
  }

  addEvidence(runId: string, rowId: string, evidence: Evidence): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.evidence.set(evidence.id, clone(evidence));
    const evidenceIds = record.rowEvidenceIds.get(rowId) ?? new Set<string>();
    evidenceIds.add(evidence.id);
    record.rowEvidenceIds.set(rowId, evidenceIds);
  }

  addExport(runId: string, artifact: ExportArtifact): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.exports.set(artifact.format, clone(artifact));
  }

  getExport(runId: string, format: "csv" | "json"): ExportArtifact | null {
    const record = this.runs.get(runId);
    if (!record) return null;
    return clone(record.exports.get(format) ?? null);
  }

  listResults(runId: string, includeRejected = false): RunResultsResponse | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const thread = this.getThreadByRun(runId);
    if (!thread) return null;
    const rows = this.listRows(runId).filter(
      (row) => row.duplicateOfRowId === null
        && (includeRejected
          || isRowInFlight(row)
          || row.status !== "rejected"),
    );
    const rowIds = new Set(rows.map((row) => row.id));
    const cells = this.listCells(runId).filter((cell) => rowIds.has(cell.rowId));

    return {
      run,
      thread: clone(thread.thread),
      criteria: clone(thread.criteria),
      columns: clone(thread.columns),
      rows,
      cells,
    };
  }

  getRowDetails(runId: string, rowId: string): RowDetailsResponse | null {
    const thread = this.getThreadByRun(runId);
    const run = this.runs.get(runId);
    const row = this.getRow(runId, rowId);
    if (!thread || !run || !row) return null;

    const cells = [...(run.cellsByRow.get(rowId)?.values() ?? [])].map((cell) => clone(cell));
    const evaluations = clone(run.evaluationsByRow.get(rowId) ?? []);
    const sourceIds = [...(run.rowSourceIds.get(rowId) ?? new Set<string>())];
    const evidenceIds = [...(run.rowEvidenceIds.get(rowId) ?? new Set<string>())];

    return {
      row,
      cells,
      criteria: clone(thread.criteria),
      evaluations,
      sources: sourceIds
        .map((sourceId) => run.sources.get(sourceId))
        .filter((source): source is SourceDocument => Boolean(source))
        .map((source) => clone(source)),
      evidence: evidenceIds
        .map((evidenceId) => run.evidence.get(evidenceId))
        .filter((evidence): evidence is Evidence => Boolean(evidence))
        .map((evidence) => clone(evidence)),
    };
  }

  cancelRun(runId: string): ResearchRun | null {
    return this.updateRun(runId, (run) => ({
      ...run,
      status: "canceled",
      finishedAt: Date.now(),
    }));
  }

  hasFinished(runId: string): boolean {
    const run = this.runs.get(runId)?.run;
    return !run || ["complete", "failed", "canceled"].includes(run.status);
  }

  private getThreadByRun(runId: string): ThreadRecord | null {
    const run = this.runs.get(runId)?.run;
    if (!run) return null;
    return this.threads.get(run.threadId) ?? null;
  }

  private syncThreadFromRun(run: ResearchRun): void {
    const thread = this.threads.get(run.threadId);
    if (!thread) return;
    thread.thread.latestRunId = run.id;
    thread.thread.updatedAt = Date.now();
    if (run.status === "queued") {
      thread.thread.phase = "queued";
      thread.thread.statusSummary = "Queued for execution.";
      return;
    }
    if (run.status === "running") {
      thread.thread.phase = "running";
      const rows = [...(this.runs.get(run.id)?.rows.values() ?? [])].filter((row) => row.duplicateOfRowId === null);
      const summary = summarizeProductCounts(rows);
      thread.thread.statusSummary = `${summary.accepted} accepted · ${summary.inFlightCount} in-flight`;
      return;
    }
    if (run.status === "complete") {
      const rows = [...(this.runs.get(run.id)?.rows.values() ?? [])].filter((row) => row.duplicateOfRowId === null);
      const summary = summarizeProductCounts(rows);
      const unresolved = summary.uncertain + summary.conflict;
      thread.thread.phase = "complete";
      thread.thread.statusSummary = `${summary.accepted} accepted · ${unresolved} unresolved`;
      return;
    }
    if (run.status === "failed") {
      thread.thread.phase = "failed";
      thread.thread.statusSummary = "Run failed.";
      return;
    }
    if (run.status === "canceled") {
      thread.thread.phase = "canceled";
      thread.thread.statusSummary = "Run canceled.";
    }
  }
}

export { emptyMetrics, emptyProgress };
