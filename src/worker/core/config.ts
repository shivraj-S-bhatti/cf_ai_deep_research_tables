import type { SearchQuery, PreviewResponse } from "../../lib/contracts";

export type RuntimeMode = "fixture" | "hybrid" | "live";
export type GeminiBackend = "google_ai" | "vertex_express";

export type RuntimeConfig = {
  mode: RuntimeMode;
  braveApiKey: string | null;
  geminiApiKey: string | null;
  vertexApiKey: string | null;
  jinaApiKey: string | null;
  geminiBackend: GeminiBackend;
  plannerModel: string;
  extractorModel: string;
  extractorRoundupModel: string;
  verifierModel: string;
  supervisorModel: string;
  rewriterModel: string;
  vertexPlannerModel: string | null;
  vertexExtractorModel: string | null;
  vertexVerifierModel: string | null;
  vertexSupervisorModel: string | null;
  vertexRewriterModel: string | null;
  searchResultsPerQuery: number;
  maxSourcesPerRun: number;
  maxSourcesPerRow: number;
  maxLlmExtractionsPerRun: number;
  maxVerificationsPerRun: number;
  maxSupervisorIterations: number;
  fetchTextCharLimit: number;
  requestTimeoutMs: number;
  /** Stop live runs after this wall time (ms). 0 = no limit. */
  maxRunWallClockMs: number;
  /** Cap stored research threads (oldest pruned). Cache KV is separate. */
  maxStoredThreads: number;
};

export type RuntimeEnvLike = Record<string, unknown> | undefined;

function readValue(env: RuntimeEnvLike, key: string): string | null {
  const envValue = env?.[key];
  if (typeof envValue === "string" && envValue.trim()) return envValue.trim();
  if (typeof process !== "undefined" && typeof process.env?.[key] === "string" && process.env[key]?.trim()) {
    return process.env[key]!.trim();
  }
  return null;
}

function readNumber(env: RuntimeEnvLike, key: string, fallback: number): number {
  const value = readValue(env, key);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveRuntimeConfig(env?: RuntimeEnvLike): RuntimeConfig {
  const braveApiKey = readValue(env, "BRAVE_API_KEY");
  const geminiApiKey = readValue(env, "GEMINI_API_KEY");
  const vertexApiKey = readValue(env, "VERTEX_AI_API_KEY");
  const jinaApiKey = readValue(env, "JINA_API_KEY");
  const requestedMode = (readValue(env, "AGENTIC_RUNTIME_MODE") ?? "hybrid") as RuntimeMode;
  const geminiBackend = (readValue(env, "GEMINI_BACKEND") ?? "google_ai") as GeminiBackend;

  return {
    mode: requestedMode,
    braveApiKey,
    geminiApiKey,
    vertexApiKey,
    jinaApiKey,
    geminiBackend,
    plannerModel: readValue(env, "GEMINI_PLANNER_MODEL") ?? "gemini-2.5-flash",
    extractorModel: readValue(env, "GEMINI_EXTRACTOR_MODEL") ?? "gemini-2.5-flash-lite",
    extractorRoundupModel: readValue(env, "GEMINI_EXTRACTOR_ROUNDUP_MODEL") ?? "gemini-2.5-flash",
    verifierModel: readValue(env, "GEMINI_VERIFIER_MODEL") ?? "gemini-2.5-flash",
    supervisorModel: readValue(env, "GEMINI_SUPERVISOR_MODEL") ?? "gemini-2.5-flash",
    rewriterModel: readValue(env, "GEMINI_REWRITER_MODEL") ?? "gemini-2.5-flash-lite",
    vertexPlannerModel: readValue(env, "VERTEX_PLANNER_MODEL"),
    vertexExtractorModel: readValue(env, "VERTEX_EXTRACTOR_MODEL"),
    vertexVerifierModel: readValue(env, "VERTEX_VERIFIER_MODEL"),
    vertexSupervisorModel: readValue(env, "VERTEX_SUPERVISOR_MODEL"),
    vertexRewriterModel: readValue(env, "VERTEX_REWRITER_MODEL"),
    searchResultsPerQuery: readNumber(env, "SEARCH_RESULTS_PER_QUERY", 5),
    maxSourcesPerRun: readNumber(env, "MAX_SOURCES_PER_RUN", 20),
    maxSourcesPerRow: readNumber(env, "MAX_SOURCES_PER_ROW", 2),
    maxLlmExtractionsPerRun: readNumber(env, "MAX_LLM_EXTRACTIONS_PER_RUN", 6),
    maxVerificationsPerRun: readNumber(env, "MAX_VERIFICATIONS_PER_RUN", 3),
    maxSupervisorIterations: readNumber(env, "MAX_SUPERVISOR_ITERATIONS", 3),
    fetchTextCharLimit: readNumber(env, "FETCH_TEXT_CHAR_LIMIT", 9000),
    requestTimeoutMs: readNumber(env, "PROVIDER_TIMEOUT_MS", 20000),
    maxRunWallClockMs: readNumber(env, "MAX_RUN_WALL_CLOCK_MS", 480_000),
    maxStoredThreads: readNumber(env, "MAX_STORED_THREADS", 100),
  };
}

export function hasLiveProviders(config: RuntimeConfig): boolean {
  return Boolean(config.braveApiKey && (config.geminiApiKey || config.vertexApiKey));
}

export function shouldUseLiveProviders(config: RuntimeConfig): boolean {
  if (config.mode === "fixture") return false;
  return hasLiveProviders(config);
}

export function normalizeSearchQuery(text: string, index: number): SearchQuery {
  return {
    id: `live:search:${index}`,
    text: text.trim(),
  };
}

export function isValidPreviewResponse(value: PreviewResponse): boolean {
  return (
    typeof value.entityType === "string"
    && Array.isArray(value.criteria)
    && Array.isArray(value.columns)
    && Array.isArray(value.searchQueries)
    && typeof value.notes === "string"
  );
}
