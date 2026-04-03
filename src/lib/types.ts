import type {
  ActivityEvent,
  ActivityStage,
  CellState,
  ColumnSpec,
  Criterion,
  CriterionVerdict,
  ProcessingState,
  ResearchRun,
  ResultCell,
  ResultRow,
  RowStatus,
  RunMetrics,
  SourceDocument,
  ThreadPhase,
  UsageSummary,
} from "./contracts";

export type SearchStatus = RowStatus;
export type SearchProcessingState = ProcessingState;
export type ThreadLifecyclePhase = ThreadPhase;
export type ColumnDefinition = ColumnSpec;
export type Enrichment = ColumnSpec;

export type Source = {
  id: string;
  url: string;
  title: string;
  snippet: string;
  favicon?: string | null;
  visitedAt?: string;
  trustTier?: string;
};

export type CriteriaEval = {
  criterionId: string;
  rule: string;
  verdict: CriterionVerdict;
  summary: string;
  confidence: number;
  primaryEvidenceId: string | null;
  sources: Source[];
};

export type SearchCell = ResultCell & {
  label: string;
  sources: Source[];
};

export type SearchResult = ResultRow & {
  name: string;
  url: string;
  evaluations: CriteriaEval[];
  cells: Record<string, SearchCell>;
  sourcesVisited: Source[];
  matchScore?: number;
};

export type AgentStepType = ActivityStage;

export type AgentStep = {
  id: string;
  type: AgentStepType;
  actor: string;
  title: string;
  detail: string;
  eventStatus: ActivityEvent["status"];
  reasoning?: string;
  checkpoint?: string;
  toolCalls?: Array<{
    name: string;
    summary: string;
    input?: string;
    output?: string;
    latencyMs?: number;
    costUsd?: number;
    cacheHit?: boolean;
  }>;
  rewards?: Array<{
    label: string;
    value: string;
    hint?: string;
  }>;
  timestamp: number;
  status: "running" | "done" | "error";
  metrics?: UsageSummary[];
  payload?: Record<string, unknown>;
};

export type Thread = {
  id: string;
  query: string;
  phase: ThreadLifecyclePhase;
  entityType: string;
  criteria: Criterion[];
  columns: ColumnDefinition[];
  results: SearchResult[];
  agentSteps: AgentStep[];
  targetResults: number;
  createdAt: number;
  updatedAt: number;
  latestRunId: string | null;
  latestRun: ResearchRun | null;
  metrics: RunMetrics | null;
  statusSummary: string;
};

/** Client-side table filters (dataset workspace), AND logic between rows */
export type TableFilterField = "name" | "url" | "status";

export type TableFilterOperator =
  | "contains"
  | "does_not_contain"
  | "equals"
  | "does_not_equal"
  | "is_empty"
  | "is_not_empty";

export type TableFilterCondition = {
  id: string;
  field: TableFilterField;
  operator: TableFilterOperator;
  value: string;
};

export type DatasetSortKey = "name" | "url" | "status";
export type DatasetSortDir = "asc" | "desc";

export type {
  ActivityEvent,
  CellState,
  ColumnSpec,
  Criterion,
  ResearchRun,
  ResultCell,
  ResultRow,
  RunMetrics,
  SourceDocument,
  UsageSummary,
};

export function mapActivityEventToAgentStep(event: ActivityEvent): AgentStep {
  const payload = event.payloadJson as Record<string, unknown>;
  return {
    id: event.id,
    type: event.stage,
    actor: typeof payload.actor === "string" ? payload.actor : actorForStage(event.stage),
    title: typeof payload.title === "string" ? payload.title : titleForStage(event.stage),
    detail: event.message,
    eventStatus: event.status,
    reasoning: typeof payload.reasoning === "string" ? payload.reasoning : undefined,
    checkpoint: typeof payload.checkpoint === "string" ? payload.checkpoint : undefined,
    toolCalls: Array.isArray(payload.toolCalls)
      ? (payload.toolCalls as AgentStep["toolCalls"])
      : undefined,
    rewards: Array.isArray(payload.rewards)
      ? (payload.rewards as AgentStep["rewards"])
      : undefined,
    timestamp: event.createdAt,
    status:
      event.status === "failed"
        ? "error"
        : event.status === "completed"
          ? "done"
          : "running",
    metrics: Array.isArray(payload.metrics)
      ? (payload.metrics as UsageSummary[])
      : undefined,
    payload,
  };
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
      return "Extracting cells";
    case "evaluation":
      return "Evaluating criteria";
    case "canonicalization":
      return "Canonicalizing entities";
    case "verification":
      return "Verifying evidence";
    case "ranking":
      return "Ranking results";
    case "export":
      return "Preparing export";
  }
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

export function sourceFromDocument(source: SourceDocument): Source {
  return {
    id: source.id,
    url: source.url,
    title: source.title,
    snippet: source.snippet,
    favicon: source.favicon,
    visitedAt: new Date(source.fetchedAt).toISOString(),
    trustTier: source.trustTier,
  };
}

export function isPendingCell(cell: SearchCell | undefined): boolean {
  return !cell || cell.state === "pending";
}

export function isBlankTerminalCell(cell: SearchCell | undefined): boolean {
  return !!cell && (cell.state === "not_found" || cell.state === "unsupported");
}

export function isWeakTerminalCell(cell: SearchCell | undefined): boolean {
  return !!cell && (cell.state === "uncertain" || cell.state === "conflict");
}

export function rowAcceptedCount(rows: SearchResult[]): number {
  return rows.filter((row) => row.status === "accepted").length;
}
