# Workflow — ADO Wiki + GitHub MD compat (v0.7.0)

**Source design**: `claudedocs/design_ado-md-compat.md`
**Target version**: `0.7.0` (minor — new feature surface + slug change affects generated output)
**Total estimate**: ~3.5 hours across 6 small stops

> **Revision (post-design):** The `POWERBI_LINEAGE_MD_TARGET` env var and `[[_TOC_]]` emission from the design's §5 have been dropped. Rationale: 99% of the compatibility work lands on a single universal format that works on ADO Wiki, GitHub, and the dashboard. The only platform-specific feature was `[[_TOC_]]`, whose absence is trivially hand-worked (user types `[[_TOC_]]` once at the top of a wiki paste). Keeping it meant a flag, a branching codepath, and a test dimension — all for one line of rendered polish. Dropped. **One universal format, no toggle.** A future `rich|minimal` toggle may appear when there's evidence of demand (e.g. Teams / email / PR-description pasting where `<details>` flattens); that's its own separate release, gated on real user pain.

---

## Decisions locked from design → brainstorm

- **Target**: universal — ADO Wiki, GitHub, dashboard all consume the same bytes
- **Files**: keep 6
- **`<details>`**: keep (renders on ADO Wiki, GitHub, dashboard; flattens only on ADO PR/Repo browsers — acceptable)
- **Badges**: hybrid span + emoji prefix
- **Mermaid**: per-measure lineage + per-fact-table star fragment. **No full-model overview** — deferred.
- **TOC**: hand-rolled only, no `[[_TOC_]]`, no env var. Users who want ADO's auto-TOC add the `[[_TOC_]]` line themselves at paste time.
- **Emoji markers**: emoji by default (not symbols — no older-client concern)
- **Wiki page-name hint**: HTML comment at top of each file

---

## Stops — all independently shippable

### Stop 1 — `adoSlug()` helper + unit tests

| ID | Task | Files |
|---|---|---|
| 1.1 | Add `adoSlug(heading: string): string` to `src/md-generator.ts` with the algorithm from design §2.5 | `src/md-generator.ts` |
| 1.2 | Add `tests/md-anchors.test.ts` with ~15 unit cases covering the matrix from design §2.4 | `tests/md-anchors.test.ts` (new) |
| 1.3 | Keep existing `slug()` untouched — nothing uses `adoSlug()` yet | — |

**Quality gate**: 56 tests + new anchor unit cases green. No behaviour change to any generated doc.

**Budget**: ~30 min.

---

### Stop 2 — Migrate MD anchors to `adoSlug` + drop `<a id>` tags

| ID | Task | Files |
|---|---|---|
| 2.1 | Replace every `slug(...)` call inside MD generator functions with `adoSlug(...)` | `src/md-generator.ts` |
| 2.2 | Remove every `<a id="...">` tag emitted to MD (approx 5 sites: measures, functions, calc-groups, data-dictionary, quality) | `src/md-generator.ts` |
| 2.3 | Add anchor-resolution integration test — for each of the six generated docs, extract every `(#anchor)` reference and assert it maps to some `## Heading`'s `adoSlug` | `tests/md-anchors.test.ts` |
| 2.4 | Add "no `<a id>` emitted" assertion to the same test file | `tests/md-anchors.test.ts` |

**Risk mitigation**: The anchor-resolution test is the gate. If any heading-to-reference mismatch exists on the H&S fixture, the test fires. Fix either the heading or the reference.

**Behaviour change**: dashboard `<h2>`s now scroll-into-view via their own auto-ID, not our dropped custom anchor. Verify the Docs tab still jumps correctly after MD re-renders.

**Budget**: ~45 min.

---

### Stop 3 — Badge emoji prefixes

| ID | Task | Files |
|---|---|---|
| 3.1 | Update `BADGE_PK`, `BADGE_PK_INF`, `BADGE_FK`, `BADGE_CALC`, `BADGE_HIDDEN`, `BADGE_PROXY` constants with emoji prefix per design §3.3 | `src/md-generator.ts` |
| 3.2 | Update inline span strings that don't use constants (status badges, slicer, calc-grp, direction) to include emoji | `src/md-generator.ts` |
| 3.3 | Verify dashboard CSS renders emoji-in-pill cleanly (no extra margin / misalignment) | `src/styles/dashboard.css` — likely no change, emoji is just another glyph |
| 3.4 | Add test: each badge constant contains both its emoji AND its text label | `tests/md-badges.test.ts` (new) |

**Dashboard visual risk**: emoji adds ~1.2x char width to each pill. If any tight layout breaks, shrink pill padding by 2px.

**Budget**: ~20 min.

---

### Stop 4 — Per-measure Mermaid lineage in `measures.md`

| ID | Task | Files |
|---|---|---|
| 4.1 | Inside the per-measure `<details>` body, before "Depends on" / "Used by", emit a `mermaid` fenced block showing upstream deps + current measure + downstream visuals | `src/md-generator.ts` (`generateMeasuresMd`) |
| 4.2 | Only emit the block when the measure has EITHER `daxDependencies.length > 0` OR `dependedOnBy.length > 0` OR `usedIn.length > 0` — otherwise nothing to draw | — |
| 4.3 | Use safe node IDs via `adoSlug(name)` + uniqueness suffix for duplicates across entity types | — |
| 4.4 | Add styling via Mermaid `classDef` for current / measure / column / visual nodes | — |
| 4.5 | Test: composite model produces at least 1 mermaid block per measure that has deps or usage | `tests/md-mermaid.test.ts` (new) |

**Design reference**: design §4.2 has the example output.

**Budget**: ~45 min.

---

### Stop 5 — Per-fact-table Mermaid in `data-dictionary.md`

| ID | Task | Files |
|---|---|---|
| 5.1 | Inside each fact-table `<details>` body (determined by `classifyTable(t) === "Fact"`), emit a `mermaid graph LR` block showing `this_table` + its outgoing-relationship dimensions | `src/md-generator.ts` (`generateDataDictionaryMd`) |
| 5.2 | Skip on bridge / dimension / calc-group / disconnected / auto-date tables — too many edge cases, not enough value | — |
| 5.3 | Test: fact tables produce mermaid blocks; non-fact tables don't | `tests/md-mermaid.test.ts` |

**Budget**: ~30 min.

---

### Stop 6 — Wiki page-name hints + CHANGELOG + version bump + PR

| ID | Task | Files |
|---|---|---|
| 6.1 | At the very top of each doc (above `# Title`), emit an HTML comment suggesting an ADO Wiki page name: `<!-- Suggested ADO Wiki page name: Health_and_Safety / Measures -->` | `src/md-generator.ts` |
| 6.2 | Update `readme.md` with a short "Publishing to ADO Wiki" section — point at the suggested page names and note that users can prepend `[[_TOC_]]` themselves if they want ADO's auto-TOC | `readme.md` |
| 6.3 | Version `0.6.0` → `0.7.0` in `package.json` | `package.json` |
| 6.4 | CHANGELOG entry with before/after table for H&S sample | `CHANGELOG.md` |
| 6.5 | Live smoke — regenerate all six docs against `test/Health_and_Safety.Report`, confirm the anchor-resolution test passes, eyeball one doc's Mermaid block in the dashboard Docs tab | — |
| 6.6 | Branch `feat/ado-md-compat` → push → PR | — |

**Budget**: ~45 min including smoke + PR.

---

## Cross-stop dependency graph

```
Stop 1 ──► Stop 2 ─┬─ Stop 3 ─┐
                   ├─ Stop 4 ─┤
                   └─ Stop 5 ─┴─ Stop 6
```

Stops 3, 4, 5 are independent after Stop 2 and can merge in any order. For a single-developer session: left-to-right for the simplest review history.

---

## Parallelism opportunities

Within this workflow, none meaningful — each stop is too small to further subdivide. Cross-session parallelism is discouraged; each stop is a ~30-minute focused edit.

---

## Validation checkpoints (per stop)

Every stop ends with:

1. `npm run build` green
2. `npm test` green (test count grows across stops)
3. `npm run typecheck` green
4. Live smoke: regenerate MD against `test/Health_and_Safety.Report` and confirm:
   - Stops 1-2: every anchor in every doc resolves to a heading slug
   - Stop 3: every PK/FK/CALC/UNUSED mention carries its emoji prefix
   - Stop 4: proxy measures show a mermaid lineage block inside their details
   - Stop 5: `fct_health_safety` / `fct_injuries` / `fct_psif` show a star-fragment mermaid block
   - Stop 6: each doc begins with a `<!-- Suggested ADO Wiki page name: ... -->` comment

---

## Risks + mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `adoSlug` rule mismatch for an uncommon char | Broken anchors in production models | Anchor-resolution test covers the H&S fixture; extend test cases when misses are reported |
| Dashboard visual regression from emoji-in-pill | Visual polish loss | Eye-check after Stop 3; padding adjustment if needed |
| Mermaid block breaks MD renderer in dashboard | Docs tab crashes | Dashboard `mdRender` passes fenced code blocks through verbatim; Mermaid renders as literal code block, not a crash. Acceptable fallback |
| Future pressure for rich-vs-minimal toggle | Scope creep | Decision recorded: add only when real user pain emerges (Teams/email/PR-description paste). Not this release. |

---

## Definition of done

- [ ] All six stops merged to `feat/ado-md-compat`
- [ ] 56 → ≥ 61 tests green (adoSlug unit ×15 merged into one test file, anchor-resolution ×6, badge emoji ×1, mermaid ×2)
- [ ] CI green across Node 18/20/22
- [ ] Live smoke on H&S: all six docs regenerated, eyeball confirms
  - mermaid blocks render inline in dashboard MD view
  - emoji badges visible in the generated MD
  - suggested-page-name comment at top of each doc
- [ ] Manual ADO Wiki paste test — one doc pasted into an ADO Wiki, all anchors click, `<details>` collapses, emoji visible, mermaid renders. _User-validated._
- [ ] PR opened, CHANGELOG entry, version 0.7.0

---

## Next step

`/sc:implement` to start Stop 1. Or `merge` first if you want to flatten v0.6.0 (PR #14) before this lands — recommended since ADO-compat work is additive and happier on a merged main.
