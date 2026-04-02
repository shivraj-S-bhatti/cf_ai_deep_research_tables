import { useState, useMemo } from "react";
import { Zap } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { ActionToolbar } from "@/components/ActionToolbar";
import { DataGrid } from "@/components/DataGrid";
import { ProvenanceSidebar } from "@/components/ProvenanceSidebar";
import { mockResults, mockCriteria } from "@/lib/mock-data";
import { toast } from "sonner";

const Index = () => {
  const [results] = useState(mockResults);
  const [enrichments, setEnrichments] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterMatches, setFilterMatches] = useState(false);

  const displayed = useMemo(
    () => (filterMatches ? results.filter((r) => r.status === "match") : results),
    [results, filterMatches]
  );

  const matchCount = results.filter((r) => r.status === "match").length;
  const selectedResult = results.find((r) => r.id === selectedId) ?? null;

  const handleSearch = (query: string) => {
    toast.success("Search started", { description: query.slice(0, 80) + "…" });
  };

  const handleAddEnrichment = (name: string) => {
    if (enrichments.includes(name)) {
      toast.error("Column already exists");
      return;
    }
    setEnrichments((prev) => [...prev, name]);
    toast.success(`Extracting "${name}" for all results…`);
  };

  const handleExport = () => {
    toast.success("CSV exported", { description: `${displayed.length} rows exported` });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center gap-3 bg-card">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm">Agentic Search</span>
        </div>
      </header>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-4">
          <SearchBar criteria={mockCriteria} onSearch={handleSearch} />
          <ActionToolbar
            matchCount={matchCount}
            totalCount={results.length}
            onAddEnrichment={handleAddEnrichment}
            onFilterMatches={() => setFilterMatches((p) => !p)}
            onExportCsv={handleExport}
          />
          <div className="flex-1 overflow-auto">
            <DataGrid
              results={displayed}
              enrichments={enrichments}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </div>

        {/* Sidebar */}
        {selectedResult && (
          <ProvenanceSidebar
            result={selectedResult}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
};

export default Index;
