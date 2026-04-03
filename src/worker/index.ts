import { handleApiRequest } from "./core/app";

export type WorkerAssetsBinding = {
  fetch: (request: Request) => Promise<Response>;
};

export type WorkerEnv = {
  ASSETS?: WorkerAssetsBinding;
  APP_ENV?: string;
  AGENTIC_RUNTIME_MODE?: string;
  SEARCH_PROVIDER_PRIMARY?: string;
  LLM_PROVIDER_PRIMARY?: string;
  BRAVE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  VERTEX_AI_API_KEY?: string;
  GEMINI_BACKEND?: string;
  GEMINI_PLANNER_MODEL?: string;
  GEMINI_EXTRACTOR_MODEL?: string;
  GEMINI_VERIFIER_MODEL?: string;
  SEARCH_RESULTS_PER_QUERY?: string;
  MAX_SOURCES_PER_RUN?: string;
  MAX_SOURCES_PER_ROW?: string;
  FETCH_TEXT_CHAR_LIMIT?: string;
  PROVIDER_TIMEOUT_MS?: string;
};

export type WorkerExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, ctx);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};
