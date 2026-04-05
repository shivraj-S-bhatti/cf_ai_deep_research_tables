import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Thread } from "@/lib/types";
import { PreviewStage } from "./PreviewStage";

function makeThread(): Thread {
  return {
    id: "thread-1",
    query: "YC W24 healthcare startups",
    phase: "preview",
    entityType: "company",
    criteria: [
      {
        id: "criterion-1",
        label: "Entity appears relevant",
        description: "",
        kind: "hard_filter",
        color: "#000000",
      },
    ],
    columns: [
      {
        id: "column-1",
        key: "website",
        label: "Website",
        kind: "identity",
        valueType: "url",
        preferredSources: ["official"],
        requiresVerification: true,
        allowInference: false,
        nullPolicy: "dash",
        orderIndex: 0,
      },
    ],
    results: [],
    targetResults: 10,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    latestRunId: null,
    latestRun: null,
    metrics: null,
    statusSummary: "Preview ready",
  };
}

describe("PreviewStage", () => {
  it("shows immediate pending UI while the run is starting", () => {
    render(
      <PreviewStage
        thread={makeThread()}
        isStartingRun
        onAddCriterion={vi.fn()}
        onRemoveCriterion={vi.fn()}
        onAddEnrichment={vi.fn()}
        onRemoveEnrichment={vi.fn()}
        onUpdateQuery={vi.fn()}
        onUpdateTarget={vi.fn()}
        onStartSearch={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /starting research/i })).toBeDisabled();
  });

  it("shows immediate pending UI while the preview is refreshing", () => {
    render(
      <PreviewStage
        thread={makeThread()}
        isRefreshingPreview
        onAddCriterion={vi.fn()}
        onRemoveCriterion={vi.fn()}
        onAddEnrichment={vi.fn()}
        onRemoveEnrichment={vi.fn()}
        onUpdateQuery={vi.fn()}
        onUpdateTarget={vi.fn()}
        onStartSearch={vi.fn()}
      />,
    );

    expect(screen.getByText("Refreshing preview…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run Search" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Add a criterion…")).toBeDisabled();
  });

  it("persists the edited query when save is clicked", () => {
    const onUpdateQuery = vi.fn();
    render(
      <PreviewStage
        thread={makeThread()}
        onAddCriterion={vi.fn()}
        onRemoveCriterion={vi.fn()}
        onAddEnrichment={vi.fn()}
        onRemoveEnrichment={vi.fn()}
        onUpdateQuery={onUpdateQuery}
        onUpdateTarget={vi.fn()}
        onStartSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("YC W24 healthcare startups"));
    const input = screen.getByDisplayValue("YC W24 healthcare startups");
    fireEvent.change(input, { target: { value: "Top pizza places in Brooklyn" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdateQuery).toHaveBeenCalledWith("Top pizza places in Brooklyn");
  });
});
