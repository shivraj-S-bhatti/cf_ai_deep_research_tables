# Cursor Context Snapshot

## Metadata

- Snapshot ID: `cursor-context-2026-04-03T02-40-25Z`
- Captured (UTC): `2026-04-03T02:40:25Z`
- Branch: `main`
- Purpose: Fast handoff context for concurrent agents working on frontend, Worker API, orchestration, and provider integration.

## Repo Reality (Important)

- The repo is in a high-churn, pre-commit state with broad in-flight changes across frontend, Worker runtime, contracts, docs, and tests.
- Core architecture and API docs now exist and are intended to be authoritative:
  - `ARCHITECTURE.md`
  - `OPENAPI.yaml`
  - `docs/context/current-decisions.md`
  - `docs/context/development-board.md`

## Product Goal (Current)

Build a generic, evidence-backed entity discovery engine for the Agentic Search Challenge:

- Input: natural-language research query
- Process: plan -> discover -> fetch -> extract -> evaluate -> rank
- Output: progressive table of entities with traceable cell evidence and export

Do not regress toward a people-search-only story.

## Current UI Contract (What Frontend Expects)

Primary shell: `src/pages/Index.tsx`

Three-phase UX:
1. Home input (`InitialSearch`)
2. Preview tune (`PreviewStage`)
3. Dataset workspace:
   - center: table + controls (`ActionToolbar`, `DataGrid`)
   - right: `WorkspaceSidebar` tabs (`Search`, `Details`, `Sources`)

Additional constraints:
- Left threads rail is overlay/toggle via header icon.
- Query editing after start is done from right `Search` tab, not a top search bar.
- Toolbar currently has generic filters + sort + export + agent activity.

## Backend/API Shape Now

Worker entrypoint: `src/worker/index.ts`

- `/api/*` requests route to `handleApiRequest` in `src/worker/core/app.ts`
- Non-API requests served via assets binding when present

Implemented route groups (v0.1 local path):
- health
- preview
- thread list/create/get/update-config
- run create/get/events/results/row-detail/cancel/export

Runtime orchestration:
- `src/worker/core/runtime.ts`
- fixture-backed stage machine
- progressive row/cell persistence
- activity events + usage ledger + export generation

Storage:
- `src/worker/storage/memory-store.ts` is active source of truth locally
- D1/KV/Queue modeled in docs/contracts, not active in local truth path

## Shared Contracts (Primary Integration Surface)

- Canonical shared types: `src/lib/contracts.ts`
- Frontend compatibility layer/mappers: `src/lib/types.ts`
- API client: `src/lib/api-client.ts`
- OpenAPI reference: `OPENAPI.yaml`

If adding/changing fields, update in this order:
1. `contracts.ts`
2. Worker runtime/store + route payloads
3. `api-client.ts`
4. frontend mappers/usages in `types.ts` and components
5. tests

## Loose Connectors / Seams For Parallel Work

These are the safest extension points without broad breakage:

1. Planner seam
   - `src/worker/domain/planner.ts`
   - swap fixture planning logic for real LLM plan generation

2. Provider seam
   - `src/worker/providers/*`
   - currently fixture-oriented; can add Brave/Gemini adapters behind same usage recording model

3. Runtime stage seam
   - `src/worker/core/runtime.ts`
   - each stage already emits events + usage; can incrementally replace fixture calls per stage

4. Store seam
   - `src/worker/storage/memory-store.ts`
   - mirror methods into D1-backed repositories without changing route contract

5. Frontend polling seam
   - `src/lib/api-client.ts` + thread/page orchestration in `src/pages/Index.tsx`
   - can swap polling cadence, event hydration, and run detail behavior without UI redesign

## Invariants To Preserve

- Progressive rendering:
  - rows can appear while run still active
  - cells can be `pending`
  - weak/ambiguous terminal states should remain explicit (not silently blanked)
- Evidence linkage:
  - filled cells should keep provenance references
- Main product framing:
  - generic entity discovery (companies/projects/businesses/websites/news), not only people
- UI shell stability:
  - maintain current shell/layout while backend matures

## Current Risks / Drift Hotspots

1. Contract drift between `contracts.ts` and component-level assumptions if fields are renamed ad hoc.
2. Mixed in-flight frontend changes can accidentally reintroduce removed components (e.g., old details/search bar paths).
3. API surface may evolve faster than OpenAPI unless updated in lockstep.
4. High concurrent edits to `Index.tsx` and store/runtime files can cause subtle phase/regression bugs.

## Coordination Suggestions For Agents

- Before touching shared contracts, scan current git diff and announce intended field-level changes.
- Prefer additive changes to `contracts.ts` and mark deprecated fields before removal.
- Keep PRs/work units narrow by seam:
  - planner/provider
  - runtime/store
  - ui wiring
  - docs/contracts
- Validate with at least:
  - `npm run test`
  - `npm run build`

## Key Files To Read First

- `ARCHITECTURE.md`
- `OPENAPI.yaml`
- `src/lib/contracts.ts`
- `src/worker/core/app.ts`
- `src/worker/core/runtime.ts`
- `src/worker/storage/memory-store.ts`
- `src/lib/api-client.ts`
- `src/pages/Index.tsx`
- `docs/context/current-decisions.md`
- `docs/context/development-board.md`

