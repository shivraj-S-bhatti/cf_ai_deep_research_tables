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
  fallbackPreview,
  planWithGemini,
  verifyWithGemini,
  type LiveDocumentExtraction,
} from "../providers/gemini";
import { fetchAndParseDocument } from "../providers/fetch";
import { estimateOperationCost } from "../providers/price-catalog";
import { MemoryResearchStore, emptyMetrics, emptyProgress } from "../storage/memory-store";
import { makeId, sleep } from "../utils/ids";

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
      return "Planner Agent";
    case "discovery":
      return "Search Agent";
    case "fetch":
      return "Retriever Agent";
    case "extraction":
      return "Extractor Agent";
    case "evaluation":
      return "Evaluator Agent";
    case "canonicalization":
      return "Canonicalizer Agent";
    case "verification":
      return "Validator Agent";
    case "ranking":
      return "Ranking Agent";
    case "export":
      return "Exporter Agent";
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

type LiveDiscoveredCandidate = {
  rowId: string;
  queryText: string;
  result: BraveWebResult;
};

type LiveFetchedSource = {
  rowId: string;
  source: SourceDocument;
  bodyText: string;
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
      ? (await planWithGemini(this.config, input)).data
      : previewQuery(input);
    this.cache.preview.set(cacheKey, structuredClone(response));
    return response;
  }

  createThread(input: CreateThreadRequest): CreateThreadResponse {
    const bundle = buildThreadBundle(input);
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

  getRunResults(runId: string, includeRejected = false) {
    return this.store.listResults(runId, includeRejected);
  }

  getRowDetails(runId: string, rowId: string) {
    return this.store.getRowDetails(runId, rowId);
  }

  cancelRun(runId: string): ResearchRun | null {
    return this.store.cancelRun(runId);
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
    const discovered: LiveDiscoveredCandidate[] = [];
    const fetchedByRow = new Map<string, LiveFetchedSource[]>();
    const extractedCriteria = new Map<string, Array<{
      label: string;
      verdict: "pass" | "fail" | "uncertain" | "conflict";
      summary: string;
      confidence: number;
      evidenceText: string | null;
    }>>();

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
      let discoveryBudget = Math.min(
        this.config.maxSourcesPerRun,
        Math.max(
          thread.thread.targetResults + 2,
          Math.min(thread.plan.fetchBudget, thread.thread.targetResults + 4),
        ),
      );

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
          if (seenUrls.has(normalizedUrl)) continue;
          seenUrls.add(normalizedUrl);
          discoveryBudget -= 1;

          const rowId = makeId("row");
          const provisionalRow: ResultRow = {
            id: rowId,
            runId,
            canonicalName: this.cleanTitle(result.title),
            canonicalUrl: normalizedUrl,
            entityType: thread.plan.entityType,
            status: "uncertain",
            processingState: "pending",
            score: 0.35,
            rank: null,
            sourceCount: 0,
            duplicateOfRowId: null,
          };

          this.store.upsertRow(runId, provisionalRow);
          for (const column of thread.columns) {
            this.store.upsertCell(runId, {
              id: `${rowId}:${column.key}`,
              rowId,
              columnKey: column.key,
              valueText: null,
              valueJson: null,
              state: "pending",
              confidence: 0,
              reasonCode: null,
              primaryEvidenceId: null,
            });
          }

          discovered.push({
            rowId,
            queryText: query.text,
            result: {
              ...result,
              url: normalizedUrl,
            },
          });

          this.store.addActivity(
            runId,
            stageEvent(runId, "discovery", "completed", `Created provisional row for ${this.cleanTitle(result.title)}.`, {
              actor: actorForStage("discovery"),
              title: "Created candidate row",
              rowId,
              reasoning:
                "Create the row immediately from the search result so the table can start filling while document fetch and extraction continue.",
              rewards: [
                { label: "query", value: query.text },
                { label: "provisional_status", value: "uncertain" },
              ],
            }),
          );
          await sleep(35);
        }
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "fetch", async () => {
      for (const candidate of discovered) {
        this.assertRunActive(runId);
        try {
          const fetchStartedAt = now();
          const parsed = await fetchAndParseDocument(candidate.result.url, this.config.fetchTextCharLimit);
          const fetchLatency = now() - fetchStartedAt;
          const source: SourceDocument = {
            id: makeId("src"),
            runId,
            url: parsed.finalUrl,
            normalizedUrl: this.normalizeUrl(parsed.finalUrl),
            domain: new URL(parsed.finalUrl).hostname,
            title: parsed.title || candidate.result.title,
            fetchedAt: now(),
            fetchStatus: 200,
            contentType: "text/html",
            contentHash: `${this.normalizeUrl(parsed.finalUrl)}:${parsed.text.length}`,
            trustTier: "reputable_secondary",
            cacheKey: `page:${this.normalizeUrl(parsed.finalUrl)}`,
            blobRef: null,
            snippet: parsed.description || candidate.result.description || parsed.text.slice(0, 280),
            favicon: `https://www.google.com/s2/favicons?domain=${new URL(parsed.finalUrl).hostname}&sz=16`,
          };

          const usage = usageRecord(runId, "fetch", "http_fetch", "fetch_source", 1, fetchLatency, false, 0, 0, {
            url: parsed.finalUrl,
          });
          this.store.addUsage(runId, usage);
          this.store.addSource(runId, candidate.rowId, source);
          this.cache.pages.set(source.cacheKey ?? source.normalizedUrl, source);

          const fetched = fetchedByRow.get(candidate.rowId) ?? [];
          fetched.push({
            rowId: candidate.rowId,
            source,
            bodyText: parsed.text,
          });
          fetchedByRow.set(candidate.rowId, fetched);

          const row = this.store.getRow(runId, candidate.rowId);
          if (row) {
            this.store.upsertRow(runId, {
              ...row,
              sourceCount: fetched.length,
            });
          }

          this.store.addActivity(
            runId,
            stageEvent(runId, "fetch", "completed", `Fetched ${source.title}.`, {
              actor: actorForStage("fetch"),
              title: "Fetching source document",
              checkpoint: "sources fetched",
              reasoning:
                "The fetched page is retained as the grounding substrate for cell extraction, criterion evaluation, and post-run debugging.",
              toolCalls: [
                this.toolCallFromUsage(usage, "Fetch and bound-read the source document.", {
                  input: candidate.result.url,
                  output: source.snippet,
                }),
              ],
              rewards: [
                { label: "domain", value: source.domain },
                { label: "source_count", value: String(fetched.length) },
              ],
            }),
          );
          await sleep(20);
        } catch (error) {
          this.store.addActivity(
            runId,
            stageEvent(
              runId,
              "fetch",
              "failed",
              error instanceof Error ? error.message : `Failed to fetch ${candidate.result.url}`,
              {
                actor: actorForStage("fetch"),
                title: "Fetching source document",
                checkpoint: "sources fetched",
              },
            ),
          );
        }
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "extraction", async () => {
      let llmExtractionsUsed = 0;
      const llmExtractionBudget = Math.max(
        1,
        Math.min(this.config.maxLlmExtractionsPerRun, thread.thread.targetResults + 1),
      );

      for (const candidate of discovered) {
        this.assertRunActive(runId);
        const row = this.store.getRow(runId, candidate.rowId);
        if (!row) continue;
        const fetchedSources = (fetchedByRow.get(candidate.rowId) ?? []).slice(0, this.config.maxSourcesPerRow);
        if (fetchedSources.length === 0) {
          this.finalizeMissingRow(runId, thread.criteria, thread.columns, row, candidate.result.description);
          continue;
        }

        const promptBody = fetchedSources
          .map((entry, index) => [
            `Source ${index + 1}: ${entry.source.title}`,
            `URL: ${entry.source.url}`,
            `Snippet: ${entry.source.snippet}`,
            entry.bodyText,
          ].join("\n"))
          .join("\n\n");

        let extraction: LiveDocumentExtraction;
        let usage: UsageRecord | null = null;
        let extractionMode = "live_llm";

        if (llmExtractionsUsed >= llmExtractionBudget) {
          extractionMode = "budget_guard";
          extraction = this.buildFallbackExtraction(
            thread.thread.queryRaw,
            thread.criteria,
            thread.columns,
            candidate,
            fetchedSources,
            "LLM extraction budget was exhausted, so this row was compacted into a heuristic fallback.",
          );
        } else {
          try {
            const startedAt = now();
            const providerResult = await extractDocumentWithGemini(this.config, {
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
              url: candidate.result.url,
              title: candidate.result.title,
              snippet: candidate.result.description,
              bodyText: promptBody,
            });
            extraction = providerResult.data;
            llmExtractionsUsed += 1;
            usage = usageRecord(runId, "llm", "gemini", "extract_candidate", 1, now() - startedAt, false, 0, 0, {
              rowId: candidate.rowId,
              sourceCount: fetchedSources.length,
              backend: providerResult.meta.backend,
              model: providerResult.meta.model,
            });
            this.store.addUsage(runId, usage);
          } catch (error) {
            extractionMode = "fallback_after_error";
            extraction = this.buildFallbackExtraction(
              thread.thread.queryRaw,
              thread.criteria,
              thread.columns,
              candidate,
              fetchedSources,
              error instanceof Error ? error.message : "LLM extraction failed.",
            );
            this.store.addActivity(
              runId,
              stageEvent(runId, "extraction", "failed", `Fell back for ${row.canonicalName}.`, {
                actor: actorForStage("extraction"),
                title: "Extractor fallback",
                checkpoint: "cells extracted",
                reasoning:
                  "A provider failure should degrade the row quality, not crash the whole run. This row keeps compact heuristic values and explicit abstentions.",
                error: error instanceof Error ? error.message : "Unexpected extraction failure",
              }),
            );
          }
        }

        this.store.upsertRow(runId, {
          ...row,
          canonicalName: extraction.canonicalName || row.canonicalName,
          canonicalUrl: this.ensureHttpUrl(extraction.canonicalUrl || row.canonicalUrl),
          status: extraction.rowStatus,
          score: extraction.score,
          sourceCount: fetchedSources.length,
        });

        const resolvedColumns: string[] = [];
        for (const column of thread.columns) {
          const extractedCell = extraction.cells.find((cell) => cell.key === column.key);
          const valueText =
            column.key === "evidence_count"
              ? String(fetchedSources.length)
              : extractedCell?.valueText ?? null;
          const state: CellState =
            column.key === "evidence_count"
              ? "filled"
              : extractedCell?.state ?? "unsupported";
          const evidenceText =
            column.key === "evidence_count"
              ? `Resolved against ${fetchedSources.length} fetched source documents.`
              : extractedCell?.evidenceText ?? null;
          const primarySource = fetchedSources[0]?.source ?? null;
          const evidence = primarySource && evidenceText
            ? this.createEvidenceFromSource(runId, candidate.rowId, primarySource.id, {
                kind: "inferred_summary",
                text: evidenceText,
                columnKey: column.key,
              })
            : null;

          this.store.upsertCell(runId, {
            id: `${candidate.rowId}:${column.key}`,
            rowId: candidate.rowId,
            columnKey: column.key,
            valueText,
            valueJson: null,
            state,
            confidence: extractedCell?.confidence ?? (column.key === "evidence_count" ? 1 : 0.2),
            reasonCode: extractedCell?.reasonCode ?? (state === "unsupported" ? "model_omitted_field" : null),
            primaryEvidenceId: evidence?.id ?? null,
          });
          if (state !== "pending") {
            resolvedColumns.push(`${column.label}:${state}`);
          }
        }

        extractedCriteria.set(candidate.rowId, extraction.criteria);
        this.store.addActivity(
          runId,
          stageEvent(runId, "extraction", "completed", `Resolved ${resolvedColumns.length} cells for ${extraction.canonicalName}.`, {
            actor: actorForStage("extraction"),
            title: "Extracting row cells",
            checkpoint: "cells extracted",
            reasoning:
              "The extractor can abstain. Cells stay blank or weak when the document does not support a grounded value strongly enough.",
            toolCalls: [
              ...(usage
                ? [
                    this.toolCallFromUsage(usage, "Extract row cells and provisional row status from fetched documents.", {
                      input: extraction.canonicalName,
                      output: resolvedColumns.join("\n"),
                    }),
                  ]
                : []),
            ],
            rewards: [
              { label: "row_status", value: extraction.rowStatus },
              { label: "score", value: extraction.score.toFixed(2) },
              { label: "mode", value: extractionMode },
            ],
          }),
        );
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "evaluation", async () => {
      for (const candidate of discovered) {
        this.assertRunActive(runId);
        const evaluations = extractedCriteria.get(candidate.rowId) ?? [];
        for (const criterion of thread.criteria) {
          const extracted = evaluations.find((entry) => entry.label === criterion.label);
          const sourceId = (fetchedByRow.get(candidate.rowId) ?? [])[0]?.source.id ?? null;
          const evidence = sourceId && extracted?.evidenceText
            ? this.createEvidenceFromSource(runId, candidate.rowId, sourceId, {
                kind: "inferred_summary",
                text: extracted.evidenceText,
                columnKey: criterion.id,
              })
            : null;
          this.store.addEvaluation(runId, {
            id: `${candidate.rowId}:${criterion.id}`,
            rowId: candidate.rowId,
            criterionId: criteriaByLabel.get(criterion.label)?.id ?? criterion.id,
            verdict: extracted?.verdict ?? "uncertain",
            summary: extracted?.summary ?? "Criterion could not be grounded from the extracted sources.",
            confidence: extracted?.confidence ?? 0.25,
            primaryEvidenceId: evidence?.id ?? null,
          });
        }

        this.store.addActivity(
          runId,
          stageEvent(runId, "evaluation", "completed", `Evaluated ${candidate.result.title} against ${thread.criteria.length} criteria.`, {
            actor: actorForStage("evaluation"),
            title: "Evaluating criteria",
            checkpoint: "criteria evaluated",
            reasoning:
              "Hard filters gate whether the row can survive into the accepted set. Soft signals may remain weaker and influence ordering instead.",
            rewards: [
              { label: "criteria_count", value: String(thread.criteria.length) },
            ],
          }),
        );
      }
    });
    if (this.shouldStop(runId)) return;

    await this.runStage(runId, "canonicalization", async () => {
      const seenCanonical = new Map<string, string>();
      for (const row of this.store.listRows(runId)) {
        const canonical = this.normalizeUrl(row.canonicalUrl);
        if (seenCanonical.has(canonical)) {
          this.store.upsertRow(runId, {
            ...row,
            duplicateOfRowId: seenCanonical.get(canonical) ?? null,
          });
        } else {
          seenCanonical.set(canonical, row.id);
        }
      }

      this.store.addActivity(
        runId,
        stageEvent(runId, "canonicalization", "completed", "Canonicalized rows and folded duplicate URLs together.", {
          actor: actorForStage("canonicalization"),
          title: "Canonicalizing entities",
          reasoning:
            "Canonicalization keeps the result table from double-counting the same entity across multiple search queries or source variants.",
        }),
      );
      await sleep(20);
    });
    if (this.shouldStop(runId)) return;

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
        const finalStatus = this.deriveFinalStatus(entry.row, entry.details?.evaluations ?? [], thread.criteria);
        const finalized: ResultRow = {
          ...entry.row,
          status: finalStatus,
          processingState: "finalized",
          rank: finalStatus === "rejected" ? null : rank,
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

  private finalizeMissingRow(
    runId: string,
    criteria: Criterion[],
    columns: Array<{ key: string; label: string }>,
    row: ResultRow,
    summary: string,
  ): void {
    this.store.upsertRow(runId, {
      ...row,
      status: "rejected",
      score: 0.1,
      processingState: "pending",
    });

    for (const column of columns) {
      this.store.upsertCell(runId, {
        id: `${row.id}:${column.key}`,
        rowId: row.id,
        columnKey: column.key,
        valueText: null,
        valueJson: null,
        state: "unsupported",
        confidence: 0.1,
        reasonCode: "fetch_failed_or_empty",
        primaryEvidenceId: null,
      });
    }

    for (const criterion of criteria) {
      this.store.addEvaluation(runId, {
        id: `${row.id}:${criterion.id}`,
        rowId: row.id,
        criterionId: criterion.id,
        verdict: "uncertain",
        summary: summary || "No fetchable evidence was available for this row.",
        confidence: 0.1,
        primaryEvidenceId: null,
      });
    }
  }

  private buildFallbackExtraction(
    query: string,
    criteria: Criterion[],
    columns: Array<{ key: string; label: string }>,
    candidate: LiveDiscoveredCandidate,
    fetchedSources: LiveFetchedSource[],
    reason: string,
  ): LiveDocumentExtraction {
    const primarySource = fetchedSources[0]?.source;
    const summaryText =
      primarySource?.snippet
      || candidate.result.description
      || candidate.result.title
      || "No grounded summary was available.";
    const canonicalName = this.cleanTitle(primarySource?.title || candidate.result.title);
    const canonicalUrl = primarySource?.url || candidate.result.url;
    const lowerSummary = `${canonicalName} ${summaryText} ${query}`.toLowerCase();

    return {
      canonicalName,
      canonicalUrl,
      rowStatus: "uncertain",
      score: 0.18,
      rowSummary: reason,
      cells: columns.map((column) => {
        const key = column.key.toLowerCase();
        if (/(^name$|headline|company|project)/.test(key)) {
          return {
            key: column.key,
            valueText: canonicalName,
            state: "filled",
            confidence: 0.55,
            reasonCode: "heuristic_identity",
            evidenceText: canonicalName,
          };
        }
        if (/(^url$|website|repo|source_url)/.test(key)) {
          return {
            key: column.key,
            valueText: canonicalUrl,
            state: "filled",
            confidence: 0.55,
            reasonCode: "heuristic_identity",
            evidenceText: canonicalUrl,
          };
        }
        if (/(description|summary|headline|about)/.test(key)) {
          return {
            key: column.key,
            valueText: summaryText,
            state: "filled",
            confidence: 0.45,
            reasonCode: "heuristic_summary",
            evidenceText: summaryText,
          };
        }
        if (key === "evidence_count") {
          return {
            key: column.key,
            valueText: String(fetchedSources.length),
            state: "filled",
            confidence: 1,
            reasonCode: "source_count",
            evidenceText: `Resolved against ${fetchedSources.length} fetched source documents.`,
          };
        }
        return {
          key: column.key,
          valueText: null,
          state: "unsupported" as const,
          confidence: 0.1,
          reasonCode: "llm_budget_guard",
          evidenceText: null,
        };
      }),
      criteria: criteria.map((criterion) => {
        const label = criterion.label.toLowerCase();
        const verdict: CriterionEvaluation["verdict"] =
          label.includes("open source") && /(open source|github|license)/.test(lowerSummary)
            ? "pass"
            : label.includes("database") && /(database|sql|postgres|mysql|sqlite|mongo)/.test(lowerSummary)
              ? "pass"
              : "uncertain";
        return {
          label: criterion.label,
          verdict,
          summary:
            verdict === "pass"
              ? `Heuristic fallback matched '${criterion.label}' against visible source text.`
              : reason,
          confidence: verdict === "pass" ? 0.45 : 0.18,
          evidenceText: verdict === "pass" ? summaryText : null,
        };
      }),
    };
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

  private deriveFinalStatus(
    row: ResultRow,
    evaluations: CriterionEvaluation[],
    criteria: Criterion[],
  ): ResultRow["status"] {
    const hardCriteriaIds = new Set(
      criteria.filter((criterion) => criterion.kind === "hard_filter").map((criterion) => criterion.id),
    );
    const hardEvaluations = evaluations.filter((evaluation) => hardCriteriaIds.has(evaluation.criterionId));

    if (hardEvaluations.some((evaluation) => evaluation.verdict === "conflict")) return "conflict";
    if (hardEvaluations.some((evaluation) => evaluation.verdict === "uncertain")) return "uncertain";
    if (hardEvaluations.some((evaluation) => evaluation.verdict === "fail")) return "rejected";
    return row.status;
  }

  private async runStage(
    runId: string,
    stage: ActivityStage,
    work: () => Promise<void>,
  ): Promise<void> {
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
