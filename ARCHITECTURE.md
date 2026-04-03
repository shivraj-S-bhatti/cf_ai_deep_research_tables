# Architecture

## Document Metadata

- `Doc ID`: `architecture.v0`
- `Version`: `1.1.0`
- `Status`: `authoritative`
- `Kind`: `architecture`
- `Last Updated`: `2026-04-02`
- `Authority`: This is the current source of truth for the v0.1 runtime architecture and implementation boundaries.
- `Supersedes`: `none`

## Goal

Build a generic, evidence-backed entity discovery system that accepts a natural-language query and returns a progressively rendered table of entities, attributes, and traceable cell-level evidence.

This system is optimized for the Agentic Search Challenge, not for chat, CRM workflows, or people-search as the primary demo path.

## Product Rules

- The current visible UI shell remains visually stable during v0.1.
- Rows appear as soon as the system has a canonical candidate identity.
- Cells render loaders while their value is still pending.
- A dash is shown only for explicit terminal blank states:
  - `not_found`
  - `unsupported`
- Weak terminal states are rendered as explicit warning states, not blanks:
  - `uncertain`
  - `conflict`
- Rejected rows are rendered in a separate unmatched partition at the bottom of the table so judges can see the system's selectivity work.
- Every filled cell must have at least one evidence record.
- Compact table rendering may collapse both `not_found` and `unsupported` to a dash, but detail views must explain them differently.
- The UI should intentionally expose internals during this phase:
  - actor/stage trace
  - tool calls
  - reasoning summaries
  - durable checkpoints
  - provider usage ledger
  - reward-style runtime proxies
- The main result set is generic across entity types:
  - companies
  - projects
  - websites
  - businesses
  - news items

## v0.1 Scope

### Included

- Single Cloudflare Worker codebase
- Static asset serving plus `/api/v1/*`
- Preview, thread, run, results, row-detail, cancel, and export APIs
- Async run orchestration
- Progressive partial row/cell persistence
- Cell-level evidence and source linkage
- Deep in-app observability
- Explicit budget tracking and provider usage ledger
- Fixture-backed provider/runtime path for local development and tests
- D1 schema and repository contracts

### Deferred

- OpenRouter fallback
- Tavily fallback
- Browser-rendered crawling
- R2 raw snapshot storage
- Auth and multi-tenant isolation
- Browser-time SSE requirement
- ORM adoption
- People search as the hero workflow

## System Shape

### Runtime

- One Worker serves both the frontend assets and backend API routes.
- Runs execute asynchronously through a queue-backed stage machine in production.
- Local development uses the same orchestration contract, with an in-memory adapter and fixture-backed execution so the frontend can be developed without external credentials.

### Storage Roles

- D1 is the source of truth for:
  - threads
  - plans
  - runs
  - rows
  - cells
  - criteria evaluations
  - source documents
  - evidence
  - activity events
  - usage ledger
  - exports
- KV is cache-only for:
  - query plans
  - search responses
  - fetched pages
  - parsed artifacts
  - short-lived exports

### Observability

- Every provider call writes a `usage_ledger` record.
- Every stage writes coarse activity events, not per-microstep spam.
- `GET /api/v1/runs/:id` exposes:
  - stage
  - progress counts
  - cache stats
  - provider usage
  - estimated cost
  - budget burn
  - stage timing rollups

Product-critical in-app metrics for v0.1 are:

- stage
- rows discovered
- rows accepted
- cells resolved
- sources fetched
- search calls
- fetch calls
- llm calls
- cache hit rate
- estimated cost
- elapsed time

## Domain Model

The system is row/cell/evidence centric.

### Thread

The user-visible research container:

- raw query
- normalized query
- entity type
- phase
- latest run

### Query Plan

The structured interpretation of the user query:

- hard filters
- soft signals
- output columns
- planned search queries
- budgets

### Result Row

A canonical candidate entity with:

- terminal semantic status
- processing state
- rank
- score
- source count

### Result Cell

A value or abstention for a specific row/column pair with:

- explicit state
- confidence
- primary evidence
- reason code

### Evidence

A grounded span, field, or summary tied back to a fetched source.

## API Design

The public contract is documented in [OPENAPI.yaml](/Users/apple/Projects/agentic-insights-dashboard/OPENAPI.yaml).

Key route groups:

- `POST /api/v1/query-plans/preview`
- `POST /api/v1/threads`
- `PATCH /api/v1/threads/:threadId/config`
- `POST /api/v1/threads/:threadId/runs`
- `GET /api/v1/threads`
- `GET /api/v1/threads/:threadId`
- `GET /api/v1/runs/:runId`
- `GET /api/v1/runs/:runId/events`
- `GET /api/v1/runs/:runId/results`
- `GET /api/v1/runs/:runId/results/:rowId`
- `POST /api/v1/runs/:runId/cancel`
- `GET /api/v1/runs/:runId/export`

## Execution Pipeline

### 1. Preview

Parse the raw query into:

- entity type
- hard filters
- soft signals
- columns
- planned search queries
- conservative budgets

### 2. Kickoff

- persist thread and plan
- create run
- enqueue run

### 3. Discovery

- execute planned searches
- identify candidate entities
- create provisional rows immediately

### 4. Fetch

- fetch and parse supporting sources
- persist source documents
- update fetch metrics and cache stats

### 5. Extraction

- resolve identity and enrichment cells
- persist each cell as it lands
- keep unresolved cells as `pending`

### 6. Evaluation

- evaluate each criterion against each row
- persist verdicts and evidence

### 7. Canonicalization

- merge duplicates
- recompute source counts
- mark duplicate rows

### 8. Verification

- verify ambiguous or high-value fields
- downgrade weak claims into `uncertain`, `conflict`, or explicit blanks

### 9. Ranking

- assign row score and rank
- finalize terminal row status

### 10. Export

- generate accepted-row CSV/JSON
- persist export metadata

## Durable Checkpoints

These are the retry/resume-safe boundaries that matter in v0.1:

- `plan persisted`
- `candidate rows created`
- `sources fetched`
- `cells extracted`
- `criteria evaluated`
- `final ranking committed`

## Progressive Rendering Contract

This is binding for both backend and frontend:

- `ResultRow.processingState = "pending"` means the row may still gain cells or even change status.
- `ResultRow.processingState = "verifying"` means the row is in a deliberate second-pass validation step.
- `ResultRow.processingState = "finalized"` means the row is terminal for the current run.
- `ResultRow.processingState = "failed"` means the row was left incomplete because the run failed before finishing its pipeline.
- `ResultCell.state = "pending"` renders a loader.
- `ResultCell.state = "filled"` renders the value.
- `ResultCell.state = "not_found"` renders a dash with inspectable provenance context.
- `ResultCell.state = "unsupported"` renders a dash with inspectable reason.
- `ResultCell.state = "uncertain"` renders a warning state.
- `ResultCell.state = "conflict"` renders a warning/conflict state.

The backend must return partial rows and partial cells during execution. The frontend must not wait for the run to finish before rendering them.

## Eval And Reward Proxies

The UI may show reward-style runtime proxies, but they are not the same as offline judged metrics.

- True precision / recall / F1 require labeled evaluation sets.
- In-product proxies are allowed for demo/debugging:
  - grounded cell rate
  - abstention rate
  - weak-state rate
  - target coverage
  - selectivity
  - unresolved share

## Provider Strategy

### Primary v0.1 Providers

- Search: Brave
- LLM: Gemini direct
- Fetch: direct HTTP fetch + parse

### Local And Test Strategy

Until real credentials and Cloudflare resources are available, v0.1 development uses fixture-backed adapters implementing the same internal interfaces as the real providers.

That lets us:

- build the full contract now
- test progressive rendering now
- validate ranking and provenance behavior now
- swap in real providers later without rewriting the UI contract

## Code Organization

```text
src/
  lib/
    contracts.ts
    types.ts
    api-client.ts
  worker/
    core/
    domain/
    fixtures/
    providers/
    queue/
    storage/
    utils/
```

Guiding principle: domain contracts live in shared TypeScript, but the Worker owns orchestration, storage, and provider logic.

## Engineering Critique And Guardrails

- Do not treat KV as a source of truth for live run state.
- Do not over-model queues in v0.1; one run-level job is simpler and easier to debug than per-row fan-out.
- Do not ship fake “agent theater” as the system’s core story. The activity surface should read like an execution trace.
- Do not over-index on single-domain demos like recruiting or LinkedIn-style search.
- Do not fill cells without evidence simply to make the table look complete.
- Do not collapse uncertainty into blanks; ambiguity is part of the product.

## Next Upgrade Points

When credentials and Cloudflare resources are available, the planned next upgrades are:

- swap memory store for D1 repositories
- swap fixture providers for Brave and Gemini
- swap local async execution for Cloudflare Queues
- add SSE on top of the existing events contract
- optionally add KV-backed caches and R2-backed raw source storage
