import { useState, useMemo, useEffect } from "react";
import { PanelLeft, Zap } from "lucide-react";
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
import type {
  Criterion,
  Enrichment,
  DatasetSortDir,
  DatasetSortKey,
  TableFilterCondition,
} from "@/lib/types";
import { rowAcceptedCount } from "@/lib/types";

const Index = () => {
  const {
    threads,
    activeThread,
    activeThreadId,
    setActiveThreadId,
    createThread,
    refreshQueryPlan,
    updateTarget,
    startRun,
    addCriterion,
    removeCriterion,
    addEnrichment,
    removeEnrichment,
  } = useThreadStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewSearch, setShowNewSearch] = useState(false);
  const [threadsPanelOpen, setThreadsPanelOpen] = useState(false);
  const [tableFilters, setTableFilters] = useState<TableFilterCondition[]>([]);
  const [sortKey, setSortKey] = useState<DatasetSortKey | null>(null);
  const [sortDir, setSortDir] = useState<DatasetSortDir>("asc");

  useEffect(() => {
    setTableFilters([]);
    setSortKey(null);
    setSortDir("asc");
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

  const handleNewSearch = async (query: string) => {
    try {
      await createThread(query);
      setShowNewSearch(false);
    } catch (error) {
      toast.error("Could not create research thread", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  };

  const handleStartSearch = async () => {
    if (!activeThread) return;
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
  };

  const handleExport = async () => {
    toast.success("CSV export is wired to the backend run contract.");
  };

  const handleNewThread = () => {
    setShowNewSearch(true);
    setSelectedId(null);
  };

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

  const showInitial = showNewSearch || threads.length === 0;
  const isPreview = activeThread?.phase === "preview" || !activeThread?.latestRunId;
  const isResults = Boolean(activeThread?.latestRunId) || ["running", "queued", "complete", "failed", "canceled"].includes(activeThread?.phase ?? "");

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
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
            <Zap className="h-3 w-3 text-primary-foreground" />
          </div>
          <span className="font-semibold text-xs">Agentic Search</span>
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
              className="absolute left-0 top-0 bottom-0 z-40 w-[220px] max-w-[min(220px,100vw-2rem)] shadow-lg animate-in slide-in-from-left duration-200 overflow-hidden flex flex-col"
            >
              <ThreadList
                threads={threads}
                activeThreadId={showInitial ? null : activeThreadId}
                onSelectThread={(id) => {
                  setActiveThreadId(id);
                  setShowNewSearch(false);
                  setSelectedId(null);
                }}
                onNewThread={handleNewThread}
                className="shadow-sm min-w-0"
              />
            </div>
          </>
        )}

        {showInitial ? (
          <InitialSearch onSearch={handleNewSearch} />
        ) : isPreview && activeThread ? (
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
        ) : isResults && activeThread ? (
          <div className="flex flex-1 min-w-0 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <div className="px-4 pt-3 pb-2 border-b bg-card shrink-0">
                <ActionToolbar
                  acceptedCount={acceptedCount}
                  totalCount={displayed.length}
                  onExportCsv={() => void handleExport()}
                  agentSteps={activeThread.agentSteps}
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
                  columns={activeThread.columns}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
            </div>
            <WorkspaceSidebar
              thread={activeThread}
              selectedResult={selectedResult}
              onUpdateThreadQueryAndCriteria={(query) => void refreshQueryPlan(activeThread.id, query)}
              onAddCriterion={(c) => void addCriterion(activeThread.id, c)}
              onRemoveCriterion={(id) => void removeCriterion(activeThread.id, id)}
              onAddEnrichment={(e) => void addEnrichment(activeThread.id, e)}
              onRemoveEnrichment={(id) => void removeEnrichment(activeThread.id, id)}
              onUpdateTarget={(n) => void updateTarget(activeThread.id, n)}
              onClearSelection={() => setSelectedId(null)}
            />
          </div>
        ) : (
          <InitialSearch onSearch={handleNewSearch} />
        )}
      </div>
    </div>
  );
};

export default Index;
