/**
 * Browser-mode entry shell.
 *
 * Runtime flow:
 *   1. Detect File System Access API support (Chrome / Edge / Opera).
 *   2. On "Open folder" click, prompt the user to pick the PBIP
 *      project folder (the parent of `.Report` + `.SemanticModel`).
 *   3. Walk the handle, collect every text file into a Map.
 *   4. Install the map as the fs-shim VFS.
 *   5. Locate the `.Report` folder inside the picked folder and run
 *      the existing parser + data-builder against the VFS path.
 *   6. Also run every md-generator so the Docs tab is populated.
 *   7. Populate the dashboard's globals (`DATA`, `pageData`, …) and
 *      call the same bootstrap sequence the server mode emits.
 *   8. Hide the landing overlay.
 *
 * No parser code is touched — `fs` and `path` imports are redirected
 * to our shims via the import-map in index.html.
 */

import { __setVFS } from "./fs-shim.js";
import { walkDirectoryHandle, isFsaSupported } from "./fsa-walk.js";
import { buildFullData } from "../data-builder.js";
import {
  generateMarkdown,
  generateMeasuresMd,
  generateFunctionsMd,
  generateCalcGroupsMd,
  generateDataDictionaryMd,
} from "../md-generator.js";

// ─────────────────────────────────────────────────────────────────────
// Types — we intentionally don't import the global `window` augmentation
// because the server-mode main.js doesn't declare types. Everything
// here is cast through `as unknown as ...` at call sites.
// ─────────────────────────────────────────────────────────────────────

type BrowserWindow = Window & {
  DATA?: unknown;
  pageData?: unknown;
  // Render functions the inline main.js exposes on the global scope.
  renderSummary?: () => void;
  renderTabs?: () => void;
  renderMeasures?: () => void;
  renderColumns?: () => void;
  renderTables?: () => void;
  renderRelationships?: () => void;
  renderSources?: () => void;
  renderFunctions?: () => void;
  renderCalcGroups?: () => void;
  renderPages?: () => void;
  renderUnused?: () => void;
  renderDocs?: () => void;
  switchTab?: (id: string) => void;
  addCopyButtons?: () => void;
  // Markdown bodies the Docs tab reads.
  MARKDOWN?: string;
  MEASURES_MD?: string;
  FUNCTIONS_MD?: string;
  CALCGROUPS_MD?: string;
  DATA_DICTIONARY_MD?: string;
  APP_VERSION?: string;
  REPORT_PATH?: string;
  REPORT_NAME?: string;
};

// ─────────────────────────────────────────────────────────────────────
// DOM helpers — the landing overlay is simple: one div the main
// dashboard sits behind, with a "Open folder" button and status line.
// ─────────────────────────────────────────────────────────────────────

const overlay = () => document.getElementById("br-overlay");
const status = () => document.getElementById("br-status");
const pickButton = () => document.getElementById("br-pick") as HTMLButtonElement | null;

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  const el = status();
  if (!el) return;
  el.textContent = message;
  el.className = "br-status br-status--" + kind;
}

function showOverlay(): void {
  const el = overlay();
  if (el) el.classList.remove("br-overlay--hidden");
}

function hideOverlay(): void {
  const el = overlay();
  if (el) el.classList.add("br-overlay--hidden");
}

// ─────────────────────────────────────────────────────────────────────
// Main flow
// ─────────────────────────────────────────────────────────────────────

async function pickAndLoad(): Promise<void> {
  const w = globalThis as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<unknown> };
  if (!isFsaSupported()) {
    setStatus(
      "Browser mode needs the File System Access API. Open this page in Chrome, Edge, or Opera.",
      "error",
    );
    return;
  }

  let handle: unknown;
  try {
    handle = await w.showDirectoryPicker({ mode: "read" });
  } catch (e) {
    const err = e as DOMException;
    if (err.name === "AbortError") {
      setStatus("Cancelled. Click 'Open folder' to try again.");
      return;
    }
    setStatus(`Couldn't open folder: ${err.message}`, "error");
    return;
  }

  // The handle is the folder the user picked. It must CONTAIN the
  // `.Report` and `.SemanticModel` siblings — matching how Node CLI
  // users point at the PBIP project root.
  const dirHandle = handle as { name: string; entries(): AsyncIterable<[string, unknown]> };
  const pickedName = dirHandle.name;

  setStatus(`Reading ${pickedName}…`);

  let files: Map<string, string>;
  try {
    files = await walkDirectoryHandle(dirHandle, pickedName);
  } catch (e) {
    setStatus(`Couldn't read folder: ${(e as Error).message}`, "error");
    return;
  }

  if (files.size === 0) {
    setStatus(
      `No PBIP files found in ${pickedName}. Pick the folder that contains a .Report + .SemanticModel pair.`,
      "error",
    );
    return;
  }

  setStatus(`Read ${files.size} files. Parsing model…`);

  // Install the VFS so the synchronous parser can read from it.
  __setVFS({ files });

  // Find the `.Report` folder inside the picked folder. The walker
  // seeds paths under `/virt/<pickedName>/…`; scan for `.Report` as
  // a direct or nested child.
  const reportPath = findReportRoot(files, pickedName);
  if (!reportPath) {
    setStatus(
      "No .Report folder found under the picked directory. Expected a <Name>.Report sibling to <Name>.SemanticModel.",
      "error",
    );
    return;
  }

  // Yield once so the status message paints before parse kicks off.
  await new Promise(r => setTimeout(r, 10));

  let fullData;
  try {
    fullData = buildFullData(reportPath);
  } catch (e) {
    setStatus(`Parser error: ${(e as Error).message}`, "error");
    // eslint-disable-next-line no-console
    console.error(e);
    return;
  }

  const reportName = reportPath
    .split("/").pop()!
    .replace(/\.Report$/i, "");

  setStatus(`Parsed ${fullData.tables.length} tables. Rendering docs…`);
  await new Promise(r => setTimeout(r, 10));

  // Generate all the MD exports the Docs tab reads.
  let md = "", measuresMd = "", functionsMd = "", calcGroupsMd = "",
      dataDictionaryMd = "";
  try {
    md = generateMarkdown(fullData, reportName);
    measuresMd = generateMeasuresMd(fullData, reportName);
    functionsMd = generateFunctionsMd(fullData, reportName);
    calcGroupsMd = generateCalcGroupsMd(fullData, reportName);
    dataDictionaryMd = generateDataDictionaryMd(fullData, reportName);
  } catch (e) {
    // MD generation is secondary — log but don't block the dashboard.
    // eslint-disable-next-line no-console
    console.warn("[entry] MD generation partial-failure:", e);
  }

  // Hand off to the dashboard renderer already loaded in this page.
  applyToDashboard(fullData, reportName, reportPath, {
    md, measuresMd, functionsMd, calcGroupsMd, dataDictionaryMd,
  });

  hideOverlay();
  setStatus("");
}

/**
 * Scan the VFS keys to find a `.Report` directory. Most PBIP projects
 * have it as a direct child of the picked folder; we support nested
 * layouts too by taking the shortest match.
 */
function findReportRoot(files: Map<string, string>, pickedName: string): string | null {
  const rootPrefix = `/virt/${pickedName}/`;
  const seen = new Set<string>();
  for (const key of files.keys()) {
    if (!key.startsWith(rootPrefix)) continue;
    // walk segments to find any *.Report directory
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
  // Prefer the shallowest candidate (usually the one the user intended)
  return [...seen].sort((a, b) => a.length - b.length)[0];
}

interface MarkdownBundle {
  md: string;
  measuresMd: string;
  functionsMd: string;
  calcGroupsMd: string;
  dataDictionaryMd: string;
}

/**
 * Populate the dashboard globals + invoke the existing render chain.
 * Mirrors the bootstrap line the server-mode main.js emits at the end
 * of the inlined script block.
 */
function applyToDashboard(
  data: unknown,
  reportName: string,
  reportPath: string,
  md: MarkdownBundle,
): void {
  const w = window as BrowserWindow;
  w.DATA = data;
  w.pageData = (data as { pages: unknown }).pages;
  w.REPORT_NAME = reportName;
  w.REPORT_PATH = reportPath;
  w.MARKDOWN = md.md;
  w.MEASURES_MD = md.measuresMd;
  w.FUNCTIONS_MD = md.functionsMd;
  w.CALCGROUPS_MD = md.calcGroupsMd;
  w.DATA_DICTIONARY_MD = md.dataDictionaryMd;

  // Call every render the server-mode bootstrap calls. Missing functions
  // are skipped silently so a partial main.js bundle still boots.
  const fns: (keyof BrowserWindow)[] = [
    "renderSummary", "renderTabs", "renderMeasures", "renderColumns",
    "renderTables", "renderRelationships", "renderSources",
    "renderFunctions", "renderCalcGroups", "renderPages",
    "renderUnused", "renderDocs", "addCopyButtons",
  ];
  for (const fn of fns) {
    const f = w[fn];
    if (typeof f === "function") {
      try { (f as () => void)(); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[entry] ${fn} threw:`, e);
      }
    }
  }
  if (typeof w.switchTab === "function") w.switchTab("measures");
}

// ─────────────────────────────────────────────────────────────────────
// Wire up on DOM ready
// ─────────────────────────────────────────────────────────────────────

function init(): void {
  if (!isFsaSupported()) {
    setStatus(
      "Browser mode needs the File System Access API — open this page in Chrome, Edge, or Opera.",
      "error",
    );
    const btn = pickButton();
    if (btn) btn.disabled = true;
    return;
  }
  showOverlay();
  const btn = pickButton();
  if (btn) btn.addEventListener("click", () => { void pickAndLoad(); });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
