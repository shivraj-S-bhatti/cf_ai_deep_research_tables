import { createRequestSignal, type RequestControl } from "./request-control";
import type { BraveWebResult } from "./brave";

export type GitHubRepositoryMetadata = {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  homepage: string | null;
  description: string | null;
  stars: number;
  language: string | null;
  license: string | null;
  topics: string[];
  pushedAt: string | null;
};

function normalizeRepoSearchQuery(value: string): string {
  let query = value.trim().replace(/\s+/g, " ");
  query = query.replace(/\bsite:github\.com\b/gi, "").trim();
  query = query.replace(/>\s*1k\b/gi, "stars:>1000");
  query = query.replace(/>\s*1000\b/gi, "stars:>1000");
  if (!/\bstars:/.test(query)) {
    const numericThreshold = /\b(?:over|more than|greater than)\s+(\d[\d,]*)\b/i.exec(query)?.[1];
    if (numericThreshold) {
      query = `${query} stars:>${numericThreshold.replace(/,/g, "")}`.trim();
    }
  }
  if (!/\bfork:false\b/i.test(query)) query = `${query} fork:false`;
  if (!/\barchived:false\b/i.test(query)) query = `${query} archived:false`;
  return query.trim();
}

export function parseGitHubRepositoryUrl(value: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(value);
    if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) return null;
    if (["topics", "collections", "orgs", "search", "marketplace", "features", "trending"].includes(segments[0]!)) {
      return null;
    }
    return {
      owner: segments[0]!,
      repo: segments[1]!,
    };
  } catch {
    return null;
  }
}

export async function searchGitHubRepositories(
  queryText: string,
  count: number,
  control?: RequestControl,
): Promise<BraveWebResult[]> {
  const query = normalizeRepoSearchQuery(queryText);
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(Math.max(1, Math.min(count, 10))));

  const { signal, cleanup } = createRequestSignal(control);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "agentic-search-demo/0.1",
      },
      signal,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`GitHub repo search failed: ${response.status} ${message}`);
    }

    const payload = (await response.json()) as {
      items?: Array<{
        html_url?: string;
        full_name?: string;
        description?: string | null;
        stargazers_count?: number;
        language?: string | null;
        license?: { name?: string | null } | null;
        fork?: boolean;
        archived?: boolean;
      }>;
    };

    return (payload.items ?? [])
      .filter((item) => item.html_url && item.full_name && !item.fork && !item.archived)
      .map((item) => {
        const parts = [
          item.description?.trim(),
          typeof item.stargazers_count === "number" ? `Stars: ${item.stargazers_count}` : null,
          item.language ? `Language: ${item.language}` : null,
          item.license?.name ? `License: ${item.license.name}` : null,
        ].filter(Boolean);

        return {
          title: item.full_name ?? item.html_url ?? "GitHub repository",
          url: item.html_url ?? "",
          description: parts.join(" · "),
          language: item.language ?? undefined,
        } satisfies BraveWebResult;
      });
  } finally {
    cleanup();
  }
}

export async function fetchGitHubRepositoryMetadata(
  repoUrl: string,
  control?: RequestControl,
): Promise<GitHubRepositoryMetadata> {
  const parsed = parseGitHubRepositoryUrl(repoUrl);
  if (!parsed) {
    throw new Error(`Not a concrete GitHub repository URL: ${repoUrl}`);
  }

  const { signal, cleanup } = createRequestSignal(control);
  try {
    const response = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "agentic-search-demo/0.1",
      },
      signal,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`GitHub repo fetch failed: ${response.status} ${message}`);
    }

    const payload = (await response.json()) as {
      full_name?: string;
      html_url?: string;
      homepage?: string | null;
      description?: string | null;
      stargazers_count?: number;
      language?: string | null;
      license?: { spdx_id?: string | null; name?: string | null } | null;
      topics?: string[];
      pushed_at?: string | null;
    };

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      fullName: payload.full_name ?? `${parsed.owner}/${parsed.repo}`,
      htmlUrl: payload.html_url ?? repoUrl,
      homepage: payload.homepage?.trim() || null,
      description: payload.description?.trim() || null,
      stars: typeof payload.stargazers_count === "number" ? payload.stargazers_count : 0,
      language: payload.language?.trim() || null,
      license: payload.license?.spdx_id?.trim() || payload.license?.name?.trim() || null,
      topics: Array.isArray(payload.topics) ? payload.topics.filter(Boolean) : [],
      pushedAt: payload.pushed_at?.trim() || null,
    };
  } finally {
    cleanup();
  }
}
