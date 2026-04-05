import type { ActivityStage, ResearchRun, ThreadPhase } from "@/lib/contracts";

export function stageActivityTitle(stage: ActivityStage | "idle"): string {
  switch (stage) {
    case "planning":
      return "Planning query";
    case "discovery":
      return "Searching for source pages";
    case "fetch":
      return "Fetching promising pages";
    case "extraction":
      return "Extracting candidate anchors";
    case "evaluation":
      return "Scoring extracted evidence";
    case "canonicalization":
      return "Merging duplicate matches";
    case "refinement":
      return "Corroborating strongest matches";
    case "verification":
      return "Checking ambiguous evidence";
    case "ranking":
      return "Finalizing grounded rows";
    case "export":
      return "Packaging results";
    case "idle":
    default:
      return "Working";
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ratio(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, value / total));
}

export function describeActiveRunState(input: {
  run: Pick<ResearchRun, "stage" | "progress" | "status">;
  targetResults: number;
}): {
  title: string;
  detail: string;
  note?: string;
  progressPct: number;
} {
  const { run, targetResults } = input;
  const { stage, progress } = run;
  const queryRatio = ratio(progress.queriesCompleted, progress.totalQueries);
  const rowRatio = ratio(progress.rowsCreated, targetResults);
  const sourceTarget = Math.max(1, Math.min(8, targetResults || 1));
  const sourceRatio = ratio(progress.sourcesFetched, sourceTarget);

  const detailParts: string[] = [];
  if (progress.totalQueries > 0) {
    detailParts.push(`${progress.queriesCompleted}/${progress.totalQueries} queries complete`);
  }
  if (progress.sourcesFetched > 0) {
    detailParts.push(`${progress.sourcesFetched} pages fetched`);
  }
  if (progress.rowsCreated > 0) {
    detailParts.push(`${progress.rowsCreated} grounded rows`);
  } else {
    detailParts.push("no grounded rows yet");
  }

  let progressPct = 8;
  switch (stage) {
    case "planning":
      progressPct = 8;
      break;
    case "discovery":
      progressPct = 15 + queryRatio * 15;
      break;
    case "fetch":
      progressPct = 32 + Math.max(queryRatio, sourceRatio) * 16;
      break;
    case "extraction":
      progressPct = 48 + Math.max(sourceRatio, rowRatio) * 14;
      break;
    case "evaluation":
      progressPct = 62 + rowRatio * 8;
      break;
    case "canonicalization":
      progressPct = 72 + rowRatio * 6;
      break;
    case "refinement":
      progressPct = 78 + Math.max(sourceRatio, rowRatio) * 12;
      break;
    case "verification":
      progressPct = 90 + rowRatio * 4;
      break;
    case "ranking":
      progressPct = 96;
      break;
    case "export":
      progressPct = 100;
      break;
    case "idle":
    default:
      progressPct = 5;
      break;
  }

  return {
    title: stageActivityTitle(stage),
    detail: detailParts.join(" · "),
    note:
      progress.rowsCreated === 0
        ? "Provisional candidates stay hidden until backed by a source."
        : undefined,
    progressPct: clampPercent(progressPct),
  };
}

export function runLoadingHeadline(input: {
  phase: ThreadPhase;
  stage: ActivityStage | "idle";
  statusSummary?: string;
}): { headline: string; subline?: string } {
  const { phase, stage, statusSummary } = input;
  const summary = statusSummary?.trim();

  if (phase === "queued") {
    return { headline: "Queued…", subline: summary ?? "Waiting to start." };
  }

  if (phase === "running" || (stage && stage !== "idle")) {
    if (phase === "complete") {
      return {
        headline: "Research complete",
        subline: summary || undefined,
      };
    }
    if (phase === "failed") {
      return {
        headline: "Research failed",
        subline: summary || undefined,
      };
    }
    if (phase === "canceled") {
      return {
        headline: "Research canceled",
        subline: summary || undefined,
      };
    }
    return {
      headline: stageActivityTitle(stage),
      subline: summary || undefined,
    };
  }

  return { headline: "Research", subline: summary };
}

export function describePotentialStall(run: Pick<ResearchRun, "status" | "stage" | "metrics" | "progress">): string | null {
  if (!["queued", "running"].includes(run.status)) return null;

  if (
    run.stage === "extraction"
    && run.metrics.elapsedMs > 15_000
    && run.progress.sourcesFetched > 0
    && run.metrics.llmCalls === 0
  ) {
    return "Fetched pages, but still waiting on the first extraction response. This may be stalled.";
  }

  if (
    run.stage === "refinement"
    && run.metrics.elapsedMs > 30_000
    && run.progress.rowsCreated === 0
  ) {
    return "Corroboration is taking longer than expected and has not produced a grounded row yet.";
  }

  if (
    run.stage === "fetch"
    && run.metrics.elapsedMs > 20_000
    && run.progress.sourcesFetched === 0
  ) {
    return "Still waiting on the first page fetch. This may be stalled.";
  }

  return null;
}
