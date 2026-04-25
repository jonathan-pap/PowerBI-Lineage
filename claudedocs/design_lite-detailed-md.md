# Design — Lite / Detailed MD output modes

**Status:** Draft for sign-off
**Date:** 2026-04-25
**Source signal:** `/sc:analyze` audit of generated MDs (post-cleanup PR #83) — ~5,693 lines / 249 KB across 9 docs is too much for stakeholder reading. Different audiences need different shapes.

---

## The problem

The generator currently emits **one shape** per doc. That shape was tuned for the data engineer / model maintainer reading every detail. Three other audiences arrive at the docs and bounce off:

- **Stakeholder reading the wiki page** wants "what is this report and what does it cover?" — a one-page overview, not 1,800 lines of measure references.
- **Reviewer doing first-pass triage** wants the 80/20 — schema, key sources, pending issues.
- **Migrator inheriting a model** wants the current full output and arguably more (DAX bodies inline).

A single shape can't serve all three without compromise. Two shapes — **Lite** and **Detailed** — cleanly separates "share this" from "audit this".

---

## Audiences + use cases

| Mode | Reader | Use case | Read time | Page output |
|---|---|---|---:|---:|
| **Lite** | Stakeholder · first-pass reviewer · migration scoping | "Tell me what this is, share it once" | ~5 min | 1–2 wiki pages, ~500 lines |
| **Detailed** | Maintainer · data engineer · auditor · reference lookup | "I need everything — searching, drilling, comparing" | ongoing | up to 9 docs, ~5,000 lines (current shape, with cleanup wins from PR #83) |

---

## Per-doc spec — what's in each mode

The big design call is *which sections survive into Lite*. Working principle: **Lite drops anything that requires per-entity reading.** Inventory tables stay; per-entity reference content goes.

**Detailed also gets refinements.** The /sc:analyze audit surfaced 13 quality issues. PR #83 already shipped the worst four (M-step collapse, ER dedupe, Table.Combine reclass, section-number drift). The remaining nine apply to Detailed (or both modes) and land here. Each Detailed column below names the concrete refinement, not "current shape".

### Model.md

| Section | Lite | Detailed |
|---|:---:|:---:|
| Front matter (counts + scope) | ✅ | ✅ |
| Document Contents (ToC) | ✅ | ✅ |
| §1 Introduction | abbreviated (purpose only, drop conventions + terminology) | ✅ full |
| §2.1 Schema summary | ✅ | ✅ |
| §2.2 Tables by role | ✅ | ✅ |
| §2.3 Relationship inventory | ✅ | ✅ |
| §2.4 Entity-relationship diagram | ✅ | ✅ |
| §3.1 Storage modes | ✅ | ✅ |
| §3.2 Parameters and expressions | ⛔ skip | ✅ — uses **source alias** pattern (see below) |
| §3.3 Per-table sources | ⛔ skip | ⛔ **removed entirely** (F9 — Sources.md owns this; replaced by 1-line pointer) |
| §4 Data Dictionary — Summary | ⛔ skip | **trimmed** — drops the 53-row table (F8); replaced by 1-line pointer to DataDict + a top-N "biggest tables by column count" mini-table for context |
| §5 Measures — Summary | ✅ | ✅ |
| §6 Calc Groups — Summary | ✅ | ✅ |
| §7 UDF — Summary | ✅ | ✅ |
| §8 Report Pages | ✅ | ✅ |
| Appendix A | ⛔ skip | ✅ |

**Lite output:** ~150 lines (was ~726).
**Detailed output:** ~550 lines (was ~726) — F8 + F9 cuts ~170 lines.

### Data Dictionary.md

| Lite | Detailed |
|---|---|
| **Skip entirely.** Stakeholders don't column-shop. Lite = no DataDict file emitted. | Current ~1,249 lines, **plus** strategic cross-links (F13): each table heading links back to its row in Model.md §2.2; each FK entry links to the target table's DataDict block. |

### Sources.md

| Section | Lite | Detailed |
|---|:---:|:---:|
| Front matter + at-a-glance | ✅ | ✅ |
| Data Sources (connection buckets) | ✅ | ✅ — uses **source alias** pattern (F6) |
| Physical-source index | ✅ | ✅ — Model-tables column links to the table's DataDict entry (F13) |
| Native queries | ⛔ skip | ✅ when present |
| M-step breakdown | ⛔ skip | ✅ (already collapsed in PR #83) |
| Raw M expressions | ⛔ skip | ✅ |
| Field Parameters | ✅ when present | ✅ when present |
| Composite-Model Proxies | ✅ when present | ✅ when present |
| Calc Groups | ✅ when present | ✅ when present |

**Lite output:** ~100 lines.
**Detailed output:** ~520 lines (was ~600 post-PR #83) — source-alias dedupe + cross-links.

### Measures.md

| Lite | Detailed |
|---|---|
| **A–Z summary table only** — columns: Name · Table · Status · Format · Description. No per-measure block, no DAX deps, no usage chips, no Mermaid lineage. | Per-measure detail **minus the front-matter External-proxy table** (F7 — proxies stay marked inline with the EXTERNAL badge in their A–Z entries). Each measure's Home Table value links to the table's Model.md §2.2 row (F13). Mermaid lineage blocks unchanged from PR #83's ADO-friendly form. |

**Lite output:** ~100 lines for 66 measures.
**Detailed output:** ~1,720 lines (was ~1,849) — F7 drops the 30-line proxy duplicate; cross-links add ~30 lines but cut reader friction substantially.

### Functions.md

| Lite | Detailed |
|---|---|
| **Skip when empty** (F5). When present, summary table only — Name · Parameters · Description · Caller count. | **Skip when empty** (F5). When present, current per-UDF shape **plus** caller-count column links to each calling measure's A–Z entry (F13). |

### Calc Groups.md

| Lite | Detailed |
|---|---|
| **Skip when empty.** When present, summary table only — Name · Items · Precedence. | **Skip when empty.** When present, current per-group shape with per-item DAX. |

### Pages.md

| Section | Lite | Detailed |
|---|:---:|:---:|
| Front matter + at-a-glance | ✅ | ✅ |
| Visible page index (jump bar) | ✅ | ✅ |
| Per-page detail blocks | ⛔ collapsed to one-line summary | ✅ full per-visual binding tables — measure / column refs link to their A–Z entries (F13) |
| Hidden / utility pages appendix | ⛔ skip | ✅ |

**Lite output:** ~50 lines.
**Detailed output:** ~290 lines (was ~260) — cross-links add ~30 lines.

### Improvements.md

| Lite | Detailed |
|---|---|
| **Same shape in both.** Severity-tiered audit is already paced for stakeholder reading. | Same — items reference entities; in Detailed those references become live links to the entity's A–Z entry (F13). |

### Index.md

| Lite | Detailed |
|---|---|
| **Skip entirely.** Glossary is reference territory; Cmd-F serves it better anyway (F10). | Current shape with one polish: collapse each letter section into `<details>` (closed by default). User scans the jump-bar, opens the letter they need. Cuts perceived size from 610 lines to a 22-letter index. |

---

## Cross-doc refinements (Detailed only)

Two patterns apply across multiple Detailed docs and deserve their own line.

### Source alias pattern (F6)

In the H&S fixture, the same AS URL appears 60+ times across docs. Detailed introduces a per-doc alias on first mention:

```md
**Sources:**
- [AS-1] `powerbi://api.powerbi.com/.../local-jpa-DD_HealthAndSafety__WS` (Health_and_Safety_Gold)
- [AS-2] `powerbi://api.powerbi.com/.../local-jpa-GlobalDataHouse__WS` (Global_DatePeriod)
```

Subsequent table rows reference `[AS-1]` instead of pasting the URL. Aliases are doc-local (Sources.md and Model.md each declare their own) — not cross-doc, since two docs aren't always read together.

**Impact:** drops ~40 lines from Sources.md, ~30 from Model.md. Cleaner output for any model with composite-model partitions.

### Strategic cross-links (F13)

The 9 docs are currently islands after the front matter. Detailed adds an `xref(kind, name)` helper that emits the canonical anchor for any entity in any doc:

| From | To | Why |
|---|---|---|
| Measures.md per-measure home-table | Model.md §2.2 row | "Where is this measure's table in the model?" |
| Measures.md DAX deps | Measures.md A–Z entry | Click-through for nested deps |
| Measures.md "Used by" | Measures.md A–Z entry | Reverse traversal |
| DataDict FK entries | DataDict target table | "Where does this FK point?" |
| Sources physical-index Model-tables | DataDict per-table | "What's the column shape of these tables?" |
| Pages.md visual bindings | Measures.md or DataDict | "What is this binding?" |
| Functions.md callers | Measures.md A–Z | "Which measures call this UDF?" |
| Improvements.md item entities | Measures.md / DataDict | "Which entity is this finding about?" |

Anchors must be ADO-stable (already verified by `tests/md-anchors.test.ts` — no new test infra needed; new links go through the existing slug helpers).

**Impact:** doc surface stops being a stack of self-contained PDFs; becomes a navigable web. Approximately +120 lines across the 5 detailed docs (extra link markup), but reader friction drops materially.

---

## Cleanup map — which audit findings land in this PR

| Finding | Status | Where it lands |
|---|---|---|
| F1 M-step collapse | ✅ Done in PR #83 | — |
| F2 Table.Combine reclass | ✅ Done in PR #83 | — |
| F3 erDiagram dedupe | ✅ Done in PR #83 | — |
| F4 Section-number drift | ✅ Done in PR #83 | — |
| **F5** Empty docs ship placeholders | This PR | Functions / Calc Groups / Improvements skip when empty in **both** modes |
| **F6** Source URL repetition | This PR | Source-alias pattern in Detailed (Lite already drops the heaviest sites) |
| **F7** Measures.md proxy duplicate | This PR | Drop the front-matter External-proxy table in **both** modes |
| **F8** Model.md §4 duplicates DataDict | This PR | Trim to 1-line pointer + top-N table in Detailed; skip in Lite |
| **F9** Model.md §3.3 duplicates Sources | This PR | Remove §3.3 entirely from **both** modes |
| **F10** Index.md letter-bucket | This PR | Skip in Lite; collapse-by-default `<details>` in Detailed |
| F11 Badge fallback inconsistency | Deferred | Cosmetic — minor follow-up |
| F12 Generation timestamp without version hash | Deferred | Nice-to-have — out of scope |
| **F13** No cross-doc signposting | This PR | Detailed gets the `xref()` helper across 5 docs |

**Eight findings ship in this work.** Two cosmetic items deferred. Lite is the new capability; Detailed becomes materially cleaner alongside.

---

## Output totals

| Doc | Lite lines | Detailed lines (today) | Detailed lines (after this PR) |
|---|---:|---:|---:|
| Model | ~150 | ~726 | ~550 (F8 + F9 cuts) |
| Data Dictionary | _skip_ | ~1,249 | ~1,260 (+ cross-links) |
| Sources | ~100 | ~603 | ~520 (source-alias dedupe) |
| Measures | ~100 | ~1,849 | ~1,720 (F7 fix + cross-links) |
| Functions | _skip when empty_ | 11 (placeholder) | _skip when empty_ |
| Calc Groups | _skip when empty_ | 11 (placeholder) | _skip when empty_ |
| Pages | ~50 | ~259 | ~290 (+ cross-links) |
| Improvements | ~170 | ~171 | ~180 (+ cross-links) |
| Index | _skip_ | ~610 | ~640 (collapsed `<details>`) |
| **Total** | **~600 lines · ~25 KB** | ~5,490 · ~250 KB | **~5,160 lines · ~225 KB** |

- **Lite is 9% the size** of Detailed. Fits in a single ADO Wiki page section.
- **Detailed shrinks 6%** despite adding cross-links — the F6/F7/F8/F9 dedupes more than offset.
- **Both modes drop Functions + Calc Groups when empty** — three placeholder docs gone from real outputs.

---

## Mode toggle — where it lives

### CLI

Default behaviour is unchanged — the CLI HTTP server opens the dashboard, no MDs written to disk. The toggle lives in the dashboard.

If we ever add a `--write-md` flag in future, it'd take `--mode lite|detailed|both` (default `detailed`).

### Dashboard — Docs tab

Two-button toggle next to the existing **Rendered / Raw** mode toggle:

```
[ Lite ] [ Detailed ]    [ Rendered ] [ Raw ]    [ ⊕ All ] [ ⊖ All ] [ ⎘ Copy ] [ ⤓ Download ]
```

Clicking flips the active doc to the chosen mode. The currently-displayed doc tab (Model / DataDict / Sources / …) decides which generator runs; the mode picks lite vs detailed within it.

When a doc is **skipped in Lite** (Data Dictionary, Index), clicking its tab while Lite is active shows a `_This document is omitted in Lite mode — switch to Detailed to view._` placeholder rather than disabling the tab. Disabling a tab silently is worse UX than explaining the omission.

### Default mode

**Detailed** — preserves current behaviour. First-time users see what they got before; lite is opt-in.

---

## Implementation plan

### Approach A — bake both at build time (preferred)

Each generator function gains a `mode` param:

```ts
export function generateMarkdown(
  data: FullData,
  reportName: string,
  mode: "lite" | "detailed" = "detailed",
): string;
```

Server side bakes all generated MDs in **both modes** into the dashboard payload:

```ts
let MARKDOWN_MODEL_LITE = "...";
let MARKDOWN_MODEL_DETAILED = "...";
// (and so on for the 6 docs that have a Lite version — Improvements/Functions/CalcGroups
//  share between modes, so single MARKDOWN_*)
```

Dashboard's `switchMd(name, mode)` picks the right global.

**Bundle cost:** Lite adds ~25 KB on top of the current ~245 KB of MDs in the bundle. New total bundle: ~315 KB → **over the current 300 KB CI cap**. Bump cap to 400 KB as part of this PR (organic growth from real features earns the headroom).

### Approach B — lazy client-side generation

Compile `md-generator.ts` for the browser (it's pure, only uses `data-builder.ts` types — no fs/path). Ship the data once + generator code; switch mode by re-running. No double-bake.

**Bundle cost:** smaller — generator is ~30 KB compiled, replacing ~25 KB of duplicated lite MDs. Net break-even.

**Implementation cost:** higher — md-generator currently doesn't compile for browser. Some helpers might pull from server-only modules. Probably 4-6 hours just to do the carve.

### Recommendation

**Start with Approach A** for v0.10.0. Faster to ship, easier to test, the bundle bump is honest (we're shipping a real new capability). If bundle pressure becomes a problem later, revisit Approach B as a refactor.

---

## Implementation phases (Approach A)

### Phase 1 — generator gates (½ day)

- Add `mode` param to all 9 generator exports
- Implement the gates per the per-doc spec above
- F5/F7/F8/F9 fixes incorporated (they apply to both modes)
- Tests: each generator gets a `mode === "lite"` test asserting the spec line counts and skipped sections

### Phase 2 — bake + ship (~2 hours)

- `app.ts` and `build-browser.mjs` invoke generators twice (lite + detailed)
- `html-generator.ts` carries the new `MARKDOWN_*_LITE` globals
- `globals.d.ts` declares them
- Bump CI bundle-size cap from 300 KB → 400 KB with a comment explaining the headroom

### Phase 3 — dashboard toggle (~2 hours)

- New `[Lite]/[Detailed]` button group in the Docs-tab toolbar
- `mdMode: "lite" | "detailed"` script-scope state, persists across renders
- `switchMd` picks the right global based on `mdMode + activeMd`
- Lite-skipped docs show the placeholder explainer
- Copy / Download honour the active mode (filename `<report>-<doc>-lite.md` vs `<report>-<doc>.md`)
- Print-CSS already prints all docs; in print, default to Detailed (override the toggle)

### Phase 4 — docs (~½ hour)

- README compatibility table gains a "Mode" axis
- WHATS-NEW.md mentions the toggle
- changelog/0.10.0.md describes the split

### Total scope

**1–1.5 days of focused work.** Probably best as **two PRs**:
1. Generator gates + tests (Phase 1) — server-side only, no UI
2. Bake + toggle + docs (Phases 2-4) — wires the two-way dashboard plumbing

Splitting reduces risk: phase 1's tests catch any per-mode regression before the UI has to deal with it.

---

## Open questions

1. **Default mode** — confirmed Detailed? Or surface both modes equally with no default (force a click)?
2. **Lite Measures table** — should it include the External-proxy column (one extra cell per measure) or keep that as a Detailed-only nicety?
3. **CSV export from Docs tab** — currently doesn't exist (the data tabs have it). Out of scope here, but worth flagging if Lite Measures becomes a primary stakeholder artefact (CSV-of-measures is the natural ADO-paste alternative).
4. **Lite mode trust signal** — should the front matter have a note like `_This is the Lite version — switch to Detailed for per-entity references._`? Useful but adds noise to wiki paste.
5. **Filename suffix** — `-lite.md` works. Alternative: separate folder per mode (`docs/lite/Model.md` vs `docs/full/Model.md`). I'd keep `-lite.md` suffix — flatter.
6. **Lite + Print** — Phase 3 says "default to Detailed when printing". Should print *honour* the toggle instead? Stakeholder hitting Ctrl-P probably wants the lite version they were just reading.

---

## Out of scope (intentional)

- **A third "exec summary" mode** — could be tighter than Lite (just front matter + Improvements). Defer until evidence of demand.
- **Per-doc mode selection** — choosing Lite Model + Detailed Sources in the same view. Adds complexity without clear value.
- **CLI write-to-disk** — out of scope for v0.10. Dashboard Copy / Download is sufficient.
- **Index in Lite** — confirmed dropped; if a stakeholder needs to look up a name, they Cmd-F or use Detailed.
- **Approach B carve** — defer until bundle pressure justifies it.

---

## Sign-off checklist

Before implementation starts, confirm:

- [ ] Per-doc Lite vs Detailed spec is correct (the table at the top)
- [ ] Approach A (bake both) is the right call vs Approach B (lazy)
- [ ] Default mode = Detailed
- [ ] Two-PR split (generator gates first, then UI + docs)
- [ ] Bundle cap bump to 400 KB is acceptable
- [ ] Open questions 1–6 have a direction (or explicit "decide later")

When signed off, lands in `changelog/0.10.0.md` as the headline feature.
