import type { ProviderName } from "../../lib/contracts";

const PRICE_CATALOG: Record<ProviderName, Record<string, number>> = {
  brave: {
    search_query: 0.005,
  },
  gemini: {
    plan_query: 0.002,
    evaluate_candidate: 0.0015,
    verify_candidate: 0.001,
    extract_candidate: 0.001,
  },
  http_fetch: {
    fetch_source: 0.0002,
  },
  kv_cache: {
    cache_lookup: 0.00001,
  },
  fixture: {
    plan_query: 0.0004,
    search_query: 0.0002,
    fetch_source: 0.0001,
    extract_candidate: 0.0003,
    evaluate_candidate: 0.00025,
    verify_candidate: 0.00015,
    rank_results: 0.0001,
    export_results: 0.00005,
  },
};

export function estimateOperationCost(
  providerName: ProviderName,
  operation: string,
  requestCount = 1,
): number {
  const perRequest = PRICE_CATALOG[providerName]?.[operation] ?? 0;
  return Number((perRequest * requestCount).toFixed(6));
}
