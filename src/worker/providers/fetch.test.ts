import { describe, expect, it } from "vitest";
import { classifySource } from "./fetch";

describe("classifySource", () => {
  it("treats concrete GitHub repository pages as entity pages", () => {
    expect(
      classifySource({
        finalUrl: "https://github.com/vllm-project/vllm",
        title: "GitHub - vllm-project/vllm: Easy, Fast, and Cheap LLM Serving",
        text: "vllm is an open-source inference and serving engine for LLMs.",
      }, "project"),
    ).toBe("entity_page");
  });

  it("keeps GitHub topic/list pages as roundup sources", () => {
    expect(
      classifySource({
        finalUrl: "https://github.com/topics/llm",
        title: "llm · GitHub Topics",
        text: "Explore repositories and topics tagged llm.",
      }, "project"),
    ).toBe("roundup");
  });

  it("treats Hugging Face entity pages as entity pages", () => {
    expect(
      classifySource({
        finalUrl: "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct",
        title: "meta-llama/Llama-3.1-8B-Instruct · Hugging Face",
        text: "Model card and usage details for the Llama model.",
      }, "project"),
    ).toBe("entity_page");
  });
});
