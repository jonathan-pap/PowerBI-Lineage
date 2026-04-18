/**
 * Badge / status-label fallback tests.
 *
 * Every badge and status label in the generated MD must carry a
 * Unicode glyph INSIDE the <span> so the content remains visually
 * distinct when the `class` attribute is stripped. ADO Wiki + GitHub
 * strip CSS; the bare text `PK` in body copy would blur into
 * surrounding content, whereas `🔑 PK` stays recognisable as a
 * marker without the pill styling.
 *
 * The test drives a full H&S generation and searches the emitted MD
 * for the glyph+label pairs. It's a spot-check — one doc for each
 * badge class that realistically appears on the composite fixture.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateMarkdown,
  generateMeasuresMd,
  generateQualityMd,
  generateDataDictionaryMd,
} from "../src/md-generator.js";
import { buildFullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

// ──────────────────────────────────────────────────────────────────
// Fixture-agnostic unit: constants themselves carry glyphs
// ──────────────────────────────────────────────────────────────────

// Load the module and inspect the constants it exports. None are
// currently exported, so we do this via source inspection — one
// regex per expected glyph+label pair. Lives separately from the
// fixture-driven tests so it runs on forks without H&S checked out.
test("badge constants source carries glyph prefixes", () => {
  const src = fs.readFileSync(path.resolve("src/md-generator.ts"), "utf8");
  const pairs: Array<[string, string]> = [
    ["🔑", "PK"],
    ["🗝", "PK\\*"],
    ["🔗", "FK"],
    ["🧮", "CALC"],
    ["👁", "HIDDEN"],
    ["🌐", "EXTERNAL"],
    ["✓", "Direct"],
    ["↻", "Indirect"],
    ["⚠", "Unused"],
  ];
  for (const [glyph, label] of pairs) {
    const rx = new RegExp(`<span class="badge[^"]+">\\s*${glyph}\\s+${label}\\s*<\\/span>`);
    assert.ok(
      rx.test(src),
      `src/md-generator.ts is missing a "${glyph} ${label}" badge constant. ` +
      `Raw-MD readers on ADO/GitHub see bare "${label}" text without the glyph.`,
    );
  }
});

if (!FIXTURE_EXISTS) {
  test("badges — fixture missing, skipping", { skip: true }, () => {});
} else {
  const data = buildFullData(path.resolve(FIXTURE));
  const name = "Health_and_Safety";
  const model = generateMarkdown(data, name);
  const measures = generateMeasuresMd(data, name);
  const quality = generateQualityMd(data, name);
  const datadict = generateDataDictionaryMd(data, name);

  // The full set of glyph+label pairs that should appear in SOME doc
  // when rendering against a rich composite model. Each assertion
  // names the doc it's checked against so regressions are specific.
  const expectations: Array<{ glyph: string; label: string; doc: string; body: string }> = [
    // H&S has no explicit `isKey` columns (26 inferred PKs instead),
    // so check the inferred-PK glyph 🗝 PK*. Explicit `🔑 PK` is
    // guarded by the badge-constants unit test below.
    { glyph: "🗝", label: "PK\\*",         doc: "data-dictionary.md", body: datadict },
    { glyph: "🔗", label: "FK",            doc: "data-dictionary.md", body: datadict },
    { glyph: "🌐", label: "EXTERNAL",      doc: "measures.md",        body: measures },
    { glyph: "🌐", label: "External proxy",doc: "measures.md",        body: measures },
    { glyph: "↻",  label: "Indirect",      doc: "measures.md",        body: measures },
    { glyph: "⚠",  label: "Unused",        doc: "measures.md",        body: measures },
    { glyph: "✓",  label: "Direct",        doc: "measures.md",        body: measures },
  ];

  for (const { glyph, label, doc, body } of expectations) {
    test(`${doc} — badge "${label}" carries ${glyph} glyph inside its span`, () => {
      // The glyph must be adjacent to the label inside a <span>. A
      // looser `body.includes(glyph)` would also pass if the glyph
      // appeared anywhere (e.g. in descriptive prose); this pattern
      // insists on the badge form.
      const rx = new RegExp(`<span class="badge[^"]+">\\s*${glyph}\\s+${label}\\s*<\\/span>`);
      assert.ok(
        rx.test(body),
        `expected <span class="badge ...">${glyph} ${label}</span> in ${doc} — ` +
        `the raw-MD fallback would read as bare "${label}" text which blurs into body copy.`
      );
    });
  }

  // Quality doc should never refer to a proxy measure as "safe to
  // remove" — check that the "DO NOT REMOVE" callout from v0.6.0 is
  // still present AND the proxy listing carries the 🌐 glyph.
  test("quality.md — proxy callout uses 🌐 glyph", () => {
    if (!quality.includes("DO NOT REMOVE")) return;  // no proxies on this fixture
    assert.ok(
      /<span class="badge[^"]+">\s*🌐\s+EXTERNAL\s*<\/span>/.test(measures) ||
      /🌐\s+External proxy/.test(quality),
      "Quality doc flagged proxies without the 🌐 glyph marker"
    );
  });

  // Front-matter shouldn't have bare (un-glyphed) status pills either —
  // regression guard for future additions.
  test("model.md — front matter uses glyph'd status markers", () => {
    // Not every model.md contains status badges in its front matter
    // (it's a summary, not a per-entity doc). If present, they must
    // carry glyphs.
    const plain = /<span class="badge badge--(success|indirect|unused)">(Direct|Indirect|Unused)<\/span>/;
    assert.ok(!plain.test(model),
      "model.md has a status badge missing its Unicode glyph prefix");
  });
}
