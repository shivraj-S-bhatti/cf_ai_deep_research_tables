# Iteration Log

## Document Metadata

- `Doc ID`: `context.iteration-log`
- `Version`: `1.0.0`
- `Status`: `working`
- `Kind`: `iteration-log`
- `Last Updated`: `2026-04-02`
- `Authority`: Useful context and synthesis, but not the binding source of truth. Use [docs/context/current-decisions.md](./current-decisions.md) for current authoritative project decisions.
- `Supersedes`: `none`

## Scope

This file keeps non-binding project context, external critique, and iteration notes that we want to preserve for later reporting and analysis.

## External Review Notes

The following notes were provided by another agent and are being preserved verbatim for context tracking.

```text
This is a good shell. The problem is not polish. The problem is that the current UI is telling the wrong product story in a few important ways.

The biggest issue first:

**right now it looks like a people-sourcing app, not a generic entity discovery engine.**

That is dangerous for this challenge.

The assignment examples are things like healthcare startups, pizza places, open source database tools. Your current screenshots are dominated by:

* LinkedIn profiles
* GitHub
* email extraction
* Crunchbase
* “AI engineers in New York…”

That makes the system look narrow, and worse, it invites questions about LinkedIn scraping, personal-data collection, and sourcing ethics instead of letting the judges focus on your retrieval/extraction/citation engine.

## What is good

A few things are genuinely strong:

* The overall 3-phase flow is good: query → preview/config → results workspace.
* The right sidebar split into Search / Details / Sources is a strong mental model.
* The details view showing per-criterion evidence is exactly the right instinct.
* The sources tab is good product framing.
* Threads/history is a nice touch for demoability.
* The UI is legible. It does not look like a toy.

So I would **keep the skeleton**.

## What is wrong or risky

### 1. The UI is too specialized around people search

Your table schema is basically:

* name
* URL
* status
* sources
* GitHub
* email

That is not a generic entity table. It is a people lead table.

For the challenge, the table must feel like it can handle:

* startups
* restaurants
* OSS tools
* datasets
* papers
* whatever entity class the query implies

So the table needs to be **dynamic-schema-first**, not people-schema-first.

---

### 2. The current interaction model assumes every criterion is binary

This is a real flaw.

“Located in New York” is binary.
“Worked at a post-Series-A startup” is maybe binary if defined carefully.
“Great at design” is not binary.
“Top pizza places” is definitely not binary.
“Open source database tools” is discovery + classification, not pass/fail.

Your current model seems to treat every criterion as:

* pass
* miss
* verifying

That is too crude.

You need at least:

* `pass`
* `fail`
* `uncertain`
* `conflict`
* maybe `partial`

And you need to separate:

* **hard filters**
* **soft ranking signals**
* **enrichment columns**

Right now those are mixed together.

---

### 3. The details pane proves criteria, but not all cells

This is one of the biggest misses.

The challenge explicitly cares that **each populated cell is traceable to a source**.

Your Details pane is pretty good for criteria. But your enrichment fields like GitHub and Email are just shown as values. No visible evidence. No source chip. No snippet. No confidence.

That means the most literal requirement of the assignment is not yet reflected in the UI.

Every non-empty cell needs:

* source URL
* supporting snippet or extracted span
* extraction method or evidence type
* confidence / trust state

At least on click.

---

### 4. The agent activity modal is a bit too much “agent theater”

This is common in generated demos.

“Rewriter Agent”, “Search Agent”, “Evaluator Agent”, “Extractor Agent” looks flashy, but it risks sounding fake unless the backend actually supports it with:

* real step boundaries
* real inputs/outputs
* real retry/failure behavior
* real cost/runtime numbers

For a take-home, judged quickly, I would reduce the anthropomorphic agent branding and make it look more like a measured pipeline:

* Parse query
* Generate search plan
* Retrieve candidate pages
* Extract candidate entities
* Verify fields
* Merge duplicates
* Finalize results

That sounds more credible and more engineering-heavy.

---

### 5. The mock leakage is fatal if it survives into demo

This screenshot is the clearest red flag:

query says **“YC W24 healthcare startups”**
but the criteria shown are still:

* AI engineer with professional experience
* located in New York
* design expertise
* post-Series-A startup

That instantly destroys trust.

Even if it is mock state now, this is not a cosmetic issue. This is exactly the type of bug a judge notices and stops believing the system.

You need hard guarantees that:

* switching threads resets derived state correctly
* query-specific criteria regenerate cleanly
* stale criteria cannot survive across runs

---

### 6. “Match / Miss / Verifying” in the main table may be the wrong top-level story

Ask what the main table is supposed to represent.

If it is the final result set, showing misses in the same main table is odd.
If it is a candidate pool, then the table needs stronger candidate-review semantics.

For the demo, I would default the main table to:

* accepted results only

Then offer filters for:

* uncertain
* rejected
* conflict

That makes the output look higher quality.

A table full of “miss” rows makes the system look imprecise, even if internally that is honest.

---

### 7. The current examples are not aligned with the safest, strongest demo domain

I would not use the people-search example as the flagship demo.

Use queries like:

* YC W24 healthcare startups
* open source LLM projects with >1k GitHub stars
* AI startups in healthcare
* developer tools for vector databases
* top pizza places in Brooklyn

Those align with the prompt and reduce side debates.

People search can remain a hidden stretch example, not the hero.

---

## Directional realignment I would make now

## 1. Reframe the product as a generic “entity discovery workspace”

Change the mental model from:

“find people that match criteria”

to:

“discover entities, verify attributes, and compile evidence-backed tables”

That means the UI should revolve around:

* **entity type**
* **criteria / filters**
* **columns / enrichments**
* **evidence**

not around LinkedIn/GitHub/email.

---

## 2. Make the table schema fully dynamic

Top-level columns should be generated from:

* entity identity columns
* criteria summary
* requested enrichment columns

A better generic base table is:

* Entity
* Domain / URL
* Type
* Match summary
* Evidence count
* dynamic requested columns...

For example, for “YC W24 healthcare startups”:

* company
* website
* healthcare angle
* YC batch
* location
* funding stage
* evidence

For “open source LLM projects with >1k stars”:

* project
* repo
* stars
* language
* license
* last active
* evidence

That is much stronger.

---

## 3. Split “criteria” from “columns”

This matters a lot.

Right now criteria and enrichments are visually separate, which is good, but the semantics still seem loose.

You want three different classes:

### Hard filters

Must be true for inclusion.
Examples:

* located in New York
* YC W24
* open source

### Soft signals / ranking preferences

Used for ordering, not strict exclusion.
Examples:

* “great at design”
* “top”
* “best”
* “promising”

### Enrichment columns

Extra fields to retrieve if available.
Examples:

* GitHub
* email
* stars
* funding
* pricing
* founders

If you do not separate these, your backend logic will get muddy fast.

---

## 4. Move evidence to the center of the experience

This is your differentiator.

For every row, every populated field should be inspectable.

I would make cell click behavior consistent:

* click a cell
* sidebar opens the value
* shows source URL(s)
* shows snippet(s)
* shows extraction method
* shows confidence/state

That is much more persuasive than a generic sources list.

Right now your Sources tab is useful, but it is too source-centric.
It should become **source-to-cell linked**.

---

## 5. Tone down the fake agent vibe and show measurable execution

A better activity panel would show things like:

* 4 search queries issued
* 17 pages fetched
* 9 entities extracted
* 3 duplicates merged
* 6 rows accepted
* 4 cells left empty due to insufficient evidence
* total model calls: X
* search cost estimate: Y
* elapsed time: Z

That is the sort of thing a judge remembers.

---

## Backend / data model criticism

Your current frontend handoff is decent, but the backend contract should be re-centered around **entity, cell, evidence, source**, not just results.

Right now `SearchResult` sounds too row-centric and too final-output-centric.

I would move toward this shape:

### Thread

* id
* raw query
* normalized query plan
* phase
* target results
* criteria
* columns
* run stats

### QueryPlan

* entity_type
* hard_filters[]
* soft_signals[]
* enrichment_columns[]
* search_queries[]
* budgets

### EntityCandidate

* id
* canonical_name
* canonical_url
* aliases[]
* status (`accepted | rejected | uncertain | conflict`)
* score
* evidence_count

### Cell

* row_id
* column_key
* value
* state (`filled | not_found | uncertain | conflict | unsupported`)
* confidence
* provenance_ids[]

### Provenance

* id
* source_id
* url
* title
* snippet
* extraction_method
* timestamp
* maybe span offsets

### SourceDocument

* id
* url
* domain
* fetched_at
* content_hash
* trust_tier

### CriterionEvaluation

* criterion_id
* verdict
* reasoning_summary
* provenance_ids[]

That model will save you pain later.

---

## Specific UI changes I would make immediately

### Keep

* 3-phase flow
* right sidebar
* thread history
* preview/edit step
* CSV export
* filter/sort

### Change now

* remove people-specific default columns from the generic view
* make columns dynamic per query
* make per-cell evidence inspectable
* rename “Agent Activity” to something more grounded, maybe “Run Trace” or “Execution”
* show accepted rows by default
* add row status categories beyond match/miss
* clearly distinguish hard filters vs ranking signals vs enrichments
* kill stale mock criteria leakage completely

### Add

* entity type badge
* evidence count
* confidence/uncertainty state
* empty-cell reason
* source-to-cell linkage
* run stats summary

---

## On the query rewrite / criteria generation side

You are right that you need a query rewriter / planner. But do not let it become a vague “agent.”

It should output a structured object like:

```json
{
  "entity_type": "startup",
  "hard_filters": [
    {"field": "yc_batch", "operator": "equals", "value": "W24"},
    {"field": "sector", "operator": "contains", "value": "healthcare"}
  ],
  "soft_signals": [],
  "enrichment_columns": ["website", "location", "description", "founders"],
  "search_queries": [
    "site:ycombinator.com W24 healthcare startup",
    "YC W24 healthcare companies",
    "W24 healthcare startup ycombinator"
  ]
}
```

That is much better than free-form criteria strings floating through the system.

---

## One deeper product criticism

The preview stage is useful, but it is currently trying to do two jobs:

* parse the natural language query
* also serve as the user’s main control panel

That is okay for now, but eventually you may want:

* simple search first
* then an editable structured plan

The real thing to avoid is letting the preview become a giant manual form-builder. If the user has to handcraft too much, the “agentic” part stops mattering.

---

## What I would make the demo story

If I were shaping the final video, I would pitch it like this:

1. Enter a broad discovery query
2. System generates a structured search plan
3. It retrieves and compiles candidate entities
4. It verifies each row against explicit criteria
5. It leaves unsupported fields empty
6. Every populated field is clickable back to evidence
7. User exports a grounded dataset

That story is strong.

The current UI is close, but it needs to stop looking like a recruiting/search-ops tool.

## My blunt summary

You are not far off.

But the current UI is:

* too people-search-shaped
* too binary in its matching logic
* too light on cell-level provenance
* slightly too “agent theater”
* vulnerable to stale-state trust failures

Keep the shell. Re-center it around **generic entity tables + evidence-backed cells**.

That is the right realignment.

I can turn this into a concrete `ARCHITECTURE.md` and an API/data-contract spec next.
```
