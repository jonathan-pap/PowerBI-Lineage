# What to Leverage from PBIP Documenter

**Date:** 2026-04-19  
**Subject repo:** [JonathanJihwanKim/pbip-documenter](https://github.com/JonathanJihwanKim/pbip-documenter) (MIT, Microsoft MVP)  
**Live tool:** [jonathanjihwankim.github.io/pbip-documenter](https://jonathanjihwankim.github.io/pbip-documenter/)  
**Purpose:** Identify concrete code patterns / features to study and adapt — not copy wholesale.

## Their architecture at a glance

Pure static web app. No build step, no deps, MIT. ~80% JS / 12% HTML / 8% CSS.

### Module split (each is a standalone `.js` file)

| Module | Purpose | What to study |
|---|---|---|
| `tmdl-parser.js` | TMDL → JSON | Reference parser patterns; ours is deeper (already handles composite partitions) |
| `m-parser.js` | Power Query M | **Column-level rename tracing** — new signal we don't have |
| `visual-parser.js` | Scans `.Report/definition/pages/*.json` | Compare to our `report-scanner.ts` for blind spots |
| `lineage-engine.js` | Bidirectional dep analysis | **Carve-out pattern** for our own lineage logic |
| `lineage-diagram.js` + `diagram.js` | Interactive SVG, pan/zoom | Interactive ERD implementation |
| `detailed-erd.js` | Entity-relationship diagrams | ER layout algorithm reference |
| `mermaid-exporter.js` | Mermaid output | We already have this |
| `drawio-exporter.js` | Draw.io XML | **New export format** — one-file add |
| `doc-generator.js` | HTML / MD / JSON | Our html-generator + md-generator combined |

### File-browser flow

Uses `window.showDirectoryPicker()` (File System Access API). User clicks "Open Project Folder", the app walks the directory, auto-discovers `.SemanticModel/` + `.Report/` siblings. No upload, no server. Chrome 86+ / Edge 86+ / Opera 72+ only — Firefox not supported.

---

## What we already do better

Don't lose these in any leverage effort:

- **Fact / Dimension / Bridge / Disconnected classification** — their tables appear flat
- **Composite-model proxy detection** (`parameterKind: "compositeModelProxy"`)
- **Field parameter classification** via `ParameterMetadata` annotation
- **Calc-table vs M-import distinction** (partitionKind)
- **Tables-tab kind-groups** (Data / Measure / Field Params / Proxies / Calc Groups)
- **Node CLI for CI/CD** — headless runs in GitHub Actions, Azure DevOps
- **ADO Wiki + GitHub anchor compatibility** — dual-mode MD
- **DAX syntax highlighting** in HTML (vendored highlighter with SHA-pinned integrity)
- **Auto-date infrastructure filtering** + Show-auto-date toggle
- **Glass-morphism / grid-line themed UI** (our dashboard is visually more cohesive)
- **Parked wireframe POC** — spatial visual layout per page (neither tool has this live)

---

## Tier A — clear wins with existing architecture

### A1. File System Access API — dual-mode entry point ⭐

**The single biggest UX leap available.** Keep Node CLI for CI. Add a browser entry point:

- Static `index.html` hosted on GitHub Pages (`jonathan-pap.github.io/powerbi-lineage`)
- Bundle `model-parser` + `data-builder` + `html-generator` to browser via esbuild or tsc `--module esnext --target es2022`
- Swap `fs.readFileSync` / `fs.readdirSync` for `FileSystemDirectoryHandle` API calls
- UI: a drop zone + "Open Project Folder" button → pick PBIP folder → dashboard renders in the same page

**Effort:** ~200 LOC bundling + ~100 LOC FS-shim + picker UI. Parser + data-builder are already pure logic (no Node-specific deps beyond `fs`/`path`). Browser shim is mechanical.

**Reference:** their `app.js` opens and walks the folder — study for file-discovery patterns.

**Value:** anyone with a browser can review a PBIP folder with zero install. Non-technical reviewers get a catalog without needing Node or Power BI Desktop.

---

### A2. M parser — column provenance

They trace Power Query M steps to map model columns back to their source columns. We parse the partition body for source type/location but don't track **per-column rename chains**.

Example we're missing:
```
customer_name (model column)
    ← "Renamed Columns" step: from "CustomerName"
    ← "Source" step: from CUSTOMERS.parquet
```

**What to add to `ModelColumn`:**
```ts
sourceProvenance?: {
  sourceTable?: string;  // e.g. "CUSTOMERS"
  sourceColumn?: string; // e.g. "CustomerName"
  renameSteps: string[]; // intermediate M step names
};
```

**Effort:** ~150 LOC new `m-parser.ts` module. Per partition, tokenise the M, walk `Table.RenameColumns` / `Table.SelectColumns` / `Table.TransformColumnTypes` steps to trace each column.

**Reference:** their `m-parser.js` is the canonical implementation — adapt, don't copy (MIT permits but their code style differs).

---

### A3. Draw.io export

New exporter, existing relationship data.

```ts
// src/drawio-exporter.ts
export function generateDrawioXml(data: FullData): string { ... }
```

Draw.io XML is well-documented. Output maps each `TableData` to a styled `<mxCell>` node and each `ModelRelationship` to an edge. Stakeholders can open in [app.diagrams.net](https://app.diagrams.net) and edit.

**Effort:** ~80 LOC. Add `--drawio` flag + export button in Docs tab.

**Reference:** their `drawio-exporter.js`.

---

### A4. RLS / OLS parsing

Already Tier 1 in the gap analysis — now has competitive-parity urgency since PBIP Documenter has it.

Parse `definition/security/roles.tmdl` (or wherever TMDL stores it in a given model). Surface:

- Role name + description
- Table-level permissions (`none` / `read` / OLS restrictions)
- Column-level permissions (OLS)
- DAX filter expression per role+table (RLS)

**Effort:** ~40 LOC parser + new Summary-tab card + new `security.md` doc. Badge on affected tables.

---

### A5. Interactive SVG ERD with pan/zoom

Today our Relationships tab is a table. Their `diagram.js` renders a proper ER diagram — drag-to-pan, scroll-to-zoom, click-to-highlight. All hand-rolled SVG, no external lib.

**Effort:** ~300 LOC. Schema-diagram item from the previous gap analysis.

**Reference:** their `diagram.js` + `detailed-erd.js`. Their layout algorithm is worth studying — typical force-directed approaches are overkill for typical 10-50 table models; they appear to use a simpler grid/tier-based layout.

---

## Tier B — architectural alignment (refactor dividend)

### B1. Extract `lineage-engine` as a module

Their split is `parser → lineage-engine → diagram/doc`. Ours embeds `daxDependencies`/`dependedOnBy` inside `data-builder.ts`. Carving `src/lineage-engine.ts` makes:

- Parser more focused (just structural parse)
- Lineage logic testable in isolation
- Future features (impact analysis, diff) plug in cleanly

**Effort:** ~60 LOC move + update imports. Purely structural, no behaviour change.

### B2. JSON export with nested `whereUsed` / `consumers`

Their JSON nests usage inline:
```json
{
  "measures": [{
    "name": "Total Injuries",
    "expression": "...",
    "whereUsed": [
      { "page": "Dashboard", "visual": "KPI-001", "title": "YTD Injuries" }
    ],
    "dependencies": ["dim_injury_type[injury_count]"]
  }],
  "columns": [{
    "name": "injury_count",
    "table": "dim_injury_type",
    "consumers": ["Total Injuries", "TRCF"]
  }]
}
```

More agent-friendly than flat arrays — an LLM consuming this JSON can answer "what uses column X" without joining across top-level arrays.

**Effort:** ~30 LOC nested shaper in data-builder. Emit when `--json` flag set.

---

## Tier C — don't chase

| Their limitation | Why we don't follow |
|---|---|
| Browser-only (Chromium only) | We keep Node CLI for CI/headless/Firefox |
| No fact/dim classification | Our role analysis is a differentiator |
| No composite-model awareness | Our Tier-1 feature |
| Flat table listing (no kind-grouping) | Our Tables-tab grouping is superior |
| No spatial page layout | Our parked wireframe POC can revive as a differentiator |

---

## Unique combo opportunity — wireframe + visual lineage

Neither tool has this if done together:

```
Pages tab → click a page
    ├─ SVG wireframe (our parked POC)
    │    each visual as a coloured rectangle at its real x/y/w/h
    └─ Visual lineage trace (their pattern)
         visual → bound measures/columns → source columns

    Hover a visual in wireframe → highlights its binding chain in the lineage pane
    Click a column in lineage → highlights every visual that uses it across all pages
```

Pulls together:
- Our wireframe POC (parked in `parked/wireframe-poc/`)
- Their `visual-parser.js` + `lineage-engine.js` pattern for bidirectional edges
- Our existing `report-scanner.ts` bindings

**Effort:** ~300 LOC total (wireframe revival + cross-linking + highlighting interactions). But this is a story-level feature, not just a feature-list tick.

---

## Recommended priority (adjusted from prior gap analysis)

Competition-aware ordering:

| # | Feature | Effort | Framing |
|---|---|---|---|
| 1 | **File System Access API browser mode** | ~300 LOC | Install-free UX; match PBIP Doc on their strongest axis |
| 2 | **Model diff / PR-comment CLI** | ~150 LOC | **Still-unique wedge — nobody has it** |
| 3 | **RLS / OLS parsing** | ~40 LOC | Competitive parity; governance critical |
| 4 | **Column → measure impact view** | ~25 LOC | Cheap, high-value |
| 5 | **M parser — column provenance** | ~150 LOC | Their signal we lack |
| 6 | **Wireframe + visual lineage combo** | ~300 LOC | Genuine differentiation |
| 7 | **Interactive SVG ERD** | ~300 LOC | Relationships tab upgrade |
| 8 | **JSON export (their nested shape)** | ~30 LOC | Library-mode foundation |
| 9 | **Draw.io exporter** | ~80 LOC | Easy polish |

Items 1 + 2 together define the new positioning: *the CI-native, git-workflow, composite-model-aware PBIP documenter — install-free in a browser, automatable in a pipeline, uniquely diff-capable*.

---

## Licensing + attribution

PBIP Documenter is MIT. We can:
- ✅ Read their code for pattern reference
- ✅ Adapt approaches (e.g., M parser heuristics) with attribution in comments
- ❌ Verbatim copy without including their LICENSE file
- ✅ Acknowledge in `README.md` under "Prior art" or similar

Recommended attribution in any module inspired by theirs:
```ts
/**
 * M-expression parser for column provenance.
 * Approach adapted from PBIP Documenter by Jihwan Kim (MIT):
 * https://github.com/JonathanJihwanKim/pbip-documenter
 */
```

---

## What the next 1-2 sprints could look like

**Sprint 1 — "browser mode + parity" (1 week)**
- A1 File System Access API browser build
- A4 RLS / OLS parsing
- Tier 1 #1 column → measure impact view (already scoped)

**Sprint 2 — "the wedge" (1 week)**
- Model diff / PR-comment CLI
- JSON export with nested shape
- Draw.io exporter

After that, every reviewer has a clear answer to "should I use your thing or PBIP Documenter":
- *Need to review in a PR?* → ours has diff comments
- *Working with composite models?* → ours classifies them
- *Running in CI?* → ours is Node
- *Just want to browse locally?* → either, use whichever tab you have open

That's defensible positioning — not monopoly, but clear.
