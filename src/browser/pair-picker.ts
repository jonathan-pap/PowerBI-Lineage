/**
 * Pure helpers for the browser-mode pair picker.
 *
 * No DOM imports — every function here is deterministic in, data
 * out. DOM construction (radio-group HTML generation) lives here
 * too because it's a string-to-string transform; the side-effecty
 * event wiring stays in entry.ts where document lives.
 *
 * This module exists because entry.ts grew past a single-file
 * comfort zone (~1.2k LOC) and its most test-worthy logic — pair
 * validation, VFS filtering, partial-mode shims — was trapped
 * inside a 326-line `showPairPicker()` with zero test coverage.
 * Extracted so the pure logic can be unit-tested and the
 * orchestrator shrinks to its actual job (DOM wiring).
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface PairCandidates {
  /** Top-level `.Report` dirs as full virtual paths under `/virt/<pickedName>/`. */
  reports: string[];
  /** Top-level `.SemanticModel` dirs, same shape. */
  semanticModels: string[];
}

export type PairVerdict =
  | { kind: "paired"; reason: "pbir" | "prefix"; message: string }
  | { kind: "mismatch"; expected: string; message: string };

/** Load-mode that flows from the pair picker → `__loadBrowserData` hook. */
export type LoadMode = "full" | "model-only" | "report-only";

/** Sentinel value used by the picker's radio groups to represent the "(none)" option. */
export const NONE_VALUE = "__none";

// ─────────────────────────────────────────────────────────────────────
// Attribute-safe escape — tiny helper, no HTML entity library
// ─────────────────────────────────────────────────────────────────────

const ENTITY_MAP: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
export const escForAttr = (s: string): string =>
  s.replace(/[&<>"']/g, c => ENTITY_MAP[c]!);

// ─────────────────────────────────────────────────────────────────────
// Path helpers — all pure
// ─────────────────────────────────────────────────────────────────────

/**
 * Strip the trailing ".Report" or ".SemanticModel" suffix (case-
 * insensitive) to derive a project prefix — e.g. "training.Report"
 * → "training". Used for prefix-match validation and the step-2
 * prompt's suggested companion name.
 */
export function reportPrefix(name: string): string {
  return name.replace(/\.(Report|SemanticModel)$/i, "");
}

/**
 * Extract the final path segment. `/virt/foo/bar.Report` → `bar.Report`.
 */
function basename(p: string): string {
  return p.split("/").pop() || "";
}

// ─────────────────────────────────────────────────────────────────────
// VFS scanning
// ─────────────────────────────────────────────────────────────────────

/**
 * Scan the VFS map for every `*.Report` and `*.SemanticModel`
 * directory and return them as full virtual paths. Walks every path
 * depth — users occasionally nest projects under a workspace
 * folder. Deduplicated per-directory, alphabetised by basename.
 */
export function scanPairCandidates(
  files: Map<string, string>,
  pickedName: string,
): PairCandidates {
  const rootPrefix = `/virt/${pickedName}/`;
  const reports = new Set<string>();
  const models = new Set<string>();
  for (const key of files.keys()) {
    if (!key.startsWith(rootPrefix)) continue;
    const parts = key.slice(rootPrefix.length).split("/");
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const fullPath = rootPrefix + parts.slice(0, i + 1).join("/");
      if (/\.Report$/i.test(seg)) reports.add(fullPath);
      else if (/\.SemanticModel$/i.test(seg)) models.add(fullPath);
    }
  }
  const byBasename = (a: string, b: string): number =>
    basename(a).localeCompare(basename(b));
  return {
    reports: [...reports].sort(byBasename),
    semanticModels: [...models].sort(byBasename),
  };
}

/**
 * Scan the VFS for any `*.Report` directory (legacy single-report
 * helper used by the fast-path when only one exists). Returns the
 * shallowest match, or null if none.
 */
export function findReportRoot(
  files: Map<string, string>,
  pickedName: string,
): string | null {
  const rootPrefix = `/virt/${pickedName}/`;
  const seen = new Set<string>();
  for (const key of files.keys()) {
    if (!key.startsWith(rootPrefix)) continue;
    const rest = key.slice(rootPrefix.length);
    const parts = rest.split("/");
    for (let i = 0; i < parts.length; i++) {
      if (/\.Report$/i.test(parts[i])) {
        const candidate = rootPrefix + parts.slice(0, i + 1).join("/");
        seen.add(candidate);
      }
    }
  }
  if (seen.size === 0) return null;
  return [...seen].sort((a, b) => a.length - b.length)[0];
}

// ─────────────────────────────────────────────────────────────────────
// Pair validation — three tiers
// ─────────────────────────────────────────────────────────────────────

/**
 * Decide whether a given `.Report` / `.SemanticModel` pair belongs
 * together:
 *   1. pbir pointer in `<report>/definition.pbir` → authoritative
 *   2. Filename prefix match (training.Report ↔ training.SemanticModel)
 *   3. Neither → hard mismatch; caller disables Load.
 *
 * Pure — takes the full VFS map so it can read the Report's pbir,
 * but never mutates it and has no DOM side-effects.
 */
export function validatePair(
  files: Map<string, string>,
  reportPath: string,
  semanticPath: string,
): PairVerdict {
  const reportName = basename(reportPath);
  const modelName = basename(semanticPath);
  const rPrefix = reportName.replace(/\.Report$/i, "");
  const mPrefix = modelName.replace(/\.SemanticModel$/i, "");

  // Tier 1: pbir authoritative pointer
  const pbirKey = reportPath + "/definition.pbir";
  const pbirContent = files.get(pbirKey);
  if (pbirContent) {
    try {
      const parsed = JSON.parse(pbirContent) as {
        datasetReference?: { byPath?: { path?: string } };
      };
      const rawPath = parsed.datasetReference?.byPath?.path;
      if (rawPath) {
        const expectedModel = rawPath.split(/[/\\]/).pop() || "";
        if (expectedModel.toLowerCase() === modelName.toLowerCase()) {
          return { kind: "paired", reason: "pbir", message: `Report paired with this model (via pbir)` };
        }
        return {
          kind: "mismatch",
          expected: expectedModel,
          message: `Report's pbir points to "${expectedModel}", not "${modelName}".`,
        };
      }
    } catch { /* malformed pbir — fall through to prefix */ }
  }

  // Tier 2: prefix heuristic
  if (rPrefix && mPrefix && rPrefix.toLowerCase() === mPrefix.toLowerCase()) {
    return { kind: "paired", reason: "prefix", message: `Prefix match — assumed paired` };
  }

  // Tier 3: mismatch
  return {
    kind: "mismatch",
    expected: rPrefix ? `${rPrefix}.SemanticModel` : "",
    message: rPrefix
      ? `"${reportName}" doesn't match "${modelName}" — expected "${rPrefix}.SemanticModel".`
      : `"${reportName}" and "${modelName}" don't appear to be paired.`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Auto-select — given one side of the pair, choose the other
// ─────────────────────────────────────────────────────────────────────

/**
 * Given a selected Report path, return the path of the Semantic
 * Model that best matches it, or null if no match. Three tiers:
 *   1. pbir pointer match
 *   2. Filename prefix match
 *   3. No match
 *
 * Caller is responsible for setting the radio's `checked` — this
 * function only computes the decision.
 */
export function findBestModelForReport(
  reportPath: string,
  candidates: PairCandidates,
  files: Map<string, string>,
): string | null {
  if (reportPath === NONE_VALUE || reportPath === "") return null;
  const reportName = basename(reportPath);

  // Tier 1: pbir pointer
  const pbirContent = files.get(reportPath + "/definition.pbir");
  if (pbirContent) {
    try {
      const parsed = JSON.parse(pbirContent) as { datasetReference?: { byPath?: { path?: string } } };
      const rawPath = parsed.datasetReference?.byPath?.path;
      if (rawPath) {
        const expected = rawPath.split(/[/\\]/).pop() || "";
        const match = candidates.semanticModels.find(m =>
          basename(m).toLowerCase() === expected.toLowerCase());
        if (match) return match;
      }
    } catch { /* fall through */ }
  }

  // Tier 2: prefix
  const rPrefix = reportName.replace(/\.Report$/i, "");
  if (rPrefix) {
    const match = candidates.semanticModels.find(m =>
      basename(m).replace(/\.SemanticModel$/i, "").toLowerCase() === rPrefix.toLowerCase());
    if (match) return match;
  }

  return null;
}

/**
 * Given a selected Semantic Model path, return the path of the
 * Report that best matches it, or null.
 *
 * One Model can pair with multiple Reports (e.g. two Reports
 * sharing a thin-client semantic layer). Disambiguation:
 *   1. Reports whose pbir points AT THIS model exactly.
 *   2. Within those, prefer the prefix-exact match.
 *   3. First pbir match (fallback).
 *   4. Pure prefix-match across all Reports (fallback when no pbir).
 *   5. No match.
 */
export function findBestReportForModel(
  modelPath: string,
  candidates: PairCandidates,
  files: Map<string, string>,
): string | null {
  if (modelPath === NONE_VALUE || modelPath === "") return null;
  const modelName = basename(modelPath);
  const mPrefix = modelName.replace(/\.SemanticModel$/i, "");

  // Collect every report whose pbir points at this model
  const pbirMatches: string[] = [];
  for (const r of candidates.reports) {
    const pbirContent = files.get(r + "/definition.pbir");
    if (!pbirContent) continue;
    try {
      const parsed = JSON.parse(pbirContent) as { datasetReference?: { byPath?: { path?: string } } };
      const rawPath = parsed.datasetReference?.byPath?.path;
      if (rawPath) {
        const expected = rawPath.split(/[/\\]/).pop() || "";
        if (expected.toLowerCase() === modelName.toLowerCase()) {
          pbirMatches.push(r);
        }
      }
    } catch { /* skip malformed pbir */ }
  }

  const pickExact = (list: string[]): string | null => {
    if (list.length === 0) return null;
    const exact = list.find(r =>
      basename(r).replace(/\.Report$/i, "").toLowerCase() === mPrefix.toLowerCase());
    return exact || list[0];
  };

  return pickExact(pbirMatches)
    || pickExact(candidates.reports.filter(r =>
      basename(r).replace(/\.Report$/i, "").toLowerCase() === mPrefix.toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────────
// VFS filter — retain only the selected pair's files, remount under
// a synthetic parent so parser paths stay stable.
// ─────────────────────────────────────────────────────────────────────

/**
 * Return a new VFS map containing ONLY files under the selected
 * Report + SemanticModel paths, remapped under `/virt/__pbip/<basename>/…`
 * so the parser's sibling-folder scan sees them as peers regardless
 * of the original parent folder name.
 *
 * Pure — original map untouched.
 */
export function filterAndRemount(
  files: Map<string, string>,
  reportPath: string | null,
  modelPath: string | null,
): Map<string, string> {
  const reportPrefixPath = reportPath ? reportPath + "/" : null;
  const modelPrefixPath = modelPath ? modelPath + "/" : null;
  const reportBase = reportPath ? basename(reportPath) : "";
  const modelBase = modelPath ? basename(modelPath) : "";
  const out = new Map<string, string>();
  for (const [key, val] of files) {
    if (reportPrefixPath && key.startsWith(reportPrefixPath)) {
      out.set(`/virt/__pbip/${reportBase}/${key.slice(reportPrefixPath.length)}`, val);
    } else if (modelPrefixPath && key.startsWith(modelPrefixPath)) {
      out.set(`/virt/__pbip/${modelBase}/${key.slice(modelPrefixPath.length)}`, val);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Partial-mode shims — synthesize the missing half so the parser
// has both pieces it expects.
// ─────────────────────────────────────────────────────────────────────

/**
 * Model-only mode: no Report picked. Parser's `scanReportBindings`
 * would throw on a missing .Report, so we manufacture a minimal
 * empty one. Result: FullData has zero pages/visuals — exactly
 * what "model-only" means.
 *
 * Mutates `files` in place (caller controls the map lifecycle).
 */
export function installModelOnlyShim(
  files: Map<string, string>,
  modelPath: string,
): void {
  const modelBase = basename(modelPath);
  const prefix = modelBase.replace(/\.SemanticModel$/i, "") || "model-only";
  const reportBase = `${prefix}.Report`;
  files.set(`/virt/__pbip/${reportBase}/definition.pbir`, JSON.stringify({
    version: "1.0",
    datasetReference: { byPath: { path: `../${modelBase}` } },
  }));
  files.set(`/virt/__pbip/${reportBase}/definition/pages/pages.json`, JSON.stringify({
    pageOrder: [],
    activePageName: "",
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json",
  }));
  files.set(`/virt/__pbip/${reportBase}/report.json`, JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.2.0/schema.json",
    resourcePackages: [],
  }));
}

/**
 * Report-only mode: no Semantic Model picked. Parser's
 * `findSemanticModelPath` + `parseModel` need a SemanticModel to
 * exist. We synthesize an empty one — a single empty TMDL file
 * routes parseModel to parseTmdlModel, which iterates and finds no
 * table declarations, returning an empty RawModel.
 */
export function installReportOnlyShim(
  files: Map<string, string>,
  reportPath: string,
): void {
  const reportBase = basename(reportPath);
  const prefix = reportBase.replace(/\.Report$/i, "") || "report-only";
  const modelBase = `${prefix}.SemanticModel`;
  files.set(`/virt/__pbip/${modelBase}/definition/tables/_empty.tmdl`,
    "/// Empty placeholder — report-only mode\n");
}

// ─────────────────────────────────────────────────────────────────────
// HTML building — pure string-to-string
// ─────────────────────────────────────────────────────────────────────

export interface PickerDefaults {
  report: string;
  model: string;
}

/**
 * Compute the default pair to pre-select when the picker opens.
 * Tries to land on the best-fit pair so the common case is one
 * click (Load). Falls back to NONE on the Report side, empty on
 * the Model side if no reasonable default exists.
 */
export function computePickerDefaults(
  candidates: PairCandidates,
  files: Map<string, string>,
): PickerDefaults {
  const defaultReport = candidates.reports[0] || NONE_VALUE;
  let defaultModel = candidates.semanticModels[0] || "";
  if (defaultReport !== NONE_VALUE && candidates.semanticModels.length > 1) {
    const match = findBestModelForReport(defaultReport, candidates, files);
    if (match) defaultModel = match;
  }
  return { report: defaultReport, model: defaultModel };
}

/**
 * Build the full pair-picker card markup as a string. No DOM
 * reads/writes — pure string transform.
 */
export function buildPickerCardHtml(
  pickedName: string,
  candidates: PairCandidates,
  defaults: PickerDefaults,
): string {
  const reportRadios = [
    ...candidates.reports.map(p => {
      const n = basename(p);
      return `<label class="br-radio"><input type="radio" name="br-pair-report" value="${escForAttr(p)}"${p === defaults.report ? " checked" : ""}>${escForAttr(n)}</label>`;
    }),
    `<label class="br-radio br-radio--none"><input type="radio" name="br-pair-report" value="${NONE_VALUE}"${defaults.report === NONE_VALUE ? " checked" : ""}>(none — semantic model only)</label>`,
  ].join("");

  const modelRadios = [
    ...candidates.semanticModels.map(p => {
      const n = basename(p);
      return `<label class="br-radio"><input type="radio" name="br-pair-model" value="${escForAttr(p)}"${p === defaults.model ? " checked" : ""}>${escForAttr(n)}</label>`;
    }),
    `<label class="br-radio br-radio--none"><input type="radio" name="br-pair-model" value="${NONE_VALUE}"${defaults.model === "" ? " checked" : ""}>(none — report only)</label>`,
  ].join("");

  return `
    <h1>Power BI Documenter</h1>
    <p class="br-lede" style="margin:8px 0 20px">Choose what to document from <code>${escForAttr(pickedName)}</code>.</p>

    <div class="br-pair-picker">
      <div class="br-pair-col">
        <h3>Report</h3>
        ${reportRadios}
      </div>
      <div class="br-pair-col">
        <h3>Semantic Model</h3>
        ${modelRadios}
      </div>
    </div>

    <div id="br-pair-verdict" class="br-pair-verdict" aria-live="polite"></div>

    <div class="br-ctas">
      <button id="br-pair-cancel" class="br-btn" type="button"
              style="background:transparent;color:#CBD5E1;border:1px solid rgba(255,255,255,0.18);">
        Cancel
      </button>
      <button id="br-pair-load" class="br-btn" type="button"
              style="background:#F59E0B;color:#0B0D11;">
        Load
      </button>
    </div>
  `.trim();
}

// ─────────────────────────────────────────────────────────────────────
// Load-mode classifier
// ─────────────────────────────────────────────────────────────────────

/**
 * Classify a user's pick as one of the four states. Used by
 * entry.ts both to decide which shim to install and to pass the
 * right loadMode flag to `__loadBrowserData` (for the header badge).
 */
export function classifyLoadMode(
  reportPath: string | null,
  modelPath: string | null,
): LoadMode | "empty" {
  if (!reportPath && !modelPath) return "empty";
  if (!reportPath) return "model-only";
  if (!modelPath) return "report-only";
  return "full";
}
