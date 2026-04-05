import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import Index from "./Index";
import { useThreadStore } from "@/stores/thread-store";
import type { Thread } from "@/lib/types";

vi.mock("@/stores/thread-store", () => ({
  useThreadStore: vi.fn(),
}));

vi.mock("@/components/InitialSearch", () => ({
  InitialSearch: () => <div>Initial Search</div>,
}));

vi.mock("@/components/PreviewStage", () => ({
  PreviewStage: () => <div>Preview Stage</div>,
}));

vi.mock("@/components/ActionToolbar", () => ({
  ActionToolbar: ({ acceptedCount, totalCount }: { acceptedCount: number; totalCount: number }) => (
    <div>{acceptedCount} accepted / {totalCount} total</div>
  ),
}));

vi.mock("@/components/DataGrid", () => ({
  DataGrid: () => <div>Results Grid</div>,
}));

vi.mock("@/components/WorkspaceSidebar", () => ({
  WorkspaceSidebar: () => <div>Workspace Sidebar</div>,
}));

vi.mock("@/components/ThreadList", () => ({
  ThreadList: ({
    threads,
    activeThreadId,
  }: {
    threads: Array<{ query: string }>;
    activeThreadId: string | null;
  }) => (
    <div>
      <div>Threads Panel</div>
      <div>Active thread: {activeThreadId ?? "none"}</div>
      <div>{threads[0]?.query}</div>
    </div>
  ),
}));

const mockedUseThreadStore = vi.mocked(useThreadStore);

function makeThread(): Thread {
  return {
    id: "thread-1",
    query: "YC W24 healthcare startups",
    phase: "running",
    entityType: "company",
    criteria: [],
    columns: [],
    results: [],
    targetResults: 10,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    latestRunId: "run-1",
    latestRun: {
      id: "run-1",
      threadId: "thread-1",
      status: "running",
      stage: "refinement",
      startedAt: Date.now(),
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      progress: {
        queriesCompleted: 1,
        sourcesFetched: 1,
        rowsCreated: 0,
        cellsResolved: 0,
        totalQueries: 1,
        totalRows: 0,
      },
      metrics: {
        searchCalls: 1,
        fetchCalls: 1,
        llmCalls: 1,
        cacheHits: 0,
        cacheMisses: 0,
        estimatedCostUsd: 0,
        budgetConsumedUsd: 0,
        elapsedMs: 0,
        stageDurationsMs: {},
        providerBreakdown: [],
      },
    },
    metrics: null,
    statusSummary: "0 accepted · 0 in-flight",
  };
}

describe("Index", () => {
  beforeEach(() => {
    mockedUseThreadStore.mockReset();
  });

  it("opens the threads panel without throwing a render error", () => {
    const thread = makeThread();

    mockedUseThreadStore.mockReturnValue({
      threads: [thread],
      threadsLoaded: true,
      activeThread: thread,
      activeThreadId: thread.id,
      creatingPreviewThread: false,
      refreshingPreviewThreadId: null,
      startingRunThreadId: null,
      activeRun: { threadId: thread.id, runId: "run-1", query: thread.query },
      setActiveThreadId: vi.fn(),
      createThread: vi.fn(),
      fetchRowDetails: vi.fn(),
      refreshQueryPlan: vi.fn(),
      updateTarget: vi.fn(),
      startRun: vi.fn(),
      cancelRun: vi.fn(),
      deleteThread: vi.fn(),
      hydrateThread: vi.fn(),
      addCriterion: vi.fn(),
      removeCriterion: vi.fn(),
      addEnrichment: vi.fn(),
      removeEnrichment: vi.fn(),
    });

    render(<Index />);

    fireEvent.click(screen.getByRole("button", { name: "Show research threads" }));

    expect(screen.getByText("Threads Panel")).toBeInTheDocument();
    expect(screen.getByText(`Active thread: ${thread.id}`)).toBeInTheDocument();
    expect(screen.getByText(thread.query)).toBeInTheDocument();
    expect(screen.getByText("Results Grid")).toBeInTheDocument();
  });
});
