#!/usr/bin/env node
/**
 * bake-sample.mjs — walks `sample/` at build time and emits
 * `docs/sample-data.json`, a flat {path → text} map the browser
 * entry can fetch on "Try a sample" click and feed into the VFS.
 *
 * Why bake instead of ship raw files:
 *   - Only ~111 text files totalling ~1.76 MB; everything else in
 *     sample/ is binary (images, custom-visuals, datamarts) the
 *     parser doesn't read.
 *   - One fetch replaces 111 — avoids a chatty cold-start and cuts
 *     gzipped payload to ~400 KB.
 *   - Skips the file-system walk step in the browser entirely for
 *     the sample path, so "Try a sample" is a one-click demo.
 *
 * Key invariants (must match the in-browser walker in
 * `src/browser/fsa-walk.ts`):
 *   - Paths are forward-slash under `/virt/<pickedName>/…`
 *   - Only files whose extension is .tmdl / .json / .bim / .pbir
 *     are included (plus version.json and report.json).
 *   - Directories named `.pbi`, `node_modules`, `.git`, `.vs*` are
 *     skipped.
 *
 * Output shape:
 *   {
 *     version: 1,
 *     pickedName: "sample",
 *     files: { "/virt/sample/...": "file text" }
 *   }
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sampleDir = resolve(repoRoot, "sample");
const outPath = resolve(repoRoot, "docs", "sample-data.json");

if (!existsSync(sampleDir)) {
  console.log("bake-sample: no `sample/` dir present — skipping (docs/sample-data.json not written)");
  process.exit(0);
}

function shouldRead(name) {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".tmdl") ||
    lower.endsWith(".json") ||
    lower.endsWith(".bim") ||
    lower.endsWith(".pbir") ||
    lower === "version.json" ||
    lower === "report.json"
  );
}

function shouldSkipDir(name) {
  return (
    name === ".pbi" ||
    name === "node_modules" ||
    name === ".git" ||
    name.startsWith(".vs")
  );
}

const pickedName = "sample";
const virtRoot = `/virt/${pickedName}`;
const files = {};
let count = 0;
let bytes = 0;

function walk(dir, virtPath) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    const childVirt = virtPath + "/" + entry;
    if (st.isDirectory()) {
      if (shouldSkipDir(entry)) continue;
      walk(abs, childVirt);
      continue;
    }
    if (st.isFile() && shouldRead(entry)) {
      const text = readFileSync(abs, "utf8");
      files[childVirt] = text;
      count++;
      bytes += text.length;
    }
  }
}

walk(sampleDir, virtRoot);

writeFileSync(
  outPath,
  JSON.stringify({ version: 1, pickedName, files }),
  "utf8",
);

// eslint-disable-next-line no-console
console.log(`bake-sample: ${count} files, ${(bytes / 1024).toFixed(1)} KB → docs/sample-data.json`);
