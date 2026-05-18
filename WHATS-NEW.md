# 👋 Welcome to Power BI Documenter

Drop in a PBIP folder — get a **searchable dashboard** plus **nine Markdown docs** ready for ADO Wiki or GitHub.

## What this dashboard shows

### Model
- **Sources** — data connections, partition modes, composite-model proxies (switch between Cards + Flat-map views) · hand-written SQL from `Value.NativeQuery` surfaced as `sql` code blocks · per-partition **M-step breakdown** classifying every ETL step (source / filter / join / typeChange / …)
- **Tables** — grouped by role (Fact / Dimension / Bridge / Calc Group) with columns, measures, and relationships at a glance
- **Columns** — types, usage counts, direct / indirect / unused status
- **Relationships** — active + inactive, cardinality (`1:*`, `1:1`, etc.), cross-filter direction (single ↔ both)
- **Measures** — A–Z reference with DAX, dependencies, where-used per visual + page
- **Calc Groups** — items, precedence, format-string expressions
- **Functions** — UDFs with parameters + every measure that calls each one

### Report
- **Pages** — each page's layout wireframe (scaled SVG showing real visual positions) + per-visual field bindings
- **Lineage** — search any measure or column from the tab itself, or click any entity in Measures / Columns / Pages / Tables. Shows upstream dependencies + source tables + downstream visuals in one view.

### Analysis

- **Unused** — orphan measures, dead-chain measures, indirect-use detection. When measures are flagged, a top toolbar generates an **AI cleanup prompt** you can paste into Claude Code (with the [`pbi-desktop`](https://github.com/data-goblin/power-bi-agentic-development) plugin) or any AI agent that can drive TOM / Tabular Editor — PowerBI-Lineage never deletes anything itself; it hands off a ready-to-run markdown prompt with Stage 1 / Stage 2 ordering + EXTERNALMEASURE safety guards baked in.
- **Improvements** — 16-check model-health audit, severity-tiered (high · medium · low · info · strengths) — includes **broken-reference detection**: flags any DAX referencing a table / column / measure that doesn't exist. The "unused measures" and "dead-chain" findings each carry a collapsible `<details>` block with the matching AI cleanup prompt, so wiki readers get it too.

### Output
- **Documentation tab** — Markdown ready to paste into ADO Wiki or GitHub. Up to nine files — *Model · Data Dictionary · Sources · Measures · Functions · Calc Groups · Pages · Improvements · Index*. Empty docs (e.g. no UDFs) skip automatically.
- **Lite / Detailed toggle** — paste-into-wiki summary versus full engineer reference. Lite drops Data Dictionary + Index entirely, replaces per-measure detail with a flat A–Z table, and skips Native queries / M-steps / Raw M from Sources. **Lite is 21% the size of Detailed** on a real model.

## Under the hood

- Runs **entirely in your browser** (File System Access API — nothing uploads) *or* as a **local CLI**
- **Zero runtime dependencies**, MIT-licensed, 299 tests
- Three themes: dark · light · BluPulse — pick from the bottom of this overlay

## Running locally (CLI mode)

Firefox / Safari users, or anyone who prefers a local app:

- **Windows:** double-click `launch.bat` — it auto-pulls the latest revision, builds if needed, and opens `http://127.0.0.1:5679`
- **Any OS:** `npm install && npm run build && node dist/app.js`

Loopback only — nothing leaves your machine. Requires Node.js 18+.

---

Looking for per-release technical details? See [`changelog/`](https://github.com/jonathan-pap/PowerBI-Lineage/tree/main/changelog).
