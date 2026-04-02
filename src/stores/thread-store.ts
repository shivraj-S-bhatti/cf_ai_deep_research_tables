import { useState, useCallback } from "react";
import type { Thread, Criterion, Enrichment } from "@/lib/types";
import { mockThreads, mockThread } from "@/lib/mock-data";

// Simple hook-based store for thread management
export function useThreadStore() {
  const [threads, setThreads] = useState<Thread[]>(mockThreads);
  const [activeThreadId, setActiveThreadId] = useState<string>(mockThread.id);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  const createThread = useCallback((query: string) => {
    const newThread: Thread = {
      id: `t${Date.now()}`,
      query,
      phase: "preview",
      criteria: [],
      enrichments: [],
      results: [],
      agentSteps: [],
      targetResults: 25,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
    return newThread;
  }, []);

  const updateThread = useCallback((id: string, updates: Partial<Thread>) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t))
    );
  }, []);

  const addCriterion = useCallback((threadId: string, criterion: Criterion) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, criteria: [...t.criteria, criterion], updatedAt: Date.now() }
          : t
      )
    );
  }, []);

  const removeCriterion = useCallback((threadId: string, criterionId: string) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, criteria: t.criteria.filter((c) => c.id !== criterionId), updatedAt: Date.now() }
          : t
      )
    );
  }, []);

  const addEnrichment = useCallback((threadId: string, enrichment: Enrichment) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, enrichments: [...t.enrichments, enrichment], updatedAt: Date.now() }
          : t
      )
    );
  }, []);

  const removeEnrichment = useCallback((threadId: string, enrichmentId: string) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, enrichments: t.enrichments.filter((e) => e.id !== enrichmentId), updatedAt: Date.now() }
          : t
      )
    );
  }, []);

  return {
    threads,
    activeThread,
    activeThreadId,
    setActiveThreadId,
    createThread,
    updateThread,
    addCriterion,
    removeCriterion,
    addEnrichment,
    removeEnrichment,
  };
}
