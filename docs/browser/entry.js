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
import { generateMarkdown, generateMeasuresMd, generateFunctionsMd, generateCalcGroupsMd, generateQualityMd, generateDataDictionaryMd, } from "../md-generator.js";
// ─────────────────────────────────────────────────────────────────────
// DOM helpers — the landing overlay is simple: one div the main
// dashboard sits behind, with a "Open folder" button and status line.
// ─────────────────────────────────────────────────────────────────────
const overlay = () => document.getElementById("br-overlay");
const status = () => document.getElementById("br-status");
const pickButton = () => document.getElementById("br-pick");
function setStatus(message, kind = "info") {
    const el = status();
    if (!el)
        return;
    el.textContent = message;
    el.className = "br-status br-status--" + kind;
}
function showOverlay() {
    const el = overlay();
    if (el)
        el.classList.remove("br-overlay--hidden");
}
function hideOverlay() {
    const el = overlay();
    if (el)
        el.classList.add("br-overlay--hidden");
}
// ─────────────────────────────────────────────────────────────────────
// Main flow
// ─────────────────────────────────────────────────────────────────────
async function pickAndLoad() {
    const w = globalThis;
    if (!isFsaSupported()) {
        setStatus("Browser mode needs the File System Access API. Open this page in Chrome, Edge, or Opera.", "error");
        return;
    }
    let handle;
    try {
        handle = await w.showDirectoryPicker({ mode: "read" });
    }
    catch (e) {
        const err = e;
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
    const dirHandle = handle;
    const pickedName = dirHandle.name;
    setStatus(`Reading ${pickedName}…`);
    let files;
    try {
        files = await walkDirectoryHandle(dirHandle, pickedName);
    }
    catch (e) {
        setStatus(`Couldn't read folder: ${e.message}`, "error");
        return;
    }
    if (files.size === 0) {
        setStatus(`No PBIP files found in ${pickedName}. Pick the folder that contains a .Report + .SemanticModel pair.`, "error");
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
        setStatus("No .Report folder found under the picked directory. Expected a <Name>.Report sibling to <Name>.SemanticModel.", "error");
        return;
    }
    // Yield once so the status message paints before parse kicks off.
    await new Promise(r => setTimeout(r, 10));
    let fullData;
    try {
        fullData = buildFullData(reportPath);
    }
    catch (e) {
        setStatus(`Parser error: ${e.message}`, "error");
        // eslint-disable-next-line no-console
        console.error(e);
        return;
    }
    const reportName = reportPath
        .split("/").pop()
        .replace(/\.Report$/i, "");
    setStatus(`Parsed ${fullData.tables.length} tables. Rendering docs…`);
    await new Promise(r => setTimeout(r, 10));
    // Generate all the MD exports the Docs tab reads.
    let md = "", measuresMd = "", functionsMd = "", calcGroupsMd = "", qualityMd = "", dataDictionaryMd = "";
    try {
        md = generateMarkdown(fullData, reportName);
        measuresMd = generateMeasuresMd(fullData, reportName);
        functionsMd = generateFunctionsMd(fullData, reportName);
        calcGroupsMd = generateCalcGroupsMd(fullData, reportName);
        qualityMd = generateQualityMd(fullData, reportName);
        dataDictionaryMd = generateDataDictionaryMd(fullData, reportName);
    }
    catch (e) {
        // MD generation is secondary — log but don't block the dashboard.
        // eslint-disable-next-line no-console
        console.warn("[entry] MD generation partial-failure:", e);
    }
    // Hand off to the dashboard renderer already loaded in this page.
    applyToDashboard(fullData, reportName, reportPath, {
        md, measuresMd, functionsMd, calcGroupsMd, qualityMd, dataDictionaryMd,
    });
    hideOverlay();
    setStatus("");
}
/**
 * Scan the VFS keys to find a `.Report` directory. Most PBIP projects
 * have it as a direct child of the picked folder; we support nested
 * layouts too by taking the shortest match.
 */
function findReportRoot(files, pickedName) {
    const rootPrefix = `/virt/${pickedName}/`;
    const seen = new Set();
    for (const key of files.keys()) {
        if (!key.startsWith(rootPrefix))
            continue;
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
    if (seen.size === 0)
        return null;
    // Prefer the shallowest candidate (usually the one the user intended)
    return [...seen].sort((a, b) => a.length - b.length)[0];
}
/**
 * Populate the dashboard globals + invoke the existing render chain.
 * Mirrors the bootstrap line the server-mode main.js emits at the end
 * of the inlined script block.
 */
function applyToDashboard(data, reportName, reportPath, md) {
    const w = window;
    w.DATA = data;
    w.pageData = data.pages;
    w.REPORT_NAME = reportName;
    w.REPORT_PATH = reportPath;
    w.MARKDOWN = md.md;
    w.MEASURES_MD = md.measuresMd;
    w.FUNCTIONS_MD = md.functionsMd;
    w.CALCGROUPS_MD = md.calcGroupsMd;
    w.QUALITY_MD = md.qualityMd;
    w.DATA_DICTIONARY_MD = md.dataDictionaryMd;
    // Call every render the server-mode bootstrap calls. Missing functions
    // are skipped silently so a partial main.js bundle still boots.
    const fns = [
        "renderSummary", "renderTabs", "renderMeasures", "renderColumns",
        "renderTables", "renderRelationships", "renderSources",
        "renderFunctions", "renderCalcGroups", "renderPages",
        "renderUnused", "renderDocs", "addCopyButtons",
    ];
    for (const fn of fns) {
        const f = w[fn];
        if (typeof f === "function") {
            try {
                f();
            }
            catch (e) {
                // eslint-disable-next-line no-console
                console.warn(`[entry] ${fn} threw:`, e);
            }
        }
    }
    if (typeof w.switchTab === "function")
        w.switchTab("measures");
}
// ─────────────────────────────────────────────────────────────────────
// Wire up on DOM ready
// ─────────────────────────────────────────────────────────────────────
function init() {
    if (!isFsaSupported()) {
        setStatus("Browser mode needs the File System Access API — open this page in Chrome, Edge, or Opera.", "error");
        const btn = pickButton();
        if (btn)
            btn.disabled = true;
        return;
    }
    showOverlay();
    const btn = pickButton();
    if (btn)
        btn.addEventListener("click", () => { void pickAndLoad(); });
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
}
else {
    init();
}
