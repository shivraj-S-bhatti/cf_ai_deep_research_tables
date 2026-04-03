import type { SearchQuery } from "../../lib/contracts";

export type BraveWebResult = {
  title: string;
  url: string;
  description: string;
  age?: string;
  language?: string;
};

export async function searchBraveWeb(
  apiKey: string,
  query: SearchQuery,
  count: number,
): Promise<BraveWebResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query.text);
  url.searchParams.set("count", String(count));
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("spellcheck", "false");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Brave search failed: ${response.status} ${message}`);
  }

  const payload = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        age?: string;
        language?: string;
      }>;
    };
  };

  return (payload.web?.results ?? [])
    .filter((result) => result.url && result.title)
    .map((result) => ({
      title: result.title ?? result.url ?? "Untitled result",
      url: result.url ?? "",
      description: result.description ?? "",
      age: result.age,
      language: result.language,
    }));
}
