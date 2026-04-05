export type EntityType =
  | "company"
  | "project"
  | "website"
  | "business"
  | "news_item"
  | "unknown";

export type ThreadPhase =
  | "preview"
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "canceled";

export type CriterionKind = "hard_filter" | "soft_signal" | "heuristic";

export type ColumnKind = "identity" | "criterion_summary" | "enrichment";

export type ValueType = "string" | "number" | "date" | "enum" | "url" | "bool" | "json";

export type RunStatus = "queued" | "running" | "complete" | "failed" | "canceled";

export type ProcessingState =
  | "pending"
  | "fetching"
  | "extracting"
  | "extracting_anchor"
  | "refining"
  | "corroborating"
  | "verifying"
  | "finalized"
  | "failed";

export type RowStatus = "accepted" | "rejected" | "uncertain" | "conflict";

export type CellState =
  | "pending"
  | "filled"
  | "not_found"
  | "unsupported"
  | "uncertain"
  | "conflict";

export type CriterionVerdict = "pass" | "fail" | "uncertain" | "conflict";

export type ActivityStatus = "started" | "completed" | "failed" | "skipped";

export type ActivityStage =
  | "planning"
  | "discovery"
  | "fetch"
  | "extraction"
  | "evaluation"
  | "canonicalization"
  | "refinement"
  | "verification"
  | "ranking"
  | "export";

export type SourceTier =
  | "official"
  | "primary_structured"
  | "reputable_secondary"
  | "weak_discovery";

export type SourceOriginClass =
  | "official"
  | "structured"
  | "secondary"
  | "roundup"
  | "directory"
  | "forum";

export type EvidenceKind =
  | "snippet"
  | "meta_tag"
  | "jsonld"
  | "heading"
  | "structured_field"
  | "inferred_summary";

export type ProviderKind = "search" | "llm" | "fetch" | "cache";

export type ProviderName = "brave" | "gemini" | "http_fetch" | "kv_cache" | "fixture";

export type SearchQuery = {
  id: string;
  text: string;
};

export type ResearchThread = {
  id: string;
  createdAt: number;
  updatedAt: number;
  queryRaw: string;
  queryNormalized: string;
  phase: ThreadPhase;
  targetResults: number;
  entityType: EntityType;
  statusSummary: string;
  latestRunId: string | null;
};

export type QueryPlan = {
  id: string;
  threadId: string;
  entityType: EntityType;
  hardFilters: Criterion[];
  softSignals: Criterion[];
  columns: ColumnSpec[];
  searchQueries: SearchQuery[];
  searchBudget: number;
  fetchBudget: number;
  verificationBudget: number;
  notes: string;
};

export type Criterion = {
  id: string;
  threadId?: string;
  label: string;
  kind: CriterionKind;
  color?: string;
  fieldHint?: string | null;
  operatorHint?: string | null;
  valueHint?: string | null;
  rankWeight?: number | null;
  orderIndex?: number;
};

export type ColumnSpec = {
  id: string;
  threadId?: string;
  key: string;
  label: string;
  kind: ColumnKind;
  valueType: ValueType;
  preferredSources: string[];
  requiresVerification: boolean;
  allowInference: boolean;
  nullPolicy: "dash" | "hidden";
  orderIndex: number;
};

export type ResearchRun = {
  id: string;
  threadId: string;
  status: RunStatus;
  stage: ActivityStage | "idle";
  startedAt: number | null;
  finishedAt: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  progress: RunProgress;
  metrics: RunMetrics;
};

export type RunProgress = {
  queriesCompleted: number;
  sourcesFetched: number;
  rowsCreated: number;
  cellsResolved: number;
  totalQueries: number;
  totalRows: number;
};

export type RunMetrics = {
  searchCalls: number;
  fetchCalls: number;
  llmCalls: number;
  cacheHits: number;
  cacheMisses: number;
  estimatedCostUsd: number;
  budgetConsumedUsd: number;
  elapsedMs: number;
  stageDurationsMs: Partial<Record<ActivityStage, number>>;
  providerBreakdown: UsageSummary[];
};

export type UsageRecord = {
  id: string;
  runId: string;
  providerKind: ProviderKind;
  providerName: ProviderName;
  operation: string;
  timestamp: number;
  latencyMs: number;
  requestCount: number;
  tokenIn: number;
  tokenOut: number;
  estimatedCostUsd: number;
  cacheHit: boolean;
  metadata: Record<string, unknown>;
};

export type UsageSummary = {
  providerName: ProviderName;
  operation: string;
  requestCount: number;
  tokenIn: number;
  tokenOut: number;
  estimatedCostUsd: number;
  cacheHits: number;
};

export type ResultRow = {
  id: string;
  runId: string;
  canonicalName: string;
  canonicalUrl: string;
  entityType: EntityType;
  status: RowStatus;
  statusReasonCode?: "source_scope_pruned" | null;
  statusReasonSummary?: string | null;
  processingState: ProcessingState;
  score: number;
  rank: number | null;
  sourceCount: number;
  duplicateOfRowId: string | null;
  lineage: {
    suggestedBySourceIds: string[];
    groundedBySourceIds: string[];
    sourceOriginClass: SourceOriginClass;
  };
};

export type ResultCell = {
  id: string;
  rowId: string;
  columnKey: string;
  valueText: string | null;
  valueJson: Record<string, unknown> | null;
  state: CellState;
  confidence: number;
  reasonCode: string | null;
  primaryEvidenceId: string | null;
};

export type CriterionEvaluation = {
  id: string;
  rowId: string;
  criterionId: string;
  verdict: CriterionVerdict;
  summary: string;
  confidence: number;
  primaryEvidenceId: string | null;
};

export type SourceDocument = {
  id: string;
  runId: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  fetchedAt: number;
  fetchStatus: number;
  contentType: string;
  contentHash: string;
  trustTier: SourceTier;
  cacheKey: string | null;
  blobRef: string | null;
  snippet: string;
  favicon: string | null;
};

export type Evidence = {
  id: string;
  sourceDocumentId: string;
  kind: EvidenceKind;
  locatorJson: Record<string, unknown>;
  text: string;
  normalizedText: string;
  extractionMethod: string;
  confidence: number;
};

export type ActivityEvent = {
  id: string;
  runId: string;
  stage: ActivityStage;
  status: ActivityStatus;
  message: string;
  payloadJson: Record<string, unknown>;
  createdAt: number;
};

export type ExportArtifact = {
  id: string;
  runId: string;
  format: "csv" | "json";
  downloadName: string;
  contentType: string;
  content: string;
  createdAt: number;
};

export type ThreadSnapshot = {
  thread: ResearchThread;
  plan: QueryPlan;
  latestRun: ResearchRun | null;
  criteria: Criterion[];
  columns: ColumnSpec[];
};

export type RunResultsResponse = {
  run: ResearchRun;
  thread: ResearchThread;
  criteria: Criterion[];
  columns: ColumnSpec[];
  rows: ResultRow[];
  cells: ResultCell[];
};

export type RowDetailsResponse = {
  row: ResultRow;
  cells: ResultCell[];
  criteria: Criterion[];
  evaluations: CriterionEvaluation[];
  sources: SourceDocument[];
  evidence: Evidence[];
};

export type PreviewRequest = {
  query: string;
  targetResults: number;
};

export type PreviewResponse = {
  entityType: EntityType;
  criteria: Criterion[];
  columns: ColumnSpec[];
  searchQueries: SearchQuery[];
  budgets: {
    searchBudget: number;
    fetchBudget: number;
    verificationBudget: number;
  };
  notes: string;
};

export type CreateThreadRequest = {
  query: string;
  targetResults: number;
  criteria: Criterion[];
  columns: ColumnSpec[];
  preview?: PreviewResponse;
};

export type CreateThreadResponse = {
  threadId: string;
  runId: string | null;
  phase: ThreadPhase;
};

export type UpdateThreadConfigRequest = Partial<{
  query: string;
  targetResults: number;
  criteria: Criterion[];
  columns: ColumnSpec[];
  preview: PreviewResponse;
}>;

export type CreateRunResponse = {
  threadId: string;
  runId: string;
  phase: ThreadPhase;
};

export type RunEventsResponse = {
  runId: string;
  events: ActivityEvent[];
};

export type RunDebugSummary = {
  run: ResearchRun;
  checkpoints: Array<{
    label: string;
    reached: boolean;
  }>;
  providerBreakdown: UsageSummary[];
  traceSummary: {
    totalEvents: number;
    stageCounts: Partial<Record<ActivityStage, number>>;
  };
  recentEvents: ActivityEvent[];
};

export type RunTraceResponse = {
  runId: string;
  page: number;
  pageSize: number;
  total: number;
  events: ActivityEvent[];
};

export type ThreadsListResponse = {
  threads: ThreadSnapshot[];
};

export type ThreadDetailsResponse = ThreadSnapshot;
