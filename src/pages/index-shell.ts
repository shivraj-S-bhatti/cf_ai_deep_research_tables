import type { ThreadLifecyclePhase } from "@/lib/types";

export type WorkspaceShellMode = "booting" | "home" | "loading" | "preview" | "results";

export function resolveWorkspaceShellMode(input: {
  showNewSearch: boolean;
  threadsLoaded: boolean;
  threadCount: number;
  activeThreadId: string | null;
  activeThreadPhase: ThreadLifecyclePhase | null;
}): WorkspaceShellMode {
  const { showNewSearch, threadsLoaded, threadCount, activeThreadId, activeThreadPhase } = input;

  if (showNewSearch) return "home";
  if (!threadsLoaded) return "booting";
  if (threadCount === 0) return "home";
  if (!activeThreadId) return "loading";
  if (!activeThreadPhase) return "loading";
  if (activeThreadPhase === "preview") return "preview";
  return "results";
}
