/**
 * Tests for the ADO-Wiki-compatible heading-slug algorithm used by
 * src/md-generator.ts when emitting hand-rolled TOCs and Jump-to
 * navs. The user's explicit concern on the v0.7.0 brainstorm was
 * "we need to be sure that page anchors actually work" in ADO Wiki,
 * so this file covers two layers:
 *
 *   1. Unit: adoSlug() matches Microsoft's documented rules across
 *      a matrix of pathological and typical inputs.
 *   2. Integration: each of the six generated docs is consistent
 *      with itself — every `[text](#anchor)` link resolves to a
 *      heading whose computed slug matches the anchor.
 *
 * The integration tests run against the Health_and_Safety fixture
 * when present (composite model with unusual table names — the
 * worst-case surface). On forks without the fixture the tests
 * gracefully skip.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  adoSlug,
  generateMarkdown,
  generateMeasuresMd,
  generateFunctionsMd,
  generateCalcGroupsMd,
  generateQualityMd,
  generateDataDictionaryMd,
} from "../src/md-generator.js";
import { buildFullData } from "../src/data-builder.js";

// ──────────────────────────────────────────────────────────────────
// Unit — adoSlug across the documented matrix
// ──────────────────────────────────────────────────────────────────

const cases: [string, string][] = [
  // Common patterns in our output
  ["1. Introduction",                            "1-introduction"],
  ["2. Model Architecture",                      "2-model-architecture"],
  ["Data Sources",                               "data-sources"],
  ["Document Contents",                          "document-contents"],

  // TMDL table names — mostly word chars with underscores + mixed case
  ["Date NEW",                                   "date-new"],
  ["_measures",                                  "_measures"],
  ["fct_health_safety",                          "fct_health_safety"],
  ["switch_hours_worked",                        "switch_hours_worked"],
  ["Refresh Time Stamp",                         "refresh-time-stamp"],

  // Real-world edge cases — punctuation ADO strips differently
  // from GitHub. These are the cases where our old slug() would
  // have produced wrong anchors.
  ["4. Data Dictionary — Summary",               "4-data-dictionary-summary"],
  ["Category (Type)",                            "category-type"],
  ["A, B, C",                                    "a-b-c"],
  ["Col: Description",                           "col-description"],
  ["Sales / Cost",                               "sales-cost"],
  ["Who's Who",                                  "whos-who"],
  ["DAX `expression`",                           "dax-expression"],
  ["What?!",                                     "what"],

  // Multi-space + leading/trailing whitespace
  ["  Extra   Spaces  ",                         "extra-spaces"],

  // Auto-date Power BI table names with GUIDs
  ["LocalDateTable_10a54981-0e64-4feb-819e-b53b1ed412a0",
   "localdatetable_10a54981-0e64-4feb-819e-b53b1ed412a0"],
];

for (const [input, expected] of cases) {
  test(`adoSlug(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
    assert.equal(adoSlug(input), expected);
  });
}

// ──────────────────────────────────────────────────────────────────
// Integration — the H&S fixture is consistent with itself
//
// Extract every [text](#anchor) link from each generated doc and
// verify the anchor matches adoSlug() of some heading in that same
// doc. Deferred to Stop 2 when the MD generators switch to
// adoSlug() for their anchor derivation. Stop 1 is unit-only.
// ──────────────────────────────────────────────────────────────────

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

/**
 * Extract every heading from an MD body. Returns the slug each
 * heading will produce on ADO Wiki / GitHub / our dashboard. One
 * pitfall: markdown inside fenced ``` blocks can look like a
 * heading but isn't. The check `fenced` suppresses that confusion.
 */
function headingSlugs(md: string): Set<string> {
  const slugs = new Set<string>();
  const lines = md.split(/\r?\n/);
  let fenced = false;
  for (const ln of lines) {
    if (/^```/.test(ln)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^#{1,6}\s+(.+)$/.exec(ln);
    if (m) slugs.add(adoSlug(m[1].replace(/\s+$/, "")));
  }
  return slugs;
}

/** Extract every `[text](#anchor)` reference from an MD body. */
function anchorRefs(md: string): string[] {
  const refs: string[] = [];
  const rx = /\[[^\]]*\]\(#([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(md))) refs.push(m[1]);
  return refs;
}

/** Also gather explicit `<a id="...">` declarations — they extend the
 *  set of valid targets even when no heading exists (used inside
 *  <details> where the <details> itself isn't heading-anchorable). */
function explicitAnchors(md: string): Set<string> {
  const out = new Set<string>();
  const rx = /<a\s+id="([^"]+)"\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(md))) out.add(m[1]);
  return out;
}

const docs: Array<{ name: string; md: () => string }> = FIXTURE_EXISTS ? (() => {
  const data = buildFullData(path.resolve(FIXTURE));
  const reportName = "Health_and_Safety";
  return [
    { name: "model.md",          md: () => generateMarkdown(data, reportName) },
    { name: "measures.md",       md: () => generateMeasuresMd(data, reportName) },
    { name: "functions.md",      md: () => generateFunctionsMd(data, reportName) },
    { name: "calc-groups.md",    md: () => generateCalcGroupsMd(data, reportName) },
    { name: "quality.md",        md: () => generateQualityMd(data, reportName) },
    { name: "data-dictionary.md", md: () => generateDataDictionaryMd(data, reportName) },
  ];
})() : [];

for (const { name, md } of docs) {
  test(`${name} — every [text](#anchor) resolves to a heading or <a id>`, () => {
    const body = md();
    const headings = headingSlugs(body);
    const explicit = explicitAnchors(body);
    const refs = anchorRefs(body);
    const unresolved = refs.filter(r => !headings.has(r) && !explicit.has(r));
    assert.equal(
      unresolved.length,
      0,
      `Broken anchors in ${name}:\n  ${unresolved.join("\n  ")}\n` +
      `(If these should resolve, either adjust the heading text or ` +
      `fix the hand-rolled link to match adoSlug of the heading.)`
    );
  });
}

if (FIXTURE_EXISTS) {
  test("no <a id> emitted right after a heading (redundant)", () => {
    const bodies = docs.map(d => d.md());
    // `## Something\n<a id="...">` is redundant — the heading already
    // auto-anchors. Stop 2 removed three such sites; this test fires
    // if anyone reintroduces the pattern.
    const redundantRx = /^##+\s+[^\n]+\n<a\s+id=/m;
    for (const body of bodies) {
      const m = body.match(redundantRx);
      assert.equal(m, null,
        `Found redundant <a id> right after a heading (use heading auto-slug instead):\n  ${m?.[0]}`);
    }
  });
}
