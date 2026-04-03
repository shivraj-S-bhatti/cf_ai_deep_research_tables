export type ParsedDocument = {
  finalUrl: string;
  title: string;
  description: string;
  text: string;
};

async function readTextLimited(response: Response, maxChars: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (text.length < maxChars) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length >= maxChars) {
      break;
    }
  }

  text += decoder.decode();
  return text.slice(0, maxChars);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function matchTag(html: string, pattern: RegExp): string {
  return pattern.exec(html)?.[1]?.trim() ?? "";
}

export async function fetchAndParseDocument(
  url: string,
  maxChars: number,
): Promise<ParsedDocument> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent":
        "agentic-search-demo/0.1 (+https://github.com/placeholder/agentic-search)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await readTextLimited(response, maxChars * 2);
  const title = matchTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    matchTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || matchTag(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const text = stripHtml(html).slice(0, maxChars);

  return {
    finalUrl: response.url || url,
    title,
    description,
    text,
  };
}
