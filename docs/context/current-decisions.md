# Current Decisions

## Document Metadata

- `Doc ID`: `context.current-decisions`
- `Version`: `1.2.0`
- `Status`: `authoritative`
- `Kind`: `decision-record`
- `Last Updated`: `2026-04-03`
- `Authority`: This is the current source of truth for active project decisions unless replaced by a newer authoritative doc with the same scope.
- `Supersedes`: `none`

## Active Decisions

- Keep the current visible UI shell stable while we build the rest of the app functionality.
- Treat the challenge brief as the primary product requirement and evaluation target.
- Optimize toward the challenge scoring dimensions: output quality, design choices, code structure, documentation, and implementation depth.
- Preserve the exact challenge brief in-repo as an authoritative grounding document.
- Preserve external review/context notes in-repo, but keep them separate from binding project decisions.
- Re-center future functionality around generic entity discovery with evidence-backed cells, not people-search-specific framing.
- Clean out template and legacy Lovable scaffolding when it does not affect the current UI shell.
- Maintain the docs registry and metadata system so we can distinguish authoritative docs from working notes and flavor/context text.
- Build v0.1 as a single Cloudflare Worker codebase with `/api/v1/*`, fixture-backed locally until real Cloudflare resources and provider keys are available.
- Keep the local runtime hybrid: deterministic fixtures for tests, live Brave + Gemini for operator-driven local development when secrets are available.
- Use D1 as the future source of truth and KV as cache only; never model live run state around KV semantics.
- Treat progressive rendering as a binding contract: rows appear early, pending cells show loaders, weak terminal cells stay explicit, and dashes appear only for terminal blanks.
- Expose observability and budget usage inside the app, not only in logs.
- Treat the app as an engineer-facing system demo during this phase: execution internals, checkpoints, tool calls, and reward-style runtime proxies should be inspectable in the UI.
- Use richer row processing states than a binary pending/finalized model:
  - `pending`
  - `verifying`
  - `finalized`
  - `failed`
- Keep rejected rows visible in a dedicated unmatched section instead of mixing them into the accepted result partition.
- Distinguish `not_found` from `unsupported` clearly in detail views even if both compact to a dash in the table.
- Guard free-tier provider usage explicitly:
  - cap candidate fan-out per run
  - cap LLM extraction calls per run
  - cap verification passes per run
  - degrade rows into heuristic fallback states instead of crashing the run
- Never let a background run rejection kill the local dev server; terminal failure should be observable in-app and non-fatal to the shell.
- Prefer a lean provider stack over agent sprawl:
  - Brave for search
  - Gemini for planning, extraction, and verification
  - optional Vertex fallback via explicit model overrides
- Treat these checkpoint boundaries as the authoritative durable milestones for retry/resume semantics:
  - `plan persisted`
  - `candidate rows created`
  - `sources fetched`
  - `cells extracted`
  - `criteria evaluated`
  - `final ranking committed`
