# Assignment Submission Draft

## Document Metadata

- `Doc ID`: `submission.assignment-draft`
- `Version`: `1.0.0`
- `Status`: `working`
- `Kind`: `submission-draft`
- `Last Updated`: `2026-04-04`
- `Authority`: Draft content for the final repository submission. Useful for assembling the final README and submission package, but not yet the binding project source of truth.
- `Supersedes`: `none`

## Project Summary

This project is an evidence-backed entity discovery system for the Agentic Search Challenge. Given a natural-language query such as `best pizza places in Brooklyn`, `open source database tools`, or `YC W24 healthcare startups`, the system is intended to search the web, gather source documents, extract candidate entities, merge and verify them, and return a structured table where each filled value can be traced back to evidence.

The current product shell is already in place: query input, editable criteria and columns, progressive results table, row details, source inspection, and a separate debug surface for execution traces. The main engineering work has been in the runtime behind that shell: planning, retrieval, parsing, extraction, evaluation, ranking, provenance, and cost/usage instrumentation.

## What We Built

- A React + TypeScript frontend for query entry, preview/edit, result inspection, and export
- A Worker-style backend with `/api/v1/*` routes for preview, threads, runs, results, row details, debug views, and export
- Brave Search integration for web discovery
- Gemini-based planning, extraction, and verification paths
- Progressive rendering so rows and cells appear before the full run is complete
- Row-level and cell-level provenance plumbing
- Usage and cost instrumentation for search, fetch, LLM, and cache operations

## Design Goal

The design goal is not generic chat. It is grounded table construction. The system should turn a broad natural-language query into a useful result table of real entities, not just a pile of URLs. The key requirement from the challenge is that each populated cell should be traceable to the source that justified it.

## Major Design Choice

The most important design choice is to separate:

- source documents
- candidate entity mentions
- final merged entity rows

This sounds obvious, but it is where the hardest bugs appeared. A source page is not the same thing as the entity being searched for. A review page, listicle, map page, and official site can all mention the same business or project. The system must use those pages as evidence, not confuse them for final rows.

## What Went Wrong In The Current System

The biggest architectural mistake in the current runtime is that it is still too page-first. Search results become provisional rows too early. That creates a cascade of downstream failures:

- roundup pages produce one bad row instead of many real entity candidates
- entity review pages get rejected by document heuristics
- hard-filter evaluation becomes shallow because it operates on page text rather than properly resolved entities
- ranking quality collapses because the rows themselves are often the wrong objects

The clearest formulation is:

> Pages are not entities.

This single mistake explains most of the bad outputs we observed in local business and “best of” queries.

## Evidence-Backed Failure Analysis

Our investigation of the current pizza query behavior surfaced these concrete bugs:

1. Roundup pages such as “10 best pizza places” are treated as one row instead of many entity mentions.
2. Entity-level review pages can be rejected by overly broad document heuristics.
3. Heuristic fallback criteria can pass rows simply because a keyword appears in the page text.
4. Fallback scoring collapses to flat values, which makes ranking meaningless.
5. URL-only deduplication cannot merge the same entity across Yelp, official site, guide pages, and reviews.
6. Query variation is currently too lexical and not semantically targeted.
7. Richer human-facing criteria/columns can be silently discarded by the fallback execution path.
8. Even after moving toward class-aware extraction, source classification can still be wrong. A roundup page mislabeled as an `entity_page` will extract one row when it should expand into many.
9. Long multi-entity extraction calls over roundup pages can time out. The most valuable documents are often the longest ones, so a naive “send 12k of text and extract everything in one call” strategy becomes a latency and reliability bottleneck.

This analysis directly changed the refactor direction: the next version needs document classification, multi-entity extraction, stronger merge logic, and a loop that can reuse already-fetched documents when the user asks for more columns or updated criteria.

## Current Architecture

Today’s codebase includes:

- a Worker-style runtime shell
- live Brave + Gemini provider paths
- fixture-backed fallback/testing paths
- in-memory truth storage for local runs
- row details, evidence, and debug trace APIs

The current architecture is documented in [ARCHITECTURE.md](/Users/apple/Projects/agentic-insights-dashboard/ARCHITECTURE.md). That document is a current-state plus target-state handoff, not just an aspirational diagram.

## Refactor Direction

The refactor direction now centers on a persistent document store and a supervisor-style loop:

1. plan the query into entity type, filters, output columns, and initial searches
2. search and fetch documents
3. extract one or more entity mentions from each useful document
4. merge mentions into canonical entity rows
5. inspect gaps in the table
6. decide whether to search more, fetch more, or re-extract from existing documents
7. verify ambiguous rows
8. rank and export

This is the shift from a rigid page-first waterfall to a document-to-entity pipeline.

Another concrete lesson is that source-type-aware extraction is necessary but not sufficient. We need both:

- better source classification so roundup, directory, entity, official, and forum pages are routed to the right extraction behavior
- bounded extraction over long documents so the system does not stall or timeout on the very pages that contain the richest multi-entity evidence

## Documentation And Analysis Assets

We intentionally preserved our engineering analysis in-repo:

- challenge grounding text
- architecture and API docs
- historical journey/analysis logs
- a pre-refactor notebook that mirrors the current broken logic
- draft blog content that explains the core failure analysis

This was done both for engineering clarity and for later reporting.

## Setup

```bash
npm install
npm run dev
```

The app runs on `http://localhost:8080`.

### Scripts

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
```

## Known Limitations

- The local runtime is still more in-memory than the final Cloudflare D1/KV/Queue target state.
- The current extraction path does not yet robustly expand roundup pages into many entity rows.
- Source classification is still error-prone enough to misroute some roundup pages into single-entity extraction paths.
- Long roundup extraction calls can time out when too much text is sent to the model in one pass.
- Entity canonicalization is still too weak for cross-source merge quality.
- Cost tracking is currently an estimated telemetry layer, not exact provider billing.
- Some current ranking behavior is still dominated by weak fallback heuristics.

## Why This Is Still A Worthwhile Submission

The project already demonstrates the right core problem framing: grounded entity discovery, explicit provenance, progressive evidence-backed output, and a clean UI shell for inspecting results. The major work remaining is in the search/extraction/merge/verification logic, and the current failure analysis has made that gap concrete rather than vague. That makes the design choices, limitations, and next-step reasoning easy to defend.
