import type { ActivityStage, ThreadPhase } from "@/lib/contracts";

export function stageActivityTitle(stage: ActivityStage | "idle"): string {
  switch (stage) {
    case "planning":
      return "Planning query";
    case "discovery":
      return "Discovering candidates";
    case "fetch":
      return "Fetching sources";
    case "extraction":
      return "Extracting row details";
    case "evaluation":
      return "Evaluating criteria";
    case "canonicalization":
      return "Canonicalizing entities";
    case "refinement":
      return "Refining coverage";
    case "verification":
      return "Validating ambiguous rows";
    case "ranking":
      return "Ranking results";
    case "export":
      return "Packaging exports";
    case "idle":
    default:
      return "Working";
  }
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
    return {
      headline: stageActivityTitle(stage),
      subline: summary || undefined,
    };
  }

  return { headline: "Research", subline: summary };
}
