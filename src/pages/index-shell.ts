import type { ThreadLifecyclePhase } from "@/lib/types";

export type WorkspaceShellMode = "booting" | "home" | "loading" | "draft" | "preview" | "results";

export function resolveWorkspaceShellMode(input: {
  routeMode: "home" | "draft" | "thread";
  threadsLoaded: boolean;
  threadCount: number;
  activeThreadId: string | null;
  activeThreadPhase: ThreadLifecyclePhase | null;
}): WorkspaceShellMode {
  const { routeMode, threadsLoaded, threadCount, activeThreadId, activeThreadPhase } = input;

  if (routeMode === "home") return "home";
  if (!threadsLoaded) return "booting";
  if (routeMode === "draft") return "draft";
  if (threadCount === 0) return "home";
  if (!activeThreadId) return "loading";
  if (!activeThreadPhase) return "loading";
  if (activeThreadPhase === "preview") return "preview";
  return "results";
}
