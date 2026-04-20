/**
 * Tests for the <script>const DATA = ...;</script> embed in
 * generateHTML. The contract: no user-supplied string in the FullData
 * payload can break out of its surrounding <script> block, even with
 * adversarial content like </script>, -->, or U+2028/2029 line
 * terminators.
 *
 * This is the Stop-3 regression net. Without safeJSON, a measure with
 * description `foo</script><script>alert(1)</script>bar` would close
 * the embedding block prematurely and let attacker-controlled JS run
 * on dashboard load.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHTML } from "../src/html-generator.js";
import type { FullData } from "../src/data-builder.js";

// ──────────────────────────────────────────────────────────────────────
// Minimal FullData factory
// ──────────────────────────────────────────────────────────────────────

/**
 * Build a tiny but type-valid FullData with a single measure whose
 * description is the caller-supplied payload. Everything else is
 * defaulted to empty arrays / safe primitives so the test focuses on
 * the one dangerous field.
 */
function buildFullDataWithPayload(payload: string): FullData {
  const measure = {
    name: "TestMeasure",
    table: "TestTable",
    daxExpression: "1",
    formatString: "",
    description: payload, // ← the dangerous field
    daxDependencies: [],
    usedIn: [],
    usageCount: 0,
    pageCount: 0,
    status: "unused" as const,
    dependedOnBy: [],
  };
  return {
    measures: [measure],
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
    modelProperties: { name: "Test", description: "" } as any,
    totals: {
      measuresInModel: 1,
      measuresDirect: 0,
      measuresIndirect: 0,
      measuresUnused: 1,
      columnsInModel: 0,
      columnsDirect: 0,
      columnsIndirect: 0,
      columnsUnused: 0,
      relationships: 0,
      functions: 0,
      calcGroups: 0,
      tables: 0,
      pages: 0,
      visuals: 0,
    },
  } as unknown as FullData;
}

/**
 * Extract the raw text of the first `<script>const DATA=...;` block.
 * We use indexOf rather than a parser because we're specifically
 * checking for premature termination — a tolerant HTML parser would
 * mask the bug we're testing against.
 */
function extractDataEmbed(html: string): string {
  const marker = "const DATA=";
  const start = html.indexOf(marker);
  assert.ok(start >= 0, "DATA embed not found in generated HTML");
  // Find the matching closing </script> that follows.
  const end = html.indexOf("</script>", start);
  assert.ok(end > start, "no </script> found after DATA embed");
  return html.slice(start, end);
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

test("generateHTML — </script> in description cannot close the embed block", () => {
  const payload = "foo</script><script>alert(1)</script>bar";
  const html = generateHTML(
    buildFullDataWithPayload(payload),
    "TestReport",
    "", "", "", "", "", "",
    "0.0.0-test"
  );
  const embed = extractDataEmbed(html);
  // The raw payload must NOT appear in the embed block — it should be
  // escaped to \u003c/script\u003e or similar.
  assert.ok(
    !embed.includes("</script>"),
    "raw </script> leaked into embed: " + embed.slice(0, 300)
  );
  assert.ok(
    !embed.includes("<script>alert"),
    "raw <script> leaked into embed"
  );
});

test("generateHTML — HTML comment close --> in description cannot break an outer comment", () => {
  const payload = "start<!--inner-->end";
  const html = generateHTML(
    buildFullDataWithPayload(payload),
    "TestReport",
    "", "", "", "", "", "",
    "0.0.0-test"
  );
  const embed = extractDataEmbed(html);
  assert.ok(!embed.includes("-->"), "raw --> leaked into embed");
});

test("generateHTML — U+2028 in description is escaped (JS line-terminator)", () => {
  const payload = "line1\u2028line2\u2029end";
  const html = generateHTML(
    buildFullDataWithPayload(payload),
    "TestReport",
    "", "", "", "", "", "",
    "0.0.0-test"
  );
  const embed = extractDataEmbed(html);
  assert.ok(!embed.includes("\u2028"), "raw U+2028 leaked into embed");
  assert.ok(!embed.includes("\u2029"), "raw U+2029 leaked into embed");
});

test("generateHTML — adversarial payload round-trips via Function()", () => {
  // Simulates a browser parsing <script>const DATA=...;</script> — we
  // extract just the JSON portion and evaluate it. The reconstructed
  // description must equal the original payload.
  const payload = `trouble: </script> then -->, then 'quotes' + "more" + \u2028 + \\slashes\\`;
  const html = generateHTML(
    buildFullDataWithPayload(payload),
    "TestReport",
    "", "", "", "", "", "",
    "0.0.0-test"
  );
  // Pull out the JSON blob that follows `const DATA=` and precedes `;\n`
  const marker = "const DATA=";
  const start = html.indexOf(marker) + marker.length;
  // The embed ends at the first `;` that is followed by a newline and
  // the next `const` declaration. Using a safe-ish locator.
  const end = html.indexOf(";\nconst MARKDOWN=", start);
  assert.ok(end > start, "could not locate end of DATA embed");
  const blob = html.slice(start, end);

  const reconstructed = Function("return " + blob + ";")();
  assert.equal(reconstructed.measures[0].description, payload);
});

test("generateHTML — reportName with </script> also safe", () => {
  // reportName is its own safeJSON splice; verify that path too.
  const html = generateHTML(
    buildFullDataWithPayload("ok"),
    "Report</script><script>x()",
    "", "", "", "", "", "",
    "0.0.0-test"
  );
  // Find the REPORT_NAME= line
  const marker = "const REPORT_NAME=";
  const start = html.indexOf(marker);
  assert.ok(start >= 0, "REPORT_NAME embed not found");
  const endOfLine = html.indexOf("\n", start);
  const line = html.slice(start, endOfLine);
  assert.ok(
    !line.includes("</script>"),
    "raw </script> leaked into REPORT_NAME: " + line
  );
});

test("generateHTML — markdown payload containing </script> is safe", () => {
  // Markdown literals are their own safeJSON splice; verify.
  const malicious = "# Heading\n\n</script><script>alert('md')</script>";
  const html = generateHTML(
    buildFullDataWithPayload("ok"),
    "TestReport",
    malicious,   // modelMd
    malicious,   // measuresMd
    malicious,   // functionsMd
    malicious,   // calcGroupsMd
    malicious,   // dataDictionaryMd
    "0.0.0-test"
  );
  // Count </script> occurrences: the file has several legitimate
  // closing tags (one per <script> block). The malicious one would
  // add six more (one per markdown literal). Assert the count is the
  // legitimate baseline — not inflated by injected tags.
  const rawCount = (html.match(/<\/script>/g) || []).length;
  // Generate an identical HTML with a benign markdown to compare.
  const baseline = generateHTML(
    buildFullDataWithPayload("ok"),
    "TestReport",
    "# safe", "# safe", "# safe", "# safe", "# safe", "# safe",
    "0.0.0-test"
  );
  const baselineCount = (baseline.match(/<\/script>/g) || []).length;
  assert.equal(
    rawCount,
    baselineCount,
    `adversarial markdown inflated </script> count: ${rawCount} vs ${baselineCount}`
  );
});
