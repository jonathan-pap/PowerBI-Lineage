# Page-layout wireframe POC — parked

Snapshot of the three source files at the point the wireframe POC was working
end-to-end. Reverted from the active `src/` because the overall effect didn't
fit the dashboard. Kept here so the work isn't lost.

## What it did

Inside each Pages-tab page card (expanded body), a small SVG wireframe at the
top showed every visual on the page as a coloured rectangle at its actual
position. Hover gave a tooltip with type · title · field bindings. Categories:

| Category | Colour |
|---|---|
| chart  | `#3B82F6` blue |
| table  | `#64748B` slate |
| card   | `#10B981` emerald |
| slicer | `#EC4899` pink |
| map    | `#F59E0B` amber |
| shape  | `#A78BFA` violet |
| button | `#06B6D4` cyan |
| ai     | `#EF4444` red |
| other  | `#6B7280` neutral |

## What's in here

- `report-scanner.ts` — captures per-visual `position` and per-page `width`/`height`. Adds `VisualPosition`, `ScannedVisual`, `ScannedPage` types. Returns `pages` and `visuals` alongside the existing `bindings`.
- `data-builder.ts` — adds `categorizeVisual()`, `WireframeVisual` and `VisualCategory` types. Threads `width`, `height`, and `wireframeVisuals` through `PageData`. Iterates the scanned page list (so even pages with no bound fields are included).
- `html-generator.ts` — replaces the client-side `pageData` IIFE with `DATA.pages`, adds `WF_COLORS` map and `renderPageWireframe(p)` SVG generator, embeds it as a "Layout" section at the top of every page card body, and adds matching CSS (`.wf-wrap`, `.wf-svg`, `.wf-visual`, `.wf-type`, `.wf-title`, `.wf-legend`, `.wf-legend-chip`).

## How to revive

If/when the wireframe is wanted again:

1. Diff each file in this folder against `src/<same name>.ts` to see the deltas
   that were removed.
2. Re-apply them, OR copy the parked file back over the active file (only safe
   if no unrelated changes have landed in the active file since this snapshot).
3. The colours / categorisation rules are isolated and can be reused even if
   the SVG layout itself is reworked (e.g. into a dedicated tab, a thumbnail
   strip, or a different rendering approach).

## Why it was parked

Liked the colours and category split, but the inline-per-card placement didn't
feel right in practice. Possible future directions:

- Dedicated "Layout" tab with one full-width wireframe per page
- Thumbnail strip across the top of the Pages tab
- Inline wireframes only in the rendered Markdown, not the dashboard
- Larger / interactive wireframe with click-to-drill behaviour
