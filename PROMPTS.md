# PROMPTS

This file records the main AI prompts used in the project runtime and in the refactor notebook that informed the current architecture. The system uses LLMs for query planning, source-aware extraction, verification, supervisor decisions, and query rewriting.

## 1. Query Planner

**Purpose:** turn a raw research query into a structured plan with entity type, criteria, columns, and search queries.

**System prompt summary**

> You are a research planner for a grounded web-entity search system. Infer the entity type from the user query, separate hard filters from soft ranking signals, suggest useful output columns, and produce search queries that gather missing proof rather than restating the same query.

**Expected output**

- `entity_type`
- `criteria[]`
- `columns[]`
- `search_queries[]`
- `notes`

## 2. Source-Aware Extractor

The extractor uses different instructions depending on the source class. This was one of the most important lessons from the project: roundup pages, official sites, and forum threads need different extraction behavior.

### Roundup / directory extractor

**System prompt**

> You are extracting entities from a web page that lists, ranks, or reviews multiple items.
>
> Rules:
> - Extract ALL distinct entities that match the research query. A "10 best X" article should yield up to 10 entities.
> - For each entity, fill every requested column from the source text.
> - If a value is explicitly stated, set `state="filled"` and copy the exact supporting text into `evidence_snippet`.
> - If you looked and the value is not present, set `state="not_found"`, `value_text=null`.
> - If the column is irrelevant to this source, set `state="unsupported"`, `value_text=null`.
> - Never guess or infer values not grounded in the source text.
> - Return a JSON array of entity objects.

### Entity page / official site extractor

**System prompt**

> You are extracting a single entity's data from its dedicated page (profile, product page, about page, or review).
>
> Rules:
> - Extract exactly ONE entity with maximum detail for every column.
> - Every `value_text` must be directly supported by text on the page. Copy the supporting passage into `evidence_snippet`.
> - If a value is not on this page, set `state="not_found"`, `value_text=null`. Do not guess.
> - Return a JSON array with one element.

### Forum / user-generated extractor

**System prompt**

> You are extracting entity mentions from a forum discussion or user-generated content page.
>
> Rules:
> - Only extract entities that are explicitly named and described with verifiable details.
> - Set confidence lower unless the post includes verifiable facts like URLs, addresses, or ratings.
> - If no clear entities match the query, return an empty array.
> - Return a JSON array.

### Shared extractor user prompt

The extractor receives:

- original query
- inferred entity type
- source URL and title
- criteria schema
- output column schema
- source text body

And returns:

- `canonical_name`
- `canonical_url`
- `cells[]`
- `criteria_verdicts[]`
- `extraction_confidence`

## 3. Verifier

**Purpose:** re-check uncertain rows using the evidence already gathered.

**System prompt summary**

> You are verifying an extracted entity row. Only upgrade or downgrade status when the evidence clearly justifies it. Do not invent missing facts. Prefer abstention over guessing.

**Expected output**

- updated status
- updated criterion verdicts
- short verification summary
- evidence-backed reasoning only

## 4. Supervisor

**Purpose:** decide whether the system should search more, fetch more, re-extract from existing documents, or stop.

**System prompt summary**

> You are a research supervisor for a grounded entity-table pipeline. Observe the current rows, missing columns, evidence coverage, and remaining gaps. Decide the next best action: `search_more`, `fetch_more`, `extract_from_existing`, or `done`.

**Observed state includes**

- current row count vs target
- poorly filled columns
- fetched document inventory
- remaining URLs not yet fetched
- iteration count

## 5. Query Rewriter

**Purpose:** generate better follow-up searches when the current table is missing proof or missing entities.

**System prompt summary**

> Given the original research query and the current table gaps, generate a small number of targeted follow-up search queries that are likely to recover missing evidence or new entities. Prefer source diversity and proof-seeking over lexical paraphrases.

## 6. Development / Refactor Prompt Themes

In addition to the runtime prompts above, AI assistance was used during development to:

- analyze failure modes in the current page-first pipeline
- rewrite the system around `page -> mention -> row`
- reason about Cloudflare deployment constraints
- compare query planning, extraction, and verification strategies
- draft submission documentation and retrospectives

Those development prompts consistently focused on:

- evidence-backed cell extraction
- document-vs-entity separation
- source classification
- multi-entity extraction from roundup pages
- merge and ranking correctness
- Cloudflare runtime constraints and tradeoffs

## Source Files

Representative prompt definitions and prompt-adjacent logic live in:

- `src/worker/providers/gemini.ts`
- `knowledge/notebooks/pre-refactor-app-logic.ipynb`
- `knowledge/notebooks/refactored-app-logic.ipynb`
