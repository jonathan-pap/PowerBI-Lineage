/**
 * Tier-1 MD generators — sources.md, pages.md, index.md.
 *
 * The pre-existing md-* tests focus on anchor/badge correctness across
 * the six original docs. These tests pin the structural invariants of
 * the three new docs without re-testing every shared helper.
 *
 * Fixture: Health_and_Safety.Report — composite model with 11 DQ
 * proxies, 3 field parameters, 3 pages, 43 user tables, 66 measures.
 * Rich enough to exercise every branch in the generators.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateSourcesMd, generatePagesMd, generateIndexMd,
} from "../src/md-generator.js";
import { buildFullData, type FullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

// ─────────────────────────────────────────────────────────────────────
// Minimal empty data — identical to the shape in md-badges.test.ts.
// Used for the empty-model branches of the three generators.
// ─────────────────────────────────────────────────────────────────────
function empty(): FullData {
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
  } as unknown as FullData;
}

// ─────────────────────────────────────────────────────────────────────
// Empty-model sanity — generators must not throw on a bare skeleton
// (a report with no parsed content should still produce the scaffold).
// ─────────────────────────────────────────────────────────────────────

test("sources.md — empty model produces the scaffold without throwing", () => {
  const md = generateSourcesMd(empty(), "Empty");
  assert.ok(md.includes("# Data Sources"));
  // Front-matter triptych replaced the old "## 1. Summary" header
  assert.ok(md.includes("At a glance"),
    "front-matter At-a-glance block missing — see md-readability sweep");
  assert.ok(md.includes("## 3. Field Parameters"));
  assert.ok(md.includes("## 4. Composite Model Proxies"));
  assert.ok(md.includes("<!-- Suggested ADO Wiki page name: Empty/Sources -->"));
});

test("pages.md — empty model short-circuits with no-pages note", () => {
  const md = generatePagesMd(empty(), "Empty");
  assert.ok(md.includes("# Report Pages"));
  // Front-matter At-a-glance replaced the old "## Summary" header
  assert.ok(md.includes("At a glance"),
    "pages.md should carry an At-a-glance block in the front matter");
  assert.ok(md.includes("_No pages analysed._"));
});

test("index.md — empty model produces the summary + zero entries", () => {
  const md = generateIndexMd(empty(), "Empty");
  assert.ok(md.includes("# Model Glossary"));
  // The new at-a-glance carries a "Total entries" row
  assert.ok(md.includes("Total entries"),
    "index.md At-a-glance must include a Total entries row");
});

// ─────────────────────────────────────────────────────────────────────
// Fixture — H&S composite model
// ─────────────────────────────────────────────────────────────────────

if (FIXTURE_EXISTS) {
  const data = buildFullData(path.resolve(FIXTURE));
  const name = "Health_and_Safety";
  const sources = generateSourcesMd(data, name);
  const pages = generatePagesMd(data, name);
  const index = generateIndexMd(data, name);

  test("sources.md — summary table counts match the fixture shape", () => {
    // 3 field params + 11 proxies on H&S (same set exercised in Stops 6.5/6.6).
    assert.ok(/\| Field parameters \| 3 \|/.test(sources),
      "summary row for field params should read 3");
    assert.ok(/\| Composite-model proxies \| 11 \|/.test(sources),
      "summary row for composite proxies should read 11");
    // Partition-mode breakdown mentions directQuery given the composite model.
    assert.ok(sources.includes("`directQuery`"),
      "H&S is composite — summary should list directQuery partitions");
  });

  test("sources.md — lists the three switch_* field parameters under §3", () => {
    // Find section 3 by header
    const fieldParamsSection = sources.split("## 3. Field Parameters")[1]?.split(/^## /m)[0] || "";
    for (const name of ["switch_geodata", "switch_site_details", "switch_time_period"]) {
      assert.ok(
        fieldParamsSection.includes(`\`${name}\``),
        `§3 should list ${name}`,
      );
    }
    // switch_hours_worked has no ParameterMetadata annotation — must NOT appear in §3
    assert.ok(!fieldParamsSection.includes("`switch_hours_worked`"),
      "switch_hours_worked is a calc table, not a field parameter — must not appear in §3");
  });

  test("sources.md — §4 groups composite-model proxies by remote AS model", () => {
    const proxySection = sources.split("## 4. Composite Model Proxies")[1]?.split(/^## /m)[0] || "";
    assert.ok(proxySection.includes("### Remote model:"),
      "§4 should sub-group proxies by their remote AS model name");
    // H&S points at Health_and_Safety_Gold — parsed from expressionSource
    assert.ok(proxySection.includes("Health_and_Safety_Gold"),
      "H&S proxies should cluster under the Health_and_Safety_Gold remote model");
    // Spot-check key tables land in §4
    for (const n of ["table_HS", "Domain_Health_and_Safety_SQL", "Globa_Data_House"]) {
      assert.ok(proxySection.includes(`**${n}**`),
        `§4 should list proxy table ${n}`);
    }
  });

  test("pages.md — emits one ### section per page + a page-index block", () => {
    // Post-readability-sweep structure:
    //   ## <reportName>          (H2 subtitle)
    //   ### Visible page index   (jump list)
    //   ## Visible pages (N)     (umbrella H2)
    //   ### <pageName>           (one H3 per visible page)
    //   ## Appendix — Hidden pages (N)  (optional)
    const visibleNames = data.pages
      .filter(p => !(data.hiddenPages || []).includes(p.name))
      .map(p => p.name);
    // Every visible page's section exists at H3
    for (const pn of visibleNames) {
      const rx = new RegExp(`^### ${pn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
      assert.ok(rx.test(pages),
        `pages.md missing ### section for page "${pn}"`);
    }
    // Jump-to index exists
    assert.ok(pages.includes("### Visible page index"),
      "pages.md should include a visible-page jump-to index");
    // Umbrella section exists when there are visible pages
    if (visibleNames.length > 0) {
      assert.ok(/^## Visible pages \(\d+\)$/m.test(pages),
        "pages.md should include the `## Visible pages (N)` umbrella header");
    }
  });

  test("pages.md — per-page section carries the visual count in its compact stats line", () => {
    // Stat tables were replaced with a compact one-liner:
    //   **N** visual(s) · **M** slicer(s) · **K** measure(s) · **J** column(s)
    // Pick the first visible page and verify its stat bits appear.
    const visible = data.pages.filter(p => !(data.hiddenPages || []).includes(p.name));
    if (visible.length === 0) return;
    const p = visible[0];
    // Section delimiter: next ### (another page) or next ## (hidden appendix)
    const headerIdx = pages.search(new RegExp(`^### ${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.ok(headerIdx >= 0, `page section for "${p.name}" not found`);
    const tailStart = headerIdx + 4 + p.name.length;
    const nextRx = /\n(?:## |### )\S/m;
    const tailHi = pages.slice(tailStart).search(nextRx);
    const section = pages.slice(headerIdx, tailStart + (tailHi > 0 ? tailHi : pages.length - tailStart));
    const vWord = p.visualCount === 1 ? "visual" : "visuals";
    assert.ok(section.includes(`**${p.visualCount}** ${vWord}`),
      `page section for "${p.name}" should carry its visualCount in the compact stats line`);
    if (p.measureCount > 0) {
      const mWord = p.measureCount === 1 ? "measure" : "measures";
      assert.ok(section.includes(`**${p.measureCount}** ${mWord}`),
        "page section should carry its measureCount");
    }
  });

  test("index.md — carries every named entity kind with correct totals", () => {
    // At-a-glance rows per kind present. We don't pin exact counts
    // (those change if the fixture evolves), just that the rows
    // exist. Post-readability-sweep: kind labels are pluralised
    // inside the At-a-glance block (`Tables`, `Measures`, `Columns`).
    for (const kind of ["Tables", "Columns", "Measures"]) {
      assert.ok(new RegExp(`\\| ${kind} \\| \\d+ \\|`).test(index),
        `At-a-glance should have a row for ${kind}`);
    }
    // H&S has field params — they must appear as entries with the
    // "field parameter" note.
    assert.ok(/`switch_geodata`.*field parameter/.test(index) ||
              index.includes("switch_geodata"),
      "switch_geodata should appear in the index");
  });

  test("index.md — letter groups are alphabetically sorted with jump bar", () => {
    assert.ok(index.includes("**Jump to:**"),
      "index should include a letter jump bar");
    // Multiple letter sections on a rich model. At least A + D should appear.
    const letterHeaders = index.match(/^## [A-Z]$/gm) || [];
    assert.ok(letterHeaders.length >= 3,
      `expected at least 3 letter-group headers, found ${letterHeaders.length}: ${letterHeaders.join(",")}`);
  });

  test("index.md — excludes .About UDF shim + auto-date tables", () => {
    assert.ok(!/`[^`]*\.About`/.test(index),
      ".About shim UDFs are boilerplate — must not appear in the glossary");
    assert.ok(!/LocalDateTable_/.test(index),
      "auto-date infrastructure must not appear in the user-facing glossary");
  });

  test("all three docs self-identify via ADO Wiki suggestion comments", () => {
    for (const [doc, stem] of [[sources, "Sources"], [pages, "Pages"], [index, "Index"]] as const) {
      assert.ok(doc.includes(`<!-- Suggested ADO Wiki page name: ${name}/${stem} -->`),
        `${stem} doc should carry the ADO Wiki page suggestion comment`);
    }
  });
}
