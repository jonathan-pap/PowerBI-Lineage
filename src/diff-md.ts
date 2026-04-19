/**
 * Markdown renderer for `DiffResult`.
 *
 * Two output forms:
 *   - `renderDiffMd(result)`         — full report, every change spelled
 *                                        out with diff bodies. For wiki
 *                                        pages / change logs.
 *   - `renderDiffSummaryMd(result)`  — terse form with collapsed
 *                                        sections. For PR comments where
 *                                        the GitHub char-limit matters.
 *
 * Both forms use the same emoji legend (🔴 breaking, 🟡 caution,
 * 🟢 safe) the rest of the MD output uses so a reviewer skimming a
 * mixed-output wiki doesn't have to relearn the glyph vocabulary.
 */

import type { DiffChange, DiffResult } from "./differ.js";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const RISK_ICON: Record<string, string> = {
  breaking: "🔴",
  caution: "🟡",
  safe: "🟢",
};

/**
 * Human-readable label for a change `kind`. We don't expose the raw
 * machine tag in the MD (too noisy) — this maps each kind to a phrase
 * that reads naturally after the entity's key.
 */
const KIND_LABEL: Record<string, string> = {
  "table-added": "Table added",
  "table-removed": "Table removed",
  "column-added": "Column added",
  "column-removed": "Column removed",
  "column-datatype-changed": "Column dataType changed",
  "column-iskey-changed": "Column isKey changed",
  "column-ishidden-changed": "Column visibility changed",
  "column-iscalculated-changed": "Column calculated flag changed",
  "column-summarizeby-changed": "Column summarizeBy changed",
  "column-formatstring-changed": "Column format changed",
  "column-datacategory-changed": "Column data category changed",
  "column-description-changed": "Column description updated",
  "column-displayfolder-changed": "Column display folder changed",
  "column-sortby-changed": "Column sortByColumn changed",
  "measure-added": "Measure added",
  "measure-removed": "Measure removed",
  "measure-dax-changed": "Measure DAX changed",
  "measure-formatstring-changed": "Measure format changed",
  "measure-description-changed": "Measure description updated",
  "measure-displayfolder-changed": "Measure display folder changed",
  "measure-proxy-changed": "Measure proxy flag changed",
  "measure-proxy-target-changed": "Measure proxy target changed",
  "relationship-added": "Relationship added",
  "relationship-removed": "Relationship removed",
  "relationship-active-changed": "Relationship activity flipped",
  "calcgroup-added": "Calc group added",
  "calcgroup-removed": "Calc group removed",
  "calcgroup-precedence-changed": "Calc group precedence changed",
  "calcitem-added": "Calc item added",
  "calcitem-removed": "Calc item removed",
  "calcitem-expression-changed": "Calc item DAX changed",
  "calcitem-formatstring-changed": "Calc item format changed",
  "function-added": "UDF added",
  "function-removed": "UDF removed",
  "function-signature-changed": "UDF signature changed",
  "function-body-changed": "UDF body changed",
  "partition-mode-changed": "Partition mode changed",
  "partition-sourcetype-changed": "Partition source type changed",
  "partition-sourcelocation-changed": "Partition source location changed",
  "partition-expressionsource-changed": "Partition expression source changed",
  "model-culture-changed": "Model culture changed",
  "model-discourageimplicitmeasures-changed": "discourageImplicitMeasures changed",
  "model-valuefilterbehavior-changed": "valueFilterBehavior changed",
  "model-compatibilitylevel-changed": "Compatibility level changed",
};

function labelFor(c: DiffChange): string {
  return KIND_LABEL[c.kind] || c.kind;
}

/** Pretty-print one change as a bullet line — used by both summary
 *  and full forms for the short items. Longer items (DAX diffs) use
 *  their own block renderer below. */
function bulletLine(c: DiffChange): string {
  const label = labelFor(c);
  const base = `\`${c.key}\``;
  // Preference order for extra detail:
  //   1. explicit `detail` (human-composed)
  //   2. old → new pair
  //   3. nothing
  if (c.detail) return `- **${label}**: ${base} — ${c.detail}`;
  if (c.oldValue !== undefined && c.newValue !== undefined) {
    return `- **${label}**: ${base} — \`${c.oldValue}\` → \`${c.newValue}\``;
  }
  return `- **${label}**: ${base}`;
}

/** Long-form block — used in the full report for DAX changes + the
 *  removal-with-consumers case. Includes fenced diff bodies. */
function longBlock(c: DiffChange): string {
  const out: string[] = [];
  out.push(`### ${labelFor(c)} — \`${c.key}\``);
  if (c.detail) out.push(c.detail);
  if (c.oldValue !== undefined && c.newValue !== undefined) {
    out.push(`\`${c.oldValue}\` → \`${c.newValue}\``);
  }
  if (c.consumers && c.consumers.length) {
    out.push("");
    out.push(`Consumers that referenced this (${c.consumers.length}):`);
    for (const con of c.consumers.slice(0, 20)) out.push(`- \`${con}\``);
    if (c.consumers.length > 20) out.push(`- …and ${c.consumers.length - 20} more`);
  }
  if (c.diffBody) {
    out.push("");
    out.push("```diff");
    out.push(c.diffBody);
    out.push("```");
  }
  return out.join("\n");
}

/**
 * A change belongs in a "long block" if it carries either a diff body
 * or consumer list. Everything else is a one-line bullet. This keeps
 * the full report scannable — tier sections don't balloon into a wall
 * of headers.
 */
function isLongForm(c: DiffChange): boolean {
  return !!(c.diffBody || (c.consumers && c.consumers.length));
}

function tierHeader(tier: "breaking" | "caution" | "safe", count: number, label: string): string {
  return `## ${RISK_ICON[tier]} ${label} (${count})`;
}

function summaryLine(r: DiffResult): string {
  const parts: string[] = [];
  if (r.summary.breaking > 0) parts.push(`🔴 **${r.summary.breaking} breaking**`);
  else parts.push(`🔴 0 breaking`);
  if (r.summary.caution > 0) parts.push(`🟡 ${r.summary.caution} caution`);
  else parts.push(`🟡 0 caution`);
  parts.push(`🟢 ${r.summary.safe} safe`);
  return parts.join(" · ");
}

// ─────────────────────────────────────────────────────────────────────
// Full report
// ─────────────────────────────────────────────────────────────────────

/**
 * Full diff report — every change with details. Intended as a wiki
 * page or attached build artifact. ~1-5 KB on a modest change set;
 * larger on a release-sized diff.
 */
export function renderDiffMd(r: DiffResult): string {
  const lines: string[] = [];
  lines.push(`# Model Diff — ${r.oldLabel} → ${r.newLabel}`);
  lines.push("");
  lines.push(`**Summary:** ${summaryLine(r)} · ${r.summary.total} change${r.summary.total === 1 ? "" : "s"} total`);
  lines.push("");

  if (r.summary.total === 0) {
    lines.push("_No meaningful changes detected between the two models._");
    lines.push("");
    return lines.join("\n");
  }

  renderTier(lines, "breaking", "Breaking changes", r.breaking);
  renderTier(lines, "caution", "Caution", r.caution);
  renderTier(lines, "safe", "Safe additions / cosmetic", r.safe);

  lines.push("---");
  lines.push(`<sub>Generated by powerbi-lineage diff</sub>`);
  lines.push("");
  return lines.join("\n");
}

function renderTier(
  lines: string[],
  tier: "breaking" | "caution" | "safe",
  label: string,
  changes: DiffChange[],
): void {
  if (changes.length === 0) return;
  lines.push(tierHeader(tier, changes.length, label));
  lines.push("");

  const long = changes.filter(isLongForm);
  const short = changes.filter(c => !isLongForm(c));

  for (const c of long) {
    lines.push(longBlock(c));
    lines.push("");
  }
  if (short.length > 0) {
    for (const c of short) lines.push(bulletLine(c));
    lines.push("");
  }
}

// ─────────────────────────────────────────────────────────────────────
// PR-comment summary
// ─────────────────────────────────────────────────────────────────────

/**
 * PR-comment summary — terse, collapsible. Each tier is a `<details>`
 * block the reviewer can expand. Fits comfortably under GitHub's
 * 65,536-char comment limit even on large diffs because everything is
 * one-line-per-change.
 */
export function renderDiffSummaryMd(r: DiffResult): string {
  const lines: string[] = [];
  lines.push(`## 📊 Model diff · ${r.oldLabel} → ${r.newLabel}`);
  lines.push("");
  lines.push(summaryLine(r));
  lines.push("");

  if (r.summary.total === 0) {
    lines.push("_No meaningful changes detected._");
    lines.push("");
    lines.push(`<sub>Generated by powerbi-lineage diff</sub>`);
    return lines.join("\n");
  }

  renderTierSummary(lines, "breaking", "Breaking", r.breaking, true);
  renderTierSummary(lines, "caution", "Caution", r.caution, r.breaking.length === 0);
  renderTierSummary(lines, "safe", "Safe additions", r.safe, false);

  lines.push(`<sub>Generated by powerbi-lineage diff</sub>`);
  return lines.join("\n");
}

function renderTierSummary(
  lines: string[],
  tier: "breaking" | "caution" | "safe",
  label: string,
  changes: DiffChange[],
  openByDefault: boolean,
): void {
  if (changes.length === 0) return;
  const open = openByDefault ? " open" : "";
  lines.push(`<details${open}><summary>${RISK_ICON[tier]} ${label} (${changes.length})</summary>`);
  lines.push("");
  for (const c of changes) {
    // Summary form drops diff bodies — keep one-line bullets only.
    // Consumers get a terse inline count instead of a list.
    const base = bulletLine(c);
    const suffix = c.consumers && c.consumers.length
      ? ` _(${c.consumers.length} consumer${c.consumers.length === 1 ? "" : "s"})_`
      : "";
    lines.push(base + suffix);
  }
  lines.push("</details>");
  lines.push("");
}
