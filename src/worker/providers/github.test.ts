import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchGitHubRepositoryMetadata, parseGitHubRepositoryUrl } from "./github";

describe("github provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses concrete repository URLs and rejects list pages", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/vllm-project/vllm")).toEqual({
      owner: "vllm-project",
      repo: "vllm",
    });
    expect(parseGitHubRepositoryUrl("https://github.com/topics/llm")).toBeNull();
  });

  it("fetches repository metadata from the GitHub API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        full_name: "vllm-project/vllm",
        html_url: "https://github.com/vllm-project/vllm",
        homepage: "https://vllm.ai",
        description: "Easy, Fast, and Cheap LLM Serving for everyone",
        stargazers_count: 41789,
        language: "Python",
        license: { spdx_id: "Apache-2.0" },
        topics: ["llm", "inference", "serving"],
        pushed_at: "2026-04-05T10:00:00Z",
      }), { status: 200 }),
    );

    await expect(fetchGitHubRepositoryMetadata("https://github.com/vllm-project/vllm")).resolves.toEqual({
      owner: "vllm-project",
      repo: "vllm",
      fullName: "vllm-project/vllm",
      htmlUrl: "https://github.com/vllm-project/vllm",
      homepage: "https://vllm.ai",
      description: "Easy, Fast, and Cheap LLM Serving for everyone",
      stars: 41789,
      language: "Python",
      license: "Apache-2.0",
      topics: ["llm", "inference", "serving"],
      pushedAt: "2026-04-05T10:00:00Z",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
