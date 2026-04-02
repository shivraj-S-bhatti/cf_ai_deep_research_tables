export type SearchStatus = "match" | "miss" | "verifying" | "queued";

export type Source = {
  url: string;
  title: string;
  snippet: string;
  favicon?: string;
  visitedAt?: string;
};

export type CriteriaEval = {
  rule: string;
  passed: boolean;
  snippet: string;
  sources: Source[];
};

export type EnrichmentValue = {
  value: string;
  source?: Source;
  status: "done" | "extracting" | "failed";
};

export type SearchResult = {
  id: string;
  name: string;
  url: string;
  status: SearchStatus;
  evaluations: CriteriaEval[];
  enrichments: Record<string, EnrichmentValue>;
  sourcesVisited: Source[];
  matchScore?: number;
};

export type Criterion = {
  id: string;
  text: string;
  color: string;
};

export type Enrichment = {
  id: string;
  name: string;
};

export type AgentStepType = "rewrite" | "search" | "evaluate" | "extract" | "reasoning";

export type AgentStep = {
  id: string;
  type: AgentStepType;
  agent: "Rewriter" | "Search" | "Evaluator" | "Extractor";
  title: string;
  detail: string;
  timestamp: number;
  status: "running" | "done" | "error";
  toolCalls?: { name: string; input: string; output?: string }[];
};

export type ThreadPhase = "search" | "preview" | "running" | "complete";

export type Thread = {
  id: string;
  query: string;
  phase: ThreadPhase;
  criteria: Criterion[];
  enrichments: Enrichment[];
  results: SearchResult[];
  agentSteps: AgentStep[];
  targetResults: number;
  createdAt: number;
  updatedAt: number;
};
