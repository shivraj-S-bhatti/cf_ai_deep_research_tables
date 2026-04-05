import { createRequestSignal, type RequestControl } from "./request-control";

export type SourceClass = "roundup" | "entity_page" | "official_site" | "directory" | "forum";

export type ParsedDocument = {
  finalUrl: string;
  title: string;
  description: string;
  text: string;
  sourceClass: SourceClass;
};

type FetchOptions = RequestControl & {
  jinaApiKey?: string | null;
  entityType?: string;
};

const ROUNDUP_DOMAINS = new Set([
  "eater.com",
  "thrillist.com",
  "timeout.com",
  "infatuation.com",
  "nymag.com",
  "bonappetit.com",
  "seriouseats.com",
  "tasteatlas.com",
  "bkmag.com",
  "tastingtable.com",
  "purewow.com",
  "foodandwine.com",
  "techcrunch.com",
  "producthunt.com",
]);

const DIRECTORY_DOMAINS = new Set([
  "yelp.com",
  "tripadvisor.com",
  "foursquare.com",
  "zomato.com",
  "opentable.com",
  "crunchbase.com",
]);

const FORUM_DOMAINS = new Set([
  "reddit.com",
  "quora.com",
  "stackexchange.com",
  "news.ycombinator.com",
  "stackoverflow.com",
]);

async function readTextLimited(response: Response, maxChars: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < maxChars) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length >= maxChars) break;
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
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function matchTag(html: string, pattern: RegExp): string {
  return pattern.exec(html)?.[1]?.trim() ?? "";
}

function hostFor(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hasDomain(hostname: string, domains: Set<string>): boolean {
  for (const domain of domains) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function isInterstitial(doc: Pick<ParsedDocument, "title" | "text">): boolean {
  const hay = `${doc.title}\n${doc.text.slice(0, 1200)}`.toLowerCase();
  const markers = [
    "please wait for verification",
    "checking if the site connection is secure",
    "enable javascript and cookies to continue",
    "attention required!",
    "cloudflare",
  ];
  return markers.some((marker) => hay.includes(marker));
}

export function classifySource(doc: Pick<ParsedDocument, "finalUrl" | "title" | "text">, _entityType = ""): SourceClass {
  const domain = hostFor(doc.finalUrl);
  const path = (() => {
    try {
      return new URL(doc.finalUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (domain === "ycombinator.com" || domain.endsWith(".ycombinator.com")) {
    if (/^\/companies\/[^/]+$/.test(path)) {
      const slug = path.split("/").pop() ?? "";
      if (/^(?:w|s|f)\d{2}$/i.test(slug)) return "directory";
      return "entity_page";
    }
    if (
      path.startsWith("/companies/industry/")
      || path.startsWith("/companies/location/")
      || path === "/companies"
      || path.startsWith("/companies?")
    ) {
      return "directory";
    }
  }

  if (hasDomain(domain, FORUM_DOMAINS)) return "forum";
  if (hasDomain(domain, DIRECTORY_DOMAINS)) return "directory";
  if (hasDomain(domain, ROUNDUP_DOMAINS)) return "roundup";

  const titleLower = (doc.title || "").toLowerCase();
  const textLower = (doc.text || "").slice(0, 4000).toLowerCase();

  if (domain.includes("github.com")) {
    const githubListy =
      path.includes("/topics/")
      || path.includes("awesome")
      || titleLower.includes("awesome")
      || titleLower.includes("top ")
      || titleLower.includes("best ")
      || titleLower.includes("leaderboard");
    if (githubListy) return "roundup";
  }

  const hasListTitle = /\b(\d+\s+\w*\s*(?:best|top|greatest)|best\s+\d+|top\s+\d+)\b/.test(titleLower)
    || /\bbest\b.*\b(?:spots?|places?|shops?|restaurants?|joints?|projects?|startups?|companies|repos?|repositories|llms?)\b/.test(titleLower);
  const hasListBody = ((doc.text || "").slice(0, 4000).match(/(?:^|\n)\s*\d+[.)]\s+/g) || []).length >= 4;
  const hasManyGithubLinks = (textLower.match(/https?:\/\/github\.com\/[^\s)\]"']+/g) || []).length >= 6;
  const hasDirectoryPath = /\/(directory|industry|category|location)\//.test(path);

  if (hasDirectoryPath) return "directory";
  if (hasListTitle || hasListBody || hasManyGithubLinks) return "roundup";
  return "entity_page";
}

async function fetchJina(
  url: string,
  maxChars: number,
  jinaApiKey?: string | null,
  control?: RequestControl,
): Promise<ParsedDocument | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Return-Format": "markdown",
  };
  if (jinaApiKey) {
    headers.Authorization = `Bearer ${jinaApiKey}`;
  }

  const { signal, cleanup } = createRequestSignal(control);
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      method: "GET",
      headers,
      redirect: "follow",
      signal,
    });
  if (!response.ok) return null;

    const body = await response.text();
    let finalUrl = url;
    let title = url;
    let description = "";
    let text = "";

    try {
      const payload = JSON.parse(body) as {
        data?: { url?: string; title?: string; description?: string; content?: string };
      };
      const data = payload.data ?? {};
      finalUrl = data.url || url;
      title = data.title || url;
      description = data.description || "";
      text = (data.content || "").slice(0, maxChars);
    } catch {
      text = body.slice(0, maxChars);
    }

    if (!text.trim()) return null;
    const sourceClass = classifySource({ finalUrl, title, text });
    const doc: ParsedDocument = { finalUrl, title, description, text, sourceClass };
    return isInterstitial(doc) ? null : doc;
  } finally {
    cleanup();
  }
}

async function fetchRaw(url: string, maxChars: number, control?: RequestControl): Promise<ParsedDocument> {
  const { signal, cleanup } = createRequestSignal(control);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": "agentic-search-demo/0.1 (+https://github.com/placeholder/agentic-search)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
      redirect: "follow",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const html = await readTextLimited(response, maxChars * 2);
    const title = matchTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || url;
    const description =
      matchTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || matchTag(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const text = stripHtml(html).slice(0, maxChars);
    const finalUrl = response.url || url;
    const sourceClass = classifySource({ finalUrl, title, text });
    return { finalUrl, title, description, text, sourceClass };
  } finally {
    cleanup();
  }
}

async function fetchRedditJson(url: string, maxChars: number, control?: RequestControl): Promise<ParsedDocument | null> {
  const jsonUrl = url.endsWith(".json") ? url : `${url.replace(/\/+$/, "")}.json`;
  const { signal, cleanup } = createRequestSignal(control);
  try {
    const response = await fetch(jsonUrl, {
      method: "GET",
      headers: { "user-agent": "AgenticSearch/1.0" },
      redirect: "follow",
      signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as Array<{
      data?: { children?: Array<{ data?: Record<string, unknown> }> };
    }>;
    const post = payload?.[0]?.data?.children?.[0]?.data ?? {};
    const title = String(post.title ?? url);
    const lines = [title, String(post.selftext ?? "")];
    const comments = payload?.[1]?.data?.children ?? [];
    for (const item of comments.slice(0, 20)) {
      const body = String(item?.data?.body ?? "");
      if (body) lines.push(body);
    }
    const text = lines.join("\n").trim().slice(0, maxChars);
    if (!text) return null;
    const doc: ParsedDocument = {
      finalUrl: url,
      title,
      description: "",
      text,
      sourceClass: "forum",
    };
    return isInterstitial(doc) ? null : doc;
  } finally {
    cleanup();
  }
}

export async function fetchAndParseDocument(
  url: string,
  maxChars: number,
  options?: FetchOptions,
): Promise<ParsedDocument> {
  if (url.includes("reddit.com/")) {
    const reddit = await fetchRedditJson(url, maxChars, options);
    if (reddit && reddit.text.length >= 100) return reddit;
  }

  const jina = await fetchJina(url, maxChars, options?.jinaApiKey, options);
  if (jina && jina.text.length >= 100) return jina;

  const raw = await fetchRaw(url, maxChars, options);
  if (isInterstitial(raw)) {
    throw new Error(`Fetch failed: interstitial content for ${url}`);
  }
  return raw;
}
