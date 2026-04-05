import type { PreviewResponse } from "../../lib/contracts";
import type { RuntimeConfig } from "../core/config";
import { buildPlannerPrompt, plannerJsonToPreview, type LivePlannerInput } from "./gemini";
import {
  createRequestSignal,
  delayWithSignal,
  isAbortLikeError,
  type RequestControl,
} from "./request-control";

type GroqChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type PlannerJson = {
  entity_type?: PreviewResponse["entityType"];
  hard_filters?: string[];
  soft_signals?: string[];
  columns?: Array<{
    key?: string;
    label?: string;
    kind?: "identity" | "criterion_summary" | "enrichment";
    value_type?: "string" | "number" | "date" | "enum" | "url" | "bool" | "json";
  }>;
  search_queries?: string[];
  budgets?: {
    search_budget?: number;
    fetch_budget?: number;
    verification_budget?: number;
  };
  notes?: string;
};

export type GroqProviderMeta = {
  provider: "groq";
  model: string;
};

export type GroqProviderResult<T> = {
  data: T;
  meta: GroqProviderMeta;
};

type GroqRequestOptions = {
  maxAttempts?: number;
};

function parseRetryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
}

function extractText(payload: GroqChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
  }
  return "";
}

function parseJson<T>(text: string): T {
  const candidate = text.trim();
  if (!candidate) {
    throw new Error("Groq returned an empty response.");
  }

  const fenced = candidate.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1]?.trim() ?? candidate;
  return JSON.parse(jsonText) as T;
}

export async function planWithGroq(
  config: RuntimeConfig,
  input: LivePlannerInput,
  control?: RequestControl,
  options?: GroqRequestOptions,
): Promise<GroqProviderResult<PreviewResponse>> {
  if (!config.groqApiKey) {
    throw new Error("Groq API key is missing.");
  }

  const { system, user } = buildPlannerPrompt(input);
  const endpoint = "https://api.groq.com/openai/v1/chat/completions";
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 1);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { signal, cleanup } = createRequestSignal(control);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.groqApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.previewPlannerModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
        signal,
      });

      if (!response.ok) {
        const message = await response.text();
        if ((response.status === 429 || response.status === 503) && attempt < maxAttempts - 1) {
          const retryMs = parseRetryAfterMs(response) ?? 1000;
          await delayWithSignal(retryMs, signal);
          continue;
        }
        throw new Error(`Groq request failed: ${response.status} ${message}`);
      }

      const payload = (await response.json()) as GroqChatCompletionResponse;
      const preview = plannerJsonToPreview(input, parseJson<PlannerJson>(extractText(payload)));
      return {
        data: preview,
        meta: {
          provider: "groq",
          model: config.previewPlannerModel,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unexpected Groq request failure.");
      if (isAbortLikeError(lastError)) {
        throw lastError;
      }
      if (attempt < maxAttempts - 1) {
        await delayWithSignal(750, signal);
        continue;
      }
    } finally {
      cleanup();
    }
  }

  throw lastError ?? new Error("Groq request failed before a response was received.");
}
