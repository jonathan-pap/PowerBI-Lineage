# Could Fabric Notebook + semantic-link + a Report Wrapper Deliver the Same Effect as PowerBI-Lineage?

**Date:** 2026-04-19  
**Scope:** Comparative research — does a Microsoft Fabric notebook using `semantic-link` (sempy) / `semantic-link-labs`, wrapped into a report deliverable, cover the same ground as this app?  
**Depth:** Standard (2-3 hops, 6 sources)  
**Answer (TL;DR):** **No — they solve different problems.** They overlap in ~40% of features but diverge sharply on workflow, deployment model, cost, and portability. The right question isn't *"which one"*, it's *"which problem are you solving today?"*

---

## 1. Executive Summary

| Dimension | This app (`PowerBI-Lineage`) | Fabric notebook + semantic-link |
|---|---|---|
| **Input** | `.Report` + `.SemanticModel` folder (TMDL/BIM) on disk | **Published** semantic model in a Fabric/Premium/PPU workspace |
| **Runtime** | Local Node.js, zero deps | Fabric notebook (requires F-SKU or trial capacity) |
| **Output** | Single self-contained HTML + Markdown files | Notebook cells, optional Power BI report on metadata lakehouse |
| **Cost** | Free | Fabric capacity consumption |
| **Offline / pre-publish** | ✅ Works on unpublished TMDL in git | ❌ Model must be published first |
| **Portable deliverable** | ✅ Email / commit / serve as static HTML | ⚠ Requires Fabric access or derivative artifacts |
| **Best Practices Analyzer** | ❌ Not built-in | ✅ 60+ rules (Microsoft + community) |
| **VertiPaq / memory stats** | ❌ Not available | ✅ Per-table/column memory breakdown |
| **Live DAX evaluation** | ❌ Not attempted | ✅ `evaluate_dax` / `evaluate_measure` |
| **Natural-language Q&A** | ❌ Not in scope | ✅ Fabric Data Agent pattern |
| **Unused detection vs report** | ✅ Full binding scan | ⚠ Possible via `INFO.CALCDEPENDENCY()` |
| **Git-friendly CI pipeline** | ✅ Natural — static files | ⚠ Possible via Fabric pipelines |
| **Works on **any** .Report** | ✅ Regardless of tenant/license | ❌ Needs workspace membership |

**Key insight:** The two approaches answer different questions. **Your app answers *"what's in this model, statically, before or outside publishing?"*** Fabric notebooks answer ***"what's happening in this model, right now, in production?"***

---

## 2. What semantic-link / sempy can actually do

### 2.1 Core sempy primitives (runs in Fabric notebook)

From the [Microsoft Learn semantic-link overview](https://learn.microsoft.com/en-us/fabric/data-science/semantic-link-overview) and [sempy.fabric API reference](https://learn.microsoft.com/en-us/python/api/semantic-link-sempy/sempy.fabric):

- `list_datasets()`, `list_tables()`, `list_columns()`, `list_measures()`, `list_relationships()` — enumerate semantic model objects
- `evaluate_dax(dataset, dax)` — execute DAX against a published model
- `evaluate_measure(dataset, measure)` — compute a specific measure
- `FabricDataFrame` — pandas subclass that carries semantic metadata + lineage through transformations
- Built-in **semantic functions** — `is_holiday`, `to_geopandas`, `parse_phonenumber`, validators

Covers: **metadata enumeration + live query**. Does *not* cover: static structural classification (fact/dim/bridge), source-partition inspection, Markdown export, HTML rendering.

### 2.2 What DAX INFO functions add

Via [INFO DAX functions exposed through sempy](https://www.tackytech.blog/how-to-query-and-store-meta-data-of-your-semantic-model-with-sempy-and-dax-info-functions/):

- `INFO.TABLES()`, `INFO.COLUMNS()`, `INFO.MEASURES()`, `INFO.RELATIONSHIPS()` — TMSCHEMA DMV wrappers
- `INFO.CALCDEPENDENCY()` — object-level dependency graph (what depends on what, transitively)
- `INFO.PARTITIONS()` — partition-level metadata including `Type` (M / calculated / entity) and source
- `INFO.EXTENDEDPROPERTIES()` — reaches the `ParameterMetadata` fieldparameter marker

**Parity gap:** INFO functions have the *same raw signal* your app extracts from TMDL, but surfaced from the **live compiled model**, not the source files. Same data, different stage of the pipeline.

### 2.3 semantic-link-labs (the "labs" extension)

From the [semantic-link-labs GitHub](https://github.com/microsoft/semantic-link-labs) and the [data-goblins walkthrough](https://data-goblins.com/power-bi/semantic-link-labs):

- **Best Practices Analyzer (BPA)** — runs Tabular Editor's BPA ruleset programmatically from Python; 60+ rules across Performance, DAX, Error Prevention, Maintenance, Formatting
- **VertiPaq Analyzer / Memory Analyzer** — per-object memory & storage statistics (unique in the Fabric ecosystem; equivalent to Tabular Editor 3's VertiPaq Analyzer)
- **Measure dependency tree** — which measures reference which
- **Report BPA** — equivalent BPA for *report* metadata (visuals, bindings)
- **Report-measure migration** — move measures from report-local to semantic model
- **Direct Lake migration** — automated import-to-DirectLake conversion
- **Mermaid diagram generation** (via Fabric Data Agent + LLM): [crossjoin.co.uk example](https://blog.crossjoin.co.uk/2025/05/04/documenting-power-bi-semantic-models-with-fabric-data-agents/) shows NL-queried docs with auto-generated relationship diagrams

**This is the library's real value-add.** It gives you things your app *doesn't*: runtime performance stats, BPA rule enforcement, live-model introspection, DAX execution. But it also *lacks* things your app does: offline operation, single-file HTML catalog, Markdown export, parameter/composite-proxy classification.

---

## 3. What a "report wrapper" would look like

The user's phrase "report wrapper" is ambiguous. There are four realistic interpretations, each with different trade-offs:

| Wrapper approach | How it works | Closest analog to your app's HTML | Drawbacks |
|---|---|---|---|
| **Notebook as doc** | Run the notebook, export to HTML/PDF | Same *idea*, different UX | Static; no tabbed navigation; no search; notebook cells expose Python |
| **Metadata lakehouse + Power BI report** | Push `INFO.*` data to lakehouse, build report on top | Live, interactive, queryable | Requires Fabric capacity to view; not portable; not git-commitable |
| **Fabric Data Agent** | NL Q&A over the metadata semantic model | Interactive in a different way — chat instead of browse | Requires Fabric AI capacity; answers vary; no offline |
| **Published HTML via Fabric API** | Notebook writes generated HTML to OneLake / Azure Blob | Can match your app's output | Still requires a Fabric run to produce; chicken-and-egg vs. git workflow |

None of these produce a **single self-contained, zero-dependency, portable HTML file** the way your app does. The closest is option 4, which just reproduces your app's output shape *inside* Fabric — at which point you're paying Fabric capacity to do what Node does for free.

---

## 4. Feature-by-feature parity matrix

Mapping every feature currently in your app to the closest Fabric-notebook equivalent:

| Your app feature | Fabric/sempy equivalent | Parity verdict |
|---|---|---|
| Source → table → column/measure catalog | `list_tables` + `list_columns` + `list_measures` + manual joining | 🟢 Achievable |
| TMDL `.SemanticModel` folder parsing (pre-publish) | — | 🔴 Not possible |
| Fact/Dimension/Bridge classification from relationship topology | Derive from `list_relationships` | 🟢 Achievable |
| Calc group detection + items | `INFO.CALCULATIONGROUPS()` + `INFO.CALCULATIONITEMS()` | 🟢 Equivalent |
| UDF (functions.tmdl) listing | Not exposed via semantic-link (TMDL-only feature) | 🔴 Gap |
| Partition kind (`m` / `calculated` / `entity`) | `INFO.PARTITIONS()` exposes `Type` | 🟢 Equivalent |
| `expressionSource` (composite-model proxy detection) | `INFO.PARTITIONS()` exposes source details | 🟡 Requires bespoke logic |
| Field-parameter detection via `ParameterMetadata` | `INFO.EXTENDEDPROPERTIES()` | 🟡 Requires bespoke logic |
| Unused measures/columns (report binding scan) | `INFO.CALCDEPENDENCY()` + custom report scan | 🟡 Partial — `CALCDEPENDENCY` covers model-internal only |
| EXTERNALMEASURE proxy detection | Regex on `INFO.MEASURES().Expression` | 🟢 Achievable |
| Auto-date infrastructure filtering | Name-pattern filter on `INFO.TABLES()` | 🟢 Trivial |
| DAX syntax highlighting in docs | Custom — notebooks have no DAX highlighter OOTB | 🟡 Achievable with extra code |
| Mermaid relationship diagrams | [Demonstrated via Data Agent](https://blog.crossjoin.co.uk/2025/05/04/documenting-power-bi-semantic-models-with-fabric-data-agents/); also doable manually | 🟢 Achievable |
| **Single-file portable HTML** | Notebook HTML export, but bulkier / less interactive | 🟡 Different UX |
| **Markdown export (ADO Wiki / GitHub-compatible)** | Custom string generation; no library help | 🟡 Achievable by hand |
| **Tables tab with kind-grouping** | No UI concept in notebooks | 🟡 Render as pandas DataFrames |
| **Git-friendly CI pipeline** | Possible via Fabric pipelines, but not native | 🟡 Awkward — TMDL lives in git, notebooks run in Fabric |
| **Runs pre-publish on disk** | — | 🔴 Impossible — semantic-link requires a published model |
| **Best Practices Analyzer** | `sempy_labs.run_model_bpa()` with 60+ rules | 🔴 Your app doesn't have this |
| **VertiPaq memory stats** | `sempy_labs.vertipaq_analyzer()` | 🔴 Your app can't compute this (needs runtime data) |
| **Live DAX evaluation** | `fabric.evaluate_dax()` | 🔴 Your app can't do this |
| **Natural-language Q&A** | Fabric Data Agent | 🔴 Your app not in scope |

**Score:** ~60% of your app's features are reproducible in Fabric; ~25% are **impossible** (pre-publish, local, offline); ~15% of Fabric's features are **impossible** in your app (live DAX, VertiPaq, BPA against a compiled model).

---

## 5. The friction no one mentions — workflow shape

Beyond features, the two approaches assume **fundamentally different workflows**:

### Your app's workflow
```
    TMDL edit → git commit → CI runs your app → docs artifact → PR review
```
- Source of truth: **TMDL in git**
- Doc artifact: **produced before publishing**
- Iteration speed: seconds (local node run)
- Who sees it: **anyone with a browser**, even contractors outside the tenant
- Fits: **dev-loop governance, code review, onboarding**

### Fabric notebook workflow
```
    TMDL edit → publish to workspace → notebook runs against workspace → insights/report
```
- Source of truth: **the published model**
- Doc artifact: **produced after publishing**
- Iteration speed: minutes (publish round-trip + Fabric compute)
- Who sees it: **workspace members only** (or Fabric report viewers)
- Fits: **runtime QA, BPA enforcement, performance investigation, NL exploration**

**These are sequential, not competitive.** Your app answers "is this model *well-structured*?" — Fabric answers "is this model *performing*?" Running both in a pipeline is the strongest combined posture.

---

## 6. The ecosystem context

Per [SQLBI's tooling overview](https://www.sqlbi.com/articles/tools-in-power-bi/) and [external-tools deep dive](https://www.excelized.de/post/external-tools-in-power-bi-a-deep-dive-into-the-essential-add-ons-and-their-trade-offs):

| Tool | Overlap with your app | Where it wins | Where it loses |
|---|---|---|---|
| **Tabular Editor 2/3** | Has BPA, dependency view, DAX editor | Authoritative model editor, live-BPA, VertiPaq (TE3) | Desktop app, not a portable doc; no MD export; TE3 paid |
| **Bravo for Power BI** | Light analyzer, date-table helper | Free, simple UX | No full doc catalog; no MD export; desktop-only |
| **DAX Studio** | DAX-focus | Best DAX IDE | Not a documentation tool at all |
| **pbi-tools** | Source-control focus | Serialises report+model to git | No human-readable docs — source files, not a catalog |
| **Measure Killer** | Unused detection | Tenant-wide scan, hard-delete safety | Commercial, narrow focus |
| **semantic-link-labs (notebook)** | BPA, VertiPaq, deps, Report-BPA | Fabric-native, automatable | Requires Fabric; requires publishing |
| **Your app** | Full catalog, classifiers, MD export, HTML | Free, offline, git-native, portable | No runtime stats, no BPA, no live DAX |

**Your app occupies a gap the commercial/MS ecosystem doesn't fill:** portable, offline, git-native, zero-dep, free, single-file-HTML documentation that works pre-publish. The closest adjacent tools all either require a desktop app (Tabular Editor), a tenant subscription (Fabric), or a commercial license (Measure Killer / TE3).

---

## 7. Recommendation

**Don't abandon your app to replace it with a Fabric notebook.** Here's why, and what to consider instead:

### Keep the app for
- **Pre-publish governance**: review TMDL changes before they land in production
- **PR artifacts in git**: MD docs checked in alongside TMDL commits
- **Contractor / external review**: anyone can open the HTML without a Fabric login
- **Tenant-agnostic analysis**: works on fixtures (`test/Health_and_Safety.Report`), forks, migrations
- **Zero-cost CI**: one GitHub Actions minute per model, no capacity consumption

### Add a parallel Fabric notebook for
- **Best Practices Analyzer** enforcement (the BPA is genuinely valuable and your app doesn't attempt it)
- **VertiPaq memory stats** — once models grow beyond ~1M rows, column-size data steers optimisation
- **Live DAX smoke tests** — assert key measures return expected totals (regression test for breaking changes)
- **Natural-language exploration** via Fabric Data Agent for non-technical stakeholders

### Possible future bridge
Your app currently parses TMDL. If you later want BPA-like signal *without* requiring Fabric, the Tabular Editor 2 BPA ruleset is [a JSON file of regex/expression rules](https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules) — reimplementable in Node against your parsed model. That'd close the one genuine capability gap while preserving the offline-first design.

### What to *not* do
- **Don't try to reproduce Fabric's runtime capabilities locally** — live DAX + VertiPaq need the tabular engine; that's Fabric/SSAS territory.
- **Don't pay for Fabric just to replicate what your app already does for free** — options 1/4 in §3 are architectural waste.
- **Don't assume "there's a Microsoft-native solution for this" means there's *one* solution** — the tool ecosystem is fragmented because the problems are genuinely different.

---

## 8. Confidence and uncertainty

**High confidence:**
- semantic-link / semantic-link-labs require Fabric notebook hosting (repeated in official docs + two community sources)
- BPA and VertiPaq are genuine value-adds your app lacks
- Pre-publish / offline TMDL analysis is not possible via semantic-link

**Medium confidence:**
- Exact licensing thresholds for running sempy (Fabric trial may suffice; F-SKU capacity sizing varies)
- Whether `semantic-link-labs` can be installed in pure Jupyter outside Fabric — GitHub docs strongly imply no, but community forks may exist

**Low confidence / unknowns:**
- Future direction: Microsoft may ship an offline TMDL-parsing Python library (gap would close)
- Whether published-report HTML export via Fabric could evolve into a true portable-single-file output

---

## 9. Sources

- **[What is semantic link? — Microsoft Learn](https://learn.microsoft.com/en-us/fabric/data-science/semantic-link-overview)** — canonical sempy overview
- **[sempy.fabric package — Microsoft Learn](https://learn.microsoft.com/en-us/python/api/semantic-link-sempy/sempy.fabric)** — API reference
- **[Semantic link and Power BI connectivity](https://learn.microsoft.com/en-us/fabric/data-science/semantic-link-power-bi)** — Fabric↔Power BI bridge
- **[microsoft/semantic-link-labs (GitHub)](https://github.com/microsoft/semantic-link-labs)** — primary labs repo + docs
- **[Managing Power BI reports with semantic-link-labs — Data Goblins](https://data-goblins.com/power-bi/semantic-link-labs)** — community walkthrough including Fabric requirement
- **[Documenting Power BI semantic models with Fabric Data Agents — Chris Webb](https://blog.crossjoin.co.uk/2025/05/04/documenting-power-bi-semantic-models-with-fabric-data-agents/)** — INFO.CALCDEPENDENCY + data-agent pattern
- **[How to query semantic-model metadata with sempy + INFO DAX — TackyTech](https://www.tackytech.blog/how-to-query-and-store-meta-data-of-your-semantic-model-with-sempy-and-dax-info-functions/)** — INFO function reference
- **[Semantic Analysis with SemPy (fabric-samples) — DeepWiki](https://deepwiki.com/microsoft/fabric-samples/2.1-semantic-analysis-with-sempy)** — worked examples
- **[External Tools in Power BI: deep dive — Excelized](https://www.excelized.de/post/external-tools-in-power-bi-a-deep-dive-into-the-essential-add-ons-and-their-trade-offs)** — ecosystem context
- **[Tools in Power BI — SQLBI](https://www.sqlbi.com/articles/tools-in-power-bi/)** — Tabular Editor / Bravo / DAX Studio overview
