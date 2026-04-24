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
import { walkDirectoryHandle, walkIntoMap, isFsaSupported } from "./fsa-walk.js";
import { buildFullData } from "../data-builder.js";
import {
  generateMarkdown,
  generateMeasuresMd,
  generateFunctionsMd,
  generateCalcGroupsMd,
  generateDataDictionaryMd,
  generateSourcesMd,
  generatePagesMd,
  generateIndexMd,
} from "../md-generator.js";
import { generateImprovementsMd } from "../improvements.js";

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
const sampleButton = () => document.getElementById("br-sample") as HTMLButtonElement | null;

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

type DirHandle = { name: string; entries(): AsyncIterable<[string, unknown]> };

/**
 * Open a native folder picker. Throws AbortError if the user
 * cancels; throws a plain Error for any other failure. Returns
 * the raw handle so callers can inspect `name` before walking.
 */
async function openDirectoryPicker(): Promise<DirHandle> {
  const w = globalThis as unknown as {
    showDirectoryPicker: (opts?: unknown) => Promise<DirHandle>;
  };
  return await w.showDirectoryPicker({ mode: "read" });
}

/**
 * Strip the trailing ".Report" or ".SemanticModel" suffix (case-
 * insensitive) to derive a project prefix the user can recognise
 * (e.g., "training.Report" → "training", so we can say "now pick
 * training.SemanticModel").
 */
function reportPrefix(name: string): string {
  return name.replace(/\.(Report|SemanticModel)$/i, "");
}

async function pickAndLoad(): Promise<void> {
  if (!isFsaSupported()) {
    setStatus(
      "Browser mode needs the File System Access API. Open this page in Chrome, Edge, or Opera.",
      "error",
    );
    return;
  }

  let handle: DirHandle;
  try {
    handle = await openDirectoryPicker();
  } catch (e) {
    const err = e as DOMException;
    if (err.name === "AbortError") {
      setStatus("Cancelled. Click 'Open folder' to try again.");
      return;
    }
    setStatus(`Couldn't open folder: ${err.message}`, "error");
    return;
  }

  const pickedName = handle.name;
  // eslint-disable-next-line no-console
  console.log(`[entry] Picked folder: "${pickedName}"`);

  // ── Two-step path: user picked a `.Report` (or `.SemanticModel`)
  // directly. The File System Access API doesn't grant sibling
  // access, so we walk this handle now and then prompt the user to
  // pick the matching companion folder. Both get merged into a
  // synthetic `/virt/__pbip/…` parent so the parser's sibling-scan
  // finds them as peers.
  if (/\.report$/i.test(pickedName) || /\.semanticmodel$/i.test(pickedName)) {
    await beginTwoStepPick(handle);
    return;
  }

  // ── One-step path (current behaviour): user picked a parent
  // containing both folders. Walk, find the .Report, proceed.
  setStatus(`Reading ${pickedName}…`);
  let files: Map<string, string>;
  try {
    files = await walkDirectoryHandle(handle, pickedName);
  } catch (e) {
    setStatus(`Couldn't read folder: ${(e as Error).message}`, "error");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[entry] Walker read ${files.size} text files under /virt/${pickedName}`);
  await processFiles(files, pickedName, /*fromSample=*/ false);
}

// ─────────────────────────────────────────────────────────────────────
// Two-step picker — handles the "pick .Report directly" flow
// ─────────────────────────────────────────────────────────────────────

/**
 * Called after the user picks a `.Report` or `.SemanticModel` folder
 * directly. Walks the first handle and swaps the overlay to prompt
 * for the matching companion.
 */
async function beginTwoStepPick(firstHandle: DirHandle): Promise<void> {
  const firstName = firstHandle.name;
  const firstIsReport = /\.report$/i.test(firstName);
  const prefix = reportPrefix(firstName);
  const needKind = firstIsReport ? "SemanticModel" : "Report";
  const needLabel = prefix ? `${prefix}.${needKind}` : `.${needKind}`;

  setStatus(`Reading ${firstName}…`);
  const firstFiles = new Map<string, string>();
  try {
    // Mount under the synthetic parent so the final VFS layout has
    // .Report and .SemanticModel as siblings of a shared root.
    await walkIntoMap(firstHandle, `/virt/__pbip/${firstName}`, firstFiles);
  } catch (e) {
    setStatus(`Couldn't read ${firstName}: ${(e as Error).message}`, "error");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[entry] Step 1: walked ${firstFiles.size} text files under /virt/__pbip/${firstName}`);

  showStep2Prompt(needLabel, firstName, firstFiles, firstIsReport);
}

/**
 * Swap the overlay's CTA row to a single "Select <X>" button that
 * drives step 2 of the two-step pick. Once the user picks the
 * companion, we walk it, merge into the first map, and run
 * processFiles against the synthetic `__pbip` root.
 */
function showStep2Prompt(
  needLabel: string,
  firstName: string,
  firstFiles: Map<string, string>,
  firstIsReport: boolean,
): void {
  const ctas = document.getElementById("br-ctas") as HTMLDivElement | null;
  if (!ctas) {
    setStatus("Internal error: CTA row missing. Reload the page.", "error");
    return;
  }

  // Remember the original CTA row so we can restore it if the user
  // cancels step 2.
  const originalCtas = ctas.innerHTML;
  // HTML-escape the user-controlled folder name so a cleverly-named
  // directory can't inject markup into the overlay. `needLabel`
  // derives from handle.name — trusted in practice (OS picker) but
  // belt-and-braces.
  const safeLabel = needLabel.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
  ctas.innerHTML = `
    <button id="br-step2" class="br-btn" type="button"
            style="background:#F59E0B;color:#0B0D11;"
            title="Pick the matching ${safeLabel} folder">
      Select ${safeLabel}
    </button>
    <button id="br-cancel-step2" class="br-btn" type="button"
            style="background:transparent;color:#CBD5E1;border:1px solid rgba(255,255,255,0.18);">
      Cancel
    </button>
  `;
  setStatus(
    `Got ${firstName}. Now pick ${needLabel} (must be a sibling of ${firstName}).`,
  );

  const step2Btn = document.getElementById("br-step2");
  const cancelBtn = document.getElementById("br-cancel-step2");

  const restore = (): void => {
    ctas.innerHTML = originalCtas;
    // Re-wire original buttons (they were destroyed when we replaced innerHTML)
    const newPick = pickButton();
    if (newPick) newPick.addEventListener("click", () => { void pickAndLoad(); });
    const newSample = sampleButton();
    if (newSample) newSample.addEventListener("click", () => { void loadSample(); });
  };

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      setStatus("Cancelled. Pick a different folder.");
      restore();
    });
  }

  if (step2Btn) {
    step2Btn.addEventListener("click", async () => {
      let second: DirHandle;
      try {
        second = await openDirectoryPicker();
      } catch (e) {
        const err = e as DOMException;
        if (err.name === "AbortError") {
          setStatus(`Cancelled. Click 'Select ${needLabel}' to try again.`);
          return;
        }
        setStatus(`Couldn't open folder: ${err.message}`, "error");
        return;
      }

      // Validate kind: must end with the opposite suffix from step 1
      const wantSuffix = firstIsReport ? /\.semanticmodel$/i : /\.report$/i;
      if (!wantSuffix.test(second.name)) {
        setStatus(
          `"${second.name}" isn't a ${needLabel} folder — pick a folder ending in .${firstIsReport ? "SemanticModel" : "Report"}.`,
          "error",
        );
        return;
      }

      setStatus(`Reading ${second.name}…`);
      try {
        await walkIntoMap(second, `/virt/__pbip/${second.name}`, firstFiles);
      } catch (e) {
        setStatus(`Couldn't read ${second.name}: ${(e as Error).message}`, "error");
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`[entry] Step 2: merged, ${firstFiles.size} total files under /virt/__pbip`);

      // Hand off. The shared processFiles pipeline takes care of
      // finding the .Report, parsing, and rendering.
      await processFiles(firstFiles, "__pbip", /*fromSample=*/ false);
    });
  }
}

/**
 * Shared back-half of the load flow — detect the `.Report` folder,
 * install the VFS, parse, render. Used by both the folder picker
 * and the "Try a sample" button.
 */
async function processFiles(
  files: Map<string, string>,
  pickedName: string,
  fromSample: boolean,
): Promise<void> {
  if (files.size === 0) {
    // The two-step picker handles the ".Report / .SemanticModel
    // picked directly" case upstream, so if we arrive here with zero
    // files it's because the user picked an unrelated folder.
    setStatus(
      `No PBIP files found in "${pickedName}". Pick a PBIP project parent folder, or the .Report folder directly (the picker will then ask for the matching .SemanticModel).`,
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
  // eslint-disable-next-line no-console
  console.log(`[entry] findReportRoot("${pickedName}") →`, reportPath || "(null — no .Report folder found)");
  if (!reportPath) {
    setStatus(
      `No .Report folder found under "${pickedName}". Pick a PBIP project parent folder, or the .Report folder directly (the picker will then ask for the matching .SemanticModel).`,
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
    // eslint-disable-next-line no-console
    console.error(`[entry] Parser threw while processing "${reportPath}" (fromSample=${fromSample}):`, e);
    setStatus(`Parser error: ${(e as Error).message}`, "error");
    return;
  }

  const reportName = reportPath
    .split("/").pop()!
    .replace(/\.Report$/i, "");

  // eslint-disable-next-line no-console
  console.log(`[entry] Parsed "${reportName}": ${fullData.tables.length} tables, ${fullData.measures.length} measures, ${fullData.pages.length} pages`);
  setStatus(`Parsed ${fullData.tables.length} tables. Rendering docs…`);
  await new Promise(r => setTimeout(r, 10));

  // Generate all 9 MD exports the Docs tab reads.
  let md = "", measuresMd = "", functionsMd = "", calcGroupsMd = "",
      dataDictionaryMd = "", sourcesMd = "", pagesMd = "", indexMd = "",
      improvementsMd = "";
  try {
    md = generateMarkdown(fullData, reportName);
    measuresMd = generateMeasuresMd(fullData, reportName);
    functionsMd = generateFunctionsMd(fullData, reportName);
    calcGroupsMd = generateCalcGroupsMd(fullData, reportName);
    dataDictionaryMd = generateDataDictionaryMd(fullData, reportName);
    sourcesMd = generateSourcesMd(fullData, reportName);
    pagesMd = generatePagesMd(fullData, reportName);
    indexMd = generateIndexMd(fullData, reportName);
    improvementsMd = generateImprovementsMd(fullData, reportName);
  } catch (e) {
    // MD generation is secondary — log but don't block the dashboard.
    // eslint-disable-next-line no-console
    console.warn("[entry] MD generation partial-failure:", e);
  }

  // Hand off to the dashboard renderer already loaded in this page.
  applyToDashboard(fullData, reportName, reportPath, {
    md, measuresMd, functionsMd, calcGroupsMd, dataDictionaryMd,
    sourcesMd, pagesMd, indexMd, improvementsMd,
  });

  hideOverlay();
  setStatus("");
}

/**
 * Fetches docs/sample-data.json (baked at build time from sample/),
 * populates the VFS, and runs the shared processFiles pipeline. No
 * folder picker, no permission prompt — the data is same-origin.
 *
 * Payload shape:
 *   { version: 1, pickedName: "sample", files: { "/virt/sample/…": "text" } }
 */
async function loadSample(): Promise<void> {
  setStatus("Fetching sample…");
  // eslint-disable-next-line no-console
  console.log("[entry] Fetching ./sample-data.json");

  let payload: { version: number; pickedName: string; files: Record<string, string> };
  try {
    const res = await fetch("./sample-data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (e) {
    setStatus(
      `Couldn't load sample: ${(e as Error).message}. Try again or use "Open folder".`,
      "error",
    );
    return;
  }

  if (!payload || !payload.files || payload.version !== 1) {
    setStatus(
      "Sample file is malformed. Rebuild the site or use 'Open folder'.",
      "error",
    );
    return;
  }

  const files = new Map<string, string>(Object.entries(payload.files));
  // eslint-disable-next-line no-console
  console.log(`[entry] Sample loaded: ${files.size} files, pickedName="${payload.pickedName}"`);

  await processFiles(files, payload.pickedName, /*fromSample=*/ true);
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
  sourcesMd: string;
  pagesMd: string;
  indexMd: string;
  improvementsMd: string;
}

/**
 * Hand the parsed data + rendered MDs off to the dashboard runtime.
 *
 * Why this is delegated: the renderers in src/client/main.ts close
 * over the top-level `let DATA` + `let MARKDOWN_*` bindings declared
 * in src/html-generator.ts. Those `let`s live in the inline script's
 * Script scope, which is invisible to this (module) code. Setting
 * `window.DATA = …` from here creates a separate variable the
 * renderers ignore — we'd render the empty build-time shell forever.
 *
 * The fix: main.ts installs `window.__loadBrowserData(opts)` inside
 * the same Script scope, so the hook has reach to mutate DATA in
 * place, reassign the primitive `let`s, refill `pageData`, and
 * re-run every renderer. Here we just shape the opts payload.
 */
function applyToDashboard(
  data: unknown,
  reportName: string,
  reportPath: string,
  md: MarkdownBundle,
): void {
  const w = window as BrowserWindow & {
    __loadBrowserData?: (opts: unknown) => void;
    REPORT_PATH?: string;
  };

  // REPORT_PATH is informational (shown in some tooltips) and lives
  // outside the Script-scoped lets — a plain window property is fine.
  w.REPORT_PATH = reportPath;

  if (typeof w.__loadBrowserData !== "function") {
    // eslint-disable-next-line no-console
    console.error(
      "[entry] window.__loadBrowserData missing — dashboard script didn't install its bootstrap hook. Check the html-generator + main.ts build.",
    );
    return;
  }

  const nowTs = new Date().toISOString().replace("T", " ").substring(0, 16);
  w.__loadBrowserData({
    data,
    reportName,
    generatedAt: nowTs,
    appVersion: "browser",
    markdown: {
      md: md.md,
      measuresMd: md.measuresMd,
      functionsMd: md.functionsMd,
      calcGroupsMd: md.calcGroupsMd,
      dataDictionaryMd: md.dataDictionaryMd,
      sourcesMd: md.sourcesMd,
      pagesMd: md.pagesMd,
      indexMd: md.indexMd,
      improvementsMd: md.improvementsMd,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Wire up on DOM ready
// ─────────────────────────────────────────────────────────────────────

function init(): void {
  // The sample button ships enabled — the sample-data.json is
  // committed alongside this script, so it always deploys as a
  // unit. If fetch fails at click-time (edge case: GitHub Pages
  // CDN hiccup) loadSample() surfaces a clear error.
  //
  // Earlier versions of this code used a HEAD probe to conditionally
  // enable the button. That introduced a race where a quick
  // first-click happened before the probe finished, felt like
  // "nothing happened". Always-enabled is simpler and more robust.
  const sBtn = sampleButton();
  if (sBtn) {
    sBtn.addEventListener("click", () => { void loadSample(); });
  }

  // Repurpose the header "Re-scan" button for browser mode. The CLI
  // version does `location.reload()` (which re-runs the server-side
  // parser); in browser mode that would just dump the loaded
  // dashboard and force another file pick. Instead: re-open the
  // overlay, restore default CTAs, let the user switch report
  // without a hard refresh.
  const reloadBtn = document.querySelector<HTMLButtonElement>(
    'button[data-action="reload"]',
  );
  if (reloadBtn) {
    reloadBtn.textContent = "Load another";
    reloadBtn.title = "Pick a different PBIP — keeps the current tab alive";
    // Swap the data-action so main.ts's delegator no longer fires
    // location.reload, and attach our own handler.
    reloadBtn.setAttribute("data-action", "browser-switch-report");
    reloadBtn.addEventListener("click", reopenPicker);
  }

  if (!isFsaSupported()) {
    setStatus(
      "Folder picker needs the File System Access API — open this page in Chrome, Edge, or Opera. You can still click 'Try a sample' above.",
      "error",
    );
    const btn = pickButton();
    if (btn) btn.disabled = true;
    // Leave the overlay visible so the sample button stays clickable.
    showOverlay();
    return;
  }
  showOverlay();
  const btn = pickButton();
  if (btn) btn.addEventListener("click", () => { void pickAndLoad(); });
}

/**
 * Bring the landing overlay back up so the user can pick a new
 * report. Restores default CTA buttons (in case the two-step flow
 * had swapped them mid-pick) and clears any lingering status text.
 */
function reopenPicker(): void {
  // Restore the default CTA row — step-2 might have replaced it.
  const ctas = document.getElementById("br-ctas");
  if (ctas) {
    ctas.innerHTML = `
      <button id="br-pick" class="br-btn" type="button">Open folder</button>
      <button id="br-sample" class="br-btn" type="button" title="Load the bundled sample PBIP — runs entirely in-browser">Try a sample</button>
    `;
    const newPick = pickButton();
    if (newPick) {
      if (!isFsaSupported()) newPick.disabled = true;
      else newPick.addEventListener("click", () => { void pickAndLoad(); });
    }
    const newSample = sampleButton();
    if (newSample) newSample.addEventListener("click", () => { void loadSample(); });
  }
  setStatus("");
  showOverlay();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
