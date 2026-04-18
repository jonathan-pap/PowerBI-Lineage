# Workflow — PowerBI-Lineage v0.2

**Source design doc:** `/sc:design` output, this session (aurora-mesh + blueprint-grid dashboard, composite-model support, 3 Critical security fixes).
**Strategy:** systematic, depth = deep.
**Parallelism:** stops are serial by default; tasks *within* a stop may run in parallel where marked `∥`.
**Status at start:** uncommitted work on `main` from prior session (EXTERNALMEASURE card, `.chip` component, downstream color change, all-pages fix). PRs #1 & #2 merged.

---

## Implementation phases — overview

| # | Stop | Goal | Budget | Gate |
|---|---|---|---|---|
| 0 | Pre-flight | Commit in-flight work, baseline tests | 30 min | Clean `git status`, `npm run build` green |
| 1 | Infra | `src/render/safe.ts`, `node --test` harness, `npm test` | 2 h | 2 smoke tests green |
| 2 | Server boundary | Bind to `127.0.0.1`, cap retries, harden error banner | 1 h | Manual + LAN-probe test |
| 3 | DATA embed safety | Route `JSON.stringify(data)` through `safeJSON` | 45 min | `</script>` round-trip test green |
| 4 | Event delegation | Introduce `data-action` pattern; add `jsStr()` for stragglers | 3 h | Injection-fuzz test green |
| 5 | Client split | Carve `html-generator.ts` into `src/client/`, inline at build | 1.5 days | All panels render identically, byte-diff spot-check |
| 6 | Composite-model fixes | Multi-line TMDL, shared-expression resolution, structured EXTERNALMEASURE, LocalDateTable filter | 1 day | H&S fixture: 52/53 tables resolve to AS, 0 LocalDateTable noise, 19 proxies tagged |
| 7 | Polish | `npm run typecheck`, `CONTRIBUTING.md`, archive this doc | 2 h | All scripts green, lint-free grep |

Total rough budget: ~4 developer-days across 7 stops. Each stop independently mergeable.

---

## Stop 0 — Pre-flight

**Goal:** Establish a clean baseline before refactoring.

**Tasks:**

| ID | Task | Files | Depends on |
|---|---|---|---|
| 0.1 | Inventory uncommitted changes from prior session | — | — |
| 0.2 | Group into logical commits: (a) EXTERNALMEASURE lineage card + regex detection, (b) downstream color → sky, (c) all-pages fix (scanner + data-builder + client), (d) chip component + MD chip lists | `src/html-generator.ts`, `src/md-generator.ts`, `src/report-scanner.ts`, `src/data-builder.ts` | 0.1 |
| 0.3 | Open PR #3 "composite-model lineage + pages fix + chip component" | — | 0.2 |
| 0.4 | Manual smoke: training + H&S models render without console errors | — | 0.3 |

**Checkpoint:** `git status` clean. `npm run build` green. Both fixtures render.

**Output artifact:** PR #3 merged to `main`.

---

## Stop 1 — Infrastructure (foundation for everything else)

**Goal:** Introduce the escape-helpers module and test harness. No behaviour change yet.

**Dependencies:** Stop 0 merged.

**Tasks:**

| ID | Task | Files | Depends on |
|---|---|---|---|
| 1.1 | Create `src/render/safe.ts` exporting `escHtml`, `escAttr`, `jsStr`, `safeJSON`. Each has a 3-5 line JSDoc stating its exact context. | `src/render/safe.ts` (new) | — |
| 1.2 ∥ | Create `tests/` directory. Add `tests/fixtures/` with minimal synthetic FullData JSON (one table, one measure with adversarial name `foo'),alert(1),('`). | `tests/fixtures/adversarial.json` (new) | — |
| 1.3 ∥ | Add `tests/safe.test.ts` covering each helper: escapes `<`, `>`, `&`, `'`, `"`, `</script>`, `U+2028`, `U+2029`. | `tests/safe.test.ts` (new) | 1.1 |
| 1.4 | Add `"test": "node --test --import tsx tests/**/*.test.ts"` (or compile first then run `node --test dist-test/**`) to `package.json`. Validate the zero-runtime-dep constraint — if `tsx` is disallowed, compile tests via separate `tsconfig.test.json` to `dist-test/`. | `package.json`, `tsconfig.test.json` (new) | 1.3 |
| 1.5 | Document test invocation in `readme.md` (2-line "Developing" section). | `readme.md` | 1.4 |

**Quality gate:**
- `npm test` passes.
- `npm run build` still green.
- No new runtime deps in `dependencies`. `tsx` or test-only helpers live in `devDependencies` only.

**Open decision needed before starting:** Keep zero-runtime-dep constraint strict (use `tsconfig.test.json` + compiled tests) **or** allow a single devDep (`tsx`) for cleaner test ergonomics. Recommend the compiled-tests path to match the project's stated zero-dep ethos.

---

## Stop 2 — Server trust boundary

**Goal:** Close the "LAN-exposed server vs. no-data-leaves-your-machine" mismatch.

**Dependencies:** Stop 1 merged (tests available for boundary assertion).

**Tasks:**

| ID | Task | Files | Depends on |
|---|---|---|---|
| 2.1 | Change `server.listen(port)` → `server.listen(port, "127.0.0.1")` in `app.ts:600`. | `src/app.ts` | — |
| 2.2 | Cap port retries at 20 (5679→5698). On exhaustion, print a clear stderr message and exit 1. | `src/app.ts:596-597` | 2.1 |
| 2.3 | Add startup self-check: after `listen` fires, inspect `server.address()` and refuse to serve if not loopback. | `src/app.ts:600` | 2.1 |
| 2.4 | In `landingHTML`, wrap `${error}` in `escHtml()`. | `src/app.ts:439` | Stop 1 (uses `safe.ts`) |
| 2.5 | Guard `parseQuery` path input: reject NUL bytes and UNC paths (`\\\\server\\…`). | `src/app.ts:501-510` | — |
| 2.6 | Add `tests/server-boundary.test.ts`: spawn app, attempt connection from a non-loopback interface, assert ECONNREFUSED. | `tests/server-boundary.test.ts` (new) | 2.1 |

**Quality gate:**
- `curl http://127.0.0.1:<port>/` → 200.
- `curl http://<lan-ip>:<port>/` → ECONNREFUSED.
- `tests/server-boundary.test.ts` green.

**Risk:** Users who rely on LAN access (e.g. running the app on a NAS and viewing from a laptop) will regress. Mitigation — add `POWERBI_LINEAGE_BIND=0.0.0.0` opt-in env var with a big warning banner in the landing page when set.

---

## Stop 3 — DATA embed safety

**Goal:** Eliminate `</script>` breakout in the embedded model payload.

**Dependencies:** Stops 1 (safe helpers) + 2 (baseline).

**Tasks:**

| ID | Task | Files | Depends on |
|---|---|---|---|
| 3.1 | Replace `JSON.stringify(data)` at `html-generator.ts:544` with `safeJSON(data)`. | `src/html-generator.ts` | 1.1 |
| 3.2 | Do the same for `reportName`, `version`, and the 6 markdown literals (lines 544-552). | `src/html-generator.ts:544-552` | 3.1 |
| 3.3 | Add `tests/render-data-embed.test.ts`: synthetic FullData with a measure description `"</script><script>alert(1)"` → assert the generated HTML, when fed to a tiny DOM-shim parser (or a regex assertion), contains no second `<script>` block. | `tests/render-data-embed.test.ts` (new) | 3.1 |

**Quality gate:**
- `</script>`, `-->`, `U+2028`, `U+2029` in any field round-trip safely.
- Both real fixtures still render identically (byte-diff the HTML output, allow whitespace-only differences).

---

## Stop 4 — Event delegation (structural XSS fix)

**Goal:** Replace every `onclick="…${field}…"` with `data-action="…"` + attribute-based props. Removes the XSS surface structurally.

**Dependencies:** Stops 1 + 3.

**Tasks:**

| ID | Task | Files | Depends on |
|---|---|---|---|
| 4.1 | Inventory all `onclick=` sites in `html-generator.ts`. Grep showed ~17 in the prior analysis; confirm. Categorize by action: `lineage`, `tab-switch`, `sort`, `page-toggle`, `table-toggle`, `copy`. | `src/html-generator.ts` | — |
| 4.2 | Design a `data-action` contract: `data-action="<verb>" data-<prop>="<value>"`. Document in a comment block at the top of `html-generator.ts`. | `src/html-generator.ts` | 4.1 |
| 4.3 | Add a single document-level delegated click listener in the embedded client JS that reads `target.closest('[data-action]')` and dispatches. | `src/html-generator.ts` | 4.2 |
| 4.4 | Migrate sites in batches of 3–5 per commit, each commit passing tests: (a) lineage measure/column spans, (b) tab-switch/back buttons, (c) table/column sort headers, (d) page + table toggles, (e) copy buttons, (f) chip onclicks in pages + MD. | `src/html-generator.ts`, `src/md-generator.ts` (chip HTML) | 4.3 |
| 4.5 | For remaining stragglers that genuinely need JS-string splicing (e.g. dynamic HTML in MD), route through `jsStr()`. | `src/render/safe.ts`, callers | 1.1 |
| 4.6 | Add `tests/render-xss-fuzz.test.ts`: generate a FullData with adversarial names across every entity type; assert the rendered HTML parses cleanly and contains no auxiliary `<script>` blocks. | `tests/render-xss-fuzz.test.ts` (new) | 4.4 |
| 4.7 | Rename `openLineage` → `navigateLineage` as part of this sweep (every call site is being edited anyway). | `src/html-generator.ts`, `src/md-generator.ts` | 4.4 |

**Quality gate:**
- Zero `onclick="` sites remain in dynamic HTML output. Confirm via `grep -n 'onclick=' src/html-generator.ts src/md-generator.ts` → no user-data-interpolating matches.
- XSS fuzz test green.

---

## Stop 5 — Client split (the big one)

**Goal:** Move client JS out of the template literal into `src/client/` as real TS files. Inline at build time via a tiny concatenator.

**Dependencies:** Stops 1–4 (safe helpers + delegation in place, so the mechanical split doesn't need to re-solve those).

**Phased sub-plan:**

### 5.a — Build pipeline

| ID | Task | Files | Depends on |
|---|---|---|---|
| 5.a.1 | Add `src/client/tsconfig.json` extending root, emit to `dist/client/`. Library target same ES2022, `"module": "None"` or bundle-friendly. | `src/client/tsconfig.json` (new) | — |
| 5.a.2 | Write `scripts/build-client.ts`: after `tsc`, concatenate `dist/client/*.js` in dependency order into `dist/client/bundle.js`. Emit an exports-free IIFE. | `scripts/build-client.ts` (new) | 5.a.1 |
| 5.a.3 | Update `package.json` `build` script: `"build": "tsc && node dist/scripts/build-client.js"`. | `package.json` | 5.a.2 |
| 5.a.4 | `html-generator.ts` reads `dist/client/bundle.js` at generate time and inlines into `<script>…</script>`. | `src/render/html-generator.ts` | 5.a.3 |

### 5.b — Carve out modules (serial, each commit independently green)

| ID | Module | Source lines (approx in current html-generator.ts) | Notes |
|---|---|---|---|
| 5.b.1 | `state.ts` | activeTab, lastTab, openTables, openPages, sort maps | Pure state, no DOM. |
| 5.b.2 | `components/badge.ts` + `chip.ts` + `lc-card.ts` | badge factory + chip + lc render | Mirror `md-generator.ts` badge constants for cross-consistency. |
| 5.b.3 | `render/md.ts` | mdRender, mdInline, mdEscapeHtml, codes array | The markdown renderer with span passthrough & chip support. |
| 5.b.4 | `render/tables.ts` | sortTable, uc/sc helpers | Shared table utilities. |
| 5.b.5 | `panels/sources.ts` | renderSources | ~100 lines |
| 5.b.6 | `panels/tables.ts` | renderTables, toggleTableCard | ~200 lines |
| 5.b.7 | `panels/columns.ts` | renderColumns | ~60 lines |
| 5.b.8 | `panels/relationships.ts` | renderRelationships | ~40 lines |
| 5.b.9 | `panels/measures.ts` | renderMeasures | ~80 lines |
| 5.b.10 | `panels/calc-groups.ts` | renderCalcGroups | ~60 lines |
| 5.b.11 | `panels/functions.ts` | renderFunctions | ~120 lines |
| 5.b.12 | `panels/pages.ts` | renderPages, togglePage | ~150 lines |
| 5.b.13 | `panels/unused.ts` | renderUnused | ~40 lines |
| 5.b.14 | `panels/lineage.ts` | navigateLineage (ex-openLineage) | ~150 lines, includes EXTERNALMEASURE card |
| 5.b.15 | `panels/docs.ts` | renderDocs + tab machinery | ~100 lines |
| 5.b.16 | `main.ts` | switchTab, renderTabs, delegated event listener, bootstrap | ~80 lines |

### 5.c — Acceptance

| ID | Task | Files | Depends on |
|---|---|---|---|
| 5.c.1 | `html-generator.ts` is ≤ 250 lines and contains only: imports, `generateHTML` shell, DATA+MD embeds, `<script src-replacement>` with inlined bundle. | `src/render/html-generator.ts` | 5.b.16 |
| 5.c.2 | Byte-diff outputs for both fixtures against the pre-split baseline; acceptable differences are only whitespace and the reorganized script block. | smoke test | 5.c.1 |

**Quality gate:**
- Manual smoke across every tab on both fixtures.
- Panel module line counts match design (`wc -l src/client/panels/*.ts` within ±20%).
- No `document.getElementById` calls outside `panels/` or `main.ts`.

**Risk:** mechanical carving introduces regressions (typos in event wiring, missed DATA references). Mitigation — one module per commit, smoke after each.

---

## Stop 6 — Composite-model fixes

**Goal:** Close the 4 remaining composite-model gaps. Cleaner after Stop 5 because render and data are separate.

**Dependencies:** Stop 5 (clean client/server split).

**Tasks:**

### 6.a — Multi-line TMDL expressions

| ID | Task | Files | Depends on |
|---|---|---|---|
| 6.a.1 | Rewrite `parseTmdlExpressions` as a line-level state machine per design §5.1. Track `{state, name, buf, indent}`. | `src/core/model-parser.ts` | — |
| 6.a.2 | Add `tests/model-parser-expressions.test.ts`: fixtures for (i) single-line, (ii) multi-line `let…in`, (iii) consecutive expressions, (iv) expression followed by `lineageTag`. | `tests/model-parser-expressions.test.ts` (new) | 6.a.1 |

### 6.b — Shared-expression resolution in `inferSource`

| ID | Task | Files | Depends on |
|---|---|---|---|
| 6.b.1 | Build `expressionSourceMap: Map<string, ResolvedSource>` once per `buildFullData` call by classifying each expression's body via the existing pattern table. | `src/core/data-builder.ts`, `src/core/model-parser.ts` | 6.a.1 |
| 6.b.2 | Update `inferSource(partition, exprMap)` to follow `#"<expr-name>"` references before falling through to the pattern table. | `src/core/model-parser.ts` | 6.b.1 |
| 6.b.3 | Test: H&S fixture → assert all 48 DQ partitions resolve to `{kind: "AnalysisServices", database: "Health_and_Safety_Gold"}`. | `tests/fixtures/h_and_s/`, `tests/data-builder.test.ts` | 6.b.2 |

### 6.c — Structured EXTERNALMEASURE

| ID | Task | Files | Depends on |
|---|---|---|---|
| 6.c.1 | Add `externalProxy: {remoteName, type, externalModel, cluster: string\|null} \| null` to `ModelMeasure`. Populate in `data-builder.ts` by regex-matching `daxExpression` once at build time. Cluster comes from joining `externalModel` against `expressionSourceMap`. | `src/core/types.ts`, `src/core/data-builder.ts` | 6.b.1 |
| 6.c.2 | Client `panels/lineage.ts`: use `m.externalProxy` instead of runtime regex. Delete the regex from the template. | `src/client/panels/lineage.ts` | 6.c.1 |
| 6.c.3 | `render/md/measures.ts`: add an "External proxy" column in the measures table and a "Proxy measures" subsection that lists all proxies grouped by `externalModel`. | `src/render/md/measures.ts` | 6.c.1 |
| 6.c.4 | `render/md/quality.ts`: new rule — "Proxy measure pointing at missing shared expression" when `externalProxy.externalModel` has no match. | `src/render/md/quality.ts` | 6.c.1 |

### 6.d — LocalDateTable filtering

| ID | Task | Files | Depends on |
|---|---|---|---|
| 6.d.1 | Add `origin: "user" \| "auto-date"` to `TableData` (and the raw equivalent). Derive from name prefix `LocalDateTable_` / `DateTableTemplate_`. | `src/core/types.ts`, `src/core/data-builder.ts` | — |
| 6.d.2 | All panel counts subtract auto-date tables by default; add `· +N auto` subtext to the Tables/Sources tab badges. | `src/client/panels/*.ts` | 5.b |
| 6.d.3 | Add a "Show auto date tables (N)" toggle in the Sources tab. Persist in `state.ts`. | `src/client/panels/sources.ts`, `src/client/state.ts` | 6.d.2 |
| 6.d.4 | MD exports: auto-date tables rendered under a collapsed `<details>` section, never silently dropped. | `src/render/md/model.ts`, `render/md/data-dictionary.ts` | 6.d.1 |

**Quality gate:**
- H&S fixture: `53 tables (10 auto) · 48 DQ partitions → AS · 19 proxies tagged`.
- Training fixture: unchanged (`7 tables · 0 auto · 120 measures`).
- All new tests green.

---

## Stop 7 — Polish + docs

| ID | Task | Files | Depends on |
|---|---|---|---|
| 7.1 | Add `"typecheck": "tsc --noEmit"` script. | `package.json` | — |
| 7.2 | Write `CONTRIBUTING.md` covering: module layout, client-split invariants, safe.ts rules, test conventions, the zero-runtime-dep constraint. | `CONTRIBUTING.md` (new) | — |
| 7.3 | Move this workflow doc + the `/sc:design` output to `claudedocs/archive/v0.2/`. | `claudedocs/archive/v0.2/` | all prior stops merged |
| 7.4 | Tag release `v0.2.0` after final merge. | git | 7.3 |

**Quality gate:**
- `npm run typecheck && npm test && npm run build` all green.
- `grep -Rn 'onclick=' src/` returns no user-data-interpolating matches.
- `CONTRIBUTING.md` present and current.

---

## Cross-stop dependency graph

```
Stop 0 ── Stop 1 ─┬─ Stop 2 ─┐
                  ├─ Stop 3 ─┤
                  └────────┬─┴── Stop 4 ── Stop 5 ── Stop 6 ── Stop 7
```

Stops 2 & 3 can land in either order (both depend only on Stop 1). Stop 4 depends on 1+3 (needs safe helpers and data-embed safety before the structural fix). Stop 5 depends on 1-4 being clean so the carving work doesn't have to re-fix them. Stop 6 benefits from the client/server split.

---

## Parallelism opportunities

Within stops:
- **Stop 1:** 1.2 and 1.3 can land in parallel after 1.1.
- **Stop 5.b:** panels 5.b.5–5.b.14 are independent; 2–3 can be in flight at once if the team is >1 developer. For a single-developer session, keep them serial for review sanity.
- **Stop 6.a, 6.d** can start before 6.b, 6.c (different files, no shared state).

Cross-stop parallelism is discouraged — each stop leaves a cleaner baseline for the next.

---

## Validation checkpoints (per stop)

Every stop ends with:
1. `npm run build` green
2. `npm test` green
3. Manual smoke: both fixture models render, every tab is clickable, no console errors
4. `git diff --stat main` review — no unintended file changes
5. PR opened with the stop number in the title (e.g. "Stop 4: event delegation XSS fix")

---

## Open questions to resolve before execution

1. **Test runner ergonomics** — accept `tsx` as devDep, or stick to compiled tests via `tsconfig.test.json`? *Recommendation:* compiled tests, matches zero-dep ethos.
2. **LAN-exposure opt-in** — ship `POWERBI_LINEAGE_BIND` env var, or leave LAN access fully impossible for v0.2? *Recommendation:* ship the env var with a warning banner so power-users aren't blocked.
3. **Cluster URL on proxy measures** — include in `externalProxy.cluster`, or model name only? *Recommendation:* include; it's cheap when shared-expression resolution is already wired.
4. **`openLineage` → `navigateLineage` rename** — confirm while Stop 4 is editing every call site. *Recommendation:* yes.
5. **Archive location** — `claudedocs/archive/v0.2/` or just a git tag? *Recommendation:* both — doc in archive, tag on `main`.

---

## Next step

After your review of this workflow:
- If any stop should be resequenced or dropped, say so before we start.
- Once confirmed, invoke `/sc:implement` on Stop 0 (pre-flight commit) to begin execution.
- Stops 1 through 7 each want their own `/sc:implement` invocation for isolation.
