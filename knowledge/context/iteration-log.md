# Iteration Log

## Document Metadata

- `Doc ID`: `context.iteration-log`
- `Version`: `1.1.0`
- `Status`: `working`
- `Kind`: `iteration-log`
- `Last Updated`: `2026-04-05`
- `Authority`: Useful context and synthesis, but not the binding source of truth. Use [knowledge/context/current-decisions.md](./current-decisions.md) for current authoritative project decisions.
- `Supersedes`: `none`

## Scope

This file keeps non-binding project context, external critique, and iteration notes that we want to preserve for later reporting and analysis.

## Devlog Entry — 2026-04-05 (Durable Object run ownership)

### Symptom

- Production runs could look healthy from one endpoint and missing from another.
- `health`, `debug/runtime`, `results`, and `cancel` requests could hit different Worker isolates.
- Active runs could stall invisibly because state and inflight execution lived in isolate-local memory.

### Root cause

The previous production runtime kept thread/run state in a module-global `AgenticSearchRuntime` backed by `MemoryResearchStore`. That was acceptable locally, but invalid on multi-isolate Workers:

- one isolate could own the live run
- another isolate could serve `results` or `cancel`
- `run_not_found` and split-brain diagnostics were therefore expected, not anomalous

### Infra change

The runtime is now split into:

- edge Worker for static assets, preview, and REST routing
- one **thread owner Durable Object** per thread for run state and execution
- one **registry Durable Object** for thread summaries and `runId -> threadId` lookup

This preserves the existing `/api/v1/*` API while moving stateful ownership to a single coordination surface per thread.

### Why this shape

- A single global Durable Object would fix consistency but destroy throughput.
- One Durable Object per thread keeps a strong owner for:
  - run execution
  - trace
  - results
  - cancel
- Different threads can still run in parallel because they route to different owners.

### Persistence model

Current persistence is snapshot-based:

- `MemoryResearchStore` can export/import a serializable snapshot
- thread owners persist snapshots into Durable Object storage
- on owner restart, non-terminal runs are failed explicitly instead of pretending they are still alive

This is the current production durability step, not the final D1-backed historical model.

## Devlog Entry — 2026-04-05 (Anchor-first live loop + explicit preview pending states)

### Symptom

- The live runtime was spending too much time creating and then cleaning up weak provisional rows.
- Directory/list pages could dominate the budget before real corroborating pages were fetched.
- Preview creation and run start looked inert for several seconds because the UI had no explicit pending state.

### Logical error in the old loop

The old live path was still shaped like:

- discover pages
- turn pages into provisional rows
- validate ambiguous rows late
- let supervisor/rewrite logic repair weak retrieval

That model creates a lot of compensating heuristics because row identity is materialized too early. It also makes `targetResults` ambiguous because candidate count gets conflated with grounded output quality.

### Simplification

The default live loop is now treated as:

- discovery returns pages only
- list/directory/forum pages emit anchor candidates only
- once an anchor exists, the next work is corroboration, not more broad search
- visible rows are created only after at least one grounding source exists
- final acceptance requires grounded evidence, not list-page optimism

Operationally this means:

- `targetResults` counts grounded final rows
- row URL defaults to the first backing source URL
- website/entity URLs remain cell-level until corroborated
- the supervisor/rewrite path is no longer the default control loop

### Preview UX fix

The client store now exposes explicit pending flags for:

- preview creation from home
- preview refresh after query edits
- run start from preview

The main shell uses those flags to:

- disable duplicate submits
- show `Building preview…`
- show `Refreshing preview…`
- show `Starting research…`

This does not shorten provider latency directly, but it makes the latency legible instead of looking broken.

## Devlog Entry — 2026-04-05 (Client thread store: `listThreads` vs `activeThreadId`)

### Symptom

From the home flow (e.g. new thread → sample query → preview → Run Search), the UI sometimes jumped to an **older** thread: wrong topic in the sidebar, preview/results out of sync with what the user had just started.

### Root cause

Two interacting issues in [`src/stores/thread-store.ts`](../../src/stores/thread-store.ts):

1. **`reloadThreadSummaries` was recreated whenever `activeThreadId` changed**, so the mount `useEffect` re-ran and issued **multiple overlapping `GET /api/v1/threads` requests**. Whichever response completed **last** won. An **older** payload could omit a thread that was created after that request started; the merge path only keeps IDs present in that response, so the new thread disappeared from client `threads`.

2. A **repair `useEffect`** runs when `activeThreadId` is set but that id is **not** in `threads`: it sets `activeThreadId` to `threads[0]` (or `null`). That is correct for “thread was deleted,” but it **fires incorrectly** when the list is briefly inconsistent.

3. **`createThread` called `setActiveThreadId` before `await hydrateThread(...)`**, so React could render with an active id pointing at a thread that was **not yet** in `threads` (hydration still in flight). The same repair effect then cleared or repointed the active id—Playwright then failed waiting for preview copy like `Criteria (3)` because the app never landed on the new thread’s preview.

### What we changed (mitigations)

- **Sequence guard**: increment a ref before each list fetch; after `await`, skip applying the result if a newer fetch started (drop superseded responses).
- **Stable list reload**: `reloadThreadSummaries` uses `[]` deps and reads `activeThreadId` from a ref for the “if no active, select first thread” branch so the effect does **not** refetch on every thread switch; create/update/delete already go through `upsertThread` / `deleteThread`.
- **Merge safety**: when applying the list, if the ref’d active id exists in **previous** `threads` but is missing from the server array, **re-insert** that thread and re-sort by `updatedAt` (covers a narrow stale-list edge).
- **Ordering**: `createThread` **awaits `hydrateThread`** (which `upsertThread`s) **then** calls `setActiveThreadId`, so the repair effect never sees “active but not in list” for a brand-new thread.

### Lessons

- **Any “replace state from HTTP” path needs either** single-flight / last-write-wins-by-design **or** explicit **generation** (or abort) so older responses cannot clobber newer reality.
- **`activeThreadId` and the list that contains that thread must become consistent in one coherent order** (insert thread in client state, then select it)—not the reverse.
- **Guard effects that “fix” invalid selection are sharp**: they will misfire if list and id are updated in the wrong order; tests that assume preview appears immediately after create are good regressions for this.

Authoritative write-up: [ARCHITECTURE.md](../../ARCHITECTURE.md) (Current Frontend Data Flow → thread list subsection; Current Failure Modes §6).

## Devlog Entry — 2026-04-05 (Runtime Stabilization + State Machine Corrections)

### Context

We completed a full pass on live runtime correctness after a major agentic refactor (multi-entity extraction, supervisor loop, fallback chains, source classification, dedup, and progressive UI updates). The main user-facing symptom was that the system appeared active but did not behave predictably under real load.

### Problems Observed

1. **Concurrent runs were possible**
   - Users could initiate overlapping research threads/runs.
   - Result: duplicated provider calls, throughput collapse, and confusing UI state.

2. **Rows looked stuck in `Queued` even when data had landed**
   - Cells/evaluations were being populated while `processingState` remained `pending`.
   - Result: users perceived no progress despite backend work.

3. **Run stage appeared stuck in `discovery` for long durations**
   - Supervisor refinement work was effectively represented as discovery-heavy flow.
   - Result: operators could not tell where time was actually going.

4. **Supervisor loop consumed extra iterations after logical completion**
   - “Done” did not sufficiently stop downstream loop behavior in all practical paths.
   - Result: avoidable LLM calls and longer elapsed runtime.

5. **Over-aggressive rejection logic**
   - Rows were rejected too early on weak signals.
   - Document-like heuristics could push rows to rejected even when confidence was low.
   - Result: false negatives and poor result quality.

6. **Source lineage problem (parent/child contamination)**
   - Wrong parent pages (example: wrong cohort/year) still fanned out child entities.
   - Result: many children got evaluated/rejected from out-of-scope provenance.

7. **No hard wall-clock expectation in UX**
   - Users lacked a clear time budget and remaining-time expectation.
   - Result: long waits felt like hangs rather than bounded execution.

### Root Causes

- State transitions were not strict enough between fetch/extract/refine/verify/finalize.
- Rejection decisions mixed hard decisions with weak heuristics.
- Source-scope checks were late (post-fanout) rather than early (at parent fetch/classification).
- Supervisor budget allocation lacked strong “do not revisit pruned families” controls.
- UX progress indicators did not map 1:1 with backend execution semantics.

### Fixes Implemented

1. **Single active run guard + explicit termination UX**
   - Starting a new query now prompts termination of the active run first.
   - Existing run is canceled before new run starts.
   - Cache is preserved.

2. **State machine improvements**
   - Added explicit transient states (`fetching`, `extracting`, `refining`) and rendered them in status badges.
   - Progressive row state updates now reflect actual work-in-progress.

3. **Supervisor/runtime control fixes**
   - Supervisor stage represented as refinement.
   - Added/kept wall-clock guard (`MAX_RUN_WALL_CLOCK_MS`, default 8 minutes).
   - Runtime now records wall-clock exceeded as explicit failure condition.

4. **Conservative final status policy**
   - Rejection is confidence-gated.
   - Weak hard-filter signals now remain uncertain instead of rejected.
   - Document-like heuristic downgraded to uncertainty signal, not auto-reject.

5. **Early source pruning and child cascade prevention**
   - Parent source scope gate added in fetch path.
   - Out-of-scope hard parents are pruned before extraction fanout.
   - Pruned source families/domains are filtered out of discovery/supervisor follow-up targets.

6. **Code bloat cleanup**
   - Removed dead fallback helpers that no longer participated in the active live path.
   - Consolidated decisions into runtime status derivation and source-scope gating functions.

7. **UX runtime clarity**
   - Added elapsed/remaining-time hints aligned with server hard cap.
   - Run panel now communicates stage + budget expectations more clearly.

### What We Learned

1. **Correctness beats parallelism in early systems**
   - Concurrency without strict admission control can destroy both quality and cost profile.

2. **State machine truthfulness is a product feature**
   - If UI state diverges from actual runtime state, users lose trust even when extraction works.

3. **Do not reject on weak evidence**
   - `uncertain` is a first-class outcome, not a failure.
   - Aggressive rejection creates silent quality loss and bad demos.

4. **Lineage-aware pruning must happen upstream**
   - If parent provenance is wrong, fanout must stop immediately.
   - Post-hoc rejection of children is wasteful and noisy.

5. **Supervisor loops need explicit stop contracts**
   - Termination behavior must be guaranteed in code paths, not assumed from intent.

6. **Bounded runtime + visible estimate reduces anxiety**
   - Hard limits plus transparent timing make long-running retrieval pipelines operationally legible.

### Open Follow-ups

- Add richer prune reason surfacing in row-level UI (reason chips/tooltips).
- Add tests for parent-prune -> child-cascade scenarios across multiple domains.
- Add stricter per-source-family budget partitioning to avoid source monopolies.
- Extend cancellation semantics to include hard delete of thread/run artifacts on user action.

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
