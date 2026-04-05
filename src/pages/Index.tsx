import { useCallback, useRef, useState, useMemo, useEffect } from "react";
import { PanelLeft } from "lucide-react";
import { InitialSearch } from "@/components/InitialSearch";
import { PreviewStage } from "@/components/PreviewStage";
import { ActionToolbar } from "@/components/ActionToolbar";
import { DataGrid } from "@/components/DataGrid";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ThreadList } from "@/components/ThreadList";
import { useThreadStore } from "@/stores/thread-store";
import { applyTableFilters, sortDatasetRows } from "@/lib/table-filters";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  Criterion,
  Enrichment,
  DatasetSortDir,
  DatasetSortKey,
  TableFilterCondition,
} from "@/lib/types";
import { rowAcceptedCount } from "@/lib/types";
import type { RowDetailsResponse } from "@/lib/contracts";
import { resolveWorkspaceShellMode } from "./index-shell";

const Index = () => {
  const {
    threads,
    threadsLoaded,
    activeThread,
    activeThreadId,
    activeRun,
    setActiveThreadId,
    createThread,
    fetchRowDetails,
    refreshQueryPlan,
    updateTarget,
    startRun,
    cancelRun,
    deleteThread,
    hydrateThread,
    addCriterion,
    removeCriterion,
    addEnrichment,
    removeEnrichment,
  } = useThreadStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRowDetail, setSelectedRowDetail] = useState<RowDetailsResponse | null>(null);
  const [selectedRowLoading, setSelectedRowLoading] = useState(false);
  const [showNewSearch, setShowNewSearch] = useState(false);
  const [threadsPanelOpen, setThreadsPanelOpen] = useState(false);
  const [tableFilters, setTableFilters] = useState<TableFilterCondition[]>([]);
  const [sortKey, setSortKey] = useState<DatasetSortKey | null>(null);
  const [sortDir, setSortDir] = useState<DatasetSortDir>("asc");
  const [confirmDialog, setConfirmDialog] = useState(false);
  const pendingActionRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    setTableFilters([]);
    setSortKey(null);
    setSortDir("asc");
    setSelectedId(null);
    setSelectedRowDetail(null);
    setSelectedRowLoading(false);
  }, [activeThreadId]);

  const displayed = useMemo(() => {
    if (!activeThread) return [];
    let rows = [...activeThread.results];
    rows = applyTableFilters(rows, tableFilters);
    rows = sortDatasetRows(rows, sortKey, sortDir);
    return rows;
  }, [activeThread, tableFilters, sortKey, sortDir]);

  const acceptedCount = activeThread ? rowAcceptedCount(activeThread.results) : 0;
  const selectedResult = activeThread?.results.find((r) => r.id === selectedId) ?? null;
  const debugHref =
    activeThread?.latestRunId ? `/threads/${activeThread.id}/debug?runId=${activeThread.latestRunId}` : null;

  useEffect(() => {
    if (!activeThread?.latestRunId || !selectedId) {
      setSelectedRowDetail(null);
      setSelectedRowLoading(false);
      return;
    }

    const controller = new AbortController();
    setSelectedRowLoading(true);
    void fetchRowDetails(activeThread.latestRunId, selectedId, controller.signal)
      .then((detail) => {
        setSelectedRowDetail(detail);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          toast.error("Could not load row details", {
            description: error instanceof Error ? error.message : "Unexpected error",
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSelectedRowLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeThread?.latestRunId, fetchRowDetails, selectedId]);

  const guardConcurrentRun = useCallback(
    (action: () => Promise<void>) => {
      if (activeRun) {
        pendingActionRef.current = action;
        setConfirmDialog(true);
        return;
      }
      void action();
    },
    [activeRun],
  );

  const handleConfirmTerminate = useCallback(async () => {
    setConfirmDialog(false);
    if (!activeRun || !pendingActionRef.current) return;
    try {
      await cancelRun(activeRun.runId);
      toast.info("Previous research terminated", {
        description: `"${activeRun.query}" was stopped. Cache is preserved.`,
      });
    } catch {
      toast.error("Could not cancel the running query");
      return;
    }
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    await action();
  }, [activeRun, cancelRun]);

  const handleNewSearch = (query: string) => {
    guardConcurrentRun(async () => {
      try {
        await createThread(query);
        setShowNewSearch(false);
      } catch (error) {
        toast.error("Could not create research thread", {
          description: error instanceof Error ? error.message : "Unexpected error",
        });
      }
    });
  };

  const handleStartSearch = () => {
    if (!activeThread) return;
    guardConcurrentRun(async () => {
      try {
        await startRun(activeThread.id);
        toast.success("Research started", {
          description: "Rows and cells will stream in as evidence lands.",
        });
      } catch (error) {
        toast.error("Could not start research", {
          description: error instanceof Error ? error.message : "Unexpected error",
        });
      }
    });
  };

  const handleExport = async () => {
    toast.success("CSV export is wired to the backend run contract.");
  };

  const handleNewThread = () => {
    setShowNewSearch(true);
    setSelectedId(null);
    setSelectedRowDetail(null);
  };

  const handleThreadStopRun = useCallback(
    async (threadId: string, runId: string) => {
      try {
        await cancelRun(runId);
        await hydrateThread(threadId);
        toast.success("Run stopped");
      } catch (error) {
        toast.error("Could not stop run", {
          description: error instanceof Error ? error.message : "Unexpected error",
        });
      }
    },
    [cancelRun, hydrateThread],
  );

  const handleThreadDelete = useCallback(
    async (threadId: string) => {
      if (!window.confirm("Delete this research thread? This cannot be undone.")) return;
      try {
        if (threadId === activeThreadId) {
          setSelectedId(null);
          setSelectedRowDetail(null);
          setSelectedRowLoading(false);
        }
        await deleteThread(threadId);
        toast.success("Thread deleted");
      } catch (error) {
        toast.error("Could not delete thread", {
          description: error instanceof Error ? error.message : "Unexpected error",
        });
      }
    },
    [deleteThread],
  );

  const addTableFilter = () => {
    setTableFilters((prev) => [
      ...prev,
      {
        id: `f${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        field: "name",
        operator: "contains",
        value: "",
      },
    ]);
  };

  const removeTableFilter = (id: string) => {
    setTableFilters((prev) => prev.filter((f) => f.id !== id));
  };

  const updateTableFilter = (id: string, patch: Partial<TableFilterCondition>) => {
    setTableFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleSortChange = (key: DatasetSortKey | null, dir: DatasetSortDir) => {
    setSortKey(key);
    setSortDir(dir);
  };

  const shellMode = resolveWorkspaceShellMode({
    showNewSearch,
    threadsLoaded,
    threadCount: threads.length,
    activeThreadId,
    activeThreadPhase: activeThread?.phase ?? null,
  });

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <header className="border-b px-4 py-2 flex items-center gap-2.5 bg-card shrink-0">
        {threads.length > 0 && (
          <Button
            type="button"
            variant={threadsPanelOpen ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-pressed={threadsPanelOpen}
            aria-expanded={threadsPanelOpen}
            aria-controls="threads-panel"
            aria-label={threadsPanelOpen ? "Hide research threads" : "Show research threads"}
            title={threadsPanelOpen ? "Hide threads" : "Threads"}
            onClick={() => setThreadsPanelOpen((open) => !open)}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex items-center gap-2.5">
          <img
            src="/brand/logo.webp"
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 shrink-0 rounded-[28%] object-cover sm:h-7 sm:w-7"
            decoding="async"
          />
          <span className="text-sm font-semibold tracking-tight">Deep Research Datasets</span>
        </div>
        <div className="flex-1" />
      </header>

      <div className="flex flex-1 overflow-hidden relative min-h-0">
        {threads.length > 0 && threadsPanelOpen && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-30 bg-background/60 backdrop-blur-[1px]"
              aria-label="Close threads panel"
              onClick={() => setThreadsPanelOpen(false)}
            />
            <div
              id="threads-panel"
              className="absolute left-0 top-0 bottom-0 z-40 w-[252px] max-w-[min(252px,100vw-2rem)] shadow-lg animate-in slide-in-from-left duration-200 overflow-hidden flex flex-col"
            >
              <ThreadList
                threads={threads}
                activeThreadId={shellMode === "home" ? null : activeThreadId}
                onSelectThread={(id) => {
                  setActiveThreadId(id);
                  setShowNewSearch(false);
                  setSelectedId(null);
                }}
                onNewThread={handleNewThread}
                onStopRun={(tid, rid) => void handleThreadStopRun(tid, rid)}
                onDeleteThread={(tid) => void handleThreadDelete(tid)}
                className="shadow-sm min-w-0 w-full max-w-none"
              />
            </div>
          </>
        )}

        {shellMode === "booting" || shellMode === "loading" ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="rounded-xl border bg-card px-5 py-4 text-center shadow-sm">
              <p className="text-sm font-medium text-foreground">
                {shellMode === "booting" ? "Loading research threads…" : "Opening workspace…"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The current thread state is being hydrated from the worker.
              </p>
            </div>
          </div>
        ) : shellMode === "home" ? (
          <InitialSearch onSearch={handleNewSearch} />
        ) : shellMode === "preview" && activeThread ? (
          <PreviewStage
            thread={activeThread}
            onAddCriterion={(c) => void addCriterion(activeThread.id, c)}
            onRemoveCriterion={(id) => void removeCriterion(activeThread.id, id)}
            onAddEnrichment={(e: Enrichment) => void addEnrichment(activeThread.id, e)}
            onRemoveEnrichment={(id) => void removeEnrichment(activeThread.id, id)}
            onUpdateQuery={(query) => void refreshQueryPlan(activeThread.id, query)}
            onUpdateTarget={(n) => void updateTarget(activeThread.id, n)}
            onStartSearch={() => void handleStartSearch()}
          />
        ) : shellMode === "results" && activeThread ? (
          <div className="flex flex-1 min-w-0 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <div className="px-4 pt-3 pb-2 border-b bg-card shrink-0">
                <ActionToolbar
                  acceptedCount={acceptedCount}
                  totalCount={displayed.length}
                  onExportCsv={() => void handleExport()}
                  debugHref={debugHref}
                  tableFilters={tableFilters}
                  onAddTableFilter={addTableFilter}
                  onRemoveTableFilter={removeTableFilter}
                  onUpdateTableFilter={updateTableFilter}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSortChange={handleSortChange}
                />
              </div>
              <div className="flex-1 overflow-hidden p-4 min-w-0 min-h-0">
                <DataGrid
                  results={displayed}
                  totalResultsCount={activeThread.results.length}
                  phase={activeThread.phase}
                  columns={activeThread.columns}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
            </div>
            <WorkspaceSidebar
              thread={activeThread}
              selectedResult={selectedResult}
              selectedRowDetail={selectedRowDetail}
              selectedRowLoading={selectedRowLoading}
              debugHref={debugHref}
              onUpdateThreadQueryAndCriteria={(query) => void refreshQueryPlan(activeThread.id, query)}
              onAddCriterion={(c) => void addCriterion(activeThread.id, c)}
              onRemoveCriterion={(id) => void removeCriterion(activeThread.id, id)}
              onAddEnrichment={(e) => void addEnrichment(activeThread.id, e)}
              onRemoveEnrichment={(id) => void removeEnrichment(activeThread.id, id)}
              onUpdateTarget={(n) => void updateTarget(activeThread.id, n)}
              onClearSelection={() => {
                setSelectedId(null);
                setSelectedRowDetail(null);
              }}
            />
          </div>
        ) : (
          <InitialSearch onSearch={handleNewSearch} />
        )}
      </div>

      <AlertDialog open={confirmDialog} onOpenChange={(open) => {
        if (!open) {
          setConfirmDialog(false);
          pendingActionRef.current = null;
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Research already running</AlertDialogTitle>
            <AlertDialogDescription>
              "{activeRun?.query}" is still in progress. Starting a new query will terminate
              the current run. Cached results and fetched pages will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleConfirmTerminate()}
            >
              Terminate &amp; start new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Index;
