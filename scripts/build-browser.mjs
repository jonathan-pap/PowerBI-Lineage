#!/usr/bin/env node
/**
 * build-browser.mjs — assemble `docs/` for the static browser build.
 *
 * Steps:
 *   1. Render a dashboard shell by calling the existing `generateHTML`
 *      with an empty `FullData`. That gives us all the panel divs,
 *      inlined CSS, the vendored DAX highlighter, and the compiled
 *      client main.js the renderer expects — exactly what the server
 *      mode produces.
 *   2. Post-process the HTML: inject an import-map (redirecting `fs`
 *      and `path` bare-imports to our shims), the browser entry
 *      module, and the "Open folder" overlay.
 *   3. Write to `docs/index.html`.
 *
 * The browser-compiled TS modules (data-builder, model-parser, etc.)
 * were already emitted to `docs/` by `tsc -p tsconfig.browser.json` —
 * this script runs AFTER that step and just wires the shell.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFullData } from "../dist/data-builder.js";
import { generateHTML } from "../dist/html-generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const docsDir = resolve(repoRoot, "docs");

// ─────────────────────────────────────────────────────────────────────
// 1. Empty FullData — minimal shape that survives every renderer.
//    We deliberately DON'T pass a real report; the shell is meant to
//    render with zero data and populate at runtime.
// ─────────────────────────────────────────────────────────────────────

const emptyData = {
  measures: [], columns: [], relationships: [], functions: [],
  calcGroups: [], tables: [], pages: [], hiddenPages: [], allPages: [],
  expressions: [], compatibilityLevel: null,
  modelProperties: {
    name: "(no model loaded)",
    description: "",
    culture: "",
    sourceQueryCulture: "",
    discourageImplicitMeasures: false,
    valueFilterBehavior: "",
    cultures: [],
    defaultPowerBIDataSourceVersion: "",
  },
  totals: {
    measuresInModel: 0, measuresDirect: 0, measuresIndirect: 0, measuresUnused: 0,
    columnsInModel: 0, columnsDirect: 0, columnsIndirect: 0, columnsUnused: 0,
    relationships: 0, functions: 0, calcGroups: 0, tables: 0, pages: 0, visuals: 0,
  },
};

const html = generateHTML(emptyData, "(browser)", "", "", "", "", "", "", "0");

// ─────────────────────────────────────────────────────────────────────
// 2. Inject browser wiring.
//
// - Import map: every bare `import "fs"` / `import "path"` inside the
//   compiled modules gets redirected to our shims. ES modules need an
//   absolute-or-relative URL here, so we use document-relative paths
//   (`./browser/...`) which also work under a sub-path deploy like
//   `gh-pages/PowerBI-Lineage/`.
//
// - Landing overlay: sits on top of the dashboard; hidden once the
//   user picks a folder and the render chain re-runs with real data.
//
// - Entry module: loads LAST so the dashboard's render globals are
//   defined before the entry wires up click handlers.
// ─────────────────────────────────────────────────────────────────────

const importMap = `
<script type="importmap">
{
  "imports": {
    "fs": "./browser/fs-shim.js",
    "path": "./browser/path-shim.js"
  }
}
</script>
`.trim();

const overlayStyles = `
<style>
  #br-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(11, 13, 17, 0.92);
    -webkit-backdrop-filter: blur(12px);
            backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DM Sans', system-ui, -apple-system, Segoe UI, sans-serif;
    color: #F9FAFB;
    transition: opacity .18s ease;
  }
  #br-overlay.br-overlay--hidden { opacity: 0; pointer-events: none; }

  .br-card {
    max-width: 520px;
    padding: 48px 40px;
    background: rgba(17, 24, 39, 0.75);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    text-align: center;
  }
  .br-card h1 {
    margin: 0 0 12px;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: linear-gradient(180deg, #F9FAFB 0%, #9CA3AF 100%);
    -webkit-background-clip: text;
            background-clip: text;
    color: transparent;
  }
  .br-card p { margin: 0 0 20px; color: #D1D5DB; font-size: 14px; line-height: 1.5; }
  #br-pick {
    display: inline-block;
    padding: 12px 24px;
    background: #F59E0B;
    color: #0B0D11;
    border: 0;
    border-radius: 8px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: transform .1s, box-shadow .1s;
  }
  #br-pick:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(245,158,11,0.4); }
  #br-pick:disabled { background: #4B5563; color: #9CA3AF; cursor: not-allowed; }
  .br-status {
    margin-top: 16px;
    font-size: 12px;
    min-height: 18px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    color: #94A3B8;
  }
  .br-status--error { color: #F87171; }
  .br-hint { margin-top: 24px; font-size: 11px; color: #6B7280; }
</style>
`.trim();

const overlayHtml = `
<div id="br-overlay">
  <div class="br-card">
    <h1>Power BI Lineage</h1>
    <p>Open a PBIP project folder — the one that contains a <code>.Report</code> folder and its <code>.SemanticModel</code> sibling. Files stay on your machine; nothing is uploaded.</p>
    <button id="br-pick" type="button">Open folder</button>
    <div id="br-status" class="br-status" aria-live="polite"></div>
    <div class="br-hint">Requires Chrome, Edge, or Opera (File System Access API)</div>
  </div>
</div>
<script type="module" src="./browser/entry.js"></script>
`.trim();

// Splice everything in right before </body>. The import map has to
// appear BEFORE the entry <script type="module"> or the browser won't
// apply it to the entry's transitive imports.
const injection = `${importMap}\n${overlayStyles}\n${overlayHtml}\n`;

const patched = html.replace(/<\/body>/i, injection + "</body>");

if (patched === html) {
  console.error("build-browser: couldn't find </body> marker to inject overlay + entry. Shell generator output changed?");
  process.exit(1);
}

writeFileSync(resolve(docsDir, "index.html"), patched, "utf8");

// A .nojekyll marker tells GitHub Pages not to run Jekyll (which
// ignores files/folders starting with `_`). We do have an `_measures`
// reference inside generated content that could theoretically confuse
// Jekyll, so flag it off to be safe.
writeFileSync(resolve(docsDir, ".nojekyll"), "", "utf8");

// eslint-disable-next-line no-console
console.log(`build-browser: wrote ${patched.length} bytes to docs/index.html`);
