# Deep Research Datasets

Deep Research Datasets is an evidence-backed entity discovery system built for the Agentic Search Challenge. Given a topic query such as `best pizza places in Brooklyn`, `open source database tools`, or `YC W24 healthcare startups`, it is intended to search the web, extract candidate entities from source documents, merge them into a structured table, and keep each populated value traceable to supporting evidence.

## What The System Does

The product flow is straightforward. A user enters a topic query, the system turns that query into a structured research plan, searches the web for relevant sources, fetches and parses those pages, extracts entity candidates and their attributes, merges repeated mentions across sources, and returns a table where filled cells can be inspected back to the text that justified them. The UI is designed around that workflow: query, plan, results, row details, sources, and evidence.

## Approach

The backend is organized as a retrieval and extraction pipeline rather than a generic chat loop. It plans the query, generates search variants, gathers web results, parses the resulting documents, extracts entity information, deduplicates repeated mentions, verifies ambiguous claims, and ranks the resulting rows.

The key modeling distinction is between three different objects:

- **Source documents**: pages such as guides, directories, official sites, review pages, or forum threads.
- **Entity mentions**: one or more candidate entities extracted from those documents.
- **Final rows**: merged entities that survive filtering, verification, and ranking.

That separation matters because the challenge is not to return URLs. It is to return entities with grounded attributes. A page may mention many entities, and many pages may refer to the same entity.

## Design Tradeoffs And What We Learned

The theoretically stronger design is document-first: classify the source, extract all matching entities from it, merge those mentions across sources, and only then rank the final rows. Our first serious implementation drifted toward a page-first pipeline, where search results became provisional rows too early. That turned out to be the core quality problem.

The most important lessons from the build were:

- Query reconstruction matters more than naive lexical variants. Appending words like `official` or `source` to a query does not create genuinely better coverage; better rewritten queries target missing evidence and different source types.
- Document classification matters before extraction. A roundup page, an official site, a directory, and a forum thread should not be treated the same way.
- Roundup pages should expand into many candidates, not one row. A “10 best pizza places” article is valuable because it names entities, not because the article itself is the entity.
- Retrieval and ranking heuristics are only useful after row semantics are correct. If the row is actually a guide page, no ranking formula will save the result.
- Progressive UI and explicit debug surfaces were useful, but over-instrumentation in the main product path made the app harder to reason about.
- The biggest practical performance gains came from reducing request fan-out, lazy-loading row details, and separating normal product polling from debug polling.

## Current Implementation

The current repo includes a working frontend shell, a Worker-style `/api/v1/*` runtime, live Brave search integration, and Gemini-based planning, extraction, and verification paths. The product surface supports query entry, editable criteria and columns, progressive result rendering, row details, source inspection, and export.

At the same time, the runtime is still in transition. Local execution still relies more on in-memory state than the intended persistent Cloudflare architecture. The live path is real, but the deterministic test path still uses fixture-backed behavior so tests can run without burning provider quota. In other words, the repo demonstrates the right product shape and several real integrations, but the search and extraction logic is still being hardened.

## Setup

Install dependencies and start the local app:

```bash
npm install
npm run dev
```

The app runs on `http://localhost:8080`.

To run with live providers, copy [.env.local.example](.env.local.example) to `.env.local` and fill in the provider keys. If you want the same configuration for Wrangler local development, copy [.dev.vars.example](.dev.vars.example) to `.dev.vars`.

Useful scripts:

```bash
npm run dev
npm run dev:live
npm run build
npm run lint
npm run test
npm run test:e2e
npm run cf:deploy
```

## Known Limitations

- Entity/document separation is still the hardest correctness problem in the runtime.
- Roundup and multi-entity extraction remain the main quality and latency bottlenecks, especially on long pages.
- Canonicalization across sources is still weaker than it should be for local business and review-heavy queries.
- Cost tracking is currently estimated telemetry, not exact provider billing.
- The local runtime is not yet the full D1/KV/Queue target architecture described in the deeper docs.

## Further Reading

- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- API contract: [OPENAPI.yaml](OPENAPI.yaml)
- Submission draft: [knowledge/submission/assignment-submission-draft.md](knowledge/submission/assignment-submission-draft.md)
- Retrospective writeup: [knowledge/blog/pages-are-not-entities-draft.md](knowledge/blog/pages-are-not-entities-draft.md)
- Investigation notebooks: [knowledge/notebooks](knowledge/notebooks)
