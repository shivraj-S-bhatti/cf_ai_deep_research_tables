import { describe, expect, it } from "vitest";

import type { ResearchRun } from "../../lib/contracts";
import { buildThreadBundle } from "../domain/planner";
import { emptyMetrics, emptyProgress, MemoryResearchStore } from "./memory-store";

function makeRun(threadId: string, runId: string): ResearchRun {
  return {
    id: runId,
    threadId,
    status: "complete",
    stage: "export",
    startedAt: 1,
    finishedAt: 2,
    errorCode: null,
    errorMessage: null,
    progress: emptyProgress(),
    metrics: emptyMetrics(),
  };
}

describe("MemoryResearchStore", () => {
  it("deletes all runs when a thread is removed", () => {
    const store = new MemoryResearchStore();
    const bundle = buildThreadBundle({
      query: "delete thread cleanup",
      targetResults: 5,
      criteria: [],
      columns: [],
    });
    store.createThread(bundle);

    store.createRun(makeRun(bundle.thread.id, "run-1"));
    store.createRun(makeRun(bundle.thread.id, "run-2"));

    expect(store.getRun("run-1")).not.toBeNull();
    expect(store.getRun("run-2")).not.toBeNull();

    expect(store.deleteThread(bundle.thread.id)).toBe(true);
    expect(store.getRun("run-1")).toBeNull();
    expect(store.getRun("run-2")).toBeNull();
  });

  it("drops all runs for pruned threads when enforcing thread retention", () => {
    const store = new MemoryResearchStore();
    const first = buildThreadBundle({
      query: "first retained thread",
      targetResults: 5,
      criteria: [],
      columns: [],
    });
    const second = buildThreadBundle({
      query: "second retained thread",
      targetResults: 5,
      criteria: [],
      columns: [],
    });

    store.createThread(first);
    store.createRun(makeRun(first.thread.id, "first-run-1"));
    store.createRun(makeRun(first.thread.id, "first-run-2"));

    store.createThread(second);
    store.createRun(makeRun(second.thread.id, "second-run-1"));

    store.pruneOldestThreadsIfOver(1);

    expect(store.getThreadSnapshot(first.thread.id)).toBeNull();
    expect(store.getRun("first-run-1")).toBeNull();
    expect(store.getRun("first-run-2")).toBeNull();
    expect(store.getThreadSnapshot(second.thread.id)).not.toBeNull();
    expect(store.getRun("second-run-1")).not.toBeNull();
  });

  it("restores thread and run state from a serialized snapshot", () => {
    const original = new MemoryResearchStore();
    const bundle = buildThreadBundle({
      query: "snapshot restore",
      targetResults: 3,
      criteria: [],
      columns: [],
    });
    original.createThread(bundle);
    original.createRun(makeRun(bundle.thread.id, "snapshot-run"));

    const restored = new MemoryResearchStore(original.exportState());

    expect(restored.getThreadSnapshot(bundle.thread.id)?.thread.queryRaw).toBe("snapshot restore");
    expect(restored.getRun("snapshot-run")?.threadId).toBe(bundle.thread.id);
  });
});
