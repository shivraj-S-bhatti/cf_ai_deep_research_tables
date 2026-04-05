# Pages Are Not Entities

## Document Metadata

- `Doc ID`: `blog.pages-are-not-entities`
- `Version`: `1.0.0`
- `Status`: `working`
- `Kind`: `blog-draft`
- `Last Updated`: `2026-04-04`
- `Authority`: Draft long-form writeup for a future website post. Useful for shaping public-facing retrospective content, but not a binding engineering artifact.
- `Supersedes`: `none`

## Premise

The bugs in our first serious agentic-search runtime did not come from random prompt weirdness. They came from one architectural mistake:

> Pages are not entities.

We built a pipeline that was too page-first. Search results turned into provisional table rows before the system had actually resolved what those pages were talking about.

That sounds small. It was not.

## The Failure Pattern

Ask the system for `best pizza places in Brooklyn` and it does something superficially plausible:

- searches the web
- fetches pages
- runs extraction
- evaluates criteria
- ranks rows

But the rows are often wrong because the search engine returns pages, not restaurants. A roundup page, a Reddit thread, a walking tour, a review page, and an official business site are all different source types. They should not all become rows in the same way.

Our old runtime created one provisional row per URL. That meant:

- a TripAdvisor “10 best pizza places” page became one row
- a pizza bus tour page became one row
- a Reddit discussion became one row
- a business review page became one row

The pipeline then spent the rest of its logic trying to rescue that mistake with heuristics.

## Concrete Bugs That Fell Out Of That

### 1. Roundup pages did not expand

The most valuable source in a “best of” query is often a roundup page. It may mention ten good candidates. The old system extracted exactly one row from it and then often rejected that row because it looked like a listicle.

That is the clearest sign that the unit of extraction was wrong.

### 2. Entity-level review pages got filtered as documents

A review page about a real business is not the same thing as a generic article. If the page is clearly about a single restaurant, the reviewed entity should become the row and the review page should become the evidence source.

Instead, broad document heuristics could kill the row outright.

### 3. Hard-filter evaluation became meaningless

If the page text mentions “pizza” and “Brooklyn,” shallow fallback logic can accidentally pass `is a pizza place` and `is located in Brooklyn` even when the row is really a tour, guide, or thread.

At that point the table looks structured, but the semantics are corrupt.

### 4. Ranking stopped being informative

Once fallback scoring collapses rows toward the same score, ranking becomes almost decorative. The app still shows a sorted table, but the ordering is not carrying useful judgment.

### 5. Deduplication had the wrong identity primitive

URL-only deduplication is fine for pages, not for entities. The same restaurant can appear across official sites, reviews, maps, and guide pages. If the system never resolves them to one entity identity, it either duplicates rows or drops signal.

### 6. Class-aware extraction still failed when classification was wrong

Once we started moving toward better extractor prompts, we introduced a source-class-aware split:

- roundup and directory pages should extract many entities
- entity pages and official sites should extract one entity
- forums should extract weak mentions conservatively

That was the right direction, but it exposed another failure mode: if a roundup page is misclassified as an entity page, the system regresses back to a one-row interpretation of a multi-entity source. In other words, better prompts do not save you if routing is wrong.

### 7. The best pages became the slowest pages

The richest pages are often the worst for latency. A strong roundup page may contain many entity mentions, long descriptions, ratings, neighborhoods, and comparisons. Sending a large body to the model and asking for “extract everything” in one shot can hit timeouts or stall badly.

That produced a new operational bug: the documents we most wanted were the ones most likely to fail under naive extraction.

## The Correct Separation

The pipeline needs three layers:

1. source documents
2. entity mentions extracted from those documents
3. merged canonical entity rows

Once those are separate, the behavior becomes much easier to reason about:

- a roundup page can yield many entity mentions
- an entity review page can yield one entity mention
- the same business can be merged across sources
- each cell can keep the evidence that grounded it

That is the real transition from a search-results UI to an entity-discovery engine.

## What We Learned

The useful insight was not “our prompt needs tweaking.” The useful insight was that the pipeline unit was wrong. We were trying to do source classification, entity extraction, row creation, and ranking inside one 1-in / 1-out pass.

That design created pressure everywhere else:

- query rewriting got muddy
- ranking logic got overloaded
- verification tried to adjudicate bad rows instead of good candidates
- observability surfaces became crowded because the underlying control flow was unclear

Once we stated the problem correctly, the refactor direction became obvious:

- persist documents
- classify the role of each document
- extract multiple entities where appropriate
- chunk or bound long documents instead of treating every rich roundup as one giant prompt
- merge on entity identity, not URL identity
- only then rank and export

## Why We Kept The Failure Visible

We kept notebooks, analysis logs, and architecture notes in the repo because we wanted to preserve the reasoning, not just the fixes. This project is not only about shipping a demo. It is also about being able to explain, with evidence, why one architecture failed and why the next one is better.

That is the kind of knowledge we want the final writeup to keep.
