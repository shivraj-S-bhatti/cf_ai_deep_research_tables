import { describe, expect, it } from "vitest";

import { resolveWorkspaceShellMode } from "./index-shell";

describe("resolveWorkspaceShellMode", () => {
  it("stays in booting mode until thread summaries load", () => {
    expect(resolveWorkspaceShellMode({
      showNewSearch: false,
      threadsLoaded: false,
      threadCount: 0,
      activeThreadId: null,
      activeThreadPhase: null,
    })).toBe("booting");
  });

  it("renders home when there are no threads after loading", () => {
    expect(resolveWorkspaceShellMode({
      showNewSearch: false,
      threadsLoaded: true,
      threadCount: 0,
      activeThreadId: null,
      activeThreadPhase: null,
    })).toBe("home");
  });

  it("uses loading mode while an active thread is being resolved", () => {
    expect(resolveWorkspaceShellMode({
      showNewSearch: false,
      threadsLoaded: true,
      threadCount: 2,
      activeThreadId: "thread-1",
      activeThreadPhase: null,
    })).toBe("loading");
  });

  it("treats preview as its own shell mode", () => {
    expect(resolveWorkspaceShellMode({
      showNewSearch: false,
      threadsLoaded: true,
      threadCount: 1,
      activeThreadId: "thread-1",
      activeThreadPhase: "preview",
    })).toBe("preview");
  });

  it("routes non-preview phases into the results shell", () => {
    expect(resolveWorkspaceShellMode({
      showNewSearch: false,
      threadsLoaded: true,
      threadCount: 1,
      activeThreadId: "thread-1",
      activeThreadPhase: "running",
    })).toBe("results");
  });
});
