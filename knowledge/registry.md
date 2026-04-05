# Knowledge Registry

This registry is the quick index for which knowledge artifacts are current and how much authority they carry.

| Doc ID | Version | Status | Kind | Path | Notes |
| --- | --- | --- | --- | --- | --- |
| `knowledge.system` | `1.1.0` | `authoritative` | `meta` | [knowledge/README.md](./README.md) | Defines the knowledge versioning and authority rules for docs and notebooks. |
| `knowledge.registry` | `1.2.0` | `authoritative` | `meta` | [knowledge/registry.md](./registry.md) | Canonical inventory of durable project docs and investigation artifacts. |
| `architecture.v0` | `2.1.0` | `authoritative` | `architecture` | [ARCHITECTURE.md](../ARCHITECTURE.md) | Current-state plus target-state handoff for the runtime, product/debug split, and anchor/corroboration execution model. |
| `openapi.v0` | `1.0.0` | `authoritative` | `api-contract` | [OPENAPI.yaml](../OPENAPI.yaml) | Current v0.1 HTTP contract for preview, runs, results, and export. |
| `schema.d1.v0` | `1.0.0` | `authoritative` | `database-schema` | [cloudflare/schema.sql](../cloudflare/schema.sql) | Current v0.1 D1 truth-model schema. |
| `grounding.agentic-search-challenge` | `1.0.0` | `authoritative` | `source-text` | [knowledge/grounding/agentic-search-challenge.md](./grounding/agentic-search-challenge.md) | Exact challenge brief we are optimizing for. |
| `submission.assignment-draft` | `1.0.0` | `working` | `submission-draft` | [knowledge/submission/assignment-submission-draft.md](./submission/assignment-submission-draft.md) | Draft challenge submission content covering approach, architecture, setup, limitations, and design choices. |
| `blog.pages-are-not-entities` | `1.0.0` | `working` | `blog-draft` | [knowledge/blog/pages-are-not-entities-draft.md](./blog/pages-are-not-entities-draft.md) | Draft public writeup of the core failure analysis and architectural lessons from the current system. |
| `context.current-decisions` | `1.5.0` | `authoritative` | `decision-record` | [knowledge/context/current-decisions.md](./context/current-decisions.md) | Current binding project decisions and iteration posture. |
| `context.development-board` | `1.2.0` | `working` | `coordination-board` | [knowledge/context/development-board.md](./context/development-board.md) | Live implementation board for milestone and workstream tracking. |
| `context.iteration-log` | `1.1.0` | `working` | `iteration-log` | [knowledge/context/iteration-log.md](./context/iteration-log.md) | Context capture, external review notes, and non-binding synthesis. |
| `context.journey-2026-04-03T05-38-21Z` | `1.0.0` | `historical` | `journey-log` | [knowledge/context/journey-2026-04-03T05-38-21Z.md](./context/journey-2026-04-03T05-38-21Z.md) | Timestamped narrative record of the live-provider integration pass. |
| `context.analysis-2026-04-03T05-38-21Z` | `1.0.0` | `historical` | `experiment-log` | [knowledge/context/analysis-2026-04-03T05-38-21Z.md](./context/analysis-2026-04-03T05-38-21Z.md) | Timestamped hypothesis/results log for the same engineering pass. |
| `context.journey-2026-04-03T21-41-01Z` | `1.0.0` | `historical` | `journey-log` | [knowledge/context/journey-2026-04-03T21-41-01Z.md](./context/journey-2026-04-03T21-41-01Z.md) | Timestamped narrative record of the stabilization and product/debug split refactor. |
| `context.analysis-2026-04-03T21-41-01Z` | `1.0.0` | `historical` | `experiment-log` | [knowledge/context/analysis-2026-04-03T21-41-01Z.md](./context/analysis-2026-04-03T21-41-01Z.md) | Timestamped analysis of what failed, what changed, and what remains risky. |
| `context.perf-baseline-2026-04-03T21-41-01Z` | `1.0.0` | `historical` | `perf-baseline` | [knowledge/context/perf-baseline-2026-04-03T21-41-01Z.md](./context/perf-baseline-2026-04-03T21-41-01Z.md) | Performance and complexity baseline before the deeper runtime cleanup pass. |
| `context.hypotheses-2026-04-03T21-41-01Z` | `1.0.0` | `historical` | `hypothesis-log` | [knowledge/context/hypotheses-2026-04-03T21-41-01Z.md](./context/hypotheses-2026-04-03T21-41-01Z.md) | Explicit hypotheses, outcomes, and next tests for the refactor sequence. |
| `notebook.pre-refactor-app-logic` | `1.0.0` | `working` | `baseline-notebook` | [knowledge/notebooks/pre-refactor-app-logic.ipynb](./notebooks/pre-refactor-app-logic.ipynb) | Executable notebook mirror of the current pre-refactor search pipeline, prompts, heuristics, and failure modes. |
| `notebook.refactored-app-logic` | `1.0.0` | `working` | `refactor-notebook` | [knowledge/notebooks/refactored-app-logic.ipynb](./notebooks/refactored-app-logic.ipynb) | Notebook sketch of the anchor/corroboration direction that informed the runtime simplification. |
