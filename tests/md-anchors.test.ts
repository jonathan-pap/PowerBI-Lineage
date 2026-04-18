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
import { adoSlug } from "../src/md-generator.js";

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
void FIXTURE_EXISTS;  // referenced by Stop-2 tests; keep the import alive
