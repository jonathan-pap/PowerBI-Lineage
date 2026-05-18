/**
 * AI cleanup prompt builder — unit tests.
 *
 * Covers the three categories, EXTERNALMEASURE exclusion, auto-date
 * exclusion, stage ordering, and a few edge cases (empty stages,
 * special characters in measure names).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCleanupPrompt, buildTabularEditorScript } from "../src/ai-prompts.js";
import type { FullData, ModelMeasure } from "../src/data-builder.js";

// ─────────────────────────────────────────────────────────────────────
// Factories — mirror tests/improvements.test.ts so the two test
// files stay readable side-by-side.
// ─────────────────────────────────────────────────────────────────────

function mk(over: Partial<FullData> = {}): FullData {
  return {
    measures: [], columns: [], relationships: [], functions: [],
    calcGroups: [], tables: [], pages: [], hiddenPages: [],
    allPages: [], expressions: [], compatibilityLevel: null,
    modelProperties: {
      name: "m", description: "Test model.", culture: "", sourceQueryCulture: "",
      discourageImplicitMeasures: false, valueFilterBehavior: "",
      cultures: [], defaultPowerBIDataSourceVersion: "",
    },
    totals: {
      measuresInModel: 0, measuresDirect: 0, measuresIndirect: 0, measuresUnused: 0,
      columnsInModel: 0, columnsDirect: 0, columnsIndirect: 0, columnsUnused: 0,
      relationships: 0, functions: 0, calcGroups: 0, tables: 0, pages: 0, visuals: 0,
    },
    ...over,
  } as FullData;
}

function mkMeasure(over: Partial<ModelMeasure> = {}): ModelMeasure {
  return {
    name: "M", table: "T", daxExpression: "1", formatString: "", description: "",
    displayFolder: "", daxDependencies: [], dependedOnBy: [], usedIn: [],
    usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
    ...over,
  };
}

const FIXED_DATE = new Date("2026-05-17T00:00:00Z");

// ─────────────────────────────────────────────────────────────────────
// Header / boilerplate invariants — apply to all three categories
// ─────────────────────────────────────────────────────────────────────

test("buildCleanupPrompt — emits ISO date stamp from injected `now`", () => {
  const md = buildCleanupPrompt(mk(), "measures-all", { now: FIXED_DATE });
  assert.ok(md.includes("2026-05-17"), "expected ISO-8601 date in prompt body");
  assert.ok(!md.includes("2026-05-17T"), "date should be sliced to YYYY-MM-DD");
});

test("buildCleanupPrompt — every category includes the six safety constraints", () => {
  for (const cat of ["unused-measures", "dead-chain-measures", "measures-all"] as const) {
    const md = buildCleanupPrompt(mk(), cat, { now: FIXED_DATE });
    assert.ok(md.includes("Safety constraints"), `${cat}: missing safety section`);
    assert.ok(md.includes("Confirm with me before each deletion"), `${cat}: missing rule 1`);
    assert.ok(md.includes("Stage 1 (directly unused)"), `${cat}: missing rule 2 (Stage 1 first)`);
    assert.ok(md.includes("EXTERNALMEASURE("), `${cat}: missing rule 3 (EXTERNALMEASURE guard)`);
    assert.ok(md.includes("`_`"), `${cat}: missing rule 4 (helper-measure flag)`);
    assert.ok(md.includes("$model.SaveChanges()"), `${cat}: missing rule 5 (save once)`);
    assert.ok(md.includes("Ctrl+Z does NOT"), `${cat}: missing rule 6 (no-undo warning)`);
  }
});

test("buildCleanupPrompt — every category points at pbi-desktop as recommended tool", () => {
  for (const cat of ["unused-measures", "dead-chain-measures", "measures-all"] as const) {
    const md = buildCleanupPrompt(mk(), cat, { now: FIXED_DATE });
    assert.ok(md.includes("`pbi-desktop`"), `${cat}: missing pbi-desktop recommendation`);
    assert.ok(md.includes("Tabular Editor CLI"), `${cat}: missing Tabular Editor fallback`);
    assert.ok(md.includes("TOM via PowerShell"), `${cat}: missing TOM fallback`);
  }
});

test("buildCleanupPrompt — verification section tells user to re-open project", () => {
  const md = buildCleanupPrompt(mk(), "measures-all", { now: FIXED_DATE });
  assert.ok(md.includes("## Verification"));
  assert.ok(md.includes("Re-open the `.pbip`"));
  assert.ok(md.includes("git reset --hard"));
});

// ─────────────────────────────────────────────────────────────────────
// Stage 1 — directly unused measures
// ─────────────────────────────────────────────────────────────────────

test("buildCleanupPrompt — Stage 1 lists `status: 'unused'` measures as bullet entries", () => {
  const data = mk({
    measures: [
      mkMeasure({ table: "Sales", name: "Old Total", daxExpression: "SUM(Sales[Amount])", status: "unused" }),
      mkMeasure({ table: "Sales", name: "Live", daxExpression: "SUM(Sales[Amount])", status: "direct" }),
    ],
  });
  const md = buildCleanupPrompt(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(md.includes("- `Sales[Old Total]`"), "missing Stage 1 bullet for Old Total");
  assert.ok(!md.includes("- `Sales[Live]`"), "Live measure (status:direct) should not appear in Stage 1");
  assert.ok(md.includes("Stage 1 — directly unused (1 measure)"), "expected singular count");
  assert.ok(!md.includes("SUM(Sales[Amount])"), "DAX body should NOT be embedded — AI reads it from the live model");
  assert.ok(!md.includes("```dax"), "no dax-fenced blocks in the prompt body");
});

test("buildCleanupPrompt — Stage 1 with zero candidates emits the placeholder", () => {
  const md = buildCleanupPrompt(mk(), "unused-measures", { now: FIXED_DATE });
  assert.ok(md.includes("Stage 1 — directly unused (0 measures)"));
  assert.ok(md.includes("_(none flagged)_"));
});

// ─────────────────────────────────────────────────────────────────────
// Stage 2 — dead-chain measures
// ─────────────────────────────────────────────────────────────────────

test("buildCleanupPrompt — Stage 2 lists dead-chain measures (status: indirect, no live caller)", () => {
  const data = mk({
    measures: [
      // Unused top-of-chain → Stage 1
      mkMeasure({ table: "T", name: "Dead", status: "unused", daxDependencies: ["Dead-Helper"] }),
      // Only reachable from Dead → Stage 2
      mkMeasure({ table: "T", name: "Dead-Helper", status: "indirect" }),
      // Direct, reachable → not in any stage
      mkMeasure({ table: "T", name: "Live", status: "direct", daxDependencies: ["Live-Helper"] }),
      mkMeasure({ table: "T", name: "Live-Helper", status: "indirect" }),
    ],
  });
  const md = buildCleanupPrompt(data, "dead-chain-measures", { now: FIXED_DATE });
  assert.ok(md.includes("- `T[Dead-Helper]`"), "Dead-Helper should be Stage 2");
  assert.ok(!md.includes("- `T[Live-Helper]`"), "Live-Helper is reachable from Live, should NOT be Stage 2");
  assert.ok(!md.includes("- `T[Dead]`"), "Dead is Stage 1, should NOT appear in a dead-chain-only prompt");
});

test("buildCleanupPrompt — dead-chain-only category warns 'This is Stage 2 work' in the goal", () => {
  const md = buildCleanupPrompt(mk(), "dead-chain-measures", { now: FIXED_DATE });
  assert.ok(md.includes("This is Stage 2 work"), "Stage-2-only prompt must warn about Stage 1 ordering up front");
});

// ─────────────────────────────────────────────────────────────────────
// Combined — measures-all (ordering matters)
// ─────────────────────────────────────────────────────────────────────

test("buildCleanupPrompt — measures-all emits Stage 1 strictly before Stage 2", () => {
  const data = mk({
    measures: [
      mkMeasure({ table: "T", name: "S1", status: "unused", daxDependencies: ["S2"] }),
      mkMeasure({ table: "T", name: "S2", status: "indirect" }),
    ],
  });
  const md = buildCleanupPrompt(data, "measures-all", { now: FIXED_DATE });
  const s1Idx = md.indexOf("### Stage 1");
  const s2Idx = md.indexOf("### Stage 2");
  assert.ok(s1Idx >= 0, "Stage 1 header must appear");
  assert.ok(s2Idx >= 0, "Stage 2 header must appear");
  assert.ok(s1Idx < s2Idx, `Stage 1 (@${s1Idx}) must come before Stage 2 (@${s2Idx})`);
  // And the dead-chain bullet must be after Stage 2 header, not before.
  const s2ItemIdx = md.indexOf("- `T[S2]`");
  assert.ok(s2ItemIdx > s2Idx, "S2 dead-chain bullet must render under the Stage 2 header");
});

// ─────────────────────────────────────────────────────────────────────
// EXTERNALMEASURE exclusion — the load-bearing safety filter
// ─────────────────────────────────────────────────────────────────────

test("buildCleanupPrompt — EXTERNALMEASURE proxies are NEVER in the kill list, even when status:unused", () => {
  const data = mk({
    measures: [
      mkMeasure({
        table: "Remote", name: "Remote Revenue",
        daxExpression: "EXTERNALMEASURE(\"Revenue\", DOUBLE, \"DirectQuery to AS - Sales\")",
        status: "unused",
        externalProxy: {
          remoteName: "Revenue", type: "DOUBLE",
          externalModel: "DirectQuery to AS - Sales", cluster: null,
        },
      }),
      mkMeasure({ table: "Sales", name: "Legit Unused", status: "unused", daxExpression: "0" }),
    ],
  });
  const md = buildCleanupPrompt(data, "measures-all", { now: FIXED_DATE });
  assert.ok(!md.includes("- `Remote[Remote Revenue]`"),
    "EXTERNALMEASURE-bound measure must not appear in kill targets even when status:unused");
  assert.ok(md.includes("- `Sales[Legit Unused]`"),
    "non-proxy unused measure should still be flagged");
});

// ─────────────────────────────────────────────────────────────────────
// Auto-date exclusion — matches improvements.ts userMeasures filter
// ─────────────────────────────────────────────────────────────────────

test("buildCleanupPrompt — measures on auto-date tables are excluded", () => {
  const data = mk({
    tables: [
      { name: "LocalDateTable_x", description: "", isCalcGroup: false, origin: "auto-date" as const,
        isCalculatedTable: false, parameterKind: null, columnCount: 0, measureCount: 0, keyCount: 0,
        fkCount: 0, hiddenColumnCount: 0, columns: [], measures: [], relationships: [],
        partitions: [], hierarchies: [] } as any,
      { name: "Sales", description: "", isCalcGroup: false, origin: "user" as const,
        isCalculatedTable: false, parameterKind: null, columnCount: 0, measureCount: 0, keyCount: 0,
        fkCount: 0, hiddenColumnCount: 0, columns: [], measures: [], relationships: [],
        partitions: [], hierarchies: [] } as any,
    ],
    measures: [
      mkMeasure({ table: "LocalDateTable_x", name: "Auto Year Total", status: "unused" }),
      mkMeasure({ table: "Sales", name: "Old", status: "unused" }),
    ],
  });
  const md = buildCleanupPrompt(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(!md.includes("- `LocalDateTable_x[Auto Year Total]`"),
    "auto-date table measures must never appear in the kill list");
  assert.ok(md.includes("- `Sales[Old]`"),
    "user-table measures with status:unused should still appear");
});

// ─────────────────────────────────────────────────────────────────────
// Output shape — final byte-level sanity
// ─────────────────────────────────────────────────────────────────────

test("buildCleanupPrompt — output ends with a single trailing newline", () => {
  const md = buildCleanupPrompt(mk(), "unused-measures", { now: FIXED_DATE });
  assert.ok(md.endsWith("\n"), "prompt should end with newline (POSIX-friendly)");
  assert.ok(!md.endsWith("\n\n"), "prompt should not have double trailing newline");
});

test("buildCleanupPrompt — title varies per category", () => {
  const u = buildCleanupPrompt(mk(), "unused-measures", { now: FIXED_DATE });
  const d = buildCleanupPrompt(mk(), "dead-chain-measures", { now: FIXED_DATE });
  const a = buildCleanupPrompt(mk(), "measures-all", { now: FIXED_DATE });
  assert.ok(u.startsWith("# Cleanup task — delete unused Power BI measures\n"));
  assert.ok(d.startsWith("# Cleanup task — delete dead-chain Power BI measures\n"));
  assert.ok(a.startsWith("# Cleanup task — delete unused + dead-chain Power BI measures\n"));
});

// ═════════════════════════════════════════════════════════════════════
// Tabular Editor script generator
// ═════════════════════════════════════════════════════════════════════

test("buildTabularEditorScript — header includes date and category summary", () => {
  const data = mk({
    measures: [
      mkMeasure({ table: "Sales", name: "Old", status: "unused" }),
    ],
  });
  const s = buildTabularEditorScript(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(s.startsWith("// PowerBI-Lineage cleanup script"), "header must lead with the cleanup tag");
  assert.ok(s.includes("2026-05-17"), "header must include the ISO date");
  assert.ok(s.includes("Category: unused-measures"), "header must echo the category");
  assert.ok(s.includes("1 directly-unused measure)"), "header must summarise the count (singular)");
});

test("buildTabularEditorScript — emits anonymous-type target entries with anchored bracket form", () => {
  const data = mk({
    measures: [
      mkMeasure({ table: "Sales", name: "Old Total", status: "unused" }),
      mkMeasure({ table: "Sales", name: "Legacy YTD", status: "unused" }),
    ],
  });
  const s = buildTabularEditorScript(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(s.includes('new { Table = "Sales", Measure = "Old Total", Stage = "Stage 1" }'),
    "target tuple must use anonymous-type syntax with named props");
  assert.ok(s.includes('new { Table = "Sales", Measure = "Legacy YTD", Stage = "Stage 1" }'),
    "all targets must appear in the script body");
});

test("buildTabularEditorScript — EXTERNALMEASURE proxies are excluded at generation time", () => {
  const data = mk({
    measures: [
      mkMeasure({
        table: "Remote", name: "Remote Revenue",
        daxExpression: "EXTERNALMEASURE(\"R\", DOUBLE, \"DirectQuery to AS - X\")",
        status: "unused",
        externalProxy: { remoteName: "R", type: "DOUBLE", externalModel: "DirectQuery to AS - X", cluster: null },
      }),
      mkMeasure({ table: "Sales", name: "Legit", status: "unused" }),
    ],
  });
  const s = buildTabularEditorScript(data, "measures-all", { now: FIXED_DATE });
  assert.ok(!s.includes("Remote Revenue"),
    "EXTERNALMEASURE-bound measure must not appear in the target list");
  assert.ok(s.includes("Legit"), "non-proxy measure should be in the target list");
});

test("buildTabularEditorScript — emits runtime EXTERNALMEASURE guard (defence in depth)", () => {
  const data = mk({ measures: [mkMeasure({ table: "Sales", name: "Old", status: "unused" })] });
  const s = buildTabularEditorScript(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(s.includes("EXTERNALMEASURE"),
    "script body must check for EXTERNALMEASURE at runtime in case one slipped through static filter");
  assert.ok(s.includes("StringComparison.OrdinalIgnoreCase"),
    "runtime check must be case-insensitive");
});

test("buildTabularEditorScript — measures-all puts Stage 1 entries before Stage 2", () => {
  const data = mk({
    measures: [
      mkMeasure({ table: "T", name: "S1a", status: "unused", daxDependencies: ["S2a"] }),
      mkMeasure({ table: "T", name: "S2a", status: "indirect" }),
    ],
  });
  const s = buildTabularEditorScript(data, "measures-all", { now: FIXED_DATE });
  const s1Idx = s.indexOf('Measure = "S1a"');
  const s2Idx = s.indexOf('Measure = "S2a"');
  assert.ok(s1Idx >= 0 && s2Idx >= 0, "both stages must be present in measures-all");
  assert.ok(s1Idx < s2Idx, "Stage 1 entries must come before Stage 2 in the target array");
  // And the Stage tag on each tuple should be correct.
  assert.ok(s.includes('Measure = "S1a", Stage = "Stage 1"'), "S1a should be tagged Stage 1");
  assert.ok(s.includes('Measure = "S2a", Stage = "Stage 2"'), "S2a should be tagged Stage 2");
});

test("buildTabularEditorScript — auto-date table measures are excluded", () => {
  const data = mk({
    tables: [
      { name: "LocalDateTable_x", description: "", isCalcGroup: false, origin: "auto-date" as const,
        isCalculatedTable: false, parameterKind: null, columnCount: 0, measureCount: 0, keyCount: 0,
        fkCount: 0, hiddenColumnCount: 0, columns: [], measures: [], relationships: [],
        partitions: [], hierarchies: [] } as any,
    ],
    measures: [
      mkMeasure({ table: "LocalDateTable_x", name: "Auto Y", status: "unused" }),
      mkMeasure({ table: "Sales", name: "Old", status: "unused" }),
    ],
  });
  const s = buildTabularEditorScript(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(!s.includes("Auto Y"), "auto-date measures must never appear in the target list");
  assert.ok(s.includes('Measure = "Old"'), "user-table measures should appear");
});

test("buildTabularEditorScript — empty kill list produces the no-op stub", () => {
  const s = buildTabularEditorScript(mk(), "unused-measures", { now: FIXED_DATE });
  assert.ok(s.includes("no measures flagged for this category. Nothing to do"),
    "empty category should produce an explicit no-op output");
  assert.ok(!s.includes("var targets = new[]"),
    "empty category should NOT emit an empty targets array");
});

test("buildTabularEditorScript — C# string escaping for awkward characters in names", () => {
  const data = mk({
    measures: [
      mkMeasure({ table: 'T"With"Quotes', name: "M\\With\\Backslash", status: "unused" }),
    ],
  });
  const s = buildTabularEditorScript(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(s.includes('Table = "T\\"With\\"Quotes"'), "double quotes in names must be C#-escaped");
  assert.ok(s.includes('Measure = "M\\\\With\\\\Backslash"'), "backslashes in names must be C#-escaped");
});

test("buildTabularEditorScript — output ends with single trailing newline", () => {
  const data = mk({ measures: [mkMeasure({ table: "Sales", name: "Old", status: "unused" })] });
  const s = buildTabularEditorScript(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(s.endsWith("\n"));
  assert.ok(!s.endsWith("\n\n"));
});

test("buildTabularEditorScript — reminds user to Ctrl+S after run", () => {
  const data = mk({ measures: [mkMeasure({ table: "Sales", name: "Old", status: "unused" })] });
  const s = buildTabularEditorScript(data, "unused-measures", { now: FIXED_DATE });
  assert.ok(s.includes("Ctrl+S"), "TE doesn't auto-save; the script must remind the user");
});
