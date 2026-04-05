import { useState, useEffect } from "react";
import { X, Plus, Play, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Thread, Criterion, Enrichment } from "@/lib/types";

const COLORS = ["hsl(220, 80%, 50%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)", "hsl(280, 60%, 50%)", "hsl(350, 70%, 50%)"];

interface PreviewStageProps {
  thread: Thread;
  isRefreshingPreview?: boolean;
  isStartingRun?: boolean;
  onAddCriterion: (c: Criterion) => void;
  onRemoveCriterion: (id: string) => void;
  onAddEnrichment: (e: Enrichment) => void;
  onRemoveEnrichment: (id: string) => void;
  onUpdateQuery: (query: string) => void;
  onUpdateTarget: (n: number) => void;
  onStartSearch: () => void;
}

export function PreviewStage({
  thread,
  isRefreshingPreview = false,
  isStartingRun = false,
  onAddCriterion,
  onRemoveCriterion,
  onAddEnrichment,
  onRemoveEnrichment,
  onUpdateQuery,
  onUpdateTarget,
  onStartSearch,
}: PreviewStageProps) {
  const [newCriterion, setNewCriterion] = useState("");
  const [newEnrichment, setNewEnrichment] = useState("");
  const [editingQuery, setEditingQuery] = useState(false);
  const [queryDraft, setQueryDraft] = useState(thread.query);

  useEffect(() => {
    setQueryDraft(thread.query);
  }, [thread.id, thread.query]);

  const handleAddCriterion = () => {
    if (!newCriterion.trim()) return;
    onAddCriterion({
      id: `c${Date.now()}`,
      label: newCriterion.trim(),
      kind: "hard_filter",
      color: COLORS[thread.criteria.length % COLORS.length],
    });
    setNewCriterion("");
  };

  const handleAddEnrichment = () => {
    if (!newEnrichment.trim()) return;
    const label = newEnrichment.trim();
    onAddEnrichment({
      id: `e${Date.now()}`,
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label,
      kind: "enrichment",
      valueType: "string",
      preferredSources: ["official"],
      requiresVerification: true,
      allowInference: false,
      nullPolicy: "dash",
      orderIndex: thread.columns.length,
    });
    setNewEnrichment("");
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-2xl space-y-6 px-4">
        {/* Query */}
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Query</label>
          {editingQuery ? (
            <div className="flex gap-2">
              <Input
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                className="text-sm h-9"
                autoFocus
              />
              <Button
                size="sm"
                variant="outline"
                disabled={isRefreshingPreview}
                onClick={() => {
                  onUpdateQuery(queryDraft);
                  setEditingQuery(false);
                }}
              >
                {isRefreshingPreview ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Refreshing…
                  </>
                ) : "Save"}
              </Button>
            </div>
          ) : (
            <div
              className="flex items-start gap-2 cursor-pointer group"
              onClick={() => setEditingQuery(true)}
            >
              <p className="text-sm leading-relaxed">{thread.query}</p>
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-1 transition-opacity" />
            </div>
          )}
          {isRefreshingPreview ? (
            <p className="text-xs text-muted-foreground">Refreshing preview…</p>
          ) : null}
        </div>

        {/* Criteria */}
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
            Criteria ({thread.criteria.length})
          </label>
          <div className="space-y-1.5">
            {thread.criteria.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-md border group"
                style={{ borderLeftColor: c.color, borderLeftWidth: 3 }}
              >
                <span className="flex-1">{c.label}</span>
                <button
                  onClick={() => onRemoveCriterion(c.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newCriterion}
              onChange={(e) => setNewCriterion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isRefreshingPreview && handleAddCriterion()}
              placeholder="Add a criterion…"
              className="text-xs h-8"
              disabled={isRefreshingPreview}
            />
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs shrink-0" onClick={handleAddCriterion} disabled={isRefreshingPreview}>
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>
        </div>

        {/* Enrichments */}
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
            Output Columns
          </label>
          <div className="flex flex-wrap gap-1.5">
            {thread.columns.map((e) => (
              <Badge key={e.id} variant="secondary" className="gap-1 text-xs">
                {e.label}
                <button onClick={() => onRemoveEnrichment(e.id)}>
                  <X className="h-2.5 w-2.5 hover:text-destructive" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newEnrichment}
              onChange={(e) => setNewEnrichment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isRefreshingPreview && handleAddEnrichment()}
              placeholder='e.g. "Website", "License", "Location"'
              className="text-xs h-8"
              disabled={isRefreshingPreview}
            />
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs shrink-0" onClick={handleAddEnrichment} disabled={isRefreshingPreview}>
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>
        </div>

        {/* Target + Start */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Target results:</span>
            <Select
              value={String(thread.targetResults)}
              onValueChange={(v) => onUpdateTarget(Number(v))}
              disabled={isRefreshingPreview || isStartingRun}
            >
              <SelectTrigger className="w-20 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="15">15</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="25">25</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={onStartSearch} className="gap-2" disabled={isRefreshingPreview || isStartingRun}>
            {isStartingRun ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isStartingRun ? "Starting research…" : "Run Search"}
          </Button>
        </div>
      </div>
    </div>
  );
}
