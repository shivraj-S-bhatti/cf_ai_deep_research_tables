import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InitialSearch } from "./InitialSearch";

describe("InitialSearch", () => {
  it("shows immediate pending UI while preview creation is in flight", () => {
    const onSearch = vi.fn();
    render(<InitialSearch onSearch={onSearch} isSubmitting />);

    const button = screen.getByRole("button", { name: /building preview/i });
    const input = screen.getByPlaceholderText("e.g. YC W24 healthcare startups");

    expect(button).toBeDisabled();
    expect(input).toBeDisabled();
  });

  it("submits the query when the user starts research", () => {
    const onSearch = vi.fn();
    render(<InitialSearch onSearch={onSearch} />);

    fireEvent.change(screen.getByPlaceholderText("e.g. YC W24 healthcare startups"), {
      target: { value: "Top pizza places in Brooklyn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Research" }));

    expect(onSearch).toHaveBeenCalledWith("Top pizza places in Brooklyn");
  });
});
