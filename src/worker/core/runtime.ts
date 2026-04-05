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
  SearchQuery,
  SourceDocument,
  Evidence,
  ThreadDetailsResponse,
  ThreadsListResponse,
  UpdateThreadConfigRequest,
  UsageRecord,
} from "../../lib/contracts";
import { buildThreadBundle, previewQuery, rebuildThreadBundle } from "../domain/planner";
import { findScenario } from "../fixtures/scenarios";
import {
  hasLiveProviders,
  resolveRuntimeConfig,
  shouldUseLiveProviders,
  type RuntimeConfig,
  type RuntimeEnvLike,
} from "./config";
import { searchBraveWeb, type BraveWebResult } from "../providers/brave";
import {
  extractDocumentWithGemini,
  planWithGemini,
  rewriteQueries,
  supervisorDecide,
  isJunkExtraction,
  verifyWithGemini,
} from "../providers/gemini";
import { fetchAndParseDocument } from "../providers/fetch";
import { dedupeAndMerge, normalizeName, type ExtractedEntityRow } from "../domain/dedup";
import { estimateOperationCost } from "../providers/price-catalog";
import { MemoryResearchStore, emptyMetrics, emptyProgress } from "../storage/memory-store";
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

export class AgenticSearchRuntime {
  private readonly store = new MemoryResearchStore();
  private readonly inflightRuns = new Map<string, Promise<void>>();
  private config: RuntimeConfig;
  private readonly cache: RuntimeCache = {
    preview: new Map(),
    search: new Map(),
    pages: new Map(),
  };

  constructor(env?: RuntimeEnvLike) {
    this.config = resolveRuntimeConfig(env);
  }

  configure(env?: RuntimeEnvLike): void {
    this.config = resolveRuntimeConfig(env);
  }

  listThreads(): ThreadsListResponse {
    return { threads: this.store.listThreadSnapshots() };
  }

  getThread(threadId: string): ThreadDetailsResponse | null {
    return this.store.getThreadSnapshot(threadId);
  }

  async preview(input: PreviewRequest): Promise<PreviewResponse> {
    const cacheKey = `${input.query.trim().toLowerCase()}:${input.targetResults}`;
    const cached = this.cache.preview.get(cacheKey);
    if (cached) return structuredClone(cached);
    const response = shouldUseLiveProviders(this.config)
      ? await (async () => {
          const timeoutMs = Math.min(this.config.requestTimeoutMs, 2500);
          const timeoutPromise = new Promise<PreviewResponse>((_, reject) => {
            setTimeout(() => reject(new Error(`Planner timeout after ${timeoutMs}ms.`)), timeoutMs);
          });
          const livePromise = planWithGemini(this.config, input).then((result) => result.data);
          return await Promise.race([livePromise, timeoutPromise]);
        })()
      : previewQuery(input);
    this.cache.preview.set(cacheKey, structuredClone(response));
    return response;
  }

  createThread(input: CreateThreadRequest): CreateThreadResponse {
    const bundle = buildThreadBundle(input);
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
    return this.store.cancelRun(runId);
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
    const promise = this.executeRun(runId)
      .catch(() => {
        // `runStage` already records terminal failure state; swallow here so the local dev server
        // does not crash on an unhandled rejection while background work is still observable in-app.
      })
      .finally(() => {
        this.inflightRuns.delete(runId);
      });
    this.inflightRuns.set(runId, promise);
  }

  private async executeRun(runId: string): Promise<void> {
    if (shouldUseLiveProviders(this.config)) {
      await this.executeLiveRun(runId);
      return;
    }

    const run = this.store.getRun(runId);
    if (!run) return;
    const thread = this.store.getThreadSnapshot(run.threadId);
    if (!thread) return;
    const scenario = findScenario(thread.thread.queryRaw);
    const criteriaByLabel = new Map(thread.criteria.map((criterion) => [criterion.label, criterion]));

    await this.runStage(runId, "planning", async () => {
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

    await this.runStage(runId, "discovery", async () => {
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

    await this.runStage(runId, "fetch", async () => {
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

    await this.runStage(runId, "extraction", async () => {
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

    await this.runStage(runId, "evaluation", async () => {
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

    await this.runStage(runId, "canonicalization", async () => {
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

    await this.runStage(runId, "verification", async () => {
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

    await this.runStage(runId, "ranking", async () => {
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

    await this.runStage(runId, "export", async () => {
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

  private async executeLiveRun(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) return;
    const thread = this.store.getThreadSnapshot(run.threadId);
    if (!thread) return;

    const criteriaByLabel = new Map(thread.criteria.map((criterion) => [criterion.label, criterion]));
    const discovered: BraveWebResult[] = [];
    const fetchedDocs: Array<{ result: BraveWebResult; parsed: Awaited<ReturnType<typeof fetchAndParseDocument>> }> = [];
    const failedUrls = new Set<string>();
    const discoveredRowIdByUrl = new Map<string, string>();
    const prunedSourceUrls = new Set<string>();
    const prunedSourceSummaries = new Map<string, string>();

    await this.runStage(runId, "planning", async () => {
      this.store.updateRun(runId, (current) => ({
        ...current,
        status: "running",
        stage: "planning",
        startedAt: current.startedAt ?? now(),
        progress: {
          ...current.progress,
          totalQueries: thread.plan.searchQueries.length,
          totalRows: 0,
        },
      }));
      this.store.addActivity(
        runId,
        stageEvent(runId, "planning", "started", "Using the persisted structured plan for live search execution.", {
          actor: actorForStage("planning"),
          title: "Planning query",
          checkpoint: "plan persisted",
          reasoning:
            "The preview plan is already persisted, so the run starts from an explicit set of filters, columns, search queries, and budgets instead of re-planning blindly.",
          rewards: [
            { label: "entity_type", value: thread.plan.entityType },
            { label: "search_queries", value: String(thread.plan.searchQueries.length) },
          ],
        }),
      );
      await sleep(25);
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "discovery", async () => {
      const seenUrls = new Set<string>();
      let discoveryBudget = Math.min(this.config.maxSourcesPerRun, Math.max(thread.thread.targetResults + 4, 6));
      for (const query of thread.plan.searchQueries) {
        if (discoveryBudget <= 0) break;
        this.assertRunActive(runId);
        const cacheKey = `search:${query.text}`;
        const cachedResults = this.cache.search.get(cacheKey) as BraveWebResult[] | undefined;
        const cacheUsage = usageRecord(runId, "cache", "kv_cache", "cache_lookup", 1, 3, Boolean(cachedResults), 0, 0, {
          key: cacheKey,
        });
        this.store.addUsage(runId, cacheUsage);

        const searchStartedAt = now();
        const searchResults = cachedResults
          ?? await searchBraveWeb(this.config.braveApiKey!, query, this.config.searchResultsPerQuery);
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
          stageEvent(runId, "discovery", "started", `Issued Brave search query: ${query.text}`, {
            actor: actorForStage("discovery"),
            title: "Discovering candidates",
            checkpoint: "candidate rows created",
            reasoning:
              "Discovery stays broad. We would rather over-retrieve candidate documents here and let extraction plus verification narrow the table later.",
            toolCalls: [
              this.toolCallFromUsage(cacheUsage, "Check whether this search query was already cached.", {
                input: cacheKey,
                output: cachedResults ? "cache hit" : "cache miss",
              }),
              ...(searchUsage
                ? [
                    this.toolCallFromUsage(searchUsage, "Search the live web for candidate documents.", {
                      input: query.text,
                      output: `${searchResults.length} results`,
                    }),
                  ]
                : []),
            ],
          }),
        );

        for (const result of searchResults) {
          if (discoveryBudget <= 0) break;
          const normalizedUrl = this.normalizeUrl(result.url);
          if (failedUrls.has(normalizedUrl) || prunedSourceUrls.has(normalizedUrl)) continue;
          if (seenUrls.has(normalizedUrl)) continue;
          seenUrls.add(normalizedUrl);
          discoveryBudget -= 1;
          discovered.push({
            ...result,
            url: normalizedUrl,
          });
          const provisionalRowId = makeId("row");
          discoveredRowIdByUrl.set(normalizedUrl, provisionalRowId);
          this.store.upsertRow(runId, {
            id: provisionalRowId,
            runId,
            canonicalName: this.cleanTitle(result.title),
              canonicalUrl: normalizedUrl,
              entityType: thread.plan.entityType,
              status: "uncertain",
              statusReasonCode: null,
              statusReasonSummary: null,
              processingState: "pending",
            score: 0.2,
            rank: null,
            sourceCount: 0,
            duplicateOfRowId: null,
            lineage: {
              ...emptyLineage(classifySourceOrigin(normalizedUrl, result.title)),
            },
          });
          for (const column of thread.columns) {
            this.store.upsertCell(runId, {
              id: `${provisionalRowId}:${column.key}`,
              rowId: provisionalRowId,
              columnKey: column.key,
              valueText: null,
              valueJson: null,
              state: "pending",
              confidence: 0,
              reasonCode: null,
              primaryEvidenceId: null,
            });
          }
        }
      }
    });
    if (this.shouldStop(runId)) return;
    if (this.failRunIfWallClockExceeded(runId)) return;

    const fetchByUrls = async (urls: string[]): Promise<Array<{ result: BraveWebResult; parsed: Awaited<ReturnType<typeof fetchAndParseDocument>> }>> => {
      const nextFetched: Array<{ result: BraveWebResult; parsed: Awaited<ReturnType<typeof fetchAndParseDocument>> }> = [];
      const byUrl = new Map(discovered.map((result) => [this.normalizeUrl(result.url), result]));
      for (const url of urls) {
        if (this.failRunIfWallClockExceeded(runId)) return nextFetched;
        this.assertRunActive(runId);
        const normalizedUrl = this.normalizeUrl(url);
        if (failedUrls.has(normalizedUrl)) continue;
        if (fetchedDocs.some((entry) => this.normalizeUrl(entry.result.url) === normalizedUrl)) continue;
        const result = byUrl.get(normalizedUrl) ?? {
          title: normalizedUrl,
          url: normalizedUrl,
          description: "",
          age: "",
        };

        const provisionalRowId = discoveredRowIdByUrl.get(normalizedUrl);
        if (provisionalRowId) {
          const existingRow = this.store.getRow(runId, provisionalRowId);
          if (existingRow) {
            this.store.upsertRow(runId, { ...existingRow, processingState: "fetching" });
          }
        }

        try {
          const fetchStartedAt = now();
          const parsed = await fetchAndParseDocument(normalizedUrl, this.config.fetchTextCharLimit, {
            jinaApiKey: this.config.jinaApiKey,
            entityType: thread.plan.entityType,
          });
          const fetchLatency = now() - fetchStartedAt;
          const usage = usageRecord(runId, "fetch", "http_fetch", "fetch_source", 1, fetchLatency, false, 0, 0, {
            url: parsed.finalUrl,
            sourceClass: parsed.sourceClass,
          });
          this.store.addUsage(runId, usage);
          const pruneDecision = classifySourceScopeDecision(
            thread.thread.queryRaw,
            {
              title: parsed.title || result.title || "",
              snippet: parsed.description || result.description || "",
            },
            this.normalizeUrl(parsed.finalUrl),
          );
          if (pruneDecision.eligibility === "out_of_scope_hard") {
            if (pruneDecision.pruneKey) {
              prunedSourceUrls.add(pruneDecision.pruneKey);
              if (pruneDecision.reasonSummary) {
                prunedSourceSummaries.set(pruneDecision.pruneKey, pruneDecision.reasonSummary);
              }
            }
            failedUrls.add(normalizedUrl);
            if (pruneDecision.pruneKey) failedUrls.add(pruneDecision.pruneKey);
            if (provisionalRowId) {
              const existingRow = this.store.getRow(runId, provisionalRowId);
              if (existingRow) {
                this.store.upsertRow(runId, {
                  ...existingRow,
                  canonicalUrl: pruneDecision.pruneKey ?? existingRow.canonicalUrl,
                  status: "rejected",
                  statusReasonCode: pruneDecision.reasonCode,
                  statusReasonSummary: pruneDecision.reasonSummary,
                  processingState: "finalized",
                  score: 0.05,
                });
              }
            }
            this.store.addActivity(
              runId,
              stageEvent(
                runId,
                "fetch",
                "skipped",
                `Pruned out-of-scope source: ${parsed.title || parsed.finalUrl}`,
                {
                  actor: actorForStage("fetch"),
                  title: "Source scope gate",
                  checkpoint: "sources fetched",
                  reason: pruneDecision.reasonCode ?? "out_of_scope_hard",
                  reasoning: pruneDecision.reasonSummary ?? undefined,
                  sourceUrl: pruneDecision.pruneKey ?? this.normalizeUrl(parsed.finalUrl),
                },
              ),
            );
            continue;
          }

          nextFetched.push({ result, parsed });

          const finalNorm = this.normalizeUrl(parsed.finalUrl);
          if (provisionalRowId) {
            discoveredRowIdByUrl.set(finalNorm, provisionalRowId);
          }

          const shortDomain = (() => { try { return new URL(parsed.finalUrl).hostname; } catch { return normalizedUrl; } })();
          this.store.addActivity(
            runId,
            stageEvent(runId, "fetch", "completed", `Fetched ${shortDomain} (${parsed.sourceClass})`, {
              actor: actorForStage("fetch"),
              title: `Reading ${parsed.title || shortDomain}`,
              checkpoint: "sources fetched",
              toolCalls: [
                this.toolCallFromUsage(usage, "Fetch and classify source page.", {
                  input: normalizedUrl,
                  output: `${parsed.sourceClass} · ${(parsed.text?.length ?? 0).toLocaleString()} chars`,
                }),
              ],
            }),
          );
        } catch (error) {
          failedUrls.add(normalizedUrl);
          if (provisionalRowId) {
            const existingRow = this.store.getRow(runId, provisionalRowId);
            if (existingRow) {
              this.store.upsertRow(runId, { ...existingRow, processingState: "failed" });
            }
          }
          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "fetch",
              "failed",
              error instanceof Error ? error.message : `Failed to fetch ${normalizedUrl}`,
              {
                actor: actorForStage("fetch"),
                title: "Fetching source document",
                checkpoint: "sources fetched",
              },
            ),
          );
        }

        this.store.updateRun(runId, (current) => ({
          ...current,
          progress: {
            ...current.progress,
            sourcesFetched: fetchedDocs.length + nextFetched.length,
          },
        }));
      }
      return nextFetched;
    };

    await this.runStage(runId, "fetch", async () => {
      const fetched = await fetchByUrls(discovered.slice(0, this.config.maxSourcesPerRun).map((result) => result.url));
      fetchedDocs.push(...fetched);
    });
    if (this.shouldStop(runId)) return;
    if (this.failRunIfWallClockExceeded(runId)) return;

    const extractFromFetched = async (
      docs: Array<{ result: BraveWebResult; parsed: Awaited<ReturnType<typeof fetchAndParseDocument>> }>,
    ): Promise<ExtractedEntityRow[]> => {
      const extracted: ExtractedEntityRow[] = [];
      for (const entry of docs) {
        if (this.failRunIfWallClockExceeded(runId)) return extracted;
        const normalizedUrl = this.normalizeUrl(entry.parsed.finalUrl);
        const provisionalRowId = discoveredRowIdByUrl.get(normalizedUrl);
        if (provisionalRowId) {
          const existingRow = this.store.getRow(runId, provisionalRowId);
          if (existingRow) {
            this.store.upsertRow(runId, { ...existingRow, processingState: "extracting" });
          }
        }

        const startedAt = now();
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
        );
        const extractLatency = now() - startedAt;
        const usage = usageRecord(runId, "llm", "gemini", "extract_candidate", 1, extractLatency, false, 0, 0, {
          backend: providerResult.meta.backend,
          model: providerResult.meta.model,
          sourceClass: entry.parsed.sourceClass,
          url: entry.parsed.finalUrl,
        });
        this.store.addUsage(runId, usage);

        let keptCount = 0;
        for (const row of providerResult.data) {
          if (isJunkExtraction(row, entry.parsed.finalUrl)) continue;
          keptCount += 1;
          extracted.push({
            ...row,
            sourceUrl: entry.parsed.finalUrl,
            sourceClass: entry.parsed.sourceClass,
          });
        }

        const shortDomain = (() => { try { return new URL(entry.parsed.finalUrl).hostname; } catch { return normalizedUrl; } })();
        const entityNames = providerResult.data
          .filter((row) => !isJunkExtraction(row, entry.parsed.finalUrl))
          .map((row) => row.canonicalName)
          .slice(0, 5);
        this.store.addActivity(
          runId,
          stageEvent(
            runId,
            "extraction",
            "completed",
            keptCount > 0
              ? `Extracted ${keptCount} entit${keptCount === 1 ? "y" : "ies"} from ${shortDomain}: ${entityNames.join(", ")}`
              : `No entities extracted from ${shortDomain}`,
            {
              actor: actorForStage("extraction"),
              title: `Extracting from ${entry.parsed.title || shortDomain}`,
              checkpoint: "entities extracted",
              toolCalls: [
                this.toolCallFromUsage(usage, "LLM structured extraction.", {
                  input: `${entry.parsed.sourceClass} · ${entry.parsed.finalUrl}`,
                  output: `${keptCount} entities kept (${providerResult.data.length} raw)`,
                }),
              ],
            },
          ),
        );
      }
      return extracted;
    };

    const upsertMergedRows = (
      mergedRows: ExtractedEntityRow[],
      docs: Array<{ result: BraveWebResult; parsed: Awaited<ReturnType<typeof fetchAndParseDocument>> }>,
    ): void => {
      const docsByUrl = new Map(docs.map((entry) => [this.normalizeUrl(entry.parsed.finalUrl), entry]));
      const rows = this.store.listRows(runId).filter((row) => !row.duplicateOfRowId);
      const rowIdByName = new Map<string, string>();
      for (const row of rows) {
        const key = normalizeName(row.canonicalName);
        if (key) rowIdByName.set(key, row.id);
      }

      for (const merged of mergedRows) {
        const normalizedName = normalizeName(merged.canonicalName);
        if (!normalizedName) continue;
        const existingRowId = rowIdByName.get(normalizedName);
        const rowId = existingRowId ?? discoveredRowIdByUrl.get(this.normalizeUrl(merged.sourceUrl)) ?? makeId("row");
        rowIdByName.set(normalizedName, rowId);
        const sourceEntry = docsByUrl.get(this.normalizeUrl(merged.sourceUrl));
        const sourceDoc: SourceDocument = {
          id: makeId("src"),
          runId,
          url: sourceEntry?.parsed.finalUrl ?? merged.sourceUrl,
          normalizedUrl: this.normalizeUrl(sourceEntry?.parsed.finalUrl ?? merged.sourceUrl),
          domain: (() => {
            try {
              return new URL(sourceEntry?.parsed.finalUrl ?? merged.sourceUrl).hostname;
            } catch {
              return "unknown";
            }
          })(),
          title: sourceEntry?.parsed.title ?? merged.canonicalName,
          fetchedAt: now(),
          fetchStatus: 200,
          contentType: "text/html",
          contentHash: `${this.normalizeUrl(sourceEntry?.parsed.finalUrl ?? merged.sourceUrl)}:${(sourceEntry?.parsed.text ?? "").length}`,
          trustTier: merged.sourceClass === "directory" ? "primary_structured" : "reputable_secondary",
          cacheKey: `page:${this.normalizeUrl(sourceEntry?.parsed.finalUrl ?? merged.sourceUrl)}`,
          blobRef: null,
          snippet: sourceEntry?.parsed.description ?? sourceEntry?.result.description ?? "",
          favicon: sourceEntry
            ? `https://www.google.com/s2/favicons?domain=${new URL(sourceEntry.parsed.finalUrl).hostname}&sz=16`
            : null,
        };
        const existing = this.store.getRow(runId, rowId);
        const terminalProcessing =
          existing?.processingState === "verifying"
          || existing?.processingState === "finalized"
          || existing?.processingState === "failed";
        const nextProcessingState = terminalProcessing
          ? (existing?.processingState ?? "pending")
          : "refining";

        this.store.upsertRow(runId, {
          id: rowId,
          runId,
          canonicalName: merged.canonicalName,
          canonicalUrl: this.ensureHttpUrl(merged.canonicalUrl),
          entityType: thread.plan.entityType,
          status: merged.rowStatus,
          statusReasonCode: null,
          statusReasonSummary: null,
          processingState: nextProcessingState,
          score: merged.score,
          rank: existing?.rank ?? null,
          sourceCount: Math.max(existing?.sourceCount ?? 0, 1),
          duplicateOfRowId: existing?.duplicateOfRowId ?? null,
          lineage: {
            suggestedBySourceIds: existing?.lineage.suggestedBySourceIds?.length
              ? existing.lineage.suggestedBySourceIds
              : [sourceDoc.id],
            groundedBySourceIds: existing?.lineage.groundedBySourceIds ?? [],
            sourceOriginClass: classifySourceOrigin(sourceDoc.url, sourceDoc.title),
          },
        });
        this.store.addSource(runId, rowId, sourceDoc);

        for (const column of thread.columns) {
          const extractedCell = merged.cells.find((cell) => cell.key === column.key);
          const valueText = column.key === "evidence_count"
            ? "1"
            : extractedCell?.valueText ?? null;
          const state: CellState = column.key === "evidence_count"
            ? "filled"
            : extractedCell?.state ?? "unsupported";
          const evidenceText = column.key === "evidence_count"
            ? "Resolved against 1 fetched source document."
            : extractedCell?.evidenceText ?? null;
          const evidence = evidenceText
            ? this.createEvidenceFromSource(runId, rowId, sourceDoc.id, {
              kind: "inferred_summary",
              text: evidenceText,
              columnKey: column.key,
            })
            : null;
          this.store.upsertCell(runId, {
            id: `${rowId}:${column.key}`,
            rowId,
            columnKey: column.key,
            valueText,
            valueJson: null,
            state,
            confidence: extractedCell?.confidence ?? (column.key === "evidence_count" ? 1 : 0.2),
            reasonCode: extractedCell?.reasonCode ?? (state === "unsupported" ? "model_omitted_field" : null),
            primaryEvidenceId: evidence?.id ?? null,
          });
        }

        for (const criterion of thread.criteria) {
          const extracted = merged.criteria.find((entry) => entry.label === criterion.label);
          const evidence = extracted?.evidenceText
            ? this.createEvidenceFromSource(runId, rowId, sourceDoc.id, {
              kind: "inferred_summary",
              text: extracted.evidenceText,
              columnKey: criterion.id,
            })
            : null;
          this.store.addEvaluation(runId, {
            id: `${rowId}:${criterion.id}`,
            rowId,
            criterionId: criteriaByLabel.get(criterion.label)?.id ?? criterion.id,
            verdict: extracted?.verdict ?? "uncertain",
            summary: extracted?.summary ?? "Criterion could not be grounded from extracted evidence.",
            confidence: extracted?.confidence ?? 0.25,
            primaryEvidenceId: evidence?.id ?? null,
          });
        }
      }
      const totalRows = this.store.listRows(runId).filter((row) => !row.duplicateOfRowId).length;
      this.store.updateRun(runId, (current) => ({
        ...current,
        progress: {
          ...current.progress,
          totalRows,
          rowsCreated: totalRows,
          sourcesFetched: fetchedDocs.length,
          cellsResolved: this.store.listCells(runId).filter((cell) => cell.state !== "pending").length,
        },
      }));
    };

    await this.runStage(runId, "extraction", async () => {
      const extracted = await extractFromFetched(fetchedDocs.slice(0, this.config.maxLlmExtractionsPerRun));
      const merged = dedupeAndMerge(extracted);
      upsertMergedRows(merged, fetchedDocs);

      if (merged.length > 0 || extracted.length > 0) {
        this.store.addActivity(
          runId,
          stageEvent(
            runId,
            "extraction",
            "completed",
            `Dedup: ${extracted.length} raw → ${merged.length} unique entit${merged.length === 1 ? "y" : "ies"}`,
            {
              actor: actorForStage("extraction"),
              title: "Deduplication complete",
              checkpoint: "entities deduplicated",
            },
          ),
        );
      }
    });
    if (this.shouldStop(runId)) return;
    if (this.failRunIfWallClockExceeded(runId)) return;

    await this.runStage(runId, "evaluation", async () => {
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

    await this.runStage(runId, "canonicalization", async () => {
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
        }
      }
    });
    if (this.shouldStop(runId)) return;

    for (let iteration = 1; iteration <= this.config.maxSupervisorIterations; iteration += 1) {
      if (this.shouldStop(runId)) return;
      if (this.failRunIfWallClockExceeded(runId)) return;

      this.store.updateRun(runId, (current) => ({
        ...current,
        status: "running",
        stage: "refinement",
        metrics: {
          ...current.metrics,
          elapsedMs: current.startedAt ? now() - current.startedAt : current.metrics.elapsedMs,
        },
      }));

      const activeRows = this.store
        .listRows(runId)
        .filter((row) => row.duplicateOfRowId === null && row.status !== "rejected");
      const summaries = thread.columns.map((column) => {
        let filled = 0;
        let confidence = 0;
        for (const row of activeRows) {
          const details = this.store.getRowDetails(runId, row.id);
          const cell = details?.cells.find((entry) => entry.columnKey === column.key);
          if (cell?.state === "filled") {
            filled += 1;
            confidence += cell.confidence;
          }
        }
        return {
          label: column.label,
          fillRate: activeRows.length > 0 ? filled / activeRows.length : 0,
          avgConfidence: filled > 0 ? confidence / filled : 0,
        };
      });

      const unfetchedUrls = discovered
        .map((result) => this.normalizeUrl(result.url))
        .filter((url) => {
          return !prunedSourceUrls.has(url);
        })
        .filter((url) => !failedUrls.has(url))
        .filter((url) => !fetchedDocs.some((entry) => this.normalizeUrl(entry.result.url) === url))
        .slice(0, 10);

      let decision: Awaited<ReturnType<typeof supervisorDecide>>["data"] = {
        action: "done",
        queries: [],
        urls: [],
        focusColumns: [],
        reasoning: "",
      };
      try {
          decision = (await supervisorDecide(this.config, {
            query: thread.thread.queryRaw,
            iteration,
            maxIterations: this.config.maxSupervisorIterations,
            totalRows: activeRows.length,
            targetRows: thread.thread.targetResults,
            columnSummaries: summaries,
            unfetchedUrls,
            prunedSources: [...prunedSourceSummaries.entries()].map(([url, reasonSummary]) => ({
              url,
              reasonSummary,
            })),
          })).data;
      } catch (error) {
        this.store.addActivity(
          runId,
          stageEvent(
            runId,
            "refinement",
            "skipped",
            `Supervisor skipped: ${error instanceof Error ? error.message : "unknown error"}`,
          ),
        );
        break;
      }

      this.store.addActivity(
        runId,
        stageEvent(
          runId,
          "refinement",
          decision.action === "done" ? "completed" : "started",
          decision.action === "done"
            ? `Supervisor: done (${activeRows.length} rows, iter ${iteration}/${this.config.maxSupervisorIterations})`
            : `Supervisor iter ${iteration}: ${decision.action.replace(/_/g, " ")} — ${decision.reasoning || "expanding coverage"}`,
          {
            actor: "Supervisor",
            title: decision.action === "done" ? "Research complete" : `Supervisor — ${decision.action.replace(/_/g, " ")}`,
            reasoning: decision.reasoning || undefined,
            rewards: [
              { label: "action", value: decision.action },
              { label: "iteration", value: `${iteration}/${this.config.maxSupervisorIterations}` },
              { label: "rows", value: String(activeRows.length) },
            ],
          },
        ),
      );

      if (decision.action === "done") {
        break;
      }

      if (decision.action === "search_more") {
        try {
          const rewritten = await rewriteQueries(this.config, {
            query: thread.thread.queryRaw,
            gapColumns: decision.focusColumns,
          });
          for (const queryText of rewritten.data) {
            const nextResults = await searchBraveWeb(
              this.config.braveApiKey!,
              { id: makeId("sq"), text: queryText },
              this.config.searchResultsPerQuery,
            );
            for (const result of nextResults) {
              const normalized = this.normalizeUrl(result.url);
              if (failedUrls.has(normalized) || prunedSourceUrls.has(normalized)) continue;
              if (discovered.some((entry) => this.normalizeUrl(entry.url) === normalized)) continue;
              discovered.push({ ...result, url: normalized });
            }
          }
        } catch {
          // Best effort only.
        }
      }

      const targetUrls = (decision.urls.length > 0 ? decision.urls : unfetchedUrls)
        .map((url) => this.normalizeUrl(url))
        .filter((url) => {
          return !prunedSourceUrls.has(url);
        })
        .slice(0, 4);
      const newFetched = await fetchByUrls(targetUrls);
      if (newFetched.length === 0) {
        continue;
      }
      fetchedDocs.push(...newFetched);
      const extracted = await extractFromFetched(newFetched);
      const merged = dedupeAndMerge(extracted);
      upsertMergedRows(merged, fetchedDocs);

      const totalAfter = this.store.listRows(runId).filter((row) => !row.duplicateOfRowId).length;
      this.store.addActivity(
        runId,
        stageEvent(
          runId,
          "extraction",
          "completed",
          `Supervisor iter ${iteration} done: +${merged.length} entit${merged.length === 1 ? "y" : "ies"}, ${totalAfter} total rows`,
          {
            actor: "Supervisor",
            title: `Iteration ${iteration} complete`,
            checkpoint: "supervisor iteration complete",
          },
        ),
      );

      if (this.shouldStop(runId)) return;
    }

    await this.runStage(runId, "verification", async () => {
      let verificationsUsed = 0;

      for (const row of this.store.listRows(runId).filter((candidateRow) => {
        if (candidateRow.duplicateOfRowId) return false;
        const details = this.store.getRowDetails(runId, candidateRow.id);
        const hasWeakCriterion = details?.evaluations.some(
          (evaluation) => evaluation.verdict === "uncertain" || evaluation.verdict === "conflict",
        );
        return candidateRow.status === "uncertain" || candidateRow.status === "conflict" || hasWeakCriterion;
      })) {
        this.assertRunActive(runId);
        if (verificationsUsed >= this.config.maxVerificationsPerRun) {
          this.store.addActivity(
            runId,
            stageEvent(runId, "verification", "skipped", `Skipped extra verification for ${row.canonicalName}.`, {
              actor: actorForStage("verification"),
              title: "Verification budget guard",
              reasoning:
                "Verification is reserved for the most ambiguous rows once the budget is tight. Skipped rows retain their extracted state.",
            }),
          );
          continue;
        }

        this.store.upsertRow(runId, {
          ...row,
          processingState: "verifying",
        });

        const details = this.store.getRowDetails(runId, row.id);
        if (!details) continue;
        const startedAt = now();
        const verificationResult = await verifyWithGemini(this.config, {
          query: thread.thread.queryRaw,
          rowName: row.canonicalName,
          rowUrl: row.canonicalUrl,
          rowStatus: row.status,
          score: row.score,
          criteria: details.evaluations.map((evaluation) => ({
            label: details.criteria.find((criterion) => criterion.id === evaluation.criterionId)?.label ?? evaluation.criterionId,
            kind: details.criteria.find((criterion) => criterion.id === evaluation.criterionId)?.kind ?? "hard_filter",
            verdict: evaluation.verdict,
            summary: evaluation.summary,
          })),
          columns: details.cells.map((cell) => ({
            key: cell.columnKey,
            label: thread.columns.find((column) => column.key === cell.columnKey)?.label ?? cell.columnKey,
            state: cell.state,
            valueText: cell.valueText,
          })),
          sourceEvidence: details.sources.map((source) => ({
            title: source.title,
            url: source.url,
            snippet: source.snippet,
          })),
        });
        const verification = verificationResult.data;
        verificationsUsed += 1;
        const usage = usageRecord(runId, "llm", "gemini", "verify_candidate", 1, now() - startedAt, false, 0, 0, {
          rowId: row.id,
          backend: verificationResult.meta.backend,
          model: verificationResult.meta.model,
        });
        this.store.addUsage(runId, usage);

        this.store.upsertRow(runId, {
          ...row,
          status: verification.rowStatus,
          score: verification.score,
          processingState: "verifying",
        });

        for (const criterion of verification.criteria) {
          const criterionId =
            criteriaByLabel.get(criterion.label)?.id
            ?? thread.criteria.find((entry) => entry.label === criterion.label)?.id;
          if (!criterionId) continue;
          const sourceId = details.sources[0]?.id ?? null;
          const evidence = sourceId && criterion.evidenceText
            ? this.createEvidenceFromSource(runId, row.id, sourceId, {
                kind: "inferred_summary",
                text: criterion.evidenceText,
                columnKey: criterionId,
              })
            : null;
          this.store.addEvaluation(runId, {
            id: `${row.id}:${criterionId}`,
            rowId: row.id,
            criterionId,
            verdict: criterion.verdict,
            summary: criterion.summary,
            confidence: criterion.confidence,
            primaryEvidenceId: evidence?.id ?? null,
          });
        }

        this.store.addActivity(
          runId,
          stageEvent(runId, "verification", "completed", `Validated ambiguous row ${row.canonicalName}.`, {
            actor: actorForStage("verification"),
            title: "Validating row state",
            checkpoint: "criteria evaluated",
            reasoning:
              "Only rows with ambiguity or weak criteria get the stronger verification pass. Clean rows do not spend extra budget.",
            toolCalls: [
              this.toolCallFromUsage(usage, "Re-check ambiguous rows with the higher-confidence verifier.", {
                input: row.canonicalName,
                output: `${verification.rowStatus} @ ${verification.score.toFixed(2)}`,
              }),
            ],
            rewards: [
              { label: "backend", value: verificationResult.meta.backend },
              { label: "model", value: verificationResult.meta.model },
            ],
          }),
        );
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "ranking", async () => {
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
          reasoning:
            "Ranking is deterministic here: hard filter failures become rejects, surviving rows keep their extracted scores, and rejected candidates drop into the unmatched partition.",
          rewards: this.computeRewardSignals(runId, thread.thread.targetResults),
          metrics: this.store.getRun(runId)?.metrics.providerBreakdown ?? [],
        }),
      );
      await sleep(20);
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "export", async () => {
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
    work: () => Promise<void>,
  ): Promise<void> {
    const currentRun = this.store.getRun(runId);
    if (!currentRun || currentRun.status === "canceled" || currentRun.status === "failed") {
      return;
    }
    const stageCheckpoint = checkpointForStage(stage);
    this.assertRunActive(runId);
    this.store.updateRun(runId, (run) => {
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
      if (this.store.getRun(runId)?.status === "canceled") return;
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
      throw error;
    }
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

  /** Returns true if the run was marked failed (wall clock). */
  private failRunIfWallClockExceeded(runId: string): boolean {
    if (this.config.maxRunWallClockMs <= 0) return false;
    const run = this.store.getRun(runId);
    if (!run?.startedAt) return false;
    if (now() - run.startedAt <= this.config.maxRunWallClockMs) return false;
    const stage = (run.stage === "idle" ? "planning" : run.stage) as ActivityStage;
    const message = `Run exceeded maximum wall time (${Math.round(this.config.maxRunWallClockMs / 60_000)} min).`;
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

  private assertRunActive(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run || run.status === "canceled") {
      throw new Error("Run canceled");
    }
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
