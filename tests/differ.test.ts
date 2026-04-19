/**
 * Model diff tests.
 *
 * Three layers:
 *   1. Hand-crafted pairs exercise each diff `kind` with a minimal
 *      FullData shape — catches every risk-tier decision and each
 *      entity-level code path.
 *   2. Identity test: two identical FullData snapshots must produce
 *      zero changes. Regression guard for "differ spuriously reports".
 *   3. Fixture integration: real H&S .Report folders must parse,
 *      diff, and emit MD without throwing.
 *
 * Not in scope: MD format stability (snapshot tests are fragile against
 * the label dictionary). We test the structured DiffResult and spot-
 * check key MD markers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { diffModels, type DiffChange } from "../src/differ.js";
import { renderDiffMd, renderDiffSummaryMd } from "../src/diff-md.js";
import type { FullData } from "../src/data-builder.js";
import { buildFullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

// ─────────────────────────────────────────────────────────────────────
// Minimal FullData factory — only the fields differ looks at
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the smallest FullData shape the differ accepts. Anything the
 * differ doesn't touch is stubbed to empty arrays / neutral defaults.
 * Keep this in sync with FullData; compilation will flag a drift.
 */
function mk(over: Partial<FullData> = {}): FullData {
  return {
    measures: [],
    columns: [],
    relationships: [],
    functions: [],
    calcGroups: [],
    tables: [],
    pages: [],
    hiddenPages: [],
    allPages: [],
    expressions: [],
    compatibilityLevel: null,
    modelProperties: {
      name: "m",
      description: "",
      culture: "en-US",
      sourceQueryCulture: "",
      discourageImplicitMeasures: false,
      valueFilterBehavior: "",
      cultures: [],
      defaultPowerBIDataSourceVersion: "",
    },
    totals: {
      measuresInModel: 0, measuresDirect: 0, measuresIndirect: 0, measuresUnused: 0,
      columnsInModel: 0, columnsDirect: 0, columnsIndirect: 0, columnsUnused: 0,
      relationships: 0, functions: 0, calcGroups: 0, tables: 0, pages: 0, visuals: 0,
    },
    ...over,
  } as FullData;
}

/** Find a single DiffChange by kind+key or fail with a helpful msg. */
function expectChange(result: ReturnType<typeof diffModels>, kind: string, key: string): DiffChange {
  const all = [...result.breaking, ...result.caution, ...result.safe];
  const hit = all.find(c => c.kind === kind && c.key === key);
  assert.ok(hit,
    `expected change kind="${kind}" key="${key}"; got: ${all.map(c => `${c.kind}:${c.key}`).join(", ") || "(none)"}`);
  return hit!;
}

// ─────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────

test("differ — identical FullData → zero changes", () => {
  const a = mk({
    measures: [{
      name: "M1", table: "T1", daxExpression: "1", formatString: "", description: "",
      displayFolder: "", daxDependencies: [], dependedOnBy: [], usedIn: [],
      usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
    }],
  });
  const b = JSON.parse(JSON.stringify(a));
  const r = diffModels(a, b);
  assert.equal(r.summary.total, 0);
  assert.equal(r.breaking.length, 0);
  assert.equal(r.caution.length, 0);
  assert.equal(r.safe.length, 0);
});

// ─────────────────────────────────────────────────────────────────────
// Measures
// ─────────────────────────────────────────────────────────────────────

test("differ — measure added is safe", () => {
  const a = mk();
  const b = mk({
    measures: [{
      name: "Total Sales", table: "_measures", daxExpression: "SUM(x[y])", formatString: "",
      description: "", displayFolder: "", daxDependencies: [], dependedOnBy: [],
      usedIn: [], usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
    }],
  });
  const r = diffModels(a, b);
  const c = expectChange(r, "measure-added", "_measures[Total Sales]");
  assert.equal(c.risk, "safe");
});

test("differ — measure removed is breaking with consumer list", () => {
  const dep: FullData["measures"][0] = {
    name: "Consumer", table: "_measures", daxExpression: "[Total Sales] * 2", formatString: "",
    description: "", displayFolder: "", daxDependencies: ["Total Sales"], dependedOnBy: [],
    usedIn: [], usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
  };
  const removed: FullData["measures"][0] = {
    name: "Total Sales", table: "_measures", daxExpression: "SUM(x[y])", formatString: "",
    description: "", displayFolder: "", daxDependencies: [], dependedOnBy: [],
    usedIn: [], usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
  };
  const a = mk({ measures: [removed, dep] });
  const b = mk({ measures: [dep] });
  const r = diffModels(a, b);
  const c = expectChange(r, "measure-removed", "_measures[Total Sales]");
  assert.equal(c.risk, "breaking");
  assert.deepEqual(c.consumers, ["_measures[Consumer]"]);
});

test("differ — measure DAX change is caution with unified diff body", () => {
  const base = {
    name: "M", table: "T", formatString: "", description: "", displayFolder: "",
    daxDependencies: [], dependedOnBy: [], usedIn: [], usageCount: 0, pageCount: 0,
    status: "unused" as const, externalProxy: null,
  };
  const a = mk({ measures: [{ ...base, daxExpression: "SUM(x[y])" }] });
  const b = mk({ measures: [{ ...base, daxExpression: "CALCULATE(SUM(x[y]), z[a] = 1)" }] });
  const r = diffModels(a, b);
  const c = expectChange(r, "measure-dax-changed", "T[M]");
  assert.equal(c.risk, "caution");
  assert.ok(c.diffBody && c.diffBody.includes("CALCULATE"), "diffBody should include new line");
});

test("differ — whitespace-only DAX change is NOT reported (normalised)", () => {
  const base = {
    name: "M", table: "T", formatString: "", description: "", displayFolder: "",
    daxDependencies: [], dependedOnBy: [], usedIn: [], usageCount: 0, pageCount: 0,
    status: "unused" as const, externalProxy: null,
  };
  const a = mk({ measures: [{ ...base, daxExpression: "SUM(x[y])" }] });
  const b = mk({ measures: [{ ...base, daxExpression: "SUM(x[y])\n\n\n" }] });
  const r = diffModels(a, b);
  assert.equal(r.summary.total, 0,
    "trailing whitespace alone must not trigger a DAX-change entry");
});

test("differ — measure becoming a proxy is breaking", () => {
  const base = {
    name: "M", table: "T", daxExpression: "x", formatString: "", description: "",
    displayFolder: "", daxDependencies: [], dependedOnBy: [], usedIn: [],
    usageCount: 0, pageCount: 0, status: "unused" as const,
  };
  const a = mk({ measures: [{ ...base, externalProxy: null }] });
  const b = mk({ measures: [{
    ...base,
    externalProxy: { remoteName: "X", type: "INTEGER", externalModel: "Remote", cluster: null },
  }] });
  const r = diffModels(a, b);
  const c = expectChange(r, "measure-proxy-changed", "T[M]");
  assert.equal(c.risk, "breaking");
});

// ─────────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────────

function col(over: Partial<FullData["columns"][0]> = {}): FullData["columns"][0] {
  return {
    name: "C", table: "T", dataType: "string", description: "", displayFolder: "",
    summarizeBy: "none", sortByColumn: "", dataCategory: "", formatString: "",
    isSlicerField: false, isKey: false, isHidden: false, isCalculated: false,
    usedIn: [], usageCount: 0, pageCount: 0, status: "unused",
    ...over,
  };
}

test("differ — column dataType change is breaking", () => {
  const a = mk({ columns: [col({ dataType: "string" })] });
  const b = mk({ columns: [col({ dataType: "int64" })] });
  const r = diffModels(a, b);
  const c = expectChange(r, "column-datatype-changed", "T[C]");
  assert.equal(c.risk, "breaking");
  assert.equal(c.oldValue, "string");
  assert.equal(c.newValue, "int64");
});

test("differ — column removed is breaking and finds consumers via DAX regex", () => {
  const a = mk({
    columns: [col({ name: "customer_id" })],
    measures: [{
      name: "Count", table: "_measures",
      daxExpression: "COUNTROWS(DISTINCT(T[customer_id]))", formatString: "",
      description: "", displayFolder: "", daxDependencies: [], dependedOnBy: [],
      usedIn: [], usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
    }],
  });
  const b = mk({
    measures: a.measures,  // measures still reference it — they'd break
  });
  const r = diffModels(a, b);
  const c = expectChange(r, "column-removed", "T[customer_id]");
  assert.equal(c.risk, "breaking");
  assert.ok(c.consumers && c.consumers.includes("_measures[Count]"),
    "consumer scan must catch COUNTROWS(DISTINCT(T[customer_id]))");
});

test("differ — column formatString change is safe (cosmetic only)", () => {
  const a = mk({ columns: [col({ formatString: "#,0" })] });
  const b = mk({ columns: [col({ formatString: "#,0.00" })] });
  const r = diffModels(a, b);
  const c = expectChange(r, "column-formatstring-changed", "T[C]");
  assert.equal(c.risk, "safe");
});

// ─────────────────────────────────────────────────────────────────────
// Relationships
// ─────────────────────────────────────────────────────────────────────

test("differ — relationship removed is breaking", () => {
  const r1 = { fromTable: "F", fromColumn: "k", toTable: "D", toColumn: "k", isActive: true };
  const a = mk({ relationships: [r1] });
  const b = mk();
  const r = diffModels(a, b);
  const c = expectChange(r, "relationship-removed", "F[k] → D[k]");
  assert.equal(c.risk, "breaking");
});

test("differ — relationship active flip is caution", () => {
  const r1 = { fromTable: "F", fromColumn: "k", toTable: "D", toColumn: "k", isActive: true };
  const a = mk({ relationships: [r1] });
  const b = mk({ relationships: [{ ...r1, isActive: false }] });
  const r = diffModels(a, b);
  const c = expectChange(r, "relationship-active-changed", "F[k] → D[k]");
  assert.equal(c.risk, "caution");
});

// ─────────────────────────────────────────────────────────────────────
// Calc groups
// ─────────────────────────────────────────────────────────────────────

test("differ — calc item removal is breaking; item DAX change is caution", () => {
  const cg = (items: Array<{ name: string; expression: string; ordinal?: number; formatStringExpression?: string; description?: string }>) => ({
    name: "Time",
    description: "",
    precedence: 10,
    items: items.map((i, idx) => ({
      name: i.name, expression: i.expression, ordinal: i.ordinal ?? idx,
      formatStringExpression: i.formatStringExpression ?? "", description: i.description ?? "",
    })),
  });
  const a = mk({ calcGroups: [cg([
    { name: "YTD", expression: "CALCULATE([M], DATESYTD(x))" },
    { name: "PY",  expression: "CALCULATE([M], SAMEPERIODLASTYEAR(x))" },
  ])] });
  const b = mk({ calcGroups: [cg([
    { name: "YTD", expression: "CALCULATE([M], DATESYTD(x), FILTER(x, TRUE))" },
  ])] });
  const r = diffModels(a, b);
  expectChange(r, "calcitem-removed", "Time/PY");
  const changed = expectChange(r, "calcitem-expression-changed", "Time/YTD");
  assert.equal(changed.risk, "caution");
});

// ─────────────────────────────────────────────────────────────────────
// UDFs / functions
// ─────────────────────────────────────────────────────────────────────

test("differ — UDF signature change is breaking; body change is caution", () => {
  const fn = (parameters: string, expression: string) =>
    ({ name: "helper.fn", parameters, expression, description: "" });
  const a = mk({ functions: [fn("(a: INT64)", "a * 2")] });
  const b = mk({ functions: [fn("(a: INT64, b: INT64)", "a * b")] });
  const r = diffModels(a, b);
  const sig = expectChange(r, "function-signature-changed", "helper.fn");
  assert.equal(sig.risk, "breaking");
  const body = expectChange(r, "function-body-changed", "helper.fn");
  assert.equal(body.risk, "caution");
});

test("differ — .About shim changes are ignored", () => {
  const fn = (name: string) => ({ name, parameters: "()", expression: "1", description: "" });
  const a = mk({ functions: [fn("Model.About")] });
  const b = mk();  // removed
  const r = diffModels(a, b);
  assert.equal(r.summary.total, 0,
    ".About shims are model boilerplate; their churn must not leak into PR diffs");
});

// ─────────────────────────────────────────────────────────────────────
// Model properties
// ─────────────────────────────────────────────────────────────────────

test("differ — compatibility level change is caution", () => {
  const a = mk({ compatibilityLevel: 1500 });
  const b = mk({ compatibilityLevel: 1702 });
  const r = diffModels(a, b);
  const c = expectChange(r, "model-compatibilitylevel-changed", "compatibilityLevel");
  assert.equal(c.risk, "caution");
});

// ─────────────────────────────────────────────────────────────────────
// MD rendering sanity
// ─────────────────────────────────────────────────────────────────────

test("renderDiffMd — empty result produces a no-changes message", () => {
  const md = renderDiffMd(diffModels(mk(), mk(), "a", "b"));
  assert.ok(md.includes("# Model Diff — a → b"));
  assert.ok(md.includes("No meaningful changes"));
});

test("renderDiffSummaryMd — includes tier counts and collapsible sections", () => {
  const a = mk({ measures: [{
    name: "M", table: "T", daxExpression: "1", formatString: "", description: "",
    displayFolder: "", daxDependencies: [], dependedOnBy: [], usedIn: [],
    usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
  }] });
  const b = mk();  // measure removed
  const md = renderDiffSummaryMd(diffModels(a, b, "old", "new"));
  assert.ok(md.includes("📊 Model diff · old → new"));
  assert.ok(md.includes("🔴 **1 breaking**"));
  assert.ok(md.includes("<details open"), "breaking section should be open by default");
  assert.ok(md.includes("<sub>Generated by powerbi-lineage diff</sub>"));
});

// ─────────────────────────────────────────────────────────────────────
// Sort stability — identical input must produce byte-identical output
// ─────────────────────────────────────────────────────────────────────

test("differ — output is deterministic (stable sort)", () => {
  // Insert entries in deliberately non-alphabetical order
  const a = mk();
  const b = mk({
    measures: [
      { name: "Z", table: "T", daxExpression: "1", formatString: "", description: "",
        displayFolder: "", daxDependencies: [], dependedOnBy: [], usedIn: [],
        usageCount: 0, pageCount: 0, status: "unused", externalProxy: null },
      { name: "A", table: "T", daxExpression: "1", formatString: "", description: "",
        displayFolder: "", daxDependencies: [], dependedOnBy: [], usedIn: [],
        usageCount: 0, pageCount: 0, status: "unused", externalProxy: null },
    ],
  });
  const r1 = diffModels(a, b);
  const r2 = diffModels(a, b);
  assert.deepEqual(r1.safe.map(c => c.key), r2.safe.map(c => c.key));
  assert.deepEqual(r1.safe.map(c => c.key), ["T[A]", "T[Z]"],
    "safe tier must be alphabetically sorted by key");
});

// ─────────────────────────────────────────────────────────────────────
// Fixture integration
// ─────────────────────────────────────────────────────────────────────

if (FIXTURE_EXISTS) {
  test("differ — H&S .Report parses, diffs against self, emits zero changes", () => {
    // Self-diff is the strongest regression guard: if the differ ever
    // starts reporting a change that isn't a change, this test fails.
    const d = buildFullData(path.resolve(FIXTURE));
    const r = diffModels(d, d);
    assert.equal(r.summary.total, 0,
      `self-diff must be empty; got ${r.summary.total} spurious changes: ` +
      [...r.breaking, ...r.caution, ...r.safe].map(c => c.kind).slice(0, 5).join(", "));
  });

  test("differ — H&S .Report: full MD output renders without throwing", () => {
    const d = buildFullData(path.resolve(FIXTURE));
    const r = diffModels(d, d, "a", "b");
    const md = renderDiffMd(r);
    assert.ok(md.length > 0);
    assert.ok(md.includes("# Model Diff"));
  });
}
