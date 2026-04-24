/**
 * Broken-reference detection — scans DAX for refs that don't resolve.
 *
 * Two layers:
 *   1. extractDaxRefs — a standalone regex/string-walker that pulls
 *      qualified `Table[Col]` refs and bare `[Name]` refs out of a
 *      DAX expression. Tested in isolation with commenting / string
 *      literal / nesting edge cases.
 *   2. brokenReferences — walks every measure / calc-item / UDF body
 *      and reports refs that don't resolve against the model's symbol
 *      index. Tests use synthetic FullData fragments to keep each
 *      rule independently verifiable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDaxRefs, brokenReferences } from "../src/improvements.js";
import type { FullData, ModelMeasure, ModelColumn } from "../src/data-builder.js";

// ─────────────────────────────────────────────────────────────────────
// FullData factory (minimal — mirrors improvements.test.ts)
// ─────────────────────────────────────────────────────────────────────

function mk(over: Partial<FullData> = {}): FullData {
  return {
    measures: [], columns: [], relationships: [], functions: [],
    calcGroups: [], tables: [], pages: [], hiddenPages: [],
    allPages: [], expressions: [], compatibilityLevel: null,
    modelProperties: {
      name: "m", description: "", culture: "", sourceQueryCulture: "",
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

function mkMeasure(o: Partial<ModelMeasure> = {}): ModelMeasure {
  return {
    name: "M", table: "T", daxExpression: "1", formatString: "", description: "",
    displayFolder: "", daxDependencies: [], dependedOnBy: [], usedIn: [],
    usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
    ...o,
  } as ModelMeasure;
}

function mkColumn(table: string, name: string): ModelColumn {
  return {
    name, table, dataType: "", description: "", displayFolder: "",
    summarizeBy: "", sortByColumn: "", dataCategory: "", formatString: "",
    isSlicerField: false, isKey: false, isHidden: false, isCalculated: false,
    usedIn: [], usageCount: 0, pageCount: 0, status: "unused",
  } as ModelColumn;
}

function mkTable(name: string): any {
  return {
    name, description: "", isCalcGroup: false, parameterKind: null,
    origin: "user",
    columnCount: 0, measureCount: 0, keyCount: 0, fkCount: 0, hiddenColumnCount: 0,
    columns: [], measures: [], relationships: [], partitions: [], hierarchies: [],
    isCalculatedTable: false,
  };
}

// ─────────────────────────────────────────────────────────────────────
// extractDaxRefs
// ─────────────────────────────────────────────────────────────────────

test("extractDaxRefs — qualified Table[Column] ref", () => {
  const { columnRefs, measureRefs } = extractDaxRefs("SUM(Sales[Amount])");
  assert.deepEqual(columnRefs, [{ table: "Sales", column: "Amount" }]);
  assert.deepEqual(measureRefs, []);
});

test("extractDaxRefs — quoted 'Table Name'[Column] ref", () => {
  const { columnRefs } = extractDaxRefs("SUM('Fact Sales'[Net Amount])");
  assert.deepEqual(columnRefs, [{ table: "Fact Sales", column: "Net Amount" }]);
});

test("extractDaxRefs — bare [Measure] not preceded by a table", () => {
  const { columnRefs, measureRefs } = extractDaxRefs("[Total Sales] * 0.1");
  assert.deepEqual(columnRefs, []);
  assert.deepEqual(measureRefs, ["Total Sales"]);
});

test("extractDaxRefs — qualified + bare together, deduped", () => {
  const { columnRefs, measureRefs } = extractDaxRefs(
    "DIVIDE(SUM(Sales[Amount]), [Order Count]) + [Order Count]",
  );
  assert.deepEqual(columnRefs, [{ table: "Sales", column: "Amount" }]);
  assert.deepEqual(measureRefs, ["Order Count"]);
});

test("extractDaxRefs — ignores refs inside string literals", () => {
  const { columnRefs, measureRefs } = extractDaxRefs(
    'IF([Flag], "Sales[FakeCol] and [FakeMeasure]", BLANK())',
  );
  assert.deepEqual(columnRefs, []);
  assert.deepEqual(measureRefs, ["Flag"]);
});

test("extractDaxRefs — ignores refs inside line comments", () => {
  const { columnRefs } = extractDaxRefs(
    "SUM(Sales[Amount]) // old: SUM(Sales[OldCol])",
  );
  assert.deepEqual(columnRefs, [{ table: "Sales", column: "Amount" }]);
});

test("extractDaxRefs — ignores refs inside block comments", () => {
  const { columnRefs } = extractDaxRefs(
    "SUM(Sales[Amount]) /* was: SUM(Other[Thing]) */",
  );
  assert.deepEqual(columnRefs, [{ table: "Sales", column: "Amount" }]);
});

test("extractDaxRefs — survives embedded doubled-quote string escape", () => {
  const { measureRefs } = extractDaxRefs(
    'IF([Flag], "he said ""hi""", BLANK()) + [Real]',
  );
  assert.deepEqual(measureRefs, ["Flag", "Real"]);
});

test("extractDaxRefs — empty / null-ish input is safe", () => {
  assert.deepEqual(extractDaxRefs(""), { columnRefs: [], measureRefs: [] });
  assert.deepEqual(
    extractDaxRefs(null as unknown as string),
    { columnRefs: [], measureRefs: [] },
  );
});

// ─────────────────────────────────────────────────────────────────────
// brokenReferences
// ─────────────────────────────────────────────────────────────────────

test("brokenReferences — case-insensitive resolution (DAX identifiers are case-insensitive)", () => {
  // The H&S fixture has `table fct_trcf_targets` (all lowercase) but
  // measures reference it as `'fct_TRCF_targets'[TRCF_target]`. Power BI
  // resolves this fine at runtime — our detector must too, or every
  // model with mixed-case ref habits lights up with false positives.
  const data = mk({
    tables: [mkTable("fct_trcf_targets")],
    columns: [mkColumn("fct_trcf_targets", "TRCF_target")],
    measures: [mkMeasure({
      name: "M",
      daxExpression: "MAX('fct_TRCF_targets'[TRCF_target])",
    })],
  });
  assert.deepEqual(brokenReferences(data), []);
});

test("brokenReferences — case-insensitive bare [Measure] ref", () => {
  const data = mk({
    tables: [mkTable("T")],
    measures: [
      mkMeasure({ name: "Total Sales", daxExpression: "1" }),
      mkMeasure({ name: "Caller", daxExpression: "[TOTAL SALES] * 2" }),
    ],
  });
  assert.deepEqual(brokenReferences(data), []);
});

test("brokenReferences — clean model reports nothing", () => {
  const data = mk({
    tables: [mkTable("Sales")],
    columns: [mkColumn("Sales", "Amount")],
    measures: [mkMeasure({ name: "Total", daxExpression: "SUM(Sales[Amount])" })],
  });
  assert.deepEqual(brokenReferences(data), []);
});

test("brokenReferences — flags a missing table", () => {
  const data = mk({
    tables: [mkTable("Sales")],
    columns: [mkColumn("Sales", "Amount")],
    measures: [mkMeasure({
      name: "Bad",
      daxExpression: "SUM(OldSales[Amount])",
    })],
  });
  const broken = brokenReferences(data);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].broken, "OldSales[Amount]");
  assert.match(broken[0].reason, /table/i);
});

test("brokenReferences — flags a missing column on an existing table", () => {
  const data = mk({
    tables: [mkTable("Sales")],
    columns: [mkColumn("Sales", "Amount")],
    measures: [mkMeasure({
      name: "Bad",
      daxExpression: "SUM(Sales[Revenue])",
    })],
  });
  const broken = brokenReferences(data);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].broken, "Sales[Revenue]");
  assert.match(broken[0].reason, /column/i);
});

test("brokenReferences — flags a missing bare measure ref", () => {
  const data = mk({
    tables: [mkTable("Sales")],
    columns: [mkColumn("Sales", "Amount")],
    measures: [
      mkMeasure({ name: "Total", daxExpression: "SUM(Sales[Amount])" }),
      mkMeasure({ name: "Bad", daxExpression: "[GhostMeasure] * 2" }),
    ],
  });
  const broken = brokenReferences(data);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].broken, "[GhostMeasure]");
});

test("brokenReferences — Table[Measure] qualifier is accepted when Measure exists elsewhere", () => {
  // DAX lets you qualify measures with a (not-necessarily-home) table.
  // Sales[Total] resolves as long as Total is a measure somewhere.
  const data = mk({
    tables: [mkTable("Sales")],
    columns: [mkColumn("Sales", "Amount")],
    measures: [
      mkMeasure({ name: "Total", table: "Metrics", daxExpression: "1" }),
      mkMeasure({ name: "Caller", table: "Sales", daxExpression: "Sales[Total] + 1" }),
    ],
  });
  assert.deepEqual(brokenReferences(data), []);
});

test("brokenReferences — row context bare [Col] ref resolves against any column", () => {
  // RANKX iterates over a table; the bare [Column] inside resolves in
  // row context. We accept any column-name match model-wide rather
  // than false-flag this common pattern.
  const data = mk({
    tables: [mkTable("Sales")],
    columns: [mkColumn("Sales", "Amount")],
    measures: [mkMeasure({
      name: "Ranked",
      daxExpression: "RANKX(ALL(Sales), [Amount])",
    })],
  });
  assert.deepEqual(brokenReferences(data), []);
});

test("brokenReferences — EXTERNALMEASURE proxies are skipped", () => {
  const data = mk({
    tables: [mkTable("Sales")],
    measures: [mkMeasure({
      name: "Proxy",
      daxExpression: 'EXTERNALMEASURE("Model.[Some Measure]", currency, "cluster")',
      externalProxy: { cluster: "cluster", modelName: "Model", measureName: "Some Measure" } as unknown as ModelMeasure["externalProxy"],
    })],
  });
  assert.deepEqual(brokenReferences(data), []);
});

test("brokenReferences — scans calc-group item expressions", () => {
  const data = mk({
    tables: [mkTable("Sales")],
    columns: [mkColumn("Sales", "Amount")],
    calcGroups: [{
      name: "Time",
      description: "",
      precedence: 0,
      items: [{
        name: "YTD",
        ordinal: 0,
        expression: "CALCULATE([GhostMeasure], DATESYTD(Dates[Date]))",
        formatStringExpression: "",
        description: "",
      }],
    }],
  });
  const broken = brokenReferences(data);
  const labels = broken.map(b => `${b.where}::${b.broken}`);
  assert.ok(labels.some(l => l.includes("Time · YTD") && l.includes("[GhostMeasure]")));
  assert.ok(labels.some(l => l.includes("Time · YTD") && l.includes("Dates[Date]")));
});

test("brokenReferences — scans UDF bodies", () => {
  const data = mk({
    tables: [mkTable("Sales")],
    columns: [mkColumn("Sales", "Amount")],
    functions: [{
      name: "MyFn",
      parameters: "x",
      description: "",
      expression: "SUM(Ghost[Col])",
    }],
  });
  const broken = brokenReferences(data);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].where, "Function MyFn");
  assert.equal(broken[0].broken, "Ghost[Col]");
});
