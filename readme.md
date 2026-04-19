# Power BI Lineage

Standalone, zero-dependency Node.js app that analyses a Power BI report's usage and model lineage.

Point it at a `.Report` folder that sits next to its `.SemanticModel` sibling and get an interactive dashboard showing:

- **Measures** — DAX, dependencies, which visuals and pages use each one, direct/indirect/unused status
- **Columns** — data types, slicer usage, usage counts, status
- **Tables** — columns with PK/FK/calc/hidden badges, relationships, measures
- **Relationships** — active + inactive, from/to mapping
- **Functions** — user-defined DAX functions, parameters, measures that call them
- **Calc Groups** — items, precedence, format-string expressions
- **Pages** — visuals per page, visual-type breakdown, coverage per page
- **Unused** — pure orphan measures, dead-chain measures, orphan columns, indirect-use measures/columns
- **Lineage** — click any measure/column to see upstream dependencies, source table, and downstream visuals

Dark/light themes, DAX copy buttons, client-side search and sort.

## Requirements

- Node.js 18+
- A `.Report` folder (PBIP format) with a sibling `.SemanticModel` folder

## Running

### Double-click (Windows)

```
launch.bat
```

First run does `npm install` + `npm run build`, then starts the app and opens your browser.

### From the terminal

```
npm install
npm run build
node dist/app.js
```

The app listens on `http://localhost:5679` (or the next free port). Paste the path to your `.Report` folder, or use the Browse button to pick it. Recent reports are remembered.

## Browser mode (install-free)

The dashboard can also run **entirely in the browser** with no Node install — pick a PBIP folder via the File System Access API and the parser + renderer run client-side. Your files stay on your machine; nothing is uploaded.

### Live

[**→ Open the browser build**](https://jonathan-pap.github.io/PowerBI-Lineage/) (requires Chrome, Edge, or Opera — Firefox and Safari don't support the File System Access API yet)

1. Click **Open folder**.
2. Pick the PBIP project folder — the one that contains both `<Name>.Report` and `<Name>.SemanticModel`.
3. Dashboard renders in the same page.

### Build + serve locally

```
npm run build:browser    # compiles to ./docs/
npm run serve:browser    # starts a local server on 127.0.0.1:5700
```

The browser build reuses the existing parser, data-builder, and md-generator unchanged — only three small new modules sit between them and the browser's storage API:

- `src/browser/fs-shim.ts` — pretends to be `fs` but reads from an in-memory Map
- `src/browser/path-shim.ts` — POSIX-style `path` replacement
- `src/browser/fsa-walk.ts` — walks a `FileSystemDirectoryHandle` into the Map

At runtime an import-map in `docs/index.html` redirects bare `import ... from "fs"` / `"path"` calls to the shims. The parser never knows the difference.

### Deploy

`.github/workflows/pages.yml` auto-publishes `docs/` to GitHub Pages on every push to `main`. No manual deploy step.

## Project layout

```
src/
  pbir-reader.ts     Read-only access to PBIR report/page/visual JSON
  model-parser.ts    findSemanticModelPath + TMDL + BIM parsers
  report-scanner.ts  Walks visuals/filters/objects to extract field bindings
  data-builder.ts    Cross-references model + report into FullData
  html-generator.ts  Dashboard HTML template
  render/safe.ts     HTML/JS/JSON escape helpers (single source of truth)
  app.ts             HTTP server + landing page + folder picker
  browser/           Browser-mode shims: fs + path + FSA-API walker + entry shell

scripts/
  build-browser.mjs  Assembles docs/ from dist/ + the browser TS output
  serve-browser.mjs  Tiny static server for local browser-mode testing

tests/               Unit tests (compiled via tsconfig.test.json -> dist-test/)
```

## Zero runtime dependencies

Runtime deps: none. Only Node builtins (`fs`, `path`, `http`, `crypto`, `child_process`). The `typescript` and `@types/node` dev-deps are only needed to build.

## Developing

```
npm run typecheck    # tsc --noEmit
npm test             # compile tests + run Node's built-in test runner
npm run build        # compile to dist/
```

Tests use the stdlib `node:test` module (Node 18+). No framework deps — the test tsconfig emits to `dist-test/` and `node --test dist-test/tests/` runs everything.

### CI

`.github/workflows/ci.yml` runs typecheck + tests + build on every push and pull request, across Node 18 / 20 / 22. Zero-dep ethos preserved — the workflow installs only what `package.json` already declares (TypeScript + `@types/node`).

## Publishing to Azure DevOps Wiki

The six markdown documents (Model, Data Dictionary, Measures, Functions, Calc Groups, Quality) are designed to paste cleanly into an ADO Wiki without modification. Every generated doc starts with an HTML comment suggesting its wiki page name:

```markdown
<!-- Suggested ADO Wiki page name: Health_and_Safety/Measures -->
# Measures Reference
```

**To publish:**

1. Open the dashboard for your report and switch to the **Docs** tab.
2. For each of the six document tabs (Model / Data Dictionary / Measures / Functions / Calc Groups / Quality):
   - Click **⎘ Copy** to copy the markdown to the clipboard.
   - In ADO Wiki, create a new page with the name from the `<!-- Suggested ADO Wiki page name: ... -->` hint at the top of the markdown.
   - Paste.
3. If you want ADO's auto-generated table of contents in place of the hand-rolled one, type `[[_TOC_]]` on its own line at the top of the page — ADO renders a TOC of every `##` heading in the page.

**Compatibility:**

| Feature | ADO Wiki | GitHub | Dashboard |
|---|---|---|---|
| Anchors (jump-to nav, cross-references) | ✅ `adoSlug` algorithm | ✅ | ✅ |
| `<details>` / `<summary>` collapsibles | ✅ native | ✅ native | ✅ native |
| Pipe tables | ✅ | ✅ | ✅ |
| Fenced `dax` code blocks | ✅ syntax-highlighted | ✅ | ✅ syntax-highlighted |
| ```` ```mermaid ```` lineage / star fragments | ✅ native | ✅ native | ⚠ renders as code block (acceptable fallback) |
| Badge `<span>` styling | ⚠ CSS stripped — falls back to emoji-prefixed plain text (`🔑 PK`) | ⚠ same fallback | ✅ styled as pill |
| Auto-anchor from heading | ✅ | ✅ | ✅ |

Every anchor link is automatically verified by `tests/md-anchors.test.ts` — if a heading's slug ever drifts from its references, CI fires.

## Screenshot

_(placeholder — add once you run it against a real report)_
