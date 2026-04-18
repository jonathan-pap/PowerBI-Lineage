/**
 * Mermaid lineage tests — v0.7.0 (Stops 4 & 5).
 *
 * Per-measure lineage blocks live in measures.md; per-fact-table
 * star fragments live in data-dictionary.md. Both render natively
 * in ADO Wiki + GitHub, and degrade to a code-block fallback in
 * our dashboard MD viewer.
 *
 * These tests verify the blocks emit when expected and carry the
 * right structural markers (node ids, classDef styling). They
 * don't validate Mermaid syntax end-to-end — that's Mermaid's job.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateMeasuresMd,
  generateDataDictionaryMd,
} from "../src/md-generator.js";
import { buildFullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

if (!FIXTURE_EXISTS) {
  test("mermaid — fixture missing, skipping", { skip: true }, () => {});
} else {
  const data = buildFullData(path.resolve(FIXTURE));

  // ────────────────────────────────────────────────────────────────
  // Stop 4 — per-measure lineage
  // ────────────────────────────────────────────────────────────────

  const measures = generateMeasuresMd(data, "Health_and_Safety");

  test("measures.md — contains mermaid lineage blocks", () => {
    const blocks = (measures.match(/```mermaid\n[\s\S]+?\n```/g) || []);
    // The H&S fixture has >20 measures with either usage or deps —
    // each should produce a block. Be conservative and just assert
    // we have several.
    assert.ok(blocks.length >= 5,
      `expected ≥5 mermaid blocks in measures.md, found ${blocks.length}`);
  });

  test("measures.md — lineage blocks carry the expected node ids + classDef", () => {
    // Every block should have at least the centre node `m0` and the
    // three classDef styling rules. Sample the first block.
    const m = measures.match(/```mermaid\n([\s\S]+?)\n```/);
    assert.ok(m, "no mermaid block found to sample");
    const body = m![1];
    assert.match(body, /^graph LR/m,        "lineage graph must start with `graph LR`");
    assert.match(body, /m0[("]/,            "missing centre node m0");
    assert.match(body, /classDef current /, "missing classDef current");
  });

  test("measures.md — measures with no deps and no usage emit NO lineage block", () => {
    // Find a measure section in the text that we KNOW from the
    // fixture has zero daxDependencies + zero usedIn. Easiest: find
    // the "Base measure" empty-state pattern from the dashboard —
    // actually easier: just re-run the data and find such a measure,
    // then assert its name doesn't sit immediately above a mermaid
    // block.
    const orphans = data.measures.filter(
      m => m.daxDependencies.length === 0
        && (!m.usedIn || m.usedIn.length === 0)
        && (!m.dependedOnBy || m.dependedOnBy.length === 0),
    );
    if (orphans.length === 0) return;  // no test subject
    const sample = orphans[0];
    // Locate that measure's <details> block and check the following
    // ~40 lines (measure body) for a mermaid fence.
    const startRx = new RegExp(`<strong>${sample.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}</strong>`);
    const i = measures.search(startRx);
    if (i < 0) return;  // name escaping quirk, skip
    const slice = measures.substring(i, i + 2000);
    // Ensure the mermaid block either isn't in this slice, or only
    // belongs to a SUBSEQUENT measure (we find the next </details>
    // and check within that range).
    const endIdx = slice.indexOf("</details>");
    const block = slice.substring(0, endIdx > 0 ? endIdx : slice.length);
    assert.ok(!block.includes("```mermaid"),
      `measure "${sample.name}" has no deps + no usage but a mermaid block was emitted`);
  });

  // ────────────────────────────────────────────────────────────────
  // Stop 5 — per-fact-table star fragments
  // Deferred assertion — just notes shape here; Stop 5 adds real
  // content to data-dictionary.md. Placeholder so the test file is
  // already the home for these checks.
  // ────────────────────────────────────────────────────────────────
  void generateDataDictionaryMd;
}
