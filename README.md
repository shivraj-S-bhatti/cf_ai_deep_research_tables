# Agentic Insights Dashboard

Execution workspace and Worker-style backend for the Agentic Search Challenge.

The current UI shell remains intentionally stable while we build out the real search, extraction, provenance, and observability pipeline behind it. The repo now supports both a fixture-backed mode for deterministic tests and a live Brave + Gemini path for local development.

## Grounding Docs

- Docs system: [docs/README.md](docs/README.md)
- Docs registry: [docs/registry.md](docs/registry.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- API contract: [OPENAPI.yaml](OPENAPI.yaml)
- D1 schema: [cloudflare/schema.sql](cloudflare/schema.sql)
- Challenge brief: [docs/grounding/agentic-search-challenge.md](docs/grounding/agentic-search-challenge.md)
- Current decisions: [docs/context/current-decisions.md](docs/context/current-decisions.md)
- Development board: [docs/context/development-board.md](docs/context/development-board.md)
- Context and iteration notes: [docs/context/iteration-log.md](docs/context/iteration-log.md)

## Stack

- Vite
- React 18
- TypeScript
- Tailwind CSS
- shadcn/ui primitives
- Vitest
- Playwright

## Getting Started

```bash
npm install
npm run dev
```

The app runs on `http://localhost:8080` by default.

### Local Runtime Modes

- `fixture`: deterministic smoke/test mode
- `hybrid`: use live providers when secrets are available, otherwise fall back to fixtures
- `live`: force live Brave + Gemini providers

For local live runs:

- copy [.env.local.example](.env.local.example) to `.env.local`
- copy [.dev.vars.example](.dev.vars.example) to `.dev.vars` if you want the same settings for Wrangler local dev later
- keep Cloudflare account auth outside app runtime secrets; use `CLOUDFLARE_API_TOKEN` only for Wrangler/account operations
- the live path now guards free-tier budgets by capping candidate fan-out, extraction calls, and verification passes per run
- if you want to use Vertex as a fallback or primary backend, set `GEMINI_BACKEND=vertex_express` and provide explicit `VERTEX_*_MODEL` values that match your account

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run test:e2e
```

## Current Direction

- Keep the existing UI shell stable while backend and data contracts evolve.
- Prioritize challenge scoring dimensions: output quality, design choices, code structure, documentation, and implementation depth.
- Re-center future functionality around generic entity discovery with evidence-backed cells, not people-search-specific behavior.
- Use a Worker-style `/api/v1/*` runtime locally, with live Brave + Gemini when configured and fixtures as the deterministic fallback.

## Known Limitations

- Live local development uses Brave search plus Gemini planning/extraction/verification when secrets are present.
- Free-tier runs should stay on conservative budgets; the runtime now falls back to heuristic row compaction instead of crashing when LLM budget or provider availability gets tight.
- Tests still run against the fixture-backed Worker path for determinism and cost control.
- D1, KV, and Cloudflare Queue bindings are specified and modeled, but the active local path uses an in-memory truth store.
- Cloudflare resource IDs, Wrangler setup, and paid-tier tuning are still needed before final demo hardening and deployment.
