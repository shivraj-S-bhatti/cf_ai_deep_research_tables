import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

    render(
      <MemoryRouter initialEntries={["/threads/thread-1"]}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/threads/:threadId" element={<Index />} />
          <Route path="/threads/new" element={<Index />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show research threads" }));

    expect(screen.getByText("Threads Panel")).toBeInTheDocument();
    expect(screen.getByText(`Active thread: ${thread.id}`)).toBeInTheDocument();
    expect(screen.getByText(thread.query)).toBeInTheDocument();
    expect(screen.getByText("Results Grid")).toBeInTheDocument();
  });

  it("stays on the home shell after reload even when threads exist", () => {
    const thread = makeThread();

    mockedUseThreadStore.mockReturnValue({
      threads: [thread],
      threadsLoaded: true,
      activeThread: null,
      activeThreadId: null,
      creatingPreviewThread: false,
      refreshingPreviewThreadId: null,
      startingRunThreadId: null,
      activeRun: null,
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

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/threads/:threadId" element={<Index />} />
          <Route path="/threads/new" element={<Index />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Initial Search")).toBeInTheDocument();
    expect(screen.queryByText("Results Grid")).not.toBeInTheDocument();
  });

  it("renders the preview-building shell on the draft route", () => {
    mockedUseThreadStore.mockReturnValue({
      threads: [],
      threadsLoaded: true,
      activeThread: null,
      activeThreadId: null,
      creatingPreviewThread: true,
      refreshingPreviewThreadId: null,
      startingRunThreadId: null,
      activeRun: null,
      setActiveThreadId: vi.fn(),
      createThread: vi.fn(() => new Promise<string>(() => undefined)),
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

    render(
      <MemoryRouter initialEntries={["/threads/new?query=Top%20pizza%20places%20in%20Brooklyn"]}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/threads/:threadId" element={<Index />} />
          <Route path="/threads/new" element={<Index />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Building structured preview")).toBeInTheDocument();
    expect(screen.getByText("Top pizza places in Brooklyn")).toBeInTheDocument();
  });

  it("navigates from the draft route to the hydrated preview thread even if submission state flips during create", async () => {
    const thread = {
      ...makeThread(),
      id: "thread-preview",
      query: "Open source LLM projects with >1k stars",
      phase: "preview",
      latestRunId: null,
      latestRun: null,
      criteria: [
        {
          id: "c1",
          label: "Project is open source",
          kind: "hard_filter" as const,
          color: "hsl(220, 80%, 50%)",
        },
      ],
      columns: [
        {
          id: "col1",
          key: "name",
          label: "Project Name",
          kind: "identity" as const,
          valueType: "string" as const,
          preferredSources: ["official"],
          requiresVerification: true,
          allowInference: false,
          nullPolicy: "dash" as const,
          orderIndex: 0,
        },
      ],
      statusSummary: "Plan refreshed. Review criteria and columns before running.",
    } satisfies Thread;

    const storeState: ReturnType<typeof useThreadStore> = {
      threads: [],
      threadsLoaded: true,
      activeThread: null,
      activeThreadId: null,
      creatingPreviewThread: false,
      refreshingPreviewThreadId: null,
      startingRunThreadId: null,
      activeRun: null,
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
    };

    let rerenderApp: (() => void) | null = null;
    let resolveCreateThread: ((value: string) => void) | null = null;
    const renderApp = () => (
      <MemoryRouter initialEntries={["/threads/new?query=Open%20source%20LLM%20projects%20with%20%3E1k%20stars"]}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/threads/:threadId" element={<Index />} />
          <Route path="/threads/new" element={<Index />} />
        </Routes>
      </MemoryRouter>
    );

    storeState.setActiveThreadId = vi.fn((id: string | null) => {
      storeState.activeThreadId = id;
      storeState.activeThread = id === thread.id ? thread : null;
    });
    storeState.createThread = vi.fn(() => new Promise<string>((resolve) => {
      resolveCreateThread = resolve;
    }));

    mockedUseThreadStore.mockImplementation(() => storeState);

    const rendered = render(renderApp());
    rerenderApp = () => rendered.rerender(renderApp());

    await waitFor(() => {
      expect(storeState.createThread).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      storeState.creatingPreviewThread = true;
      rerenderApp?.();
    });

    await act(async () => {
      storeState.creatingPreviewThread = false;
      storeState.threads = [thread];
      resolveCreateThread?.(thread.id);
      await Promise.resolve();
    });

    await waitFor(() => {
      rerenderApp?.();
      expect(screen.getByText("Preview Stage")).toBeInTheDocument();
    });

    expect(storeState.createThread).toHaveBeenCalledTimes(1);
    expect(storeState.setActiveThreadId).toHaveBeenCalledWith(thread.id);
  });
});
