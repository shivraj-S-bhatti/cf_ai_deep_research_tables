import { useState, useMemo } from "react";
import { Zap } from "lucide-react";
import { InitialSearch } from "@/components/InitialSearch";
import { PreviewStage } from "@/components/PreviewStage";
import { SearchBar } from "@/components/SearchBar";
import { ActionToolbar } from "@/components/ActionToolbar";
import { DataGrid } from "@/components/DataGrid";
import { DetailsSidebar } from "@/components/DetailsSidebar";
import { AgentActivityModal } from "@/components/AgentActivityModal";
import { ThreadList } from "@/components/ThreadList";
import { useThreadStore } from "@/stores/thread-store";
import { mockCriteria, mockAgentSteps } from "@/lib/mock-data";
import { toast } from "sonner";
import type { Criterion, Enrichment } from "@/lib/types";

const Index = () => {
  const {
    threads, activeThread, activeThreadId,
    setActiveThreadId, createThread, updateThread,
    addCriterion, removeCriterion, addEnrichment, removeEnrichment,
  } = useThreadStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterMatches, setFilterMatches] = useState(false);
  const [showNewSearch, setShowNewSearch] = useState(false);

  const displayed = useMemo(
    () => {
      if (!activeThread) return [];
      return filterMatches
        ? activeThread.results.filter((r) => r.status === "match")
        : activeThread.results;
    },
    [activeThread, filterMatches]
  );

  const matchCount = activeThread?.results.filter((r) => r.status === "match").length ?? 0;
  const selectedResult = activeThread?.results.find((r) => r.id === selectedId) ?? null;

  const handleNewSearch = (query: string) => {
    const thread = createThread(query);
    // Auto-generate some criteria from the query
    const autoCriteria: Criterion[] = mockCriteria.map((c, i) => ({
      ...c,
      id: `c${Date.now()}-${i}`,
    }));
    autoCriteria.forEach((c) => addCriterion(thread.id, c));
    setShowNewSearch(false);
  };

  const handleStartSearch = () => {
    if (!activeThread) return;
    // Simulate transitioning to results with mock data
    updateThread(activeThread.id, {
      phase: "complete",
      results: (await import("@/lib/mock-data")).mockResults,
      agentSteps: mockAgentSteps,
    });
    toast.success("Search complete", { description: `Found ${6} results` });
  };

  const handleAddEnrichment = (name: string) => {
    if (!activeThread) return;
    addEnrichment(activeThread.id, { id: `e${Date.now()}`, name });
    toast.success(`Extracting "${name}"…`);
  };

  const handleExport = () => {
    toast.success("CSV exported", { description: `${displayed.length} rows` });
  };

  const handleNewThread = () => {
    setShowNewSearch(true);
    setSelectedId(null);
  };

  // Show initial search if no threads or explicitly creating new
  const showInitial = showNewSearch || threads.length === 0;
  const isPreview = activeThread?.phase === "preview" || activeThread?.phase === "search";
  const isResults = activeThread?.phase === "complete" || activeThread?.phase === "running";

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="border-b px-4 py-2 flex items-center gap-2.5 bg-card shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
            <Zap className="h-3 w-3 text-primary-foreground" />
          </div>
          <span className="font-semibold text-xs">Agentic Search</span>
        </div>
        <div className="flex-1" />
        {isResults && activeThread && (
          <AgentActivityModal steps={activeThread.agentSteps} />
        )}
      </header>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Thread sidebar */}
        {threads.length > 0 && (
          <ThreadList
            threads={threads}
            activeThreadId={showInitial ? null : activeThreadId}
            onSelectThread={(id) => {
              setActiveThreadId(id);
              setShowNewSearch(false);
              setSelectedId(null);
            }}
            onNewThread={handleNewThread}
          />
        )}

        {/* Content */}
        {showInitial ? (
          <InitialSearch onSearch={handleNewSearch} />
        ) : isPreview && activeThread ? (
          <PreviewStage
            thread={activeThread}
            onAddCriterion={(c) => addCriterion(activeThread.id, c)}
            onRemoveCriterion={(id) => removeCriterion(activeThread.id, id)}
            onAddEnrichment={(e) => addEnrichment(activeThread.id, e)}
            onRemoveEnrichment={(id) => removeEnrichment(activeThread.id, id)}
            onUpdateQuery={(q) => updateThread(activeThread.id, { query: q })}
            onUpdateTarget={(n) => updateThread(activeThread.id, { targetResults: n })}
            onStartSearch={handleStartSearch}
          />
        ) : isResults && activeThread ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 pt-3 pb-2 space-y-2 border-b bg-card">
              <SearchBar thread={activeThread} onUpdateQuery={(q) => updateThread(activeThread.id, { query: q })} />
              <ActionToolbar
                matchCount={matchCount}
                totalCount={activeThread.results.length}
                onAddEnrichment={handleAddEnrichment}
                onFilterMatches={() => setFilterMatches((p) => !p)}
                onExportCsv={handleExport}
                filterActive={filterMatches}
              />
            </div>
            <div className="flex-1 overflow-auto p-4">
              <DataGrid
                results={displayed}
                enrichments={activeThread.enrichments}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>
          </div>
        ) : (
          <InitialSearch onSearch={handleNewSearch} />
        )}

        {/* Details sidebar */}
        {selectedResult && (
          <DetailsSidebar
            result={selectedResult}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
};

export default Index;
