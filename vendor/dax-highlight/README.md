# vendor/dax-highlight

Vendored copy of **dax-highlight** — a tiny, dependency-free DAX syntax highlighter.

## Source

Upstream: `C:\Users\jonathan\OneDrive\jonathan-pap.github.io\dist\dax-highlight\` (author: Jonathan Papworth, MIT).

## Why vendored (instead of a runtime npm dep)

The whole PowerBI-Lineage app has a strict *zero runtime dependencies* policy — only Node builtins in production. Vendoring keeps that intact. The highlighter is ~300 lines of plain JS + ~70 lines of CSS, reviewed into the repo, upgraded manually when a new version lands.

## Files

| File | Purpose |
|---|---|
| `dax-highlight.js` | UMD highlighter. Exposes `window.DaxHighlight` when loaded as a `<script>`. |
| `dax-highlight.css` | Default theme, all token colours exposed as CSS custom properties. |

## How it's wired in

`src/html-generator.ts` reads both files at generation time and inlines them into the generated dashboard HTML:

- The CSS is appended to the main `<style>` block.
- The JS is injected into its own `<script>` tag right before the main dashboard script.
- After every render that produces a `.lineage-dax` block (openLineage, renderFunctions, renderCalcGroups) we call `DaxHighlight.highlightAll(document, '.lineage-dax:not(.code-dax)')` to colourise it.

Our dark/light theme toggle overrides the `--dax-*` custom properties to blend with our `--clr-*` palette, see the `[data-theme="light"] .code-dax` rules at the bottom of the main stylesheet.

## Upgrading

1. Drop the new `dax-highlight.js` / `dax-highlight.css` into this folder.
2. Run `npm test` — the `tests/render-dax-highlight.test.ts` smoke test verifies the highlighter still exposes the expected API surface.
3. If the upstream renames any `.dax-*` token classes, update the theme-bridge block in `src/html-generator.ts`.
