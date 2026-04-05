import type {
  CellState,
  CriterionKind,
  CriterionVerdict,
  EntityType,
  PreviewResponse,
  ValueType,
} from "../../lib/contracts";
import type { GeminiBackend, RuntimeConfig } from "../core/config";
import { isValidPreviewResponse, normalizeSearchQuery } from "../core/config";
import type { SourceClass } from "./fetch";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type PlannerJson = {
  entity_type?: EntityType;
  hard_filters?: string[];
  soft_signals?: string[];
  columns?: Array<{
    key?: string;
    label?: string;
    kind?: "identity" | "criterion_summary" | "enrichment";
    value_type?: ValueType;
  }>;
  search_queries?: string[];
  budgets?: {
    search_budget?: number;
    fetch_budget?: number;
    verification_budget?: number;
  };
  notes?: string;
};

type ExtractionJson = {
  canonical_name?: string;
  canonical_url?: string;
  row_status?: "accepted" | "rejected" | "uncertain" | "conflict";
  score?: number;
  row_summary?: string;
  cells?: Array<{
    key?: string;
    value_text?: string | null;
    state?: CellState;
    confidence?: number;
    reason_code?: string | null;
    evidence_text?: string | null;
  }>;
  criteria?: Array<{
    label?: string;
    verdict?: CriterionVerdict;
    summary?: string;
    confidence?: number;
    evidence_text?: string | null;
  }>;
};

type ExtractionEnvelopeJson = {
  entities?: ExtractionJson[] | null;
};

type VerifyJson = {
  row_status?: "accepted" | "rejected" | "uncertain" | "conflict";
  score?: number;
  row_summary?: string;
  criteria?: Array<{
    label?: string;
    verdict?: CriterionVerdict;
    summary?: string;
    confidence?: number;
    evidence_text?: string | null;
  }>;
};

type SupervisorDecisionJson = {
  action?: "search_more" | "fetch_more" | "extract_from_existing" | "done";
  queries?: string[] | null;
  urls?: string[] | null;
  focus_columns?: string[] | null;
  reasoning?: string;
};

type RewriteQueriesJson = {
  queries?: string[] | null;
};

type GeminiOperation =
  | "planner"
  | "extractor_roundup"
  | "extractor_entity"
  | "supervisor"
  | "verifier"
  | "rewriter";

export type GeminiProviderMeta = {
  backend: GeminiBackend;
  model: string;
};

export type GeminiProviderResult<T> = {
  data: T;
  meta: GeminiProviderMeta;
};

export type LivePlannerInput = {
  query: string;
  targetResults: number;
};

export type LivePlannerOutput = PreviewResponse;

export type LiveDocumentInput = {
  query: string;
  entityType: EntityType;
  criteria: Array<{
    label: string;
    kind: CriterionKind;
  }>;
  columns: Array<{
    key: string;
    label: string;
    kind: "identity" | "criterion_summary" | "enrichment";
    valueType: ValueType;
  }>;
  url: string;
  title: string;
  snippet: string;
  bodyText: string;
};

export type LiveDocumentExtraction = {
  canonicalName: string;
  canonicalUrl: string;
  rowStatus: "accepted" | "rejected" | "uncertain" | "conflict";
  score: number;
  rowSummary: string;
  cells: Array<{
    key: string;
    valueText: string | null;
    state: CellState;
    confidence: number;
    reasonCode: string | null;
    evidenceText: string | null;
  }>;
  criteria: Array<{
    label: string;
    verdict: CriterionVerdict;
    summary: string;
    confidence: number;
    evidenceText: string | null;
  }>;
};

export type LiveVerificationInput = {
  query: string;
  rowName: string;
  rowUrl: string;
  rowStatus: "accepted" | "rejected" | "uncertain" | "conflict";
  score: number;
  criteria: Array<{
    label: string;
    kind: CriterionKind;
    verdict: CriterionVerdict;
    summary: string;
  }>;
  columns: Array<{
    key: string;
    label: string;
    state: CellState;
    valueText: string | null;
  }>;
  sourceEvidence: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
};

export type LiveVerificationOutput = {
  rowStatus: "accepted" | "rejected" | "uncertain" | "conflict";
  score: number;
  rowSummary: string;
  criteria: Array<{
    label: string;
    verdict: CriterionVerdict;
    summary: string;
    confidence: number;
    evidenceText: string | null;
  }>;
};

export type SupervisorDecisionInput = {
  query: string;
  iteration: number;
  maxIterations: number;
  totalRows: number;
  targetRows: number;
  columnSummaries: Array<{
    label: string;
    fillRate: number;
    avgConfidence: number;
  }>;
  unfetchedUrls: string[];
  prunedSources: Array<{
    url: string;
    reasonSummary: string;
  }>;
};

export type SupervisorDecisionOutput = {
  action: "search_more" | "fetch_more" | "extract_from_existing" | "done";
  queries: string[];
  urls: string[];
  focusColumns: string[];
  reasoning: string;
};

export type RewriteQueriesInput = {
  query: string;
  gapColumns: string[];
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly backend: GeminiBackend,
    readonly model: string,
    readonly retryDelayMs: number | null = null,
  ) {
    super(message);
    this.name = "GeminiRequestError";
  }
}

function resolveBackendOrder(config: RuntimeConfig): GeminiBackend[] {
  const order: GeminiBackend[] = [];
  const preferred = config.geminiBackend === "vertex_express" ? "vertex_express" : "google_ai";

  if (preferred === "google_ai" && config.geminiApiKey) {
    order.push("google_ai");
  }
  if (preferred === "vertex_express" && config.vertexApiKey) {
    order.push("vertex_express");
  }
  if (!order.includes("google_ai") && config.geminiApiKey) {
    order.push("google_ai");
  }
  if (!order.includes("vertex_express") && config.vertexApiKey) {
    order.push("vertex_express");
  }
  return order;
}

function resolveModelForBackend(
  config: RuntimeConfig,
  operation: GeminiOperation,
  backend: GeminiBackend,
): string {
  if (operation === "planner") {
    return "gemini-2.5-flash";
  }
  if (backend === "vertex_express") {
    if (operation === "extractor_roundup" && config.vertexExtractorModel) return config.vertexExtractorModel;
    if (operation === "extractor_entity" && config.vertexExtractorModel) return config.vertexExtractorModel;
    if (operation === "verifier" && config.vertexVerifierModel) return config.vertexVerifierModel;
    if (operation === "supervisor" && config.vertexSupervisorModel) return config.vertexSupervisorModel;
    if (operation === "rewriter" && config.vertexRewriterModel) return config.vertexRewriterModel;
  }

  if (operation === "extractor_roundup") return config.extractorRoundupModel;
  if (operation === "extractor_entity") return config.extractorModel;
  if (operation === "supervisor") return config.supervisorModel;
  if (operation === "rewriter") return config.rewriterModel;
  return config.verifierModel;
}

function buildEndpoint(backend: GeminiBackend, apiKey: string, model: string): string {
  if (backend === "vertex_express") {
    return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${apiKey}`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function apiKeyForBackend(config: RuntimeConfig, backend: GeminiBackend): string {
  if (backend === "vertex_express") {
    if (!config.vertexApiKey) {
      throw new Error("Vertex AI key is missing.");
    }
    return config.vertexApiKey;
  }

  if (!config.geminiApiKey) {
    throw new Error("Gemini API key is missing.");
  }
  return config.geminiApiKey;
}

function parseRetryDelayMs(message: string): number | null {
  const secondsMatch = message.match(/"retryDelay":\s*"(\d+)s"/i);
  if (secondsMatch) {
    return Number(secondsMatch[1]) * 1000;
  }

  const plainSecondsMatch = message.match(/retry in\s+([\d.]+)s/i);
  if (plainSecondsMatch) {
    return Math.ceil(Number(plainSecondsMatch[1]) * 1000);
  }

  return null;
}

function modelFallbacks(model: string): string[] {
  if (model.includes("3-flash-preview")) return ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  if (model.includes("3.1-flash-lite-preview")) return ["gemini-2.5-flash-lite"];
  if (model.includes("2.5-flash")) return ["gemini-2.5-flash-lite"];
  return [];
}

function modelChain(model: string): string[] {
  return [...new Set([model, ...modelFallbacks(model)])];
}

function extractJsonText(payload: GeminiResponse): string {
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  return text.trim();
}

function parseJson<T>(text: string): T {
  const candidate = text.trim();
  if (!candidate) {
    throw new Error("Gemini returned an empty response.");
  }

  const fenced = candidate.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1]?.trim() ?? candidate;
  return JSON.parse(jsonText) as T;
}

async function generateStructuredJson<T>(
  config: RuntimeConfig,
  operation: GeminiOperation,
  system: string,
  user: string,
): Promise<GeminiProviderResult<T>> {
  const backends = resolveBackendOrder(config);
  let lastError: Error | null = null;

  for (const backend of backends) {
    const primaryModel = resolveModelForBackend(config, operation, backend);
    const apiKey = apiKeyForBackend(config, backend);
    for (const model of modelChain(primaryModel)) {
      const endpoint = buildEndpoint(backend, apiKey, model);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: system }],
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: user }],
                },
              ],
              generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json",
              },
            }),
          });

          if (!response.ok) {
            const message = await response.text();
            const requestError = new GeminiRequestError(
              `Gemini request failed: ${response.status} ${message}`,
              response.status,
              backend,
              model,
              parseRetryDelayMs(message),
            );
            if (response.status === 429 || response.status === 503) {
              const retryMs = requestError.retryDelayMs ?? Math.min(90000, 8000 + attempt * 14000);
              await new Promise((resolve) => setTimeout(resolve, retryMs));
              continue;
            }
            throw requestError;
          }

          const payload = (await response.json()) as GeminiResponse;
          return {
            data: parseJson<T>(extractJsonText(payload)),
            meta: { backend, model },
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unexpected Gemini request failure.");
          if (attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, 3000 + attempt * 2000));
            continue;
          }
        }
      }
    }
  }

  throw lastError ?? new Error("Gemini request failed before a response was received.");
}

function heuristicEntityType(query: string): EntityType {
  const lower = query.toLowerCase();
  if (/\b(startup|company|companies|ipo|funding|yc)\b/.test(lower)) return "company";
  if (/\b(open source|oss|github|repo|tool|tools|library|libraries|sdk)\b/.test(lower)) return "project";
  if (/\b(doc|docs|documentation|website|site|sites)\b/.test(lower)) return "website";
  if (/\b(restaurant|pizza|museum|exhibition|place|places|business|businesses)\b/.test(lower)) return "business";
  if (/\b(news|announcement|announcements|layoff|ipo|m&a|acquisition|merger)\b/.test(lower)) return "news_item";
  return "unknown";
}

function defaultColumnsForEntityType(entityType: EntityType) {
  switch (entityType) {
    case "company":
      return [
        { key: "website", label: "Website", kind: "identity" as const, valueType: "url" as const },
        { key: "description", label: "Description", kind: "enrichment" as const, valueType: "string" as const },
        { key: "location", label: "Location", kind: "enrichment" as const, valueType: "string" as const },
        { key: "evidence_count", label: "Evidence", kind: "criterion_summary" as const, valueType: "number" as const },
      ];
    case "project":
      return [
        { key: "repo", label: "Repo", kind: "identity" as const, valueType: "url" as const },
        { key: "description", label: "Description", kind: "enrichment" as const, valueType: "string" as const },
        { key: "license", label: "License", kind: "enrichment" as const, valueType: "string" as const },
        { key: "evidence_count", label: "Evidence", kind: "criterion_summary" as const, valueType: "number" as const },
      ];
    case "website":
      return [
        { key: "url", label: "URL", kind: "identity" as const, valueType: "url" as const },
        { key: "description", label: "Description", kind: "enrichment" as const, valueType: "string" as const },
        { key: "focus", label: "Focus", kind: "enrichment" as const, valueType: "string" as const },
        { key: "evidence_count", label: "Evidence", kind: "criterion_summary" as const, valueType: "number" as const },
      ];
    case "business":
      return [
        { key: "website", label: "Website", kind: "identity" as const, valueType: "url" as const },
        { key: "summary", label: "Summary", kind: "enrichment" as const, valueType: "string" as const },
        { key: "location", label: "Location", kind: "enrichment" as const, valueType: "string" as const },
        { key: "evidence_count", label: "Evidence", kind: "criterion_summary" as const, valueType: "number" as const },
      ];
    case "news_item":
      return [
        { key: "source_url", label: "Source URL", kind: "identity" as const, valueType: "url" as const },
        { key: "headline", label: "Headline", kind: "enrichment" as const, valueType: "string" as const },
        { key: "date", label: "Date", kind: "enrichment" as const, valueType: "date" as const },
        { key: "evidence_count", label: "Evidence", kind: "criterion_summary" as const, valueType: "number" as const },
      ];
    default:
      return [
        { key: "url", label: "URL", kind: "identity" as const, valueType: "url" as const },
        { key: "summary", label: "Summary", kind: "enrichment" as const, valueType: "string" as const },
        { key: "evidence_count", label: "Evidence", kind: "criterion_summary" as const, valueType: "number" as const },
      ];
  }
}

export function fallbackPreview(input: LivePlannerInput): PreviewResponse {
  const entityType = heuristicEntityType(input.query);
  const columns = defaultColumnsForEntityType(entityType).map((column, index) => ({
    id: `preview:${slugify(input.query)}:${column.key}`,
    key: column.key,
    label: column.label,
    kind: column.kind,
    valueType: column.valueType,
    preferredSources: ["official", "reputable_secondary"],
    requiresVerification: true,
    allowInference: column.kind !== "identity",
    nullPolicy: "dash" as const,
    orderIndex: index,
  }));

  const searchQueries = [
    input.query,
    `${input.query} official`,
    `${input.query} source`,
  ].map(normalizeSearchQuery);

  return {
    entityType,
    criteria: [],
    columns,
    searchQueries,
    budgets: {
      searchBudget: searchQueries.length,
      fetchBudget: Math.max(6, input.targetResults),
      verificationBudget: Math.max(3, Math.ceil(input.targetResults / 4)),
    },
    notes: "Fallback heuristic plan. Replace with Gemini-backed planning when available.",
  };
}

export async function planWithGemini(
  config: RuntimeConfig,
  input: LivePlannerInput,
): Promise<GeminiProviderResult<LivePlannerOutput>> {
  const system = [
    "You are planning a grounded entity discovery run.",
    "Return JSON only.",
    "Parse the research query into entity type, hard filters, soft signals, output columns, search queries, and conservative budgets.",
    "Write criteria in plain, concise human assistant language.",
    "Avoid jargon words like entity, scope, canonical, grounded.",
    "Each criterion should read like a practical checklist item, not policy prose.",
    "Prefer abstention over overfitting.",
  ].join("\n");
  const user = [
    `Query: ${input.query}`,
    `Target results: ${input.targetResults}`,
    "",
    "Return JSON with shape:",
    `{
  "entity_type": "company|project|website|business|news_item|unknown",
  "hard_filters": ["..."],
  "soft_signals": ["..."],
  "columns": [{"key":"snake_case","label":"Human Label","kind":"identity|criterion_summary|enrichment","value_type":"string|number|date|enum|url|bool|json"}],
  "search_queries": ["..."],
  "budgets": {"search_budget": 3, "fetch_budget": 12, "verification_budget": 4},
  "notes": "brief note"
}`,
  ].join("\n");

  const { data: json, meta } = await generateStructuredJson<PlannerJson>(config, "planner", system, user);
  const preview: PreviewResponse = {
    entityType: json.entity_type ?? heuristicEntityType(input.query),
    criteria: [
      ...(json.hard_filters ?? []).map((label, index) => ({
        id: `preview:${slugify(input.query)}:criterion:hard:${index}`,
        label,
        kind: "hard_filter" as const,
        color: "hsl(220, 80%, 50%)",
        orderIndex: index,
      })),
      ...(json.soft_signals ?? []).map((label, index) => ({
        id: `preview:${slugify(input.query)}:criterion:soft:${index}`,
        label,
        kind: "soft_signal" as const,
        color: "hsl(280, 60%, 50%)",
        orderIndex: (json.hard_filters?.length ?? 0) + index,
      })),
    ],
    columns: (json.columns ?? defaultColumnsForEntityType(json.entity_type ?? heuristicEntityType(input.query))).map((column, index) => ({
      id: `preview:${slugify(input.query)}:column:${column.key ?? slugify(column.label ?? `column_${index}`)}`,
      key: column.key ?? slugify(column.label ?? `column_${index}`),
      label: column.label ?? `Column ${index + 1}`,
      kind: column.kind ?? "enrichment",
      valueType: column.value_type ?? "string",
      preferredSources: ["official", "reputable_secondary"],
      requiresVerification: true,
      allowInference: column.kind !== "identity",
      nullPolicy: "dash" as const,
      orderIndex: index,
    })),
    searchQueries: (json.search_queries ?? [input.query]).slice(0, 6).map(normalizeSearchQuery),
    budgets: {
      searchBudget: json.budgets?.search_budget ?? 3,
      fetchBudget: json.budgets?.fetch_budget ?? Math.max(8, input.targetResults),
      verificationBudget: json.budgets?.verification_budget ?? Math.max(3, Math.ceil(input.targetResults / 4)),
    },
    notes: json.notes ?? "Gemini-backed plan.",
  };

  if (!isValidPreviewResponse(preview)) {
    throw new Error("Planner returned an invalid preview response.");
  }

  preview.criteria = preview.criteria
    .filter((criterion) => typeof criterion.label === "string" && criterion.label.trim().length > 0)
    .slice(0, 3)
    .map((criterion, index) => ({ ...criterion, orderIndex: index }));

  if (preview.criteria.length === 0) {
    throw new Error("Planner returned no criteria.");
  }
  if (preview.columns.length === 0) {
    throw new Error("Planner returned no output columns.");
  }
  if (preview.searchQueries.length === 0) {
    throw new Error("Planner returned no search queries.");
  }

  return { data: preview, meta };
}

export async function extractDocumentWithGemini(
  config: RuntimeConfig,
  input: LiveDocumentInput,
  sourceClass: SourceClass = "entity_page",
): Promise<GeminiProviderResult<LiveDocumentExtraction[]>> {
  const operation: GeminiOperation =
    sourceClass === "roundup" || sourceClass === "directory"
      ? "extractor_roundup"
      : "extractor_entity";

  const system = sourceClass === "forum"
    ? [
      "You extract entities from forum/community content.",
      "Return JSON only.",
      "Prefer lower confidence for opinionated claims.",
      "Do not invent URLs or ratings.",
      "Return {\"entities\": [...]}",
    ].join("\n")
    : sourceClass === "roundup" || sourceClass === "directory"
      ? [
        "You extract multiple entities from roundup/list pages.",
        "Return JSON only with an entities array.",
        "Each entity must be grounded in the provided text.",
        "If no valid entities are present, return {\"entities\": []}.",
      ].join("\n")
      : [
        "You extract one grounded entity from an entity-specific page.",
        "Return JSON only with an entities array (0 or 1 entity preferred).",
        "Do not return page/site names as entities.",
      ].join("\n");

  const user = [
    `Query: ${input.query}`,
    `Entity type: ${input.entityType}`,
    `Source URL: ${input.url}`,
    `Source title: ${input.title}`,
    `Search snippet: ${input.snippet}`,
    `Source class: ${sourceClass}`,
    "",
    `Criteria: ${JSON.stringify(input.criteria)}`,
    `Columns: ${JSON.stringify(input.columns)}`,
    "",
    "Source body excerpt:",
    input.bodyText.slice(0, 10000),
    "",
    "Return JSON with shape:",
    `{
  "entities": [{
  "canonical_name": "string",
  "canonical_url": "https://...",
  "row_status": "accepted|rejected|uncertain|conflict",
  "score": 0.0,
  "row_summary": "short explanation",
  "cells": [{"key":"column_key","value_text":"string or null","state":"filled|not_found|unsupported|uncertain|conflict","confidence":0.0,"reason_code":"optional","evidence_text":"direct snippet or short grounded quote"}],
  "criteria": [{"label":"criterion label","verdict":"pass|fail|uncertain|conflict","summary":"short explanation","confidence":0.0,"evidence_text":"direct snippet or short grounded quote"}]
  }]
}`,
  ].join("\n");

  const { data: raw, meta } = await generateStructuredJson<ExtractionEnvelopeJson | ExtractionJson[]>(
    config,
    operation,
    system,
    user,
  );
  const entities: ExtractionJson[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.entities)
      ? raw.entities
      : [];
  const rows = entities.map((json) => ({
    canonicalName: json.canonical_name?.trim() || input.title,
    canonicalUrl: json.canonical_url?.trim() || input.url,
    rowStatus: json.row_status ?? "uncertain",
    score: typeof json.score === "number" ? Math.max(0, Math.min(1, json.score)) : 0.5,
    rowSummary: json.row_summary?.trim() || "Row extracted from live document evidence.",
    cells: (json.cells ?? []).map((cell) => ({
      key: cell.key ?? "",
      valueText: cell.value_text ?? null,
      state: cell.state ?? "unsupported",
      confidence: typeof cell.confidence === "number" ? cell.confidence : 0.2,
      reasonCode: cell.reason_code ?? null,
      evidenceText: cell.evidence_text ?? null,
    })),
    criteria: (json.criteria ?? []).map((criterion) => ({
      label: criterion.label ?? "",
      verdict: criterion.verdict ?? "uncertain",
      summary: criterion.summary?.trim() || "No summary returned.",
      confidence: typeof criterion.confidence === "number" ? criterion.confidence : 0.2,
      evidenceText: criterion.evidence_text ?? null,
    })),
  }));

  return {
    data: rows,
    meta,
  };
}

export function isJunkExtraction(
  row: LiveDocumentExtraction,
  sourceUrl: string,
): boolean {
  const normalizedName = (row.canonicalName || "").trim().toLowerCase();
  const sourceHost = (() => {
    try {
      return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const filledCells = row.cells.filter((cell) => cell.state === "filled").length;
  if (!normalizedName || normalizedName === "not_found") return true;
  if (normalizedName === sourceHost) return true;
  if (row.score <= 0) return true;
  if (filledCells === 0) return true;
  return false;
}

export async function supervisorDecide(
  config: RuntimeConfig,
  input: SupervisorDecisionInput,
): Promise<GeminiProviderResult<SupervisorDecisionOutput>> {
  const system = [
    "You are a research supervisor for a grounded entity discovery pipeline.",
    "Decide exactly one action each turn.",
    "Actions: search_more, fetch_more, extract_from_existing, done.",
    "Do not choose done when identity columns are weak and target rows are not met.",
  ].join("\n");
  const cols = input.columnSummaries
    .map((col) => `${col.label}: fill=${Math.round(col.fillRate * 100)}% avg_conf=${col.avgConfidence.toFixed(2)}`)
    .join("\n");
  const user = [
    `Research query: ${input.query}`,
    `Iteration: ${input.iteration} of ${input.maxIterations}`,
    `Rows found: ${input.totalRows} (target: ${input.targetRows})`,
    "",
    "Column fill rates:",
    cols,
    "",
    `Unfetched URLs available: ${input.unfetchedUrls.length}`,
    ...input.unfetchedUrls.slice(0, 5).map((u) => `- ${u}`),
    "",
    `Pruned sources to avoid repeating: ${input.prunedSources.length}`,
    ...input.prunedSources.slice(0, 5).map((entry) => `- ${entry.url} :: ${entry.reasonSummary}`),
    "",
    "Return JSON:",
    `{
  "action": "search_more|fetch_more|extract_from_existing|done",
  "queries": ["..."],
  "urls": ["..."],
  "focus_columns": ["..."],
  "reasoning": "one sentence"
}`,
  ].join("\n");

  const { data, meta } = await generateStructuredJson<SupervisorDecisionJson>(
    config,
    "supervisor",
    system,
    user,
  );
  return {
    data: {
      action: data.action ?? "done",
      queries: (data.queries ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0),
      urls: (data.urls ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0),
      focusColumns: (data.focus_columns ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0),
      reasoning: data.reasoning ?? "",
    },
    meta,
  };
}

export async function rewriteQueries(
  config: RuntimeConfig,
  input: RewriteQueriesInput,
): Promise<GeminiProviderResult<string[]>> {
  const system = [
    "You rewrite search queries for entity discovery.",
    "Return JSON only.",
    "Generate 2-3 high-recall but targeted search queries.",
  ].join("\n");
  const user = [
    `Original query: ${input.query}`,
    `Columns with poor fill rate: ${input.gapColumns.join(", ") || "none"}`,
    "",
    "Return JSON with shape:",
    `{"queries": ["...", "..."]}`,
  ].join("\n");

  const { data, meta } = await generateStructuredJson<RewriteQueriesJson>(
    config,
    "rewriter",
    system,
    user,
  );
  return {
    data: (data.queries ?? [])
      .filter((query): query is string => typeof query === "string" && query.trim().length > 0)
      .slice(0, 3),
    meta,
  };
}

export async function verifyWithGemini(
  config: RuntimeConfig,
  input: LiveVerificationInput,
): Promise<GeminiProviderResult<LiveVerificationOutput>> {
  const system = [
    "You are verifying an already-extracted row from a grounded entity discovery pipeline.",
    "Return JSON only.",
    "Only change row_status when evidence clearly supports it.",
    "Prefer abstention over overclaiming.",
  ].join("\n");
  const user = [
    `Query: ${input.query}`,
    `Row name: ${input.rowName}`,
    `Row URL: ${input.rowUrl}`,
    `Current row status: ${input.rowStatus}`,
    `Current score: ${input.score}`,
    `Criteria: ${JSON.stringify(input.criteria)}`,
    `Cells: ${JSON.stringify(input.columns)}`,
    `Source evidence: ${JSON.stringify(input.sourceEvidence)}`,
    "",
    "Return JSON with shape:",
    `{
  "row_status": "accepted|rejected|uncertain|conflict",
  "score": 0.0,
  "row_summary": "short explanation",
  "criteria": [{"label":"criterion label","verdict":"pass|fail|uncertain|conflict","summary":"short explanation","confidence":0.0,"evidence_text":"grounded snippet"}]
}`,
  ].join("\n");

  try {
    const { data: json, meta } = await generateStructuredJson<VerifyJson>(config, "verifier", system, user);
    return {
      data: {
        rowStatus: json.row_status ?? input.rowStatus,
        score: typeof json.score === "number" ? Math.max(0, Math.min(1, json.score)) : input.score,
        rowSummary: json.row_summary?.trim() || `Verification retained ${input.rowStatus}.`,
        criteria: (json.criteria ?? []).map((criterion) => ({
          label: criterion.label ?? "",
          verdict: criterion.verdict ?? "uncertain",
          summary: criterion.summary?.trim() || "No verification summary returned.",
          confidence: typeof criterion.confidence === "number" ? criterion.confidence : 0.25,
          evidenceText: criterion.evidence_text ?? null,
        })),
      },
      meta,
    };
  } catch {
    return {
      data: {
        rowStatus: input.rowStatus,
        score: input.score,
        rowSummary: `Verification fallback retained ${input.rowStatus}.`,
        criteria: input.criteria.map((criterion) => ({
          label: criterion.label,
          verdict: criterion.verdict,
          summary: criterion.summary,
          confidence: 0.4,
          evidenceText: null,
        })),
      },
      meta: {
        backend: config.geminiBackend === "vertex_express" && config.vertexApiKey ? "vertex_express" : "google_ai",
        model: config.verifierModel,
      },
    };
  }
}
