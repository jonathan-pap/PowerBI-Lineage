/**
 * Tests for the pure helpers in src/browser/pair-picker.ts.
 *
 * These functions used to live as private nested helpers inside
 * `showPairPicker()` in entry.ts — extracted during /sc:analyze's P1
 * recommendation so their branches could be covered without jsdom.
 *
 * Every test here is DOM-free: the module is pure string/Map/json
 * transformations by construction. A live-DOM smoke is deliberately
 * out of scope — entry.ts's orchestration layer still needs
 * manual / browser-based verification.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NONE_VALUE,
  reportPrefix,
  scanPairCandidates,
  findReportRoot,
  validatePair,
  findBestModelForReport,
  findBestReportForModel,
  filterAndRemount,
  installModelOnlyShim,
  installReportOnlyShim,
  computePickerDefaults,
  buildPickerCardHtml,
  classifyLoadMode,
  escForAttr,
  type PairCandidates,
} from "../src/browser/pair-picker.js";

// ─────────────────────────────────────────────────────────────────────
// Fixtures — small VFS maps we reuse across tests
// ─────────────────────────────────────────────────────────────────────

/** A minimally-valid pbir JSON pointing at the given model basename. */
function pbir(modelBase: string): string {
  return JSON.stringify({
    version: "1.0",
    datasetReference: { byPath: { path: `../${modelBase}` } },
  });
}

/** Build a VFS that contains one paired project under /virt/<pickedName>/. */
function singlePairVfs(pickedName: string, prefix: string): Map<string, string> {
  const root = `/virt/${pickedName}`;
  const m = new Map<string, string>();
  m.set(`${root}/${prefix}.Report/definition.pbir`, pbir(`${prefix}.SemanticModel`));
  m.set(`${root}/${prefix}.Report/report.json`, "{}");
  m.set(`${root}/${prefix}.SemanticModel/definition/tables/fact.tmdl`, "table fact\n");
  return m;
}

// ─────────────────────────────────────────────────────────────────────
// reportPrefix — strip either suffix
// ─────────────────────────────────────────────────────────────────────

test("reportPrefix strips .Report suffix (case-insensitive)", () => {
  assert.equal(reportPrefix("training.Report"), "training");
  assert.equal(reportPrefix("Health_and_Safety.REPORT"), "Health_and_Safety");
});

test("reportPrefix strips .SemanticModel suffix", () => {
  assert.equal(reportPrefix("training.SemanticModel"), "training");
  assert.equal(reportPrefix("My_Model.semanticmodel"), "My_Model");
});

test("reportPrefix leaves other strings unchanged", () => {
  assert.equal(reportPrefix("training"), "training");
  assert.equal(reportPrefix(""), "");
  assert.equal(reportPrefix("Report.Thing"), "Report.Thing"); // not a suffix
});

// ─────────────────────────────────────────────────────────────────────
// escForAttr — attribute-safe
// ─────────────────────────────────────────────────────────────────────

test("escForAttr escapes the five attribute-dangerous characters", () => {
  assert.equal(escForAttr(`a<b>c&d"e'f`), "a&lt;b&gt;c&amp;d&quot;e&#39;f");
});

test("escForAttr leaves safe strings alone", () => {
  assert.equal(escForAttr("safe_string/with.dots"), "safe_string/with.dots");
});

// ─────────────────────────────────────────────────────────────────────
// scanPairCandidates — happy paths + edge cases
// ─────────────────────────────────────────────────────────────────────

test("scanPairCandidates finds one pair at the top level", () => {
  const vfs = singlePairVfs("parent", "training");
  const c = scanPairCandidates(vfs, "parent");
  assert.deepEqual(c.reports, ["/virt/parent/training.Report"]);
  assert.deepEqual(c.semanticModels, ["/virt/parent/training.SemanticModel"]);
});

test("scanPairCandidates finds multiple pairs sorted alphabetically", () => {
  const vfs = new Map<string, string>();
  for (const name of ["bar-charts", "kpi-cards", "training"]) {
    for (const [k, v] of singlePairVfs("parent", name)) vfs.set(k, v);
  }
  const c = scanPairCandidates(vfs, "parent");
  assert.deepEqual(c.reports.map(p => p.split("/").pop()),
    ["bar-charts.Report", "kpi-cards.Report", "training.Report"]);
  assert.deepEqual(c.semanticModels.map(p => p.split("/").pop()),
    ["bar-charts.SemanticModel", "kpi-cards.SemanticModel", "training.SemanticModel"]);
});

test("scanPairCandidates dedupes — each directory appears once even with many files", () => {
  const vfs = new Map<string, string>();
  for (let i = 0; i < 10; i++) {
    vfs.set(`/virt/parent/training.Report/file${i}.json`, "{}");
    vfs.set(`/virt/parent/training.SemanticModel/file${i}.tmdl`, "");
  }
  const c = scanPairCandidates(vfs, "parent");
  assert.equal(c.reports.length, 1);
  assert.equal(c.semanticModels.length, 1);
});

test("scanPairCandidates handles nested project layout", () => {
  const vfs = new Map<string, string>();
  vfs.set("/virt/root/workspace/myproj.Report/report.json", "{}");
  vfs.set("/virt/root/workspace/myproj.SemanticModel/definition/tables/t.tmdl", "");
  const c = scanPairCandidates(vfs, "root");
  assert.equal(c.reports.length, 1);
  assert.ok(c.reports[0].endsWith("myproj.Report"));
});

test("scanPairCandidates returns empty arrays for a VFS with no PBIP dirs", () => {
  const vfs = new Map<string, string>([
    ["/virt/parent/notes.txt", "hi"],
    ["/virt/parent/package.json", "{}"],
  ]);
  const c = scanPairCandidates(vfs, "parent");
  assert.equal(c.reports.length, 0);
  assert.equal(c.semanticModels.length, 0);
});

// ─────────────────────────────────────────────────────────────────────
// findReportRoot — legacy shallowest-match helper
// ─────────────────────────────────────────────────────────────────────

test("findReportRoot returns the shallowest .Report dir", () => {
  const vfs = new Map<string, string>();
  vfs.set("/virt/p/outer.Report/report.json", "{}");
  vfs.set("/virt/p/workspace/inner.Report/report.json", "{}");
  const found = findReportRoot(vfs, "p");
  assert.equal(found, "/virt/p/outer.Report");
});

test("findReportRoot returns null when no .Report exists", () => {
  const vfs = new Map<string, string>([["/virt/p/nothing.txt", ""]]);
  assert.equal(findReportRoot(vfs, "p"), null);
});

// ─────────────────────────────────────────────────────────────────────
// validatePair — three tiers
// ─────────────────────────────────────────────────────────────────────

test("validatePair returns paired/pbir when the pbir pointer matches", () => {
  const vfs = singlePairVfs("p", "training");
  const v = validatePair(vfs, "/virt/p/training.Report", "/virt/p/training.SemanticModel");
  assert.equal(v.kind, "paired");
  if (v.kind === "paired") assert.equal(v.reason, "pbir");
});

test("validatePair returns paired/prefix when no pbir but names match", () => {
  const vfs = new Map<string, string>();
  // No pbir file — forces the prefix fallback
  vfs.set("/virt/p/training.Report/report.json", "{}");
  vfs.set("/virt/p/training.SemanticModel/definition/tables/t.tmdl", "");
  const v = validatePair(vfs, "/virt/p/training.Report", "/virt/p/training.SemanticModel");
  assert.equal(v.kind, "paired");
  if (v.kind === "paired") assert.equal(v.reason, "prefix");
});

test("validatePair returns mismatch when pbir points at a different model", () => {
  const vfs = new Map<string, string>();
  vfs.set("/virt/p/training.Report/definition.pbir", pbir("OtherModel.SemanticModel"));
  const v = validatePair(vfs, "/virt/p/training.Report", "/virt/p/training.SemanticModel");
  assert.equal(v.kind, "mismatch");
  if (v.kind === "mismatch") {
    assert.equal(v.expected, "OtherModel.SemanticModel");
    assert.match(v.message, /points to "OtherModel\.SemanticModel"/);
  }
});

test("validatePair handles malformed pbir by falling through to prefix", () => {
  const vfs = new Map<string, string>();
  vfs.set("/virt/p/training.Report/definition.pbir", "{ not valid json");
  const v = validatePair(vfs, "/virt/p/training.Report", "/virt/p/training.SemanticModel");
  assert.equal(v.kind, "paired"); // fell through to prefix
});

test("validatePair returns mismatch when nothing aligns", () => {
  const vfs = new Map<string, string>();
  // No pbir, names don't match
  const v = validatePair(vfs, "/virt/p/alpha.Report", "/virt/p/beta.SemanticModel");
  assert.equal(v.kind, "mismatch");
  if (v.kind === "mismatch") {
    assert.equal(v.expected, "alpha.SemanticModel");
  }
});

// ─────────────────────────────────────────────────────────────────────
// findBestModelForReport — Report → Model auto-select
// ─────────────────────────────────────────────────────────────────────

test("findBestModelForReport uses pbir pointer when available", () => {
  const vfs = new Map<string, string>();
  vfs.set("/virt/p/one.Report/definition.pbir", pbir("two.SemanticModel"));
  const candidates: PairCandidates = {
    reports: ["/virt/p/one.Report"],
    semanticModels: ["/virt/p/one.SemanticModel", "/virt/p/two.SemanticModel"],
  };
  const match = findBestModelForReport("/virt/p/one.Report", candidates, vfs);
  assert.equal(match, "/virt/p/two.SemanticModel"); // pbir overrides same-prefix
});

test("findBestModelForReport falls back to prefix match when no pbir", () => {
  const candidates: PairCandidates = {
    reports: ["/virt/p/sales.Report"],
    semanticModels: ["/virt/p/other.SemanticModel", "/virt/p/sales.SemanticModel"],
  };
  const match = findBestModelForReport("/virt/p/sales.Report", candidates, new Map());
  assert.equal(match, "/virt/p/sales.SemanticModel");
});

test("findBestModelForReport returns null when nothing matches", () => {
  const candidates: PairCandidates = {
    reports: ["/virt/p/alpha.Report"],
    semanticModels: ["/virt/p/beta.SemanticModel"],
  };
  assert.equal(findBestModelForReport("/virt/p/alpha.Report", candidates, new Map()), null);
});

test("findBestModelForReport returns null for the NONE sentinel", () => {
  const candidates: PairCandidates = {
    reports: [], semanticModels: ["/virt/p/any.SemanticModel"],
  };
  assert.equal(findBestModelForReport(NONE_VALUE, candidates, new Map()), null);
});

// ─────────────────────────────────────────────────────────────────────
// findBestReportForModel — Model → Report auto-select (4-tier ladder)
// ─────────────────────────────────────────────────────────────────────

test("findBestReportForModel prefers a pbir-pointing Report with prefix-exact match", () => {
  const vfs = new Map<string, string>();
  // Both reports point at the same model, but only `sales` has the matching prefix
  vfs.set("/virt/p/sales.Report/definition.pbir", pbir("sales.SemanticModel"));
  vfs.set("/virt/p/sales_archive.Report/definition.pbir", pbir("sales.SemanticModel"));
  const candidates: PairCandidates = {
    reports: ["/virt/p/sales.Report", "/virt/p/sales_archive.Report"],
    semanticModels: ["/virt/p/sales.SemanticModel"],
  };
  const match = findBestReportForModel("/virt/p/sales.SemanticModel", candidates, vfs);
  assert.equal(match, "/virt/p/sales.Report");
});

test("findBestReportForModel falls back to pure prefix when no pbir", () => {
  const candidates: PairCandidates = {
    reports: ["/virt/p/alpha.Report", "/virt/p/training.Report"],
    semanticModels: ["/virt/p/training.SemanticModel"],
  };
  const match = findBestReportForModel("/virt/p/training.SemanticModel", candidates, new Map());
  assert.equal(match, "/virt/p/training.Report");
});

test("findBestReportForModel returns null when nothing pairs", () => {
  const candidates: PairCandidates = {
    reports: ["/virt/p/unrelated.Report"],
    semanticModels: ["/virt/p/other.SemanticModel"],
  };
  assert.equal(findBestReportForModel("/virt/p/other.SemanticModel", candidates, new Map()), null);
});

// ─────────────────────────────────────────────────────────────────────
// filterAndRemount — VFS scoping + remount
// ─────────────────────────────────────────────────────────────────────

test("filterAndRemount keeps only the selected pair's files under /virt/__pbip/", () => {
  const vfs = new Map<string, string>();
  // Pair A (selected)
  vfs.set("/virt/parent/training.Report/report.json", "A1");
  vfs.set("/virt/parent/training.Report/definition.pbir", "A2");
  vfs.set("/virt/parent/training.SemanticModel/definition/tables/t.tmdl", "A3");
  // Pair B (not selected) — must be dropped
  vfs.set("/virt/parent/other.Report/report.json", "B1");
  vfs.set("/virt/parent/other.SemanticModel/definition/tables/t.tmdl", "B2");

  const out = filterAndRemount(
    vfs,
    "/virt/parent/training.Report",
    "/virt/parent/training.SemanticModel",
  );

  assert.equal(out.size, 3);
  assert.equal(out.get("/virt/__pbip/training.Report/report.json"), "A1");
  assert.equal(out.get("/virt/__pbip/training.Report/definition.pbir"), "A2");
  assert.equal(out.get("/virt/__pbip/training.SemanticModel/definition/tables/t.tmdl"), "A3");
});

test("filterAndRemount supports report-only (null modelPath)", () => {
  const vfs = new Map<string, string>();
  vfs.set("/virt/p/one.Report/report.json", "R");
  vfs.set("/virt/p/one.SemanticModel/t.tmdl", "M");
  const out = filterAndRemount(vfs, "/virt/p/one.Report", null);
  assert.equal(out.size, 1);
  assert.ok(out.get("/virt/__pbip/one.Report/report.json"));
});

test("filterAndRemount supports model-only (null reportPath)", () => {
  const vfs = new Map<string, string>();
  vfs.set("/virt/p/one.Report/report.json", "R");
  vfs.set("/virt/p/one.SemanticModel/t.tmdl", "M");
  const out = filterAndRemount(vfs, null, "/virt/p/one.SemanticModel");
  assert.equal(out.size, 1);
  assert.ok(out.get("/virt/__pbip/one.SemanticModel/t.tmdl"));
});

// ─────────────────────────────────────────────────────────────────────
// Shims — installModelOnlyShim / installReportOnlyShim
// ─────────────────────────────────────────────────────────────────────

test("installModelOnlyShim adds a Report stub named after the model's prefix", () => {
  const vfs = new Map<string, string>();
  installModelOnlyShim(vfs, "/virt/__pbip/sales.SemanticModel");
  assert.ok(vfs.has("/virt/__pbip/sales.Report/definition.pbir"));
  assert.ok(vfs.has("/virt/__pbip/sales.Report/definition/pages/pages.json"));
  assert.ok(vfs.has("/virt/__pbip/sales.Report/report.json"));
  // The stub pages.json has an empty pageOrder — this is what makes
  // the parser produce "model-only" output with zero pages.
  const pages = JSON.parse(vfs.get("/virt/__pbip/sales.Report/definition/pages/pages.json")!);
  assert.deepEqual(pages.pageOrder, []);
});

test("installReportOnlyShim adds a SemanticModel stub with an empty TMDL", () => {
  const vfs = new Map<string, string>();
  installReportOnlyShim(vfs, "/virt/__pbip/sales.Report");
  const key = "/virt/__pbip/sales.SemanticModel/definition/tables/_empty.tmdl";
  assert.ok(vfs.has(key));
  // Must NOT contain any `table X` — parseTmdlModel would otherwise
  // interpret our stub as a real table and fail tests pinned to
  // zero-table expectations.
  assert.ok(!/^table /m.test(vfs.get(key)!));
});

// ─────────────────────────────────────────────────────────────────────
// classifyLoadMode — four-state switch
// ─────────────────────────────────────────────────────────────────────

test("classifyLoadMode returns 'empty' for (null, null)", () => {
  assert.equal(classifyLoadMode(null, null), "empty");
});

test("classifyLoadMode returns 'full' for both paths", () => {
  assert.equal(classifyLoadMode("/virt/a.Report", "/virt/a.SemanticModel"), "full");
});

test("classifyLoadMode returns 'model-only' when report is null", () => {
  assert.equal(classifyLoadMode(null, "/virt/a.SemanticModel"), "model-only");
});

test("classifyLoadMode returns 'report-only' when model is null", () => {
  assert.equal(classifyLoadMode("/virt/a.Report", null), "report-only");
});

// ─────────────────────────────────────────────────────────────────────
// computePickerDefaults — default pair pre-selection
// ─────────────────────────────────────────────────────────────────────

test("computePickerDefaults prefers prefix-matching model when multiple exist", () => {
  const candidates: PairCandidates = {
    reports: ["/virt/p/sales.Report"],
    semanticModels: ["/virt/p/alpha.SemanticModel", "/virt/p/sales.SemanticModel"],
  };
  const d = computePickerDefaults(candidates, new Map());
  assert.equal(d.report, "/virt/p/sales.Report");
  assert.equal(d.model, "/virt/p/sales.SemanticModel");
});

test("computePickerDefaults falls back to NONE/empty when lists are empty", () => {
  const d = computePickerDefaults({ reports: [], semanticModels: [] }, new Map());
  assert.equal(d.report, NONE_VALUE);
  assert.equal(d.model, "");
});

// ─────────────────────────────────────────────────────────────────────
// buildPickerCardHtml — landmark checks
// ─────────────────────────────────────────────────────────────────────

test("buildPickerCardHtml renders both radio groups + (none) options + the expected picked folder code-ref", () => {
  const candidates: PairCandidates = {
    reports: ["/virt/parent/training.Report"],
    semanticModels: ["/virt/parent/training.SemanticModel"],
  };
  const html = buildPickerCardHtml("parent", candidates, {
    report: "/virt/parent/training.Report",
    model: "/virt/parent/training.SemanticModel",
  });
  assert.match(html, /Choose what to document from <code>parent<\/code>/);
  assert.match(html, /name="br-pair-report"/);
  assert.match(html, /name="br-pair-model"/);
  assert.match(html, /\(none — semantic model only\)/);
  assert.match(html, /\(none — report only\)/);
  assert.match(html, /id="br-pair-load"/);
  assert.match(html, /id="br-pair-cancel"/);
  assert.match(html, /id="br-pair-verdict"/);
});

test("buildPickerCardHtml HTML-escapes adversarial folder names", () => {
  const html = buildPickerCardHtml(`evil<>"'&`, { reports: [], semanticModels: [] }, {
    report: NONE_VALUE,
    model: "",
  });
  assert.match(html, /evil&lt;&gt;&quot;&#39;&amp;/);
  assert.doesNotMatch(html, /evil<>"'&/);  // raw should not appear
});
