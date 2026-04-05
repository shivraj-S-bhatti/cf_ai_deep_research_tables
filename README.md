# Deep Research Datasets

**`query_raw` → grounded entity table**  
Brave search · Gemini planning/extraction · Cloudflare Worker

---

## The Hard Problems

**1. Entity kind from raw query**
- Query names no type. Planner must infer from intent.
- `"best pizza in Brooklyn"` → `restaurant`
- `"YC W24 healthcare startups"` → `startup`
- Wrong kind → wrong checks → wrong search targets

**2. Checks from raw query**
- Hidden marks in user intent: location, cohort, category, date
- Split: `hard_filter` (must pass) vs `soft_signal` (weight toward)
- Output shape per check: `{label, kind, fieldHint, operatorHint, valueHint}`
- Planner must not collapse all marks into keyword variants of the query

**3. Query → planner input**
- `query_raw` → `{entityType, criteria[], columns[], searchQueries[], budgets}`
- Search queries must seek missing proof — not rewrites of the same query
- Failing here means all downstream stages run on the wrong search space

**4. Page ≠ Row**
- Roundup page → many entity candidates, not one row
- Official site → one entity, many facts
- Forum thread → weak backing only
- Must class the page before pulling; wrong class → wrong row count
- This is the biggest single source of bad output

**5. Folding across pages**
- Same thing named differently across Yelp, official site, guide, review
- Group by: `normName(a) == normName(b)` OR `jaccardTokens(a,b) ≥ 0.5`
- Merge: keep highest-weight cell per key; keep highest-weight check per label
- URL-only dedup cannot catch this

**6. Cell traceability**
- Every filled cell must carry backing text (`evidenceText`)
- Weight drives merge winner; lower-weight cell is dropped, not blended
- Null policy: `dash` — not blank string

---

## Run State Machine

```mermaid
stateDiagram-v2
    [*] --> Plan : query_raw
    Plan --> Search : entityType + checks + columns + searchQueries
    Search --> Fetch : urls[]
    Fetch --> Class : page body
    Class --> Pull : sourceClass
    Pull --> Fold : mentions[]
    Fold --> Weigh : canonical rows
    Weigh --> Rank : rowStatus per row
    Rank --> Export : scored rows
    Export --> [*]

    Weigh --> Fetch : table gaps → re-fetch
    Weigh --> Search : table gaps → re-search
```

`sourceClass`: `roundup` · `entity_page` · `official` · `directory` · `forum`

---

## Three Objects

|  | What | Not |
|---|---|---|
| **page** | Fetched doc. Has `sourceClass`. | Not a row. |
| **mention** | One candidate pulled from one page. | May share name with mentions from other pages. |
| **row** | Merged canonical thing. Cells from best mention per key. | Not a page. |

---

## Row States

**kind:** `accepted` · `rejected` · `uncertain` · `conflict`  
**step:** `pending` · `verifying` · `finalized` · `failed`

---

## Fold Logic (`dedup.ts`)

```
normName(s):
  lowercase → strip (the|a|an) → strip non-alphanumeric → collapse spaces

jaccardTokens(a, b):
  tokenSet(a), tokenSet(b) → |intersect| / |union|

group if:
  normName(a) == normName(b)
  OR jaccardTokens(a, b) >= 0.5

merge group:
  seed      = highest-score row
  cells     = max-weight per key across group
  checks    = max-weight per label across group
  rowStatus = conflict > uncertain > rejected > accepted
  score     = max across group
```

---

## Cost Shape

| Stage | Bound |
|---|---|
| Plan | O(1) |
| Search | O(Q + S) |
| Fetch | O(S) |
| Pull | O(R × C) |
| Weigh | O(R × K) |

`Q`=queries · `S`=pages · `R`=rows · `C`=columns · `K`=checks

Blowup in practice: not asymptotic. Per-row polling and repeated full-event transfer were the real hotspots.

---

## Open Gaps

- Roundup expansion: should yield N rows; currently yields 1
- Cross-page fold too weak for local business queries
- Page misclass silently routes to wrong pull path
- Long roundup pages time out on single-call extraction
- Local run: in-memory, not D1/KV/Queue

---

## Setup

```bash
npm install
npm run dev   # → http://localhost:8080
```

Copy `.env.local.example` → `.env.local` for live Brave + Gemini keys.

| Script | |
|---|---|
| `npm run dev:live` | live keys |
| `npm run build` | build |
| `npm run test` | unit |
| `npm run test:e2e` | e2e |
| `npm run cf:deploy` | deploy |

---

## Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [OPENAPI.yaml](OPENAPI.yaml)
- [Submission draft](knowledge/submission/assignment-submission-draft.md)
- [Notebooks](knowledge/notebooks)
