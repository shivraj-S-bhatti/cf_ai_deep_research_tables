# Development Board

## Document Metadata

- `Doc ID`: `context.development-board`
- `Version`: `1.2.0`
- `Status`: `working`
- `Kind`: `coordination-board`
- `Last Updated`: `2026-04-03`
- `Authority`: This is the live implementation board for coordination and progress tracking. It is not authoritative over product requirements or architecture.
- `Supersedes`: `none`

## Milestones

### M0. Architecture And Contracts

- [x] `ARCHITECTURE.md` created
- [x] `OPENAPI.yaml` created
- [x] `cloudflare/schema.sql` created
- [x] coordination board created
- [x] docs linked from README and registry
Checkpoint: authoritative architecture and contract docs exist and are tracked.

### M1. Worker Runtime Foundation

- [x] Worker entrypoint
- [x] local router
- [ ] env validation
- [x] health endpoint
- [x] queue producer/consumer contracts
- [x] local dev API integration through Vite
Checkpoint: frontend and Worker can run together locally.

### M2. Truth Model And Repositories

- [x] repository interfaces
- [x] memory-backed repository implementation
- [ ] D1 repository shape
- [x] idempotent stage markers
- [x] export persistence
Checkpoint: runs, rows, cells, evidence, and events can be stored and queried consistently.

### M3. Providers, Planning, And Budgets

- [x] fixture planner
- [x] fixture discovery provider
- [x] Brave adapter interface
- [x] Gemini adapter interface
- [x] fetch/parse adapter interface
- [x] usage ledger + pricing catalog
- [x] live hybrid provider path
- [x] free-tier budget guards
- [x] graceful fallback when live LLM calls fail
Checkpoint: provider calls emit observable usage records and estimated cost.

### M4. Orchestrator And API

- [x] async run stage machine
- [x] preview endpoint
- [x] create thread endpoint
- [x] rerun endpoint
- [x] run status/events/results/row detail endpoints
- [x] cancel endpoint
- [x] export endpoint
Checkpoint: a client can create and inspect a real run.

### M5. Frontend Integration

- [x] API client
- [x] async thread store
- [x] preview wiring
- [x] progressive result polling
- [x] row detail/evidence wiring
- [x] observability surface wiring
- [x] unmatched row partition
- [x] internals tab with checkpoints/tool surface/reward proxies
- [x] scrollable trace/sidebar containers
Checkpoint: current UI shell runs against the new API without redesign.

### M6. Quality And Smoke Library

- [x] smoke fixture coverage across five domains
- [x] contract tests
- [x] integration tests
- [x] progressive rendering tests
- [x] export tests
Checkpoint: vertical slice is stable enough for iterative provider swap-in.

## Suggested Ownership

- Workstream A: platform, runtime, env, and Vite integration
- Workstream B: schema, repositories, and storage adapters
- Workstream C: planner, providers, budget ledger, and observability rollups
- Workstream D: orchestrator and API routes
- Workstream E: frontend store and UI contract wiring
- Workstream F: tests, smoke fixtures, and docs/runbooks

## Current Notes

- The current UI shell stays visually stable during this phase.
- Fixture-backed execution is the active path until real Cloudflare resources and provider keys are available.
- Live local execution now works with Brave + Gemini secrets, but Cloudflare D1/KV/Queue resources are still not provisioned.
- The runtime now degrades under quota pressure instead of crashing: extraction/verification budgets are capped and fallback rows remain explicit.
- Progressive row/cell rendering is a binding product behavior, not a future enhancement.
- This phase intentionally biases toward engineering theater: expose the moving parts so judges can inspect execution rather than only admire output polish.
