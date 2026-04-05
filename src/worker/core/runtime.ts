import type {
  ActivityEvent,
  ActivityStage,
  CellState,
  Criterion,
  CriterionEvaluation,
  CreateRunResponse,
  CreateThreadRequest,
  CreateThreadResponse,
  EntityType,
  ExportArtifact,
  PreviewRequest,
  PreviewResponse,
  ResearchRun,
  ResultCell,
  ResultRow,
  RunDiagnosticsResponse,
  RuntimeDiagnosticsResponse,
  SearchQuery,
  SourceDocument,
  Evidence,
  ThreadDetailsResponse,
  ThreadsListResponse,
  UpdateThreadConfigRequest,
  UsageRecord,
} from "../../lib/contracts";
import { describePotentialStall } from "../../lib/run-stage-copy";
import { buildThreadBundle, previewQuery, rebuildThreadBundle } from "../domain/planner";
import { findScenario } from "../fixtures/scenarios";
import {
  allocateExtractionBatch,
  createExtractionBudget,
  hasExtractionBudgetRemaining,
} from "./extraction-budget";
import {
  buildCorroborationQueries,
  collectFollowUpUrls,
  classifyDiscoveryIntent,
  computeFetchBatchSize,
  discoverySearchResultLimit,
  expandDiscoveryQueries,
  extractionTimeoutMsForIntent,
  isCandidateOnlySourceClass,
  isGroundingSourceClass,
  selectDiscoveryBatch,
  shouldStopGreedyRefinement,
  shouldStopExploration,
} from "./live-run-policy";
import {
  hasLivePreviewProvider,
  hasLiveProviders,
  resolveRuntimeConfig,
  shouldUseLiveProviders,
  type RuntimeConfig,
  type RuntimeEnvLike,
} from "./config";
import { searchBraveWeb, type BraveWebResult } from "../providers/brave";
import {
  fetchGitHubRepositoryMetadata,
  parseGitHubRepositoryUrl,
  searchGitHubRepositories,
} from "../providers/github";
import {
  extractDocumentWithGemini,
  planWithGemini,
  isJunkExtraction,
} from "../providers/gemini";
import { planWithGroq } from "../providers/groq";
import { fetchAndParseDocument } from "../providers/fetch";
import { dedupeAndMerge, normalizeName, type ExtractedEntityRow } from "../domain/dedup";
import { estimateOperationCost } from "../providers/price-catalog";
import {
  createAbortError,
  type RequestControl,
} from "../providers/request-control";
import {
  MemoryResearchStore,
  emptyMetrics,
  emptyProgress,
  type MemoryResearchStoreSnapshot,
} from "../storage/memory-store";
import { makeId, sleep } from "../utils/ids";
import {
  classifySourceScopeDecision,
  DEFAULT_ACCEPT_CONFIDENCE_MIN,
  DEFAULT_REJECT_CONFIDENCE_MIN,
  deriveFinalStatus,
} from "../../lib/runtime-policy";

type RuntimeCache = {
  preview: Map<string, PreviewResponse>;
  search: Map<string, unknown>;
  pages: Map<string, SourceDocument>;
};

function now(): number {
  return Date.now();
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

function stageEvent(
  runId: string,
  stage: ActivityStage,
  status: ActivityEvent["status"],
  message: string,
  payloadJson: Record<string, unknown> = {},
): ActivityEvent {
  return {
    id: makeId("evt"),
    runId,
    stage,
    status,
    message,
    payloadJson,
    createdAt: now(),
  };
}

function actorForStage(stage: ActivityStage): string {
  switch (stage) {
    case "planning":
      return "planner";
    case "discovery":
      return "discovery";
    case "fetch":
      return "fetch";
    case "extraction":
      return "extraction";
    case "evaluation":
      return "evaluation";
    case "canonicalization":
      return "canonicalization";
    case "refinement":
      return "supervisor";
    case "verification":
      return "verification";
    case "ranking":
      return "ranking";
    case "export":
      return "export";
  }
}

function titleForStage(stage: ActivityStage): string {
  switch (stage) {
    case "planning":
      return "Planning query";
    case "discovery":
      return "Discovering candidates";
    case "fetch":
      return "Fetching sources";
    case "extraction":
      return "Extracting row cells";
    case "evaluation":
      return "Evaluating criteria";
    case "canonicalization":
      return "Canonicalizing entities";
    case "refinement":
      return "Refining coverage";
    case "verification":
      return "Validating ambiguous rows";
    case "ranking":
      return "Ranking and partitioning rows";
    case "export":
      return "Packaging exports";
  }
}

function checkpointForStage(stage: ActivityStage): string | undefined {
  switch (stage) {
    case "planning":
      return "plan persisted";
    case "discovery":
      return "candidate rows created";
    case "fetch":
      return "sources fetched";
    case "extraction":
      return "cells extracted";
    case "evaluation":
      return "criteria evaluated";
    case "refinement":
      return "supervisor iteration";
    case "ranking":
      return "final ranking committed";
    default:
      return undefined;
  }
}

function usageRecord(
  runId: string,
  providerKind: UsageRecord["providerKind"],
  providerName: UsageRecord["providerName"],
  operation: string,
  requestCount: number,
  latencyMs: number,
  cacheHit = false,
  tokenIn = 0,
  tokenOut = 0,
  metadata: Record<string, unknown> = {},
): UsageRecord {
  return {
    id: makeId("use"),
    runId,
    providerKind,
    providerName,
    operation,
    timestamp: now(),
    latencyMs,
    requestCount,
    tokenIn,
    tokenOut,
    estimatedCostUsd: estimateOperationCost(providerName, operation, requestCount),
    cacheHit,
    metadata,
  };
}

function classifySourceOrigin(url: string, title: string): ResultRow["lineage"]["sourceOriginClass"] {
  const normalized = `${url} ${title}`.toLowerCase();
  if (
    normalized.includes("reddit.com")
    || normalized.includes("quora.com")
    || normalized.includes("stackexchange.com")
    || normalized.includes("news.ycombinator.com")
  ) {
    return "forum";
  }
  if (normalized.includes("ycombinator.com/companies") || normalized.includes("/directory")) {
    return "directory";
  }
  if (normalized.includes("github.com") || normalized.includes("schema.org") || normalized.includes("api")) {
    return "structured";
  }
  if (
    normalized.includes("top ") ||
    normalized.includes("best ") ||
    normalized.includes("list of") ||
    normalized.includes("roundup") ||
    normalized.includes("guide")
  ) {
    return "roundup";
  }
  return normalized.includes("official") ? "official" : "secondary";
}

function emptyLineage(sourceOriginClass: ResultRow["lineage"]["sourceOriginClass"] = "secondary") {
  return {
    suggestedBySourceIds: [] as string[],
    groundedBySourceIds: [] as string[],
    sourceOriginClass,
  };
}

function csvEscape(value: string): string {
  if (/[,"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

type TraceToolCall = {
  name: string;
  summary: string;
  input?: string;
  output?: string;
  latencyMs?: number;
  costUsd?: number;
  cacheHit?: boolean;
};

type RunExecutionControl = {
  requestControl: (timeoutMs?: number) => RequestControl;
  armDeadline: (startedAt: number) => void;
  dispose: () => void;
  failIfWallClockExceeded: () => boolean;
};

export class AgenticSearchRuntime {
  private readonly store: MemoryResearchStore;
  private readonly inflightRuns = new Map<string, Promise<void>>();
  private readonly instanceId: string;
  private config: RuntimeConfig;
  private readonly cache: RuntimeCache = {
    preview: new Map(),
    search: new Map(),
    pages: new Map(),
  };

  constructor(
    env?: RuntimeEnvLike,
    options?: {
      instanceId?: string;
      store?: MemoryResearchStore;
    },
  ) {
    this.store = options?.store ?? new MemoryResearchStore();
    this.instanceId = options?.instanceId ?? crypto.randomUUID();
    this.config = resolveRuntimeConfig(env);
  }

  configure(env?: RuntimeEnvLike): void {
    this.config = resolveRuntimeConfig(env);
  }

  listThreads(): ThreadsListResponse {
    return { threads: this.store.listThreadSnapshots() };
  }

  exportState(): MemoryResearchStoreSnapshot {
    return this.store.exportState();
  }

  recoverInterruptedRuns(reason = "Thread runtime restarted before the run completed."): void {
    for (const run of this.store.listRuns()) {
      if (run.status !== "queued" && run.status !== "running") continue;
      const stage = (run.stage === "idle" ? "planning" : run.stage) as ActivityStage;
      this.store.updateRun(run.id, (current) => ({
        ...current,
        status: "failed",
        finishedAt: now(),
        errorCode: "owner_restarted",
        errorMessage: reason,
      }));
      this.markNonTerminalRowsFailed(run.id);
      this.store.addActivity(
        run.id,
        stageEvent(run.id, stage, "failed", reason, {
          actor: "runtime",
          title: "Owner restarted",
          checkpoint: "run terminated",
        }),
      );
    }
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getThread(threadId: string): ThreadDetailsResponse | null {
    return this.store.getThreadSnapshot(threadId);
  }

  async preview(input: PreviewRequest): Promise<PreviewResponse> {
    const cacheKey = `${input.query.trim().toLowerCase()}:${input.targetResults}`;
    const cached = this.cache.preview.get(cacheKey);
    if (cached) return structuredClone(cached);
    const response = this.config.mode !== "fixture" && hasLivePreviewProvider(this.config)
      ? await this.buildLivePreview(input)
      : previewQuery(input);
    this.cache.preview.set(cacheKey, structuredClone(response));
    return response;
  }

  createThread(input: CreateThreadRequest, options?: { threadId?: string }): CreateThreadResponse {
    const bundle = buildThreadBundle(input, options?.threadId);
    this.store.pruneOldestThreadsIfOver(this.config.maxStoredThreads);
    this.store.createThread(bundle);
    return {
      threadId: bundle.thread.id,
      runId: null,
      phase: bundle.thread.phase,
    };
  }

  updateThreadConfig(threadId: string, patch: UpdateThreadConfigRequest): ThreadDetailsResponse | null {
    const current = this.store.getThreadSnapshot(threadId);
    if (!current) return null;
    const rebuilt = rebuildThreadBundle(
      current.thread,
      current.plan,
      patch as Partial<CreateThreadRequest>,
    );
    return this.store.updateThread(threadId, rebuilt);
  }

  createRun(threadId: string): CreateRunResponse | null {
    const snapshot = this.store.getThreadSnapshot(threadId);
    if (!snapshot) return null;
    if (snapshot.plan.searchQueries.length === 0) {
      return null;
    }
    const run: ResearchRun = {
      id: makeId("run"),
      threadId,
      status: "queued",
      stage: "idle",
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      progress: emptyProgress(snapshot.plan.searchQueries.length),
      metrics: emptyMetrics(),
    };
    this.store.createRun(run);
    this.scheduleRun(run.id);
    return {
      threadId,
      runId: run.id,
      phase: "queued",
    };
  }

  getRun(runId: string): ResearchRun | null {
    return this.store.getRun(runId);
  }

  getInflightPromise(runId: string): Promise<void> | undefined {
    return this.inflightRuns.get(runId);
  }

  getRunEvents(runId: string) {
    return {
      runId,
      events: this.store.listEvents(runId),
    };
  }

  getRunDebug(runId: string) {
    return this.store.getDebugSummary(runId);
  }

  getRuntimeDiagnostics(): RuntimeDiagnosticsResponse {
    const threads = this.store.listThreadSnapshots().map((snapshot) => ({
      threadId: snapshot.thread.id,
      queryRaw: snapshot.thread.queryRaw,
      phase: snapshot.thread.phase,
      latestRunId: snapshot.thread.latestRunId,
      statusSummary: snapshot.thread.statusSummary,
    }));

    return {
      instanceId: this.instanceId,
      now: now(),
      threadCount: threads.length,
      threads,
      inflightRunIds: [...this.inflightRuns.keys()],
    };
  }

  getRunDiagnostics(runId: string): RunDiagnosticsResponse | null {
    const run = this.store.getRun(runId);
    if (!run) return null;
    const thread = this.store.getThreadSnapshot(run.threadId)?.thread ?? null;
    const rows = this.store.listRows(runId);
    const events = this.store.listEvents(runId);
    const debug = this.store.getDebugSummary(runId);
    const visibleRows = rows.filter((row) => row.duplicateOfRowId === null && row.lineage.groundedBySourceIds.length > 0);

    return {
      instanceId: this.instanceId,
      runId,
      inflight: this.inflightRuns.has(runId),
      run,
      thread,
      counts: {
        rows: rows.length,
        visibleRows: visibleRows.length,
        cells: this.store.listCells(runId).length,
        sources: this.store.countSources(runId),
        evidence: this.store.countEvidence(runId),
        events: events.length,
      },
      stallWarning: describePotentialStall(run),
      checkpoints: debug?.checkpoints ?? [],
      recentEvents: events.slice(-10),
    };
  }

  getRunTrace(runId: string, page = 1, pageSize = 50) {
    return this.store.getTrace(runId, page, pageSize);
  }

  getRunResults(runId: string, includeRejected = false) {
    return this.store.listResults(runId, includeRejected);
  }

  getRowDetails(runId: string, rowId: string) {
    return this.store.getRowDetails(runId, rowId);
  }

  cancelRun(runId: string): ResearchRun | null {
    const current = this.store.getRun(runId);
    if (!current) return null;
    if (["complete", "failed", "canceled"].includes(current.status)) return current;
    const canceled = this.store.cancelRun(runId);
    this.markNonTerminalRowsFailed(runId);
    this.store.addActivity(
      runId,
      stageEvent(
        runId,
        current.stage === "idle" ? "planning" : current.stage,
        "skipped",
        "Cancellation requested. The current provider call will stop after the in-flight request settles.",
        {
          actor: "runtime",
          title: "Cancellation requested",
        },
      ),
    );
    return canceled;
  }

  deleteThread(threadId: string): boolean {
    const snapshot = this.store.getThreadSnapshot(threadId);
    if (!snapshot) return false;
    const runId = snapshot.latestRun?.id;
    if (runId && (snapshot.latestRun?.status === "queued" || snapshot.latestRun?.status === "running")) {
      this.cancelRun(runId);
      this.inflightRuns.delete(runId);
    }
    return this.store.deleteThread(threadId);
  }

  exportRun(runId: string, format: "csv" | "json"): ExportArtifact | null {
    const existing = this.store.getExport(runId, format);
    if (existing) return existing;
    const payload = this.store.listResults(runId, false);
    if (!payload) return null;
    const acceptedRows = payload.rows.filter((row) => row.status === "accepted");
    const columns = payload.columns;

    if (format === "json") {
      const content = JSON.stringify(
        acceptedRows.map((row) => ({
          id: row.id,
          canonical_name: row.canonicalName,
          canonical_url: row.canonicalUrl,
          status: row.status,
          processing_state: row.processingState,
          cells: payload.cells.filter((cell) => cell.rowId === row.id),
        })),
        null,
        2,
      );
      const artifact: ExportArtifact = {
        id: makeId("exp"),
        runId,
        format,
        downloadName: `agentic-search-${runId}.json`,
        contentType: "application/json; charset=utf-8",
        content,
        createdAt: now(),
      };
      this.store.addExport(runId, artifact);
      return artifact;
    }

    const header = ["Entity", "URL", ...columns.map((column) => column.label)];
    const lines = acceptedRows.map((row) => {
      const rowCells = payload.cells.filter((cell) => cell.rowId === row.id);
      const values = columns.map((column) => {
        const cell = rowCells.find((entry) => entry.columnKey === column.key);
        return cell?.valueText ?? "";
      });
      return [row.canonicalName, row.canonicalUrl, ...values].map(csvEscape).join(",");
    });
    const artifact: ExportArtifact = {
      id: makeId("exp"),
      runId,
      format,
      downloadName: `agentic-search-${runId}.csv`,
      contentType: "text/csv; charset=utf-8",
      content: [header.map(csvEscape).join(","), ...lines].join("\n"),
      createdAt: now(),
    };
    this.store.addExport(runId, artifact);
    return artifact;
  }

  private scheduleRun(runId: string): void {
    if (this.inflightRuns.has(runId)) return;
    const executionControl = this.createRunExecutionControl(runId);
    const promise = this.executeRun(runId, executionControl)
      .catch(() => {
        // `runStage` already records terminal failure state; swallow here so the local dev server
        // does not crash on an unhandled rejection while background work is still observable in-app.
      })
      .finally(() => {
        executionControl.dispose();
        this.inflightRuns.delete(runId);
      });
    this.inflightRuns.set(runId, promise);
  }

  private async buildLivePreview(input: PreviewRequest): Promise<PreviewResponse> {
    const requestControl = {
      timeoutMs: this.config.previewPlannerTimeoutMs,
    };
    const maxAttempts = this.config.previewPlannerMaxAttempts;
    const providerResult = this.config.previewPlannerProvider === "groq"
      ? await planWithGroq(this.config, input, requestControl, { maxAttempts })
      : await planWithGemini(this.config, input, requestControl, { maxAttempts });
    return providerResult.data;
  }

  private async executeRun(runId: string, executionControl: RunExecutionControl): Promise<void> {
    if (shouldUseLiveProviders(this.config)) {
      await this.executeLiveRun(runId, executionControl);
      return;
    }

    const run = this.store.getRun(runId);
    if (!run) return;
    const thread = this.store.getThreadSnapshot(run.threadId);
    if (!thread) return;
    const scenario = findScenario(thread.thread.queryRaw);
    const criteriaByLabel = new Map(thread.criteria.map((criterion) => [criterion.label, criterion]));

    await this.runStage(runId, "planning", executionControl, async () => {
      const usage = usageRecord(runId, "llm", "fixture", "plan_query", 1, 120, false, 320, 84, {
        query: thread.thread.queryRaw,
      });
      this.store.addUsage(runId, usage);
      this.store.updateRun(runId, (current) => ({
        ...current,
        status: "running",
        stage: "planning",
        startedAt: current.startedAt ?? now(),
        progress: {
          ...current.progress,
          totalQueries: thread.plan.searchQueries.length,
          totalRows: scenario.candidates.length,
        },
      }));
      this.store.addActivity(
        runId,
        stageEvent(runId, "planning", "started", "Interpreting the natural-language query into a structured search plan.", {
          actor: actorForStage("planning"),
          title: "Planning query",
          checkpoint: "plan persisted",
          reasoning:
            "Start broad enough to preserve recall, then sharpen the plan into explicit hard filters, soft signals, and grounded output columns.",
          toolCalls: [
            this.toolCallFromUsage(usage, "Convert the raw query into entity type, filters, columns, and budget hints.", {
              input: thread.thread.queryRaw,
              output: JSON.stringify(
                {
                  entityType: scenario.entityType,
                  hardFilters: scenario.hardFilters,
                  softSignals: scenario.softSignals,
                  searchQueries: scenario.searchQueries,
                },
                null,
                2,
              ),
            }),
          ],
        }),
      );
      await sleep(140);
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "discovery", executionControl, async () => {
      const maxLength = Math.max(thread.plan.searchQueries.length, scenario.candidates.length);
      for (let index = 0; index < maxLength; index += 1) {
        this.assertRunActive(runId);

        const searchQuery = thread.plan.searchQueries[index];
        if (searchQuery) {
          const cacheKey = `search:${searchQuery.text}`;
          const cacheHit = this.cache.search.has(cacheKey);
          const cacheUsage = usageRecord(runId, "cache", "kv_cache", "cache_lookup", 1, 3, cacheHit, 0, 0, {
            key: cacheKey,
          });
          this.store.addUsage(runId, cacheUsage);
          if (!cacheHit) this.cache.search.set(cacheKey, { query: searchQuery.text });
          const searchUsage = usageRecord(runId, "search", "fixture", "search_query", 1, 95, false, 0, 0, {
            query: searchQuery.text,
          });
          this.store.addUsage(runId, searchUsage);
          this.store.updateRun(runId, (current) => ({
            ...current,
            stage: "discovery",
            progress: {
              ...current.progress,
              queriesCompleted: Math.min(
                current.progress.totalQueries,
                current.progress.queriesCompleted + 1,
              ),
            },
          }));
          this.store.addActivity(
            runId,
            stageEvent(runId, "discovery", "started", `Issued search query: ${searchQuery.text}`, {
              actor: actorForStage("discovery"),
              title: "Discovering candidates",
              checkpoint: "candidate rows created",
              reasoning:
                "Use multiple query variants to trade a bit of precision for better candidate recall before verification tightens the set.",
              toolCalls: [
                this.toolCallFromUsage(cacheUsage, "Check whether a cached query response already exists.", {
                  input: cacheKey,
                  output: cacheHit ? "cache hit" : "cache miss",
                }),
                this.toolCallFromUsage(searchUsage, "Retrieve broad candidate documents for this query.", {
                  input: searchQuery.text,
                  output: `Returned fixture-backed candidates for query variant ${index + 1}.`,
                }),
              ],
            }),
          );
        }

        const candidate = scenario.candidates[index];
        if (candidate) {
          const row: ResultRow = {
            id: candidate.id,
            runId,
            canonicalName: candidate.name,
            canonicalUrl: `https://${candidate.url.replace(/^https?:\/\//, "")}`,
            entityType: scenario.entityType,
            status: candidate.status,
            processingState: "pending",
            score: candidate.score,
            rank: null,
            sourceCount: 0,
            duplicateOfRowId: null,
            lineage: {
              suggestedBySourceIds: candidate.sources.map((source) => source.id),
              groundedBySourceIds: [],
              sourceOriginClass: classifySourceOrigin(
                candidate.sources[0]?.url ?? candidate.url,
                candidate.sources[0]?.title ?? candidate.name,
              ),
            },
          };
          this.store.upsertRow(runId, row);
          for (const column of thread.columns) {
            const pendingCell: ResultCell = {
              id: `${candidate.id}:${column.key}`,
              rowId: candidate.id,
              columnKey: column.key,
              valueText: null,
              valueJson: null,
              state: "pending",
              confidence: 0,
              reasonCode: null,
              primaryEvidenceId: null,
            };
            this.store.upsertCell(runId, pendingCell);
          }
          this.store.addActivity(
            runId,
            stageEvent(runId, "discovery", "completed", `Created a provisional row for ${candidate.name}.`, {
              actor: actorForStage("discovery"),
              title: "Created candidate row",
              rowId: candidate.id,
              reasoning:
                "Emit the row immediately once canonical identity is stable so the table can render early while the rest of the evidence pipeline runs.",
              rewards: [
                { label: "row_status", value: candidate.status },
                { label: "score_seed", value: candidate.score.toFixed(2) },
              ],
            }),
          );
        }

        await sleep(120);
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "fetch", executionControl, async () => {
      for (const candidate of scenario.candidates) {
        this.assertRunActive(runId);
        for (const source of candidate.sources) {
          const cacheKey = `page:${source.url}`;
          const cachedSource = this.cache.pages.get(cacheKey);
          const cacheUsage = usageRecord(runId, "cache", "kv_cache", "cache_lookup", 1, 2, Boolean(cachedSource), 0, 0, {
            key: cacheKey,
          });
          this.store.addUsage(runId, cacheUsage);
          const document: SourceDocument =
            cachedSource ??
            {
              id: source.id,
              runId,
              url: source.url,
              normalizedUrl: source.url.toLowerCase(),
              domain: new URL(source.url).hostname,
              title: source.title,
              fetchedAt: now(),
              fetchStatus: 200,
              contentType: "text/html",
              contentHash: `${source.id}:hash`,
              trustTier: source.trustTier ?? "official",
              cacheKey,
              blobRef: null,
              snippet: source.snippet,
              favicon: `https://www.google.com/s2/favicons?domain=${new URL(source.url).hostname}&sz=16`,
            };
          this.cache.pages.set(cacheKey, document);
          const fetchUsage = usageRecord(runId, "fetch", "fixture", "fetch_source", 1, 60, false, 0, 0, {
            url: source.url,
          });
          this.store.addUsage(runId, fetchUsage);
          this.store.addSource(runId, candidate.id, document);
          const row = this.store.getRow(runId, candidate.id);
          if (row) {
            this.store.upsertRow(runId, {
              ...row,
              sourceCount: candidate.sources.length,
            });
          }
          this.store.addActivity(
            runId,
            stageEvent(runId, "fetch", "completed", `Fetched ${document.title} for ${candidate.name}.`, {
              actor: actorForStage("fetch"),
              title: "Fetching source document",
              checkpoint: "sources fetched",
              reasoning:
                "Persist enough source text and metadata to support cell grounding, abstention decisions, and post-run debugging.",
              toolCalls: [
                this.toolCallFromUsage(cacheUsage, "Check whether the normalized source document is already cached.", {
                  input: cacheKey,
                  output: cachedSource ? "cache hit" : "cache miss",
                }),
                this.toolCallFromUsage(fetchUsage, "Fetch and normalize the source document.", {
                  input: source.url,
                  output: source.snippet,
                }),
              ],
              rewards: [
                { label: "trust_tier", value: document.trustTier },
                { label: "source_count", value: String(candidate.sources.length) },
              ],
            }),
          );
          await sleep(60);
        }
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "extraction", executionControl, async () => {
      for (const candidate of scenario.candidates) {
        this.assertRunActive(runId);
        const usage = usageRecord(runId, "llm", "fixture", "extract_candidate", 1, 110, false, 420, 96, {
          rowId: candidate.id,
        });
        this.store.addUsage(runId, usage);
        const resolvedColumns: string[] = [];
        for (const column of thread.columns) {
          const fixtureCell = candidate.cells[column.key];
          const evidence = fixtureCell?.sourceIds?.[0]
            ? this.createEvidenceFromSource(runId, candidate.id, fixtureCell.sourceIds[0], {
                kind: fixtureCell.evidenceKind ?? "snippet",
                text:
                  fixtureCell.valueText ??
                  `${column.label} not supported by the available fixture evidence.`,
                columnKey: column.key,
              })
            : null;
          const cell: ResultCell = {
            id: `${candidate.id}:${column.key}`,
            rowId: candidate.id,
            columnKey: column.key,
            valueText: fixtureCell?.valueText ?? null,
            valueJson: null,
            state: fixtureCell?.state ?? "unsupported",
            confidence: fixtureCell?.confidence ?? 0.12,
            reasonCode: fixtureCell?.reasonCode ?? (fixtureCell ? null : "fixture_missing"),
            primaryEvidenceId: evidence?.id ?? null,
          };
          this.store.upsertCell(runId, cell);
          if (cell.state !== "pending") {
            resolvedColumns.push(`${column.label}:${cell.state}`);
          }
          await sleep(40);
        }
        this.store.addActivity(
          runId,
          stageEvent(runId, "extraction", "completed", `Resolved ${resolvedColumns.length} cells for ${candidate.name}.`, {
            actor: actorForStage("extraction"),
            title: "Extracting row cells",
            checkpoint: "cells extracted",
            reasoning:
              "Prefer abstention over hallucination. If the fixture evidence does not cleanly support a field, preserve the explicit null-state instead of forcing a value.",
            toolCalls: [
              this.toolCallFromUsage(usage, "Fill identity and enrichment cells from the fetched sources.", {
                input: candidate.name,
                output: resolvedColumns.join("\n"),
              }),
            ],
          }),
        );
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "evaluation", executionControl, async () => {
      for (const candidate of scenario.candidates) {
        this.assertRunActive(runId);
        const usage = usageRecord(runId, "llm", "fixture", "evaluate_candidate", 1, 90, false, 260, 74, {
          rowId: candidate.id,
        });
        this.store.addUsage(runId, usage);
        const verdicts: string[] = [];
        for (const criterion of thread.criteria) {
          const fixtureEvaluation = candidate.evaluations.find(
            (evaluation) => evaluation.label === criterion.label,
          );
          const primarySourceId = fixtureEvaluation?.sourceIds?.[0] ?? null;
          const evidence = primarySourceId
            ? this.createEvidenceFromSource(runId, candidate.id, primarySourceId, {
                kind: "inferred_summary",
                text: fixtureEvaluation?.summary ?? criterion.label,
                columnKey: criterion.id,
              })
            : null;
          const evaluation: CriterionEvaluation = {
            id: `${candidate.id}:${criterion.id}`,
            rowId: candidate.id,
            criterionId: criteriaByLabel.get(criterion.label)?.id ?? criterion.id,
            verdict: fixtureEvaluation?.verdict ?? "uncertain",
            summary:
              fixtureEvaluation?.summary ??
              "No fixture-backed evaluation is available for this custom criterion yet.",
            confidence: fixtureEvaluation?.confidence ?? 0.2,
            primaryEvidenceId: evidence?.id ?? null,
          };
          this.store.addEvaluation(runId, evaluation);
          verdicts.push(`${criterion.label}: ${evaluation.verdict}`);
          await sleep(30);
        }
        this.store.addActivity(
          runId,
          stageEvent(runId, "evaluation", "completed", `Evaluated ${candidate.name} against ${thread.criteria.length} criteria.`, {
            actor: actorForStage("evaluation"),
            title: "Scoring candidate against criteria",
            checkpoint: "criteria evaluated",
            reasoning:
              "Separate semantic inclusion logic from enrichment. Hard filters gate acceptance; soft signals shape ordering and confidence.",
            toolCalls: [
              this.toolCallFromUsage(usage, "Evaluate row-level criteria against the evidence set.", {
                input: candidate.name,
                output: verdicts.join("\n"),
              }),
            ],
          }),
        );
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "canonicalization", executionControl, async () => {
      this.store.addActivity(
        runId,
        stageEvent(runId, "canonicalization", "started", "Checking for duplicate entities and unstable canonical URLs.", {
          actor: actorForStage("canonicalization"),
          title: "Canonicalizing entities",
          checkpoint: "candidate rows created",
          reasoning:
            "Do not rank duplicate aliases separately. Canonicalization keeps the evidence graph coherent before final scoring.",
        }),
      );
      await sleep(70);
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "verification", executionControl, async () => {
      const rows = this.store.listRows(runId);
      for (const row of rows.filter(
        (candidate) => candidate.status === "uncertain" || candidate.status === "conflict",
      )) {
        this.assertRunActive(runId);
        this.store.upsertRow(runId, {
          ...row,
          processingState: "verifying",
        });
        const usage = usageRecord(runId, "llm", "fixture", "verify_candidate", 1, 80, false, 180, 54, {
          rowId: row.id,
        });
        this.store.addUsage(runId, usage);
        this.store.addActivity(
          runId,
          stageEvent(runId, "verification", "started", `Re-checking ambiguous evidence for ${row.canonicalName}.`, {
            actor: actorForStage("verification"),
            title: "Validating row state",
            checkpoint: "criteria evaluated",
            reasoning:
              "Only rows with unresolved ambiguity take the extra pass. This avoids wasting budget on already-grounded accepted or rejected rows.",
            toolCalls: [
              this.toolCallFromUsage(usage, "Run a second-pass validation on uncertain or conflicting rows.", {
                input: row.canonicalName,
                output: row.status,
              }),
            ],
            rewards: [
              { label: "pre_verify_status", value: row.status },
              { label: "score", value: row.score.toFixed(2) },
            ],
          }),
        );
        await sleep(40);
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "ranking", executionControl, async () => {
      const usage = usageRecord(runId, "llm", "fixture", "rank_results", 1, 55, false, 120, 26, {});
      this.store.addUsage(runId, usage);
      const rankedRows = this.store
        .listRows(runId)
        .filter((row) => row.duplicateOfRowId === null)
        .sort((left, right) => right.score - left.score);
      let rank = 1;
      for (const row of rankedRows) {
        const finalized: ResultRow = {
          ...row,
          processingState: "finalized",
          rank: row.status === "rejected" ? null : rank,
          lineage: this.withGroundedLineage(runId, row),
        };
        if (row.status !== "rejected") rank += 1;
        this.store.upsertRow(runId, finalized);
      }
      this.store.addActivity(
        runId,
        stageEvent(runId, "ranking", "completed", "Committed final ranking and row statuses.", {
          actor: actorForStage("ranking"),
          title: "Ranking and partitioning rows",
          checkpoint: "final ranking committed",
          reasoning:
            "Rank only after extraction, evaluation, and verification have converged so the accepted set and unmatched set tell a credible engineering story.",
          toolCalls: [
            this.toolCallFromUsage(
              usage,
              "Rank the candidate pool and finalize row states.",
              {
                input: `${rankedRows.length} rows`,
                output: rankedRows
                  .map((row) => `${row.canonicalName}: ${row.status}`)
                  .join("\n"),
              },
            ),
          ],
          rewards: this.computeRewardSignals(runId, thread.thread.targetResults),
          metrics: this.store.getRun(runId)?.metrics.providerBreakdown ?? [],
        }),
      );
      await sleep(80);
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "export", executionControl, async () => {
      const usage = usageRecord(runId, "llm", "fixture", "export_results", 1, 35, false, 0, 0, {});
      this.store.addUsage(runId, usage);
      this.exportRun(runId, "json");
      this.exportRun(runId, "csv");
      this.store.addActivity(
        runId,
        stageEvent(runId, "export", "completed", "Prepared JSON and CSV exports for accepted rows.", {
          actor: actorForStage("export"),
          title: "Packaging exports",
          checkpoint: "final ranking committed",
          toolCalls: [
            this.toolCallFromUsage(usage, "Serialize the final accepted set into export artifacts.", {
              input: runId,
              output: "csv,json",
            }),
          ],
        }),
      );
      await sleep(30);
    });
    if (this.shouldStop(runId)) return;

    this.store.updateRun(runId, (current) => ({
      ...current,
      status: "complete",
      stage: "export",
      finishedAt: now(),
      metrics: {
        ...current.metrics,
        elapsedMs: current.startedAt ? now() - current.startedAt : current.metrics.elapsedMs,
      },
    }));
  }

  private async executeLiveRun(runId: string, executionControl: RunExecutionControl): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) return;
    const thread = this.store.getThreadSnapshot(run.threadId);
    if (!thread) return;

    const criteriaByLabel = new Map(thread.criteria.map((criterion) => [criterion.label, criterion]));
    type FetchedDoc = {
      result: BraveWebResult;
      parsed: Awaited<ReturnType<typeof fetchAndParseDocument>>;
    };
    type AnchorSourceMeta = {
      url: string;
      title: string;
      snippet: string;
      sourceClass: Awaited<ReturnType<typeof fetchAndParseDocument>>["sourceClass"];
    };
    type AnchorCandidate = {
      key: string;
      canonicalName: string;
      candidateWebsite: string | null;
      followUpUrls: Set<string>;
      suggestedSources: Map<string, AnchorSourceMeta>;
      sourceOriginClass: ResultRow["lineage"]["sourceOriginClass"];
      bestScore: number;
      rowSummary: string;
      corroborationSearchIssued: boolean;
      rowId: string | null;
    };

    const discovered: BraveWebResult[] = [];
    const discoveredUrls = new Set<string>();
    const fetchedDocs: FetchedDoc[] = [];
    const fetchedUrls = new Set<string>();
    const failedUrls = new Set<string>();
    const prunedSourceUrls = new Set<string>();
    const prunedSourceSummaries = new Map<string, string>();
    const anchorCandidates = new Map<string, AnchorCandidate>();
    const queuedCorroborationUrls = new Map<string, string>();
    const extractionBudget = createExtractionBudget(this.config.maxLlmExtractionsPerRun);
    const rowIdByName = new Map<string, string>();
    const criteriaLabels = thread.criteria.map((criterion) => criterion.label);
    const discoveryIntent = classifyDiscoveryIntent({
      query: thread.thread.queryRaw,
      entityType: thread.plan.entityType,
      criteriaLabels,
    });
    const activeSearchQueries = expandDiscoveryQueries({
      query: thread.thread.queryRaw,
      entityType: thread.plan.entityType,
      plannedQueries: thread.plan.searchQueries,
      criteriaLabels,
    });

    const compactSourcePayload = (payload: Record<string, unknown>) => payload;
    const searchConcurrency = 3;
    const fetchConcurrency = 3;
    const extractionConcurrency = 2;
    const extractionTimeoutForSourceClass = (sourceClass: FetchedDoc["parsed"]["sourceClass"]): number => {
      return extractionTimeoutMsForIntent(sourceClass, discoveryIntent, this.config.requestTimeoutMs);
    };
    const visibleGroundedRows = (): ResultRow[] =>
      this.store.listRows(runId).filter(
        (row) =>
          row.duplicateOfRowId === null
          && row.lineage.groundedBySourceIds.length > 0
          && row.processingState !== "failed"
          && row.status !== "rejected",
      );
    const trustTierForSourceClass = (sourceClass: FetchedDoc["parsed"]["sourceClass"]) => {
      if (sourceClass === "official_site") return "official" as const;
      if (sourceClass === "entity_page" || sourceClass === "directory") return "primary_structured" as const;
      if (sourceClass === "forum") return "weak_discovery" as const;
      return "reputable_secondary" as const;
    };
    const extractStarThreshold = (label: string): number | null => {
      const lower = label.toLowerCase();
      const direct = /stars?\s*(?:>|>=)\s*(\d[\d,]*)/i.exec(lower)?.[1];
      if (direct) return Number(direct.replace(/,/g, ""));
      const verbal = /(?:over|more than|greater than)\s+(\d[\d,]*)/i.exec(lower)?.[1];
      if (verbal) return Number(verbal.replace(/,/g, ""));
      const shorthand = />\s*(\d+)\s*k\b/i.exec(lower);
      if (shorthand) return Number(shorthand[1]) * 1000;
      return null;
    };
    const buildDeterministicGitHubRow = async (entry: FetchedDoc) => {
      if (discoveryIntent !== "project_repo") return null;
      if (entry.parsed.sourceClass !== "entity_page") return null;
      const repoRef = parseGitHubRepositoryUrl(entry.parsed.finalUrl);
      if (!repoRef) return null;

      const metadata = await fetchGitHubRepositoryMetadata(
        entry.parsed.finalUrl,
        executionControl.requestControl(Math.min(this.config.requestTimeoutMs, 5_000)),
      );
      const metadataText = [
        metadata.fullName,
        metadata.description,
        metadata.language,
        metadata.license,
        metadata.topics.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const repoUrl = metadata.htmlUrl;
      const homepage = metadata.homepage;
      const makeCell = (
        valueText: string | null,
        confidence: number,
        evidenceText?: string | null,
      ): ExtractedEntityRow["cells"][number] => ({
        key: "",
        valueText,
        state: valueText ? "filled" : "not_found",
        confidence: valueText ? confidence : 0.2,
        reasonCode: valueText ? null : "github_metadata_missing",
        evidenceText: evidenceText ?? valueText,
      });
      const cells = thread.columns.map((column) => {
        const lowerKey = column.key.toLowerCase();
        const lowerLabel = column.label.toLowerCase();
        let next = makeCell(null, 0.2);

        if (lowerKey === "name" || lowerLabel.includes("name")) {
          next = makeCell(metadata.fullName, 0.98, metadata.fullName);
        } else if (lowerKey.includes("star") || lowerLabel.includes("star")) {
          next = makeCell(String(metadata.stars), 0.99, `Stars: ${metadata.stars}`);
        } else if (lowerKey.includes("repo") || lowerLabel.includes("repo")) {
          next = makeCell(repoUrl, 0.99, repoUrl);
        } else if (lowerKey === "url") {
          next = makeCell(repoUrl, 0.99, repoUrl);
        } else if (lowerKey.includes("website") || lowerKey.includes("homepage") || lowerLabel.includes("website")) {
          next = makeCell(homepage, homepage ? 0.9 : 0.2, homepage);
        } else if (lowerKey.includes("description") || lowerLabel.includes("description")) {
          next = makeCell(metadata.description, metadata.description ? 0.92 : 0.2, metadata.description);
        } else if (lowerKey.includes("license") || lowerLabel.includes("license")) {
          next = makeCell(metadata.license, metadata.license ? 0.97 : 0.2, metadata.license);
        } else if (lowerKey.includes("commit") || lowerLabel.includes("commit")) {
          next = makeCell(metadata.pushedAt, metadata.pushedAt ? 0.92 : 0.2, metadata.pushedAt);
        } else if (lowerKey.includes("language") || lowerLabel.includes("language")) {
          next = makeCell(metadata.language, metadata.language ? 0.88 : 0.2, metadata.language);
        }

        return {
          ...next,
          key: column.key,
        };
      });

      const criteria = thread.criteria.map((criterion) => {
        const label = criterion.label.toLowerCase();
        if (label.includes("open source") || /\boss\b/.test(label)) {
          if (metadata.license) {
            return {
              label: criterion.label,
              verdict: "pass" as const,
              summary: `Repository declares license ${metadata.license}.`,
              confidence: 0.95,
              evidenceText: metadata.license,
            };
          }
          return {
            label: criterion.label,
            verdict: "uncertain" as const,
            summary: "Repository is public, but metadata did not expose an explicit license.",
            confidence: 0.45,
            evidenceText: repoUrl,
          };
        }
        if (label.includes("llm") || label.includes("language model")) {
          const looksLikeLlm = /\b(llm|large language model|language model|transformer|inference|rag|model)\b/.test(metadataText);
          return {
            label: criterion.label,
            verdict: looksLikeLlm ? "pass" as const : "uncertain" as const,
            summary: looksLikeLlm
              ? "Repository metadata references LLM/model-related terms."
              : "Repository metadata does not make the LLM focus explicit.",
            confidence: looksLikeLlm ? 0.82 : 0.42,
            evidenceText: metadata.description || metadata.topics.join(", ") || metadata.fullName,
          };
        }
        if (label.includes("star")) {
          const threshold = extractStarThreshold(criterion.label) ?? 1000;
          const passes = metadata.stars > threshold;
          return {
            label: criterion.label,
            verdict: passes ? "pass" as const : "fail" as const,
            summary: `Repository has ${metadata.stars} stars.`,
            confidence: 0.99,
            evidenceText: `Stars: ${metadata.stars}`,
          };
        }
        return {
          label: criterion.label,
          verdict: "uncertain" as const,
          summary: "Criterion requires corroboration beyond GitHub repository metadata.",
          confidence: 0.35,
          evidenceText: metadata.description || repoUrl,
        };
      });

      const hardCriteria = criteria
        .filter((criterion) => (criteriaByLabel.get(criterion.label)?.kind ?? "hard_filter") === "hard_filter");
      const allHardPass = hardCriteria.length > 0 && hardCriteria.every((criterion) => criterion.verdict === "pass");
      const score = Math.max(
        0.65,
        Math.min(
          0.98,
          0.68
            + Math.min(0.18, Math.log10(Math.max(1, metadata.stars)) / 10)
            + (allHardPass ? 0.08 : 0),
        ),
      );

      const row: ExtractedEntityRow = {
        canonicalName: metadata.fullName,
        canonicalUrl: repoUrl,
        candidateWebsite: homepage,
        rowStatus: allHardPass ? "accepted" : "uncertain",
        score,
        rowSummary: metadata.description || `GitHub repository ${metadata.fullName}.`,
        sourceUrl: entry.parsed.finalUrl,
        sourceClass: entry.parsed.sourceClass,
        followUpUrls: homepage ? [homepage] : [],
        cells,
        criteria,
      };

      return {
        metadata,
        row,
      };
    };
    const registerDiscoveredResult = (candidate: BraveWebResult): string | null => {
      const normalizedUrl = this.normalizeUrl(candidate.url);
      if (discoveredUrls.has(normalizedUrl) || failedUrls.has(normalizedUrl) || prunedSourceUrls.has(normalizedUrl)) {
        return null;
      }
      discovered.push({
        ...candidate,
        url: normalizedUrl,
      });
      discoveredUrls.add(normalizedUrl);
      return normalizedUrl;
    };
    const selectNextDiscoveryUrls = (limit: number): string[] => {
      if (limit <= 0) return [];
      return selectDiscoveryBatch(
        {
          query: thread.thread.queryRaw,
          entityType: thread.plan.entityType,
          criteriaLabels,
          candidates: discovered.filter((candidate) => {
            const normalizedUrl = this.normalizeUrl(candidate.url);
            return !prunedSourceUrls.has(normalizedUrl)
              && !failedUrls.has(normalizedUrl)
              && !fetchedUrls.has(normalizedUrl);
          }),
          limit,
        },
      ).map((candidate) => this.normalizeUrl(candidate.url));
    };
    const queueCorroborationUrl = (rawUrl: string | null | undefined, anchorKey: string): void => {
      if (!rawUrl) return;
      const normalizedUrl = this.normalizeUrl(rawUrl);
      if (
        prunedSourceUrls.has(normalizedUrl)
        || failedUrls.has(normalizedUrl)
        || fetchedUrls.has(normalizedUrl)
        || queuedCorroborationUrls.has(normalizedUrl)
      ) {
        return;
      }
      queuedCorroborationUrls.set(normalizedUrl, anchorKey);
    };
    const selectedCorroborationUrls = (limit: number): string[] => {
      if (limit <= 0) return [];
      const urls: string[] = [];
      for (const [url, anchorKey] of queuedCorroborationUrls.entries()) {
        if (urls.length >= limit) break;
        const anchor = anchorCandidates.get(anchorKey);
        if (!anchor) {
          queuedCorroborationUrls.delete(url);
          continue;
        }
        if (failedUrls.has(url) || prunedSourceUrls.has(url) || fetchedUrls.has(url)) {
          queuedCorroborationUrls.delete(url);
          continue;
        }
        urls.push(url);
      }
      return urls;
    };
    const anchorNeedsCorroboration = (anchor: AnchorCandidate): boolean => {
      if (!anchor.rowId) return true;
      const row = this.store.getRow(runId, anchor.rowId);
      const details = this.store.getRowDetails(runId, anchor.rowId);
      if (!row || !details) return true;
      const groundedSources = details.sources.filter((source) =>
        row.lineage.groundedBySourceIds.includes(source.id),
      );
      const hasAuthoritativeGrounding = groundedSources.some(
        (source) => source.trustTier === "official" || source.trustTier === "primary_structured",
      );
      return !(hasAuthoritativeGrounding || groundedSources.length >= 2);
    };
    const seedCorroborationSearches = async (limit = 2): Promise<void> => {
      const anchors = [...anchorCandidates.values()]
        .filter((anchor) => anchorNeedsCorroboration(anchor) && !anchor.corroborationSearchIssued)
        .slice(0, limit);
      for (const anchor of anchors) {
        anchor.corroborationSearchIssued = true;
        const queries = buildCorroborationQueries({
          anchorName: anchor.canonicalName,
          query: thread.thread.queryRaw,
          entityType: thread.plan.entityType,
          candidateWebsite: anchor.candidateWebsite,
        });
        for (const queryText of queries) {
          this.assertRunActive(runId);
          const searchQuery: SearchQuery = {
            id: makeId("sq"),
            text: queryText,
          };
          const startedAt = now();
          const results = await searchBraveWeb(
            this.config.braveApiKey!,
            searchQuery,
            Math.min(discoverySearchResultLimit(this.config.searchResultsPerQuery, discoveryIntent), 6),
            executionControl.requestControl(),
          );
          this.assertRunActive(runId);
          const usage = usageRecord(runId, "search", "brave", "search_anchor_corroboration", 1, now() - startedAt, false, 0, 0, {
            query: queryText,
            anchor: anchor.canonicalName,
            resultCount: results.length,
          });
          this.store.addUsage(runId, usage);
          const selected = selectDiscoveryBatch(
            {
              query: queryText,
              entityType: thread.plan.entityType,
              criteriaLabels,
              candidates: results.filter((result) => {
                const normalizedUrl = this.normalizeUrl(result.url);
                return !failedUrls.has(normalizedUrl)
                  && !prunedSourceUrls.has(normalizedUrl)
                  && !fetchedUrls.has(normalizedUrl);
              }),
              limit: Math.min(2, this.config.maxSourcesPerRow),
            },
          );
          for (const result of selected) {
            registerDiscoveredResult(result);
            queueCorroborationUrl(result.url, anchor.key);
          }
          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "refinement",
              "completed",
              `Corroboration search for ${anchor.canonicalName}: ${selected.length} targets.`,
              compactSourcePayload({
                actor: "corroboration",
                title: "Anchor corroboration search",
                anchor: anchor.canonicalName,
                query: queryText,
                urls: selected.map((entry) => this.normalizeUrl(entry.url)),
                toolCalls: [
                  this.toolCallFromUsage(usage, "Search for corroborating sources for an extracted anchor.", {
                    input: queryText,
                    output: this.stringifyForTrace({
                      selectedUrls: selected.map((entry) => this.normalizeUrl(entry.url)),
                      resultCount: results.length,
                    }),
                  }),
                ],
              }),
            ),
          );
        }
      }
    };
    const registerAnchor = (merged: ExtractedEntityRow, sourceMeta: AnchorSourceMeta): void => {
      const key = normalizeName(merged.canonicalName);
      if (!key) return;
      const existing = anchorCandidates.get(key) ?? {
        key,
        canonicalName: merged.canonicalName,
        candidateWebsite: null,
        followUpUrls: new Set<string>(),
        suggestedSources: new Map<string, AnchorSourceMeta>(),
        sourceOriginClass: classifySourceOrigin(sourceMeta.url, sourceMeta.title),
        bestScore: merged.score,
        rowSummary: merged.rowSummary,
        corroborationSearchIssued: false,
        rowId: null,
      };
      if (merged.score >= existing.bestScore) {
        existing.canonicalName = merged.canonicalName;
        existing.bestScore = merged.score;
        existing.rowSummary = merged.rowSummary;
      }
      existing.candidateWebsite =
        existing.candidateWebsite
        ?? (merged.candidateWebsite ? this.normalizeUrl(merged.candidateWebsite) : null);
      existing.suggestedSources.set(this.normalizeUrl(sourceMeta.url), sourceMeta);
      for (const followUpUrl of collectFollowUpUrls(merged)) {
        existing.followUpUrls.add(followUpUrl);
        queueCorroborationUrl(followUpUrl, key);
      }
      anchorCandidates.set(key, existing);
      this.store.addActivity(
        runId,
        stageEvent(
          runId,
          "extraction",
          "completed",
          `Anchor: ${existing.canonicalName}`,
          compactSourcePayload({
            actor: "anchor_extraction",
            title: "Anchor extracted",
            name: existing.canonicalName,
            sourceUrl: sourceMeta.url,
            followUpCount: existing.followUpUrls.size,
          }),
        ),
      );
    };
    const buildStoredSource = (
      meta: AnchorSourceMeta,
      sourceClass: AnchorSourceMeta["sourceClass"],
    ): SourceDocument => {
      const normalizedUrl = this.normalizeUrl(meta.url);
      const domain = (() => {
        try {
          return new URL(normalizedUrl).hostname;
        } catch {
          return "unknown";
        }
      })();
      return {
        id: makeId("src"),
        runId,
        url: normalizedUrl,
        normalizedUrl,
        domain,
        title: meta.title || normalizedUrl,
        fetchedAt: now(),
        fetchStatus: 200,
        contentType: "text/html",
        contentHash: `${normalizedUrl}:${meta.snippet.length}`,
        trustTier: trustTierForSourceClass(sourceClass),
        cacheKey: `page:${normalizedUrl}`,
        blobRef: null,
        snippet: meta.snippet,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=16`,
      };
    };
    const upsertGroundedRow = (merged: ExtractedEntityRow, entry: FetchedDoc): void => {
      const key = normalizeName(merged.canonicalName);
      if (!key) return;
      const anchor = anchorCandidates.get(key);
      const rowId = rowIdByName.get(key) ?? anchor?.rowId ?? makeId("row");
      rowIdByName.set(key, rowId);
      if (anchor) {
        anchor.rowId = rowId;
      }

      const existing = this.store.getRow(runId, rowId);
      const details = this.store.getRowDetails(runId, rowId);
      const existingSourcesByUrl = new Map(
        (details?.sources ?? []).map((source) => [this.normalizeUrl(source.url), source]),
      );
      const ensuredSources: SourceDocument[] = [];
      const pushSource = (meta: AnchorSourceMeta) => {
        const normalizedUrl = this.normalizeUrl(meta.url);
        const existingSource = existingSourcesByUrl.get(normalizedUrl);
        if (existingSource) {
          ensuredSources.push(existingSource);
          return existingSource;
        }
        const doc = buildStoredSource(meta, meta.sourceClass);
        this.store.addSource(runId, rowId, doc);
        existingSourcesByUrl.set(normalizedUrl, doc);
        ensuredSources.push(doc);
        return doc;
      };

      const groundingSource = pushSource(
        {
          url: entry.parsed.finalUrl,
          title: entry.parsed.title || entry.result.title,
          snippet: entry.parsed.description || entry.result.description || "",
          sourceClass: entry.parsed.sourceClass,
        },
      );
      if (anchor) {
        for (const sourceMeta of anchor.suggestedSources.values()) {
          pushSource(sourceMeta);
        }
      }

      const suggestedBySourceIds = new Set(existing?.lineage.suggestedBySourceIds ?? []);
      for (const source of ensuredSources) {
        suggestedBySourceIds.add(source.id);
      }
      const groundedBySourceIds = new Set(existing?.lineage.groundedBySourceIds ?? []);
      groundedBySourceIds.add(groundingSource.id);

      this.store.upsertRow(runId, {
        id: rowId,
        runId,
        canonicalName: merged.canonicalName,
        canonicalUrl: existing?.canonicalUrl ?? groundingSource.url,
        entityType: thread.plan.entityType,
        status: "uncertain",
        statusReasonCode: null,
        statusReasonSummary: null,
        processingState: "corroborating",
        score: Math.max(existing?.score ?? 0, merged.score),
        rank: existing?.rank ?? null,
        sourceCount: suggestedBySourceIds.size,
        duplicateOfRowId: existing?.duplicateOfRowId ?? null,
        lineage: {
          suggestedBySourceIds: [...suggestedBySourceIds],
          groundedBySourceIds: [...groundedBySourceIds],
          sourceOriginClass: anchor?.sourceOriginClass ?? classifySourceOrigin(groundingSource.url, groundingSource.title),
        },
      });

      const existingCells = new Map((details?.cells ?? []).map((cell) => [cell.columnKey, cell]));
      const existingEvaluations = new Map((details?.evaluations ?? []).map((evaluation) => [evaluation.criterionId, evaluation]));
      const websiteValue =
        anchor?.candidateWebsite
        ?? merged.candidateWebsite
        ?? (entry.parsed.sourceClass === "official_site" ? groundingSource.url : null);

      for (const column of thread.columns) {
        const extractedCell = merged.cells.find((cell) => cell.key === column.key);
        const current = existingCells.get(column.key);
        const fallbackWebsiteCell =
          !extractedCell && column.key === "website" && websiteValue
            ? {
                key: column.key,
                valueText: websiteValue,
                state: "filled" as const,
                confidence: 0.72,
                reasonCode: null,
                evidenceText: websiteValue,
              }
            : null;
        const nextCell = extractedCell ?? fallbackWebsiteCell;
        if (!nextCell) {
          if (!current) {
            this.store.upsertCell(runId, {
              id: `${rowId}:${column.key}`,
              rowId,
              columnKey: column.key,
              valueText: null,
              valueJson: null,
              state: "unsupported",
              confidence: 0.1,
              reasonCode: "model_omitted_field",
              primaryEvidenceId: null,
            });
          }
          continue;
        }
        if (current && current.confidence > nextCell.confidence) continue;
        const evidence = nextCell.evidenceText
          ? this.createEvidenceFromSource(runId, rowId, groundingSource.id, {
              kind: "inferred_summary",
              text: nextCell.evidenceText,
              columnKey: column.key,
            })
          : null;
        this.store.upsertCell(runId, {
          id: `${rowId}:${column.key}`,
          rowId,
          columnKey: column.key,
          valueText: nextCell.valueText,
          valueJson: null,
          state: nextCell.state,
          confidence: nextCell.confidence,
          reasonCode: nextCell.reasonCode,
          primaryEvidenceId: evidence?.id ?? null,
        });
      }

      for (const criterion of thread.criteria) {
        const extractedCriterion = merged.criteria.find((item) => item.label === criterion.label);
        if (!extractedCriterion) continue;
        const criterionId = criteriaByLabel.get(criterion.label)?.id ?? criterion.id;
        const current = existingEvaluations.get(criterionId);
        if (current && current.confidence > extractedCriterion.confidence) continue;
        const evidence = extractedCriterion.evidenceText
          ? this.createEvidenceFromSource(runId, rowId, groundingSource.id, {
              kind: "inferred_summary",
              text: extractedCriterion.evidenceText,
              columnKey: criterionId,
            })
          : null;
        this.store.addEvaluation(runId, {
          id: `${rowId}:${criterionId}`,
          rowId,
          criterionId,
          verdict: extractedCriterion.verdict,
          summary: extractedCriterion.summary,
          confidence: extractedCriterion.confidence,
          primaryEvidenceId: evidence?.id ?? null,
        });
      }

      this.store.addActivity(
        runId,
        stageEvent(
          runId,
          "refinement",
          "completed",
          `Grounded ${merged.canonicalName} from ${groundingSource.domain}`,
          compactSourcePayload({
            actor: "corroboration",
            title: "Grounded row",
            rowId,
            name: merged.canonicalName,
            sourceUrl: groundingSource.url,
            sourceCount: suggestedBySourceIds.size,
          }),
        ),
      );
    };
    const processExtractedRows = (rows: ExtractedEntityRow[], docs: FetchedDoc[]) => {
      const docsByUrl = new Map(docs.map((entry) => [this.normalizeUrl(entry.parsed.finalUrl), entry]));
      const mergedRows = dedupeAndMerge(rows);
      for (const merged of mergedRows) {
        const doc = docsByUrl.get(this.normalizeUrl(merged.sourceUrl));
        if (!doc) continue;
        if (isCandidateOnlySourceClass(merged.sourceClass)) {
          registerAnchor(merged, {
            url: doc.parsed.finalUrl,
            title: doc.parsed.title || doc.result.title,
            snippet: doc.parsed.description || doc.result.description || "",
            sourceClass: doc.parsed.sourceClass,
          });
          continue;
        }
        upsertGroundedRow(merged, doc);
      }
    };
    const fetchByUrls = async (
      urls: string[],
      mode: "discovery" | "corroboration",
    ): Promise<FetchedDoc[]> => {
      const nextFetched: FetchedDoc[] = [];
      const byUrl = new Map(discovered.map((result) => [this.normalizeUrl(result.url), result]));
      await mapConcurrent(urls, fetchConcurrency, async (rawUrl) => {
        if (executionControl.failIfWallClockExceeded()) return;
        this.assertRunActive(runId);
        const normalizedUrl = this.normalizeUrl(rawUrl);
        if (failedUrls.has(normalizedUrl) || fetchedUrls.has(normalizedUrl)) return;

        const anchorKey = queuedCorroborationUrls.get(normalizedUrl) ?? null;
        queuedCorroborationUrls.delete(normalizedUrl);
        const anchor = anchorKey ? anchorCandidates.get(anchorKey) : null;
        if (anchor?.rowId) {
          const row = this.store.getRow(runId, anchor.rowId);
          if (row) {
            this.store.upsertRow(runId, {
              ...row,
              processingState: "fetching",
            });
          }
        }

        const result = byUrl.get(normalizedUrl) ?? {
          title: normalizedUrl,
          url: normalizedUrl,
          description: "",
          age: "",
        };

        try {
          const fetchStartedAt = now();
          const parsed = await fetchAndParseDocument(normalizedUrl, this.config.fetchTextCharLimit, {
            jinaApiKey: this.config.jinaApiKey,
            entityType: thread.plan.entityType,
            ...executionControl.requestControl(),
          });
          this.assertRunActive(runId);
          const fetchLatency = now() - fetchStartedAt;
          const finalNorm = this.normalizeUrl(parsed.finalUrl);
          if (fetchedUrls.has(finalNorm)) {
            failedUrls.add(normalizedUrl);
            return;
          }
          const pruneDecision = classifySourceScopeDecision(
            thread.thread.queryRaw,
            {
              title: parsed.title || result.title || "",
              snippet: parsed.description || result.description || "",
            },
            finalNorm,
          );
          if (pruneDecision.eligibility === "out_of_scope_hard") {
            if (pruneDecision.pruneKey) {
              prunedSourceUrls.add(pruneDecision.pruneKey);
              if (pruneDecision.reasonSummary) {
                prunedSourceSummaries.set(pruneDecision.pruneKey, pruneDecision.reasonSummary);
              }
            }
            failedUrls.add(normalizedUrl);
            return;
          }

          const usage = usageRecord(runId, "fetch", "http_fetch", "fetch_source", 1, fetchLatency, false, 0, 0, {
            url: parsed.finalUrl,
            mode,
            sourceClass: parsed.sourceClass,
          });
          this.store.addUsage(runId, usage);
          fetchedUrls.add(finalNorm);
          const fetchedDoc = { result, parsed };
          nextFetched.push(fetchedDoc);
          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "fetch",
              "completed",
              `${mode === "corroboration" ? "Corroboration" : "Discovery"} fetch: ${parsed.title || finalNorm}`,
              compactSourcePayload({
                actor: "fetch",
                title: "Fetched source",
                sourceUrl: parsed.finalUrl,
                sourceClass: parsed.sourceClass,
                mode,
                toolCalls: [
                  this.toolCallFromUsage(usage, "Fetch and normalize a candidate source page.", {
                    input: normalizedUrl,
                    output: this.stringifyForTrace({
                      finalUrl: parsed.finalUrl,
                      title: parsed.title,
                      sourceClass: parsed.sourceClass,
                      description: parsed.description,
                    }),
                  }),
                ],
              }),
            ),
          );
        } catch (error) {
          failedUrls.add(normalizedUrl);
          queuedCorroborationUrls.delete(normalizedUrl);
          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "fetch",
              "failed",
              error instanceof Error ? error.message : `Failed to fetch ${normalizedUrl}`,
              compactSourcePayload({
                actor: "fetch",
                title: "Source fetch failed",
                sourceUrl: normalizedUrl,
                mode,
                error: error instanceof Error ? error.message : "Unknown fetch failure",
              }),
            ),
          );
        }
      });
      this.store.updateRun(runId, (current) => ({
        ...current,
        progress: {
          ...current.progress,
          sourcesFetched: fetchedUrls.size,
        },
      }));
      return nextFetched;
    };
    const extractDocs = async (docs: FetchedDoc[]): Promise<ExtractedEntityRow[]> => {
      const extracted: ExtractedEntityRow[] = [];
      await mapConcurrent(docs, extractionConcurrency, async (entry) => {
        if (executionControl.failIfWallClockExceeded()) return;
        const maybeAnchorKey = [...anchorCandidates.values()].find((anchor) =>
          anchor.followUpUrls.has(this.normalizeUrl(entry.parsed.finalUrl))
          || anchor.candidateWebsite === this.normalizeUrl(entry.parsed.finalUrl),
        )?.key;
        const anchor = maybeAnchorKey ? anchorCandidates.get(maybeAnchorKey) : null;
        if (anchor?.rowId) {
          const row = this.store.getRow(runId, anchor.rowId);
          if (row) {
            this.store.upsertRow(runId, {
              ...row,
              processingState: isGroundingSourceClass(entry.parsed.sourceClass) ? "corroborating" : "extracting_anchor",
            });
          }
        }

        const startedAt = now();
        this.store.addActivity(
          runId,
          stageEvent(
            runId,
            "extraction",
            "started",
            `Extracting ${entry.parsed.sourceClass} from ${entry.parsed.finalUrl}`,
            compactSourcePayload({
              actor: entry.parsed.sourceClass === "entity_page" || entry.parsed.sourceClass === "official_site"
                ? "corroboration"
                : "anchor_extraction",
              title: "Structured extraction",
              sourceUrl: entry.parsed.finalUrl,
              sourceClass: entry.parsed.sourceClass,
              operation: "extract_start",
            }),
          ),
        );
        try {
          let kept: ExtractedEntityRow[] = [];
          let usage: UsageRecord;
          let traceOutput: unknown;

          const deterministic = await buildDeterministicGitHubRow(entry);
          if (deterministic) {
            this.assertRunActive(runId);
            kept = [deterministic.row];
            usage = usageRecord(runId, "fetch", "github", "extract_repo_metadata", 1, now() - startedAt, false, 0, 0, {
              url: entry.parsed.finalUrl,
              sourceClass: entry.parsed.sourceClass,
              repo: deterministic.metadata.fullName,
            });
            traceOutput = {
              canonicalName: deterministic.row.canonicalName,
              repoUrl: deterministic.metadata.htmlUrl,
              homepage: deterministic.metadata.homepage,
              stars: deterministic.metadata.stars,
              license: deterministic.metadata.license,
            };
          } else {
            const providerResult = await extractDocumentWithGemini(
              this.config,
              {
                query: thread.thread.queryRaw,
                entityType: thread.plan.entityType,
                criteria: thread.criteria.map((criterion) => ({
                  label: criterion.label,
                  kind: criterion.kind,
                })),
                columns: thread.columns.map((column) => ({
                  key: column.key,
                  label: column.label,
                  kind: column.kind,
                  valueType: column.valueType,
                })),
                url: entry.parsed.finalUrl,
                title: entry.parsed.title || entry.result.title,
                snippet: entry.parsed.description || entry.result.description,
                bodyText: entry.parsed.text,
              },
              entry.parsed.sourceClass,
              executionControl.requestControl(extractionTimeoutForSourceClass(entry.parsed.sourceClass)),
            );
            this.assertRunActive(runId);
            usage = usageRecord(runId, "llm", "gemini", "extract_candidate", 1, now() - startedAt, false, 0, 0, {
              backend: providerResult.meta.backend,
              model: providerResult.meta.model,
              sourceClass: entry.parsed.sourceClass,
              url: entry.parsed.finalUrl,
            });
            kept = providerResult.data.filter((row) => !isJunkExtraction(row, entry.parsed.finalUrl));
            traceOutput = kept.map((row) => ({
              canonicalName: row.canonicalName,
              candidateWebsite: row.candidateWebsite,
              followUpUrls: row.followUpUrls,
              cellCount: row.cells.length,
              criteriaCount: row.criteria.length,
            }));
          }

          this.store.addUsage(runId, usage);
          for (const row of kept) {
            extracted.push({
              ...row,
              sourceUrl: entry.parsed.finalUrl,
              sourceClass: entry.parsed.sourceClass,
            });
          }

          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "extraction",
              "completed",
              `${entry.parsed.sourceClass}: ${kept.length} ${kept.length === 1 ? "entity" : "entities"}`,
              compactSourcePayload({
                actor: entry.parsed.sourceClass === "entity_page" || entry.parsed.sourceClass === "official_site"
                  ? "corroboration"
                  : "anchor_extraction",
                title: "Structured extraction",
                sourceUrl: entry.parsed.finalUrl,
                sourceClass: entry.parsed.sourceClass,
                keptCount: kept.length,
                toolCalls: [
                  this.toolCallFromUsage(usage, "Extract anchors or grounded fields from the fetched page.", {
                    input: this.stringifyForTrace({
                      query: thread.thread.queryRaw,
                      url: entry.parsed.finalUrl,
                      sourceClass: entry.parsed.sourceClass,
                      title: entry.parsed.title || entry.result.title,
                    }),
                    output: this.stringifyForTrace(traceOutput),
                  }),
                ],
              }),
            ),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Structured extraction failed.";
          const failedUsage = usageRecord(runId, "llm", "gemini", "extract_candidate", 1, now() - startedAt, false, 0, 0, {
            sourceClass: entry.parsed.sourceClass,
            url: entry.parsed.finalUrl,
            failed: true,
            error: message,
          });
          this.store.addUsage(runId, failedUsage);
          if (this.shouldStop(runId)) {
            throw error;
          }
          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "extraction",
              "failed",
              `Structured extraction failed for ${entry.parsed.finalUrl}: ${message}`,
              compactSourcePayload({
                actor: entry.parsed.sourceClass === "entity_page" || entry.parsed.sourceClass === "official_site"
                  ? "corroboration"
                  : "anchor_extraction",
                title: "Structured extraction failed",
                sourceUrl: entry.parsed.finalUrl,
                sourceClass: entry.parsed.sourceClass,
                error: message,
                recoverable: true,
              }),
            ),
          );
          return;
        }
      });
      return extracted;
    };
    const extractWithinBudget = async (docs: FetchedDoc[], context: string): Promise<ExtractedEntityRow[]> => {
      const { allowedItems, skippedCount } = allocateExtractionBatch(extractionBudget, docs);
      if (skippedCount > 0) {
        this.store.addActivity(
          runId,
          stageEvent(
            runId,
            "extraction",
            "skipped",
            `Skipped ${skippedCount} sources (${context}).`,
            compactSourcePayload({
              actor: "extraction_budget",
              title: "Extraction budget guard",
              skippedSources: skippedCount,
              remainingBudget: extractionBudget.remainingCalls,
            }),
          ),
        );
      }
      if (allowedItems.length === 0) return [];
      return extractDocs(allowedItems);
    };

    await this.runStage(runId, "planning", executionControl, async () => {
      this.store.updateRun(runId, (current) => ({
        ...current,
        status: "running",
        stage: "planning",
        startedAt: current.startedAt ?? now(),
        progress: {
          ...current.progress,
          totalQueries: activeSearchQueries.length,
          totalRows: 0,
        },
      }));
      this.store.addActivity(
        runId,
        stageEvent(runId, "planning", "started", "Using the persisted structured plan for live search execution.", {
          actor: actorForStage("planning"),
          title: "Planning query",
          checkpoint: "plan persisted",
          entityType: thread.plan.entityType,
          searchQueries: activeSearchQueries.length,
          discoveryIntent,
        }),
      );
      await sleep(25);
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "discovery", executionControl, async () => {
      if (discoveryIntent === "project_repo" && activeSearchQueries.length > 0) {
        const githubSeedQuery = activeSearchQueries[0]!.text;
        const startedAt = now();
        try {
          const githubResults = await searchGitHubRepositories(
            githubSeedQuery,
            Math.min(6, discoverySearchResultLimit(this.config.searchResultsPerQuery, discoveryIntent)),
            executionControl.requestControl(),
          );
          this.assertRunActive(runId);
          const githubUsage = usageRecord(runId, "search", "github", "search_repo", 1, now() - startedAt, false, 0, 0, {
            query: githubSeedQuery,
            resultCount: githubResults.length,
          });
          this.store.addUsage(runId, githubUsage);
          this.store.updateRun(runId, (current) => ({
            ...current,
            stage: "discovery",
            metrics: {
              ...current.metrics,
              elapsedMs: current.startedAt ? now() - current.startedAt : current.metrics.elapsedMs,
            },
          }));
          this.store.addActivity(
            runId,
            stageEvent(runId, "discovery", "completed", `Issued GitHub repo search: ${githubSeedQuery}`, {
              actor: actorForStage("discovery"),
              title: "Discovering candidates",
              query: githubSeedQuery,
              provider: "github",
              results: githubResults.length,
              toolCalls: [
                this.toolCallFromUsage(githubUsage, "Search GitHub repositories for repo-like sources.", {
                  input: githubSeedQuery,
                  output: this.stringifyForTrace({
                    resultCount: githubResults.length,
                    topUrls: githubResults.slice(0, 5).map((entry) => this.normalizeUrl(entry.url)),
                  }),
                }),
              ],
            }),
          );

          for (const result of githubResults) {
            registerDiscoveredResult(result);
          }
        } catch (error) {
          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "discovery",
              "failed",
              error instanceof Error ? error.message : "GitHub repository search failed.",
              {
                actor: actorForStage("discovery"),
                title: "GitHub repository search failed",
                query: githubSeedQuery,
                provider: "github",
              },
            ),
          );
        }
      }

      await mapConcurrent(activeSearchQueries, searchConcurrency, async (query) => {
        this.assertRunActive(runId);
        const cacheKey = `search:${query.text}`;
        const cachedResults = this.cache.search.get(cacheKey) as BraveWebResult[] | undefined;
        const cacheUsage = usageRecord(runId, "cache", "kv_cache", "cache_lookup", 1, 3, Boolean(cachedResults), 0, 0, {
          key: cacheKey,
        });
        this.store.addUsage(runId, cacheUsage);

        const searchStartedAt = now();
        const searchResults = cachedResults
          ?? await searchBraveWeb(
            this.config.braveApiKey!,
            query,
            discoverySearchResultLimit(this.config.searchResultsPerQuery, discoveryIntent),
            executionControl.requestControl(),
          );
        this.assertRunActive(runId);
        const searchLatency = now() - searchStartedAt;

        if (!cachedResults) {
          this.cache.search.set(cacheKey, structuredClone(searchResults));
        }

        const searchUsage = cachedResults
          ? null
          : usageRecord(runId, "search", "brave", "search_query", 1, searchLatency, false, 0, 0, {
              query: query.text,
              resultCount: searchResults.length,
            });
        if (searchUsage) {
          this.store.addUsage(runId, searchUsage);
        }
        this.store.updateRun(runId, (current) => ({
          ...current,
          stage: "discovery",
          metrics: {
            ...current.metrics,
            elapsedMs: current.startedAt ? now() - current.startedAt : current.metrics.elapsedMs,
          },
          progress: {
            ...current.progress,
            queriesCompleted: Math.min(current.progress.totalQueries, current.progress.queriesCompleted + 1),
          },
        }));
        this.store.addActivity(
          runId,
          stageEvent(runId, "discovery", "completed", `Issued Brave search query: ${query.text}`, {
            actor: actorForStage("discovery"),
            title: "Discovering candidates",
            query: query.text,
            results: searchResults.length,
            cacheHit: Boolean(cachedResults),
            toolCalls: [
              this.toolCallFromUsage(searchUsage ?? cacheUsage, "Search for source pages for the current query.", {
                input: query.text,
                output: this.stringifyForTrace({
                  resultCount: searchResults.length,
                  topUrls: searchResults.slice(0, 5).map((entry) => this.normalizeUrl(entry.url)),
                }),
              }),
            ],
          }),
        );

        for (const result of searchResults) {
          registerDiscoveredResult(result);
        }
      });
    });
    if (this.shouldStop(runId)) return;
    if (executionControl.failIfWallClockExceeded()) return;

    await this.runStage(runId, "fetch", executionControl, async () => {
      const initialFetchLimit = computeFetchBatchSize({
        iteration: 0,
        targetResults: thread.thread.targetResults,
        currentRows: visibleGroundedRows().length,
        remainingExtractionCalls: extractionBudget.remainingCalls,
        maxSourcesPerRun: this.config.maxSourcesPerRun,
        intent: discoveryIntent,
      });
      const fetched = await fetchByUrls(selectNextDiscoveryUrls(initialFetchLimit), "discovery");
      fetchedDocs.push(...fetched);
    });
    if (this.shouldStop(runId)) return;
    if (executionControl.failIfWallClockExceeded()) return;

    await this.runStage(runId, "extraction", executionControl, async () => {
      const extracted = await extractWithinBudget(fetchedDocs, "initial extraction");
      processExtractedRows(extracted, fetchedDocs);
    });
    if (this.shouldStop(runId)) return;
    if (executionControl.failIfWallClockExceeded()) return;

    await this.runStage(runId, "evaluation", executionControl, async () => {
      this.store.addActivity(
        runId,
        stageEvent(runId, "evaluation", "completed", "Criteria are captured during extraction and merged per entity.", {
          actor: actorForStage("evaluation"),
          title: "Evaluating criteria",
          checkpoint: "criteria evaluated",
        }),
      );
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "canonicalization", executionControl, async () => {
      const rows = this.store.listRows(runId).filter((row) => row.duplicateOfRowId === null);
      const seen = new Map<string, string>();
      for (const row of rows) {
        const key = normalizeName(row.canonicalName) || this.normalizeUrl(row.canonicalUrl);
        if (seen.has(key)) {
          this.store.upsertRow(runId, {
            ...row,
            duplicateOfRowId: seen.get(key) ?? null,
          });
        } else {
          seen.set(key, row.id);
          rowIdByName.set(key, row.id);
        }
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "refinement", executionControl, async () => {
      let iteration = 1;
      let consecutiveNoGroundingIterations = 0;
      let broadDiscoveryMisses = 0;
      while (!this.shouldStop(runId) && hasExtractionBudgetRemaining(extractionBudget)) {
        if (executionControl.failIfWallClockExceeded()) return;
        const groundedCount = visibleGroundedRows().length;
        const pendingAnchors = [...anchorCandidates.values()].filter((anchor) => anchorNeedsCorroboration(anchor));
        const shouldGreedyStop = shouldStopGreedyRefinement({
          intent: discoveryIntent,
          groundedRows: groundedCount,
          targetResults: thread.thread.targetResults,
          pendingAnchors: pendingAnchors.length,
          consecutiveNoGroundingIterations,
          broadDiscoveryMisses,
        });
        if (shouldGreedyStop) {
          const stopReason = shouldStopExploration(groundedCount, thread.thread.targetResults)
            ? "grounded target reached"
            : discoveryIntent === "project_repo" && groundedCount > 0 && pendingAnchors.length === 0 && broadDiscoveryMisses >= 1
              ? "greedy stop after a no-yield discovery iteration"
              : "no new grounded rows after repeated refinement iterations";
          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "refinement",
              "completed",
              `Refinement stopped: ${stopReason}.`,
              compactSourcePayload({
                actor: "corroboration",
                title: "Refinement stop",
                groundedRows: groundedCount,
                pendingAnchors: pendingAnchors.length,
                consecutiveNoGroundingIterations,
                broadDiscoveryMisses,
                reason: stopReason,
              }),
            ),
          );
          break;
        }

        const fetchLimit = computeFetchBatchSize({
          iteration,
          targetResults: thread.thread.targetResults,
          currentRows: groundedCount,
          remainingExtractionCalls: extractionBudget.remainingCalls,
          maxSourcesPerRun: this.config.maxSourcesPerRun,
          pendingAnchors: pendingAnchors.length,
          preferFollowUps: pendingAnchors.length > 0,
          intent: discoveryIntent,
        });
        let targetUrls = selectedCorroborationUrls(fetchLimit);
        let mode: "discovery" | "corroboration" = "corroboration";

        if (targetUrls.length === 0 && pendingAnchors.length > 0) {
          await seedCorroborationSearches(Math.min(2, pendingAnchors.length));
          targetUrls = selectedCorroborationUrls(fetchLimit);
        }

        if (targetUrls.length === 0) {
          mode = "discovery";
          targetUrls = selectNextDiscoveryUrls(fetchLimit);
        }

        if (targetUrls.length === 0) {
          break;
        }

        const newFetched = await fetchByUrls(targetUrls, mode);
        if (newFetched.length === 0) {
          if (mode === "discovery") {
            broadDiscoveryMisses += 1;
          }
          consecutiveNoGroundingIterations += 1;
          iteration += 1;
          continue;
        }
        fetchedDocs.push(...newFetched);
        const groundedBefore = groundedCount;
        const extracted = await extractWithinBudget(newFetched, `${mode} iteration ${iteration}`);
        processExtractedRows(extracted, newFetched);
        const groundedAfter = visibleGroundedRows().length;
        const gainedGroundedRows = Math.max(0, groundedAfter - groundedBefore);
        if (gainedGroundedRows > 0) {
          consecutiveNoGroundingIterations = 0;
          broadDiscoveryMisses = 0;
        } else {
          consecutiveNoGroundingIterations += 1;
          if (mode === "discovery") {
            broadDiscoveryMisses += 1;
          }
        }
        iteration += 1;
      }

      if (this.config.enableSupervisorRefinement) {
        this.store.addActivity(
          runId,
          stageEvent(
            runId,
            "refinement",
            "skipped",
            "Supervisor experiment flag is enabled, but the simplified deterministic loop handled this run.",
            compactSourcePayload({
              actor: "corroboration",
              title: "Supervisor skipped",
            }),
          ),
        );
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "ranking", executionControl, async () => {
      const rankedRows = this.store
        .listRows(runId)
        .filter((row) => row.duplicateOfRowId === null)
        .map((row) => ({
          row,
          details: this.store.getRowDetails(runId, row.id),
        }))
        .sort((left, right) => right.row.score - left.row.score);

      let rank = 1;
      for (const entry of rankedRows) {
        const details = entry.details;
        const filledCount = details?.cells.filter((cell) => cell.state === "filled").length ?? 0;
        const avgCellConfidence = details && details.cells.length > 0
          ? details.cells.reduce((sum, cell) => sum + cell.confidence, 0) / details.cells.length
          : 0;
        const enrichedScore = Math.max(entry.row.score, Math.min(1, 0.6 * entry.row.score + 0.25 * avgCellConfidence + 0.15 * Math.min(1, filledCount / Math.max(1, thread.columns.length))));
        const finalStatus = deriveFinalStatus(
          entry.row,
          entry.details?.evaluations ?? [],
          thread.criteria,
          entry.details?.sources ?? [],
          {
            rejectConfidenceMin: DEFAULT_REJECT_CONFIDENCE_MIN,
            acceptConfidenceMin: DEFAULT_ACCEPT_CONFIDENCE_MIN,
          },
        );
        const finalized: ResultRow = {
          ...entry.row,
          status: finalStatus,
          processingState: "finalized",
          score: enrichedScore,
          rank: finalStatus === "rejected" ? null : rank,
          lineage: this.withGroundedLineage(runId, entry.row),
        };
        if (finalStatus !== "rejected") rank += 1;
        this.store.upsertRow(runId, finalized);
      }

      this.store.addActivity(
        runId,
        stageEvent(runId, "ranking", "completed", "Committed final ranking and unmatched partition for the live run.", {
          actor: actorForStage("ranking"),
          title: "Ranking and partitioning rows",
          checkpoint: "final ranking committed",
          rows: rankedRows.length,
        }),
      );
      await sleep(20);
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "export", executionControl, async () => {
      this.exportRun(runId, "json");
      this.exportRun(runId, "csv");
      this.store.addActivity(
        runId,
        stageEvent(runId, "export", "completed", "Prepared JSON and CSV exports for accepted live rows.", {
          actor: actorForStage("export"),
          title: "Packaging exports",
          checkpoint: "final ranking committed",
        }),
      );
      await sleep(20);
    });
    if (this.shouldStop(runId)) return;

    this.store.updateRun(runId, (current) => ({
      ...current,
      status: "complete",
      stage: "export",
      finishedAt: now(),
      metrics: {
        ...current.metrics,
        elapsedMs: current.startedAt ? now() - current.startedAt : current.metrics.elapsedMs,
      },
    }));
  }

  private cleanTitle(title: string): string {
    return title
      .replace(/\s+[|\-–:]\s+.*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private ensureHttpUrl(value: string): string {
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value.replace(/^\/+/, "")}`;
  }

  private normalizeUrl(value: string): string {
    try {
      const parsed = new URL(this.ensureHttpUrl(value));
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return this.ensureHttpUrl(value);
    }
  }

  private withGroundedLineage(runId: string, row: ResultRow): ResultRow["lineage"] {
    const details = this.store.getRowDetails(runId, row.id);
    const groundedBySourceIds = details
      ? [...new Set(details.evidence.map((evidence) => evidence.sourceDocumentId))]
      : row.lineage.groundedBySourceIds;
    const sourceOriginClass =
      details?.sources[0]
        ? classifySourceOrigin(details.sources[0].url, details.sources[0].title)
        : row.lineage.sourceOriginClass;

    return {
      suggestedBySourceIds: row.lineage.suggestedBySourceIds,
      groundedBySourceIds,
      sourceOriginClass,
    };
  }

  private async runStage(
    runId: string,
    stage: ActivityStage,
    executionControl: RunExecutionControl,
    work: () => Promise<void>,
  ): Promise<void> {
    const currentRun = this.store.getRun(runId);
    if (!currentRun || currentRun.status === "canceled" || currentRun.status === "failed") {
      return;
    }
    const stageCheckpoint = checkpointForStage(stage);
    this.assertRunActive(runId);
    const updatedRun = this.store.updateRun(runId, (run) => {
      const startedAt = run.startedAt ?? now();
      return {
        ...run,
        status: "running",
        stage,
        startedAt,
        metrics: {
          ...run.metrics,
          elapsedMs: Math.max(run.metrics.elapsedMs, now() - startedAt),
        },
      };
    });
    if (updatedRun?.startedAt) {
      executionControl.armDeadline(updatedRun.startedAt);
    }
    this.store.addActivity(
      runId,
      stageEvent(runId, stage, "started", `${stage} started.`, {
        actor: actorForStage(stage),
        title: titleForStage(stage),
        checkpoint: stageCheckpoint,
      }),
    );
    const stageStart = now();
    try {
      await work();
      this.store.setRunStageDuration(runId, stage, now() - stageStart);
      const terminalStatus = this.store.getRun(runId)?.status;
      if (terminalStatus === "canceled" || terminalStatus === "failed") return;
      this.store.updateRun(runId, (run) => ({
        ...run,
        metrics: {
          ...run.metrics,
          elapsedMs: run.startedAt ? now() - run.startedAt : run.metrics.elapsedMs,
        },
      }));
      this.store.addActivity(
        runId,
        stageEvent(runId, stage, "completed", `${stage} completed.`, {
          actor: actorForStage(stage),
          title: titleForStage(stage),
          checkpoint: stageCheckpoint,
        }),
      );
    } catch (error) {
      if (this.store.getRun(runId)?.status === "canceled") return;
      if (this.store.getRun(runId)?.status === "failed") return;
      const message = error instanceof Error ? error.message : "Unexpected run failure";
      this.store.setRunStageDuration(runId, stage, now() - stageStart);
      this.store.addActivity(
        runId,
        stageEvent(runId, stage, "failed", message, {
          actor: actorForStage(stage),
          title: titleForStage(stage),
          checkpoint: stageCheckpoint,
        }),
      );
      this.store.updateRun(runId, (run) => ({
        ...run,
        status: "failed",
        stage,
        finishedAt: now(),
        errorCode: "runtime_failure",
        errorMessage: message,
        metrics: {
          ...run.metrics,
          elapsedMs: run.startedAt ? now() - run.startedAt : run.metrics.elapsedMs,
        },
      }));
      this.markNonTerminalRowsFailed(runId);
      throw error;
    }
  }

  private markNonTerminalRowsFailed(runId: string): void {
    for (const row of this.store.listRows(runId)) {
      if (row.processingState === "finalized" || row.processingState === "failed") continue;
      this.store.upsertRow(runId, {
        ...row,
        processingState: "failed",
      });
    }
  }

  private wallClockExceededMessage(): string {
    return `Run exceeded maximum wall time (${Math.round(this.config.maxRunWallClockMs / 60_000)} min).`;
  }

  private createRunExecutionControl(runId: string): RunExecutionControl {
    const controller = new AbortController();
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const abort = (message: string) => {
      if (!controller.signal.aborted) {
        controller.abort(createAbortError(message));
      }
    };
    const clearDeadline = () => {
      if (!deadlineTimer) return;
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
    };
    return {
      requestControl: (timeoutMs = this.config.requestTimeoutMs) => {
        this.assertRunActive(runId);
        return {
          signal: controller.signal,
          timeoutMs,
        };
      },
      armDeadline: (startedAt: number) => {
        if (this.config.maxRunWallClockMs <= 0 || deadlineTimer) return;
        const remainingMs = Math.max(0, startedAt + this.config.maxRunWallClockMs - now());
        deadlineTimer = setTimeout(() => {
          const message = this.wallClockExceededMessage();
          if (this.failRunForWallClockExceeded(runId)) {
            abort(message);
          }
        }, remainingMs);
      },
      dispose: () => {
        clearDeadline();
      },
      failIfWallClockExceeded: () => {
        if (this.config.maxRunWallClockMs <= 0) return false;
        const run = this.store.getRun(runId);
        if (!run?.startedAt) return false;
        if (now() - run.startedAt <= this.config.maxRunWallClockMs) return false;
        const message = this.wallClockExceededMessage();
        const failed = this.failRunForWallClockExceeded(runId);
        if (failed) {
          abort(message);
        }
        return failed;
      },
    };
  }

  private failRunForWallClockExceeded(runId: string): boolean {
    const run = this.store.getRun(runId);
    if (!run?.startedAt) return false;
    if (run.status === "failed" && run.errorCode === "wall_clock_exceeded") return true;
    if (run.status === "complete" || run.status === "canceled" || run.status === "failed") return false;

    const stage = (run.stage === "idle" ? "planning" : run.stage) as ActivityStage;
    const message = this.wallClockExceededMessage();
    this.store.updateRun(runId, (current) => ({
      ...current,
      status: "failed",
      finishedAt: now(),
      errorCode: "wall_clock_exceeded",
      errorMessage: message,
      metrics: {
        ...current.metrics,
        elapsedMs: current.startedAt ? now() - current.startedAt : current.metrics.elapsedMs,
      },
    }));
    this.markNonTerminalRowsFailed(runId);
    this.store.addActivity(
      runId,
      stageEvent(runId, stage, "failed", message, {
        actor: "runtime",
        title: "Wall clock limit",
        checkpoint: "run terminated",
      }),
    );
    return true;
  }

  private createEvidenceFromSource(
    runId: string,
    rowId: string,
    sourceId: string,
    input: {
      kind: Evidence["kind"];
      text: string;
      columnKey: string;
    },
  ): Evidence | null {
    const source = this.store.getSource(runId, sourceId);
    if (!source) {
      return null;
    }
    const evidence: Evidence = {
      id: makeId("ev"),
      sourceDocumentId: sourceId,
      kind: input.kind,
      locatorJson: {
        rowId,
        columnKey: input.columnKey,
      },
      text: input.text,
      normalizedText: input.text.toLowerCase(),
      extractionMethod: shouldUseLiveProviders(this.config) ? "live_runtime" : "fixture",
      confidence: 0.88,
    };
    this.store.addEvidence(runId, rowId, evidence);
    return evidence;
  }

  private assertRunActive(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run) {
      throw new Error("Run canceled");
    }
    if (run.status === "canceled") throw new Error("Run canceled");
    if (run.status === "failed") throw new Error(run.errorMessage ?? "Run failed");
  }

  private shouldStop(runId: string): boolean {
    const run = this.store.getRun(runId);
    return !run || run.status === "canceled" || run.status === "failed";
  }

  private toolCallFromUsage(
    usage: UsageRecord,
    summary: string,
    extra: {
      input?: string;
      output?: string;
    } = {},
  ): TraceToolCall {
    return {
      name: usage.operation,
      summary,
      input: extra.input,
      output: extra.output,
      latencyMs: usage.latencyMs,
      costUsd: usage.estimatedCostUsd,
      cacheHit: usage.cacheHit,
    };
  }

  private truncateForTrace(value: string, limit = 1200): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}…`;
  }

  private stringifyForTrace(value: unknown, limit = 1200): string {
    if (typeof value === "string") return this.truncateForTrace(value, limit);
    try {
      return this.truncateForTrace(JSON.stringify(value, null, 2), limit);
    } catch {
      return this.truncateForTrace(String(value), limit);
    }
  }

  private computeRewardSignals(runId: string, targetResults: number): Array<{
    label: string;
    value: string;
    hint?: string;
  }> {
    const rows = this.store.listRows(runId);
    const cells = this.store.listCells(runId);
    const finalizedRows = rows.filter((row) => row.processingState === "finalized");
    const accepted = finalizedRows.filter((row) => row.status === "accepted").length;
    const rejected = finalizedRows.filter((row) => row.status === "rejected").length;
    const uncertain = finalizedRows.filter((row) => row.status === "uncertain").length;
    const conflict = finalizedRows.filter((row) => row.status === "conflict").length;
    const resolvedCells = cells.filter((cell) => cell.state !== "pending");
    const filledCells = resolvedCells.filter((cell) => cell.state === "filled");
    const blankCells = resolvedCells.filter(
      (cell) => cell.state === "not_found" || cell.state === "unsupported",
    );
    const weakCells = resolvedCells.filter(
      (cell) => cell.state === "uncertain" || cell.state === "conflict",
    );
    const groundedCellRate =
      resolvedCells.length > 0 ? (filledCells.length / resolvedCells.length) * 100 : 0;
    const abstentionRate =
      resolvedCells.length > 0 ? (blankCells.length / resolvedCells.length) * 100 : 0;
    const weakRate = resolvedCells.length > 0 ? (weakCells.length / resolvedCells.length) * 100 : 0;
    const targetCoverage = targetResults > 0 ? (accepted / targetResults) * 100 : 0;
    const selectivity =
      finalizedRows.length > 0 ? (rejected / finalizedRows.length) * 100 : 0;
    const unresolvedShare =
      finalizedRows.length > 0 ? ((uncertain + conflict) / finalizedRows.length) * 100 : 0;

    return [
      { label: "grounded_cell_rate", value: `${groundedCellRate.toFixed(0)}%`, hint: "Filled cells over all resolved cells." },
      { label: "abstention_rate", value: `${abstentionRate.toFixed(0)}%`, hint: "Explicit not_found or unsupported cells." },
      { label: "weak_state_rate", value: `${weakRate.toFixed(0)}%`, hint: "Uncertain or conflict cells that still need judgment." },
      { label: "target_coverage", value: `${targetCoverage.toFixed(0)}%`, hint: "Accepted rows against the target result count." },
      { label: "selectivity", value: `${selectivity.toFixed(0)}%`, hint: "Rejected rows as a share of finalized candidates." },
      { label: "unresolved_share", value: `${unresolvedShare.toFixed(0)}%`, hint: "Uncertain plus conflict rows over finalized candidates." },
    ];
  }
}

declare global {
  var __agenticSearchRuntime: AgenticSearchRuntime | undefined;
}

export function getRuntime(env?: RuntimeEnvLike): AgenticSearchRuntime {
  if (!globalThis.__agenticSearchRuntime) {
    globalThis.__agenticSearchRuntime = new AgenticSearchRuntime(env);
  } else if (env) {
    globalThis.__agenticSearchRuntime.configure(env);
  }
  return globalThis.__agenticSearchRuntime;
}
