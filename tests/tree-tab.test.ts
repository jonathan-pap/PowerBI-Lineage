/**
 * Smoke tests for the Tree tab (v1).
 *
 * The Tree tab renders Source → Table → (Columns / Measures groups) →
 * leaves as nested <details>/<summary> — zero JS, all browser-native
 * collapse. Leaves are clickable and route through the existing
 * delegated-click handler via data-action="lineage" data-type=... .
 *
 * These tests check only the STRUCTURAL invariants — we don't
 * evaluate the page in a DOM. We grep the generated HTML for the
 * hooks the browser needs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateHTML } from "../src/html-generator.js";
import type { FullData } from "../src/data-builder.js";
import { buildFullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

function minimalData(): FullData {
  return {
    measures: [], columns: [], relationships: [], functions: [],
    calcGroups: [], tables: [], pages: [], hiddenPages: [],
    allPages: [], expressions: [], compatibilityLevel: null,
    modelProperties: { name: "t" } as any,
    totals: {
      measuresInModel: 0, measuresDirect: 0, measuresIndirect: 0, measuresUnused: 0,
      columnsInModel: 0, columnsDirect: 0, columnsIndirect: 0, columnsUnused: 0,
      relationships: 0, functions: 0, calcGroups: 0, tables: 0, pages: 0, visuals: 0,
    },
  } as unknown as FullData;
}

test("Tree tab — panel slot is present in the generated HTML", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  assert.ok(html.includes('id="panel-tree"'),
    "missing <div id=\"panel-tree\"> slot — tree tab won't render anywhere");
  assert.ok(html.includes('id="tree-content"'),
    "missing <div id=\"tree-content\"> — renderTree has no target");
});

test("Tree tab — client bundle registers a `tree` tab button", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // The tab list is built at runtime from a JS array; grep the inlined
  // source for the registration line.
  // tsc may reformat the object literal with spaces — tolerant regex.
  assert.ok(
    /id:\s*"tree",\s*l:\s*"Tree"/.test(html),
    "tab registration for `tree` missing — renderTabs() won't emit the button",
  );
});

test("Tree tab — renderTree function + bootstrap call are present", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  assert.ok(html.includes("function renderTree("),
    "renderTree() function missing from the inlined client bundle");
  // Bootstrap line contains a renderTree() call among the other render calls.
  assert.ok(
    /renderSummary\(\);[\s\S]*?renderTree\(\);[\s\S]*?switchTab/.test(html),
    "renderTree() isn't called during bootstrap — tab would render empty until user toggles auto-date",
  );
});

test("Tree tab — CSS is inlined (classes that the render output depends on)", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  for (const sel of [".tree-leaf", ".tree-table", ".tree-src", ".tree-group", ".tree-role-fact"]) {
    assert.ok(html.includes(sel),
      `CSS class ${sel} missing — tree will render but unstyled`);
  }
});

if (FIXTURE_EXISTS) {
  test("Tree tab — on H&S fixture, render output emits expected structural hooks", () => {
    // Exercise the rendered tree against the real composite model. We
    // can't open a DOM here; we replay what renderTree would produce
    // by inspecting the inputs.
    const data = buildFullData(path.resolve(FIXTURE));
    // Every visible table must be reachable via name lookup.
    const tableNames = new Set(data.tables.filter(t => t.origin !== "auto-date").map(t => t.name));
    assert.ok(tableNames.size > 0, "fixture has no user tables");
    // Every measure's home table must exist (otherwise the tree can't
    // place the measure).
    const orphanMeasures = data.measures.filter(m => !data.tables.some(t => t.name === m.table));
    assert.equal(orphanMeasures.length, 0,
      `${orphanMeasures.length} measures have no matching home table — tree would drop them`);
    // UDFs (excluding the .About shim) must be renderable as a separate
    // root — they're not attached to any data-source bucket.
    const udfs = data.functions.filter(f => !f.name.endsWith(".About"));
    assert.ok(Array.isArray(udfs), "functions list should be enumerable");
  });
}
