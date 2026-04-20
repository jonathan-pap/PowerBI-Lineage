# MD Readability Pass — Design

**Date:** 2026-04-20  
**Scope:** Redesign the generated Markdown docs for human readers. No new signals — same data, better presentation.  
**Observation (user):** *"Some of the files are just lists."*

## The diagnosis

Audited all 9 docs against `test/Health_and_Safety.Report` output. Three distinct problems emerge.

### Problem 1 — Flat alphabetical dumps

`index.md` §C has 27 rows of mixed Columns + Measures + Tables in one 5-column table. Reader lands on it with no way to narrow down "I'm looking for a measure, not a column":

```
## C
| Name                     | Kind   | Parent                     | Notes | Description |
| `Calender Week`          | Column | `Date NEW`                  | —     | ISO calendar week number. |
| `Calender Week`          | Column | `Date Period NEW Comparison`| —     | ISO calendar week number. |
| `city_name`              | Column | `dim_site`                  | —     | City where the site is located. |
| `Comparison Date Period` | Column | `Date Period NEW Base`      | —     | Display name of the base date period. |
| ... 23 more rows ...
```

Same signal, grouped by Kind first, would be 10× more usable:
```
## C
### Tables (0)
### Columns (24)   [compact 3-col table]
### Measures (3)   [compact 2-col table]
```

### Problem 2 — Infrastructure noise

`pages.md` renders a full section for every page, including 23 hidden tooltip / drillthrough scaffolds with zero bindings. Reader scrolls past "tt_lsr_with_lsr" / "tt_site_details" / etc. before reaching the actual dashboard pages. On H&S that's 23 useless H2 headers out of 35.

Same pattern in `data-dictionary.md` — all user tables flat-alphabetical, so `_measures` and `_Rollup_measures` appear ahead of `fact_injury`/`fact_psif`. A reader wanting "what's a fact table in this model" has to know to look past the underscores.

### Problem 3 — No orientation or summary

Most docs open with a title → paragraph → immediate data. No "what you'll find" hint, no top-level stats, no way to skim-then-drill.

`model.md` does this well (numbered sections, front matter with a metadata table). `improvements.md` does it well (summary count table, tiered structure). The others don't.

## The proposal — 6 shared patterns

Apply uniformly. None add new data; they rearrange existing output.

### Pattern A — **Front-matter triptych**

Every doc opens with three compact blocks before the first data:

```markdown
# Data Dictionary
## <ReportName>

> Single-sentence description of what's here.

| At a glance | |
|---|---|
| User tables | 43 |
| Columns | 306 |
| Key columns | 26 |
| Hierarchies | 12 |

**How to read this:** Tables are grouped by role (Fact / Dim / Bridge / Misc).
Click any heading to jump; click `▸ Columns (N)` to expand the full column
table for a table.
```

Reader gets numbers + navigation hint in ~8 lines.

### Pattern B — **Signal-first sort, not alphabetical**

For most docs, alphabetical order is the wrong default:

| Doc | Better sort |
|---|---|
| data-dictionary.md | **By role**: Fact → Bridge → Dimension → Calc group → Misc. Alpha within. |
| pages.md | **Visible before hidden**, **measure-binding count descending** (biggest-impact pages first). |
| measures.md | Keep A-Z per-letter, but **group by home-table within each letter** so `_measures[X]` + `_measures[Y]` + `_measures[Z]` don't interleave with everyone else. |
| index.md | **Group by Kind within each letter** (Tables first, then Measures, then Columns). |
| sources.md | Already good (source-type groupings). |

### Pattern C — **Collapsibles over dense tables**

Long data tables (>20 rows) go inside `<details>` with a summary line carrying the count. Reader expands only when hunting.

```markdown
### dim_injury

| At a glance | |
|---|---|
| Columns | 18 |
| Keys | 1 (inferred) |
| Hierarchies | 0 |

<details><summary><b>Columns (18)</b></summary>

| Name | Type | Badges | Description |
| ... |
</details>

<details><summary><b>Relationships (4)</b></summary>
...
</details>
```

Lands as 3-row stat block; expand on demand.

### Pattern D — **Infrastructure goes to an appendix**

Hidden pages with no bindings → one-liner callout + `<details>` appendix, not per-page sections:

```markdown
## Visible pages (10)

[per-page sections as today]

## Hidden pages (23)  _utility / tooltip / drillthrough scaffolds_

<details><summary>Show the list</summary>

| Page | Visuals | Reason likely hidden |
| `tt_lsr_with_lsr` | 3 | tooltip page (no data bindings) |
| `tt_site_details` | 4 | tooltip page |
| ...
</details>
```

Collapses 23 noise sections into 1 appendix, reader expands only when auditing.

Same pattern for auto-date tables in `data-dictionary.md` (already partly done — extend).

### Pattern E — **Cross-links that work**

Every `see the X doc` reference must be a real link or dropped. Current state has strings like `"See the Quality doc's Unused Measures section"` left over from before Quality was removed — dead references.

Sweep all docs for `see the X doc` / `see the X section` and either:
- Convert to `[text](./x.md#anchor)` if the target exists
- Convert to dashboard tab reference: `"…seen in the Unused tab of the dashboard"`
- Drop the mention

### Pattern F — **One compact line > tall table**

For index-style listings, consider replacing 5-column wide tables with compact single-line items:

Before:
```markdown
| `Calender Week` | Column | `Date NEW` | — | ISO calendar week number. |
```

After:
```markdown
- **`Calender Week`** _(Column in `Date NEW`)_ — ISO calendar week number.
```

Narrower, scans faster on mobile / wiki themes. Keep tables where there are 3+ *structured* facts (like the data-dictionary columns table), drop them where the only data is name + kind + desc.

## Per-doc changes (proposed)

### index.md

- Front-matter triptych (At-a-glance + How-to-read)
- **Group by Kind within each letter**: `## C` → `### Tables (0)` → `### Measures (3)` → `### Columns (24)`
- Convert item tables to compact single-line entries (Pattern F)
- Add letter-count badges to the Jump-to bar so reader sees `A (12) · B (7) · C (27)` — fast density indicator
- **Estimated effect**: 44K → ~28K, 550 lines → ~350, no signal lost

### pages.md

- Lead with per-page summary + visual-type distribution
- **Visible pages first**, sorted by binding-count descending. Hidden pages in a collapsed appendix at the end.
- Drop the zero-bindings stat table for pages with nothing bound (they add no info)
- Per-page section: stat block + `<details>` for visuals + `<details>` for full binding list
- **Estimated effect**: 22K → ~12K, 638 lines → ~280

### data-dictionary.md

- Lead with **role-based schema overview** — "this model has 7 Facts, 4 Bridges, 11 Dims, 21 Misc"
- Tables grouped by role (Fact → Bridge → Dim → Misc) with intra-role alpha
- Per-table: stat block on top, then `<details>` per sub-section
- Auto-date tables already collapsed — keep
- **Estimated effect**: navigation drastically better; bytes modest (~20% down)

### measures.md

- Keep A-Z skeleton (it's the reference)
- **Within each letter**, group by home-table (keeps related measures together)
- Per-measure `<details>` already there — keep
- Add compact "At a glance" block at top: direct/indirect/unused breakdown + top-5 most-referenced
- **Estimated effect**: navigation better; bytes similar

### model.md

- Already well-structured (numbered sections)
- One tweak: §3 Tables table gets a role-breakdown sub-header above the list
- Add a compact cross-link box at end: "For details see [Data Dictionary](./data-dictionary.md), [Sources](./sources.md), [Measures](./measures.md)"
- **Estimated effect**: minor polish

### sources.md

- Already strong — minor tweaks only
- Add per-source-group "at a glance" — partition-mode breakdown, table roles

### improvements.md

- Already strong — no changes proposed
- This is the "design target" — other docs should lean toward this feel

### functions.md, calcgroups.md

- Tiny on most models; existing layout is fine
- One tweak: if the doc is empty (no UDFs / no calc groups), emit a one-liner rather than a skeleton with only a title + empty tables

## Cross-cutting

- **Sweep for dead cross-references** (the "Quality doc" leftovers) — 2 sites I already know of in improvements.ts
- **Standard "generated at / regenerate command" footer** across all docs (consistent)
- **Heading-level discipline**: H1 for title only, H2 for top-level sections, H3 for sub-sections, no H4+

## Scope + effort

Full pass across all docs: **~500-800 LOC** of generator changes, all in `src/md-generator.ts` + `src/improvements.ts`. No new parsing. No new tests required, but existing `md-anchors.test.ts` will need a sweep if heading text changes.

### Three execution options

| | Scope | Effort | What you get |
|---|---|---|---|
| **A** | **Just the bad ones** — index.md, pages.md, data-dictionary.md | ~300 LOC | Biggest readability wins on the three worst offenders |
| **B** | All 9 docs, uniform Pattern A/B/C/D/E/F application | ~700 LOC | Consistency across the catalog |
| **C** | Minimum-scope experiments — pick 1 doc, apply all 6 patterns, see if it feels right | ~150 LOC | Validate the patterns before committing to sweep |

## My pick: C → A → B

- **C first**: pick `index.md` (worst offender, simplest data shape). Apply all 6 patterns. Eyeball the result.
- If it feels right, extend to `pages.md` and `data-dictionary.md` (Option A scope).
- If after those three it still feels like an incremental improvement rather than a qualitative lift, keep going (Option B).

This is honest iteration — commit to one doc, verify the patterns pay off, then expand. Avoids burning a full day on a sweep whose payoff you couldn't preview.

## Anti-goals — things NOT to do

- **Don't add ASCII-art diagrams** — they render fine in GitHub but ADO Wiki strips the monospace block
- **Don't mix emoji heavy in body text** — the badge emojis are deliberate (🔑 🔗 🧮); adding random 📄 📊 🎯 for decoration makes docs feel cluttered
- **Don't link externally** (to Power BI docs, etc.) — docs should be self-contained for air-gapped / ADO Wiki consumption
- **Don't collapse everything by default** — over-use of `<details>` makes docs feel like they're hiding content. Collapse lists >20 items, tables >30 rows; keep short sections expanded
- **Don't let "readability" morph into "dumb it down"** — reviewers are technical; they want signal density, just with better hierarchy

## Next step

Confirm one of A / B / C. Then I implement the chosen scope, re-generate the H&S output, and we eyeball-review each doc. No test changes until the sweep stabilises (existing md-anchors test will fire naturally if slugs drift).
