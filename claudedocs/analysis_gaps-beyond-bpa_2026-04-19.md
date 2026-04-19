# Gap Analysis — What's Missing Beyond BPA

**Date:** 2026-04-19  
**Scope:** What's genuinely absent from `PowerBI-Lineage` today that would add real value, **excluding** the BPA ruleset (covered in the separate Fabric research doc).  
**Lens:** Every gap is filtered through three constraints — does it fit the **zero-runtime-dep, offline-first, git-friendly, single-file-output** design ethos?

## What the app already does (calibration)

Audited against current source:

| Area | Status |
|---|---|
| Tables, columns, measures, relationships | ✅ parsed + surfaced |
| Calc groups + items | ✅ dedicated tab + MD |
| UDFs (functions.tmdl) | ✅ dedicated tab + MD |
| Expressions / M parameters | ✅ parsed |
| Partitions (mode, source type, source location, **kind**, expressionSource) | ✅ classifiers + grouping |
| Hierarchies | ✅ parsed (surfaced in data-dictionary MD) |
| EXTERNALMEASURE proxy detection | ✅ structured `externalProxy` field |
| Field parameters / composite-model proxies | ✅ classifiers + Tables-tab grouping |
| Auto-date infrastructure | ✅ filtered, toggle-able |
| Report pages / visuals / bindings | ✅ full scan |
| Unused measures/columns vs. report usage | ✅ dedicated tab + quality.md |
| Measure DAX dependencies | ✅ `daxDependencies` / `dependedOnBy` fields |
| Per-measure Mermaid lineage | ✅ in measures.md |
| Per-table Mermaid relationships | ✅ in data-dictionary.md |
| DAX syntax highlighting | ✅ via vendored highlighter |
| ADO Wiki / GitHub MD compatibility | ✅ anchors + emoji badges |
| Compatibility level + model properties | ✅ parsed (culture, description, etc.) |

**Missing pieces confirmed via source grep** (all searches returned empty): `roles.tmdl`, perspectives, KPIs, refresh policies, sensitivity labels, culture translation overrides, report-level bookmarks/filters/themes.

---

## Tier 1 — High value, low lift, aligned with ethos

These are TMDL-parseable signals the app doesn't look at yet. All add to the "static governance snapshot" story without needing new runtime deps.

### 1.1 Security roles (RLS / OLS) — `roles.tmdl`

**Gap:** Nothing in the app reads `definition/security/roles.tmdl` or equivalent. Row-Level Security is one of the most governance-sensitive parts of a model, and reviewers need to see which roles exist and what DAX filters they apply.

**What to surface:**
- Role name + description
- Member count (if in TMDL)
- `tablePermission` (OLS) — which tables/columns a role can see
- `filterExpression` (RLS) — the DAX filter per role+table

**Effort:** New parser function (~40 LOC) + new tab + new MD doc. Data-builder passes through as-is.  
**Why it lands well:** RLS is the #1 thing that breaks silently on migration; catching it in a PR diff is genuinely valuable. Also fits naturally into a new `security.md` doc that complements `quality.md`.

### 1.2 Refresh policies — incremental refresh

**Gap:** Partitions are parsed, but `refreshPolicy` blocks (rolling window, incremental column, historical range) aren't.

**What to surface:**
- Which tables have incremental refresh configured
- Window size (rolling + incremental)
- RangeStart / RangeEnd parameter binding
- Is DirectQuery-mixed-mode enabled

**Effort:** Extend partition parser (~30 LOC), extend TableData with a `refreshPolicy?` field, add a row in the Sources / Tables tab.  
**Why it lands well:** Refresh policies are brittle — renaming `RangeStart` breaks everything. Showing them in a doc means reviewers can't miss a change.

### 1.3 Sensitivity labels + governance flags

**Gap:** Model-level governance metadata isn't surfaced.

**What to surface:**
- `discourageImplicitMeasures` (already parsed — flag in summary)
- `sensitivityLabel` (if present)
- `privacyLevel` on partitions
- Column-level `dataCategory` values that are governance-relevant (PostalCode, Address, Email)

**Effort:** ~20 LOC in parser; surface as badges on the Summary tab + a compliance section in quality.md.  
**Why it lands well:** One-line diff telling you "this PR downgrades a sensitivity label" is exactly the catch a code review wants.

### 1.4 KPIs as first-class objects

**Gap:** Measures with a `kpi` block aren't distinguished from regular measures.

**What to surface:**
- Measure with `kpi` sub-block → tag with ⭐ KPI badge
- Show goal, status thresholds, trend measure linkage
- List KPIs in a dedicated Measures-tab group (or alongside "Field Parameters" / "Composite Proxies" as a kind)

**Effort:** ~15 LOC parser extension + UI badge + optional dedicated section.  
**Why it lands well:** KPIs are how execs consume the model. Missing them from docs = missing the thing the business cares about most.

### 1.5 Circular & duplicate measure detection

**Gap:** You have `daxDependencies` / `dependedOnBy`. Two graph analyses on top come for free:

- **Circular dependencies** — measures that reference each other transitively. Should be zero; existence = bug.
- **Duplicate DAX bodies** — two measures with identical expression text (after whitespace normalisation). Common refactor target.

**Effort:** Pure graph/hash analysis in data-builder (~30 LOC). Render as two sections in quality.md.  
**Why it lands well:** Zero new data needed — you already have the graph. These are classic refactor targets that humans miss in 200-measure models.

### 1.6 Column → measure impact view

**Gap:** You have measure→measure deps. You can derive **column → measures that reference it** by regexing `Table[Column]` patterns in DAX. Currently the Measures-tab lineage shows dependencies from a measure's POV; the inverse ("if I drop this column, these measures break") is the bigger review risk.

**What to surface:**
- On each column card: "Referenced by N measures: [list]"
- In quality.md: "Columns with no measure references" (candidates for deletion)

**Effort:** Parse-time regex per measure DAX against all column names (~25 LOC). Already have the measure text.  
**Why it lands well:** This is the single most-asked question in a code review: "can I delete this column?" Right now the answer needs Tabular Editor or manual grep.

---

## Tier 2 — Medium lift, genuine differentiator

Bigger investments, but each creates a distinctive capability.

### 2.1 Model diff / PR-comment mode

**Gap:** No way to compare two versions of a model. Reviewers currently eyeball the raw TMDL diff.

**What to build:**
- `node dist/app.js diff <old.Report> <new.Report>` CLI mode
- Output: structured diff — added/removed/modified tables/columns/measures/relationships
- PR-comment-ready Markdown summary: "+3 measures, -1 column, 2 relationships changed"
- Optional: detect **risky changes** — column type changes, RLS filter changes, relationship activity flips

**Effort:** ~150 LOC new module + CLI wiring. Uses existing parser twice.  
**Why it lands well:** This is the feature that makes the app **the** git-workflow tool for Power BI. No existing tool in the SQLBI ecosystem does PR-comment diffs for TMDL. Fills a gap the Fabric research doc highlighted.

### 2.2 Measure dependency DAG (interactive, per-tab)

**Gap:** Mermaid measure lineage exists *per measure in MD*. The HTML app has no whole-model DAG view.

**What to build:**
- New "Dependency" sub-view on the Measures tab: Mermaid diagram of all measure→measure edges for the currently-filtered measures
- Click a node → Lineage tab opens for that measure
- Optional: column nodes at the leaves

**Effort:** Mermaid.js already vendored for MD; need to render in HTML tab. ~80 LOC client + vendor file.  
**Why it lands well:** Visual dependency reading is much faster than list-traversal. 100-measure models currently require clicking through lineage one-by-one.

### 2.3 Deep / transitive unused detection

**Gap:** Current Unused logic is "measure isn't bound to a visual". But a measure can be "used" by another measure that's itself unused — both should flag.

**What to build:**
- Topological walk from `measure.usageCount > 0` leaves backward through `dependedOnBy` graph
- Mark anything not reachable as `status: "transitively-unused"`
- New badge + filter on Measures tab

**Effort:** ~40 LOC in data-builder cross-reference step.  
**Why it lands well:** Finds the next-level dead code the current pass misses. Standard refactor dividend.

### 2.4 JSON / library-mode export

**Gap:** App outputs HTML + MD. Programmatic consumers (other tools, custom CI scripts, LLM agents) need structured data.

**What to build:**
- `--format json` CLI flag → dumps `FullData` as JSON to stdout / file
- Publish parser + data-builder as an npm package (`@org/powerbi-lineage-core`) for library consumers
- Or just a stable JSON schema so downstream tools can depend on the shape

**Effort:** JSON export is ~20 LOC (it's already a plain object). npm package requires API stability commitments.  
**Why it lands well:** Turns the app from a "doc generator" into a **platform**. Fabric notebooks could consume the JSON and add their runtime-only signal on top. Downstream AI agents / custom dashboards / migration tools become feasible.

### 2.5 Schema diagram in HTML (interactive)

**Gap:** Relationships tab is a table. A visual star/snowflake diagram is faster to read.

**What to build:**
- SVG rendering of tables-as-nodes, relationships-as-edges
- Highlight fact/dim with existing colour tokens
- Click-to-navigate to the table in Tables tab

**Effort:** ~200 LOC, potentially with a vendored minimal graph layout (dagre via `dagre-d3`, or hand-rolled if sticking to zero-dep).  
**Why it lands well:** Makes the tool visibly better than competitors. But watch the zero-dep boundary — may force adding one vendored lib.

---

## Tier 3 — Worth considering, with caveats

### 3.1 Perspectives

**Gap:** Not parsed. Perspectives group measures/columns into subject-area views.

**Effort:** Easy to parse, hard to render usefully — perspectives overlap with display folders in practice.  
**Verdict:** Skip unless a real user model shows heavy perspective use.

### 3.2 Translations / culture overrides

**Gap:** `cultures/*.tmdl` files aren't consumed. They carry translated captions for non-`en-US` deployments.

**Effort:** Moderate parser work. Render value: show translated captions alongside raw names.  
**Verdict:** Niche — only useful for multi-language deployments. Defer.

### 3.3 Report-level themes / custom visuals / bookmarks

**Gap:** Report scanner gets visuals but doesn't catalog theme or bookmarks.

**Effort:** Moderate parsing per-report.  
**Verdict:** Useful for report-health audits but expands scope from "model" to "full deliverable". Could be a follow-up module.

### 3.4 BPA-lite (reimplement TE2 ruleset in Node)

**Gap:** The research doc called this out as the one genuine Fabric-side advantage. User said "apart from BPA" — so park this.

**Verdict:** Skip per explicit instruction, but worth a separate design doc later since the [Microsoft BPA rules JSON](https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules) is directly portable.

---

## Recommendation — priority order

If I were scoping a roadmap, this is the order I'd land them:

| # | Feature | Tier | Rough LOC | Standalone value | Unlocks |
|---|---|---|---|---|---|
| 1 | **Column → measure impact view** | 1 | ~25 | Answers "can I delete this?" | Real-time governance during edit |
| 2 | **RLS / OLS surfacing** | 1 | ~40 | Governance crit | Security section in quality.md |
| 3 | **Refresh policies** | 1 | ~30 | Ops signal | Complete Sources-tab story |
| 4 | **Model diff / PR-comment mode** | 2 | ~150 | Defining feature | Makes app **the** git workflow tool |
| 5 | **KPIs as first-class** | 1 | ~15 | Exec visibility | |
| 6 | **Circular / duplicate detection** | 1 | ~30 | Refactor targets | Expand quality.md |
| 7 | **Transitive unused detection** | 2 | ~40 | Cleanup dividends | |
| 8 | **Measure DAG in HTML** | 2 | ~80 | UX delight | Model-comprehension aid |
| 9 | **JSON export / library mode** | 2 | ~20 + API work | Ecosystem play | Downstream tools |
| 10 | **Sensitivity + governance flags** | 1 | ~20 | Compliance | |

**Quick-win block (items 1-3 + 5-6):** ~140 LOC, under a day's work, lands five visible features.  
**Distinctive-feature block (item 4):** another ~150 LOC, establishes the CI-native niche.  
**Platform block (item 9):** ~20 LOC but requires a commitment to API stability.

## Anti-recommendations — don't build these

- **Live DAX evaluation** → can't without an AS engine; Fabric's job
- **VertiPaq memory stats** → same reason
- **NL Q&A / data agents** → outside ethos, LLM-dependent
- **Schema diagram requiring a heavy graph lib** → breaks zero-dep
- **Workspace / tenant scanning** → Fabric-side concern
- **Publishing / deployment automation** → out of scope; pbi-tools territory

These are genuinely impossible or misaligned. Keeping the boundary sharp is what makes the tool distinctive.

## What "good" looks like after this roadmap

Your app becomes the **pre-publish governance snapshot** for Power BI, with:

- Every TMDL-parseable signal surfaced (security, refresh, KPIs, impact)
- PR-comment diffs on every model change
- A stable JSON output that other tools / LLMs can consume
- Visual dependency browsing that Tabular Editor doesn't match for shareability
- Still: zero runtime deps, single HTML, offline, free, portable, git-native

Positioned against Fabric notebooks: **you ship the upstream. They ship the runtime.**
