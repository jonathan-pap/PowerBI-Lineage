/**
 * Cleanup-export generators (AI prompt + Tabular Editor script).
 *
 * Two formats over the same audit data:
 *   1. buildCleanupPrompt  — markdown for Claude Code / any AI agent.
 *   2. buildTabularEditorScript — C# .csx script paste-into-TE2/TE3
 *      Advanced Scripting tab. Direct execution, no AI loop.
 *
 * Same input (FullData + category), same EXTERNALMEASURE / auto-date
 * filtering, same Stage 1 / Stage 2 ordering. The two formats serve
 * different users: AI prompt for users who want a conversational
 * safety check, TE script for users already living in Tabular Editor.
 *
 * Lineage itself never mutates the model — this module just emits text.
 * See claudedocs/intake-specs/design-ai-cleanup-handoff.md for the
 * locked decisions and the rationale for the read-only commitment.
 */
import type { FullData, ModelMeasure } from "./data-builder.js";

// Note: this module is intentionally **self-contained** so it can be
// concatenated into the dashboard's inline <script> block (a classic
// script, not a module bundle). The dead-chain algorithm is duplicated
// from improvements.ts as `findDeadChainMeasures` below — kept in sync
// by the tests in tests/ai-prompts.test.ts and tests/improvements.test.ts
// asserting the same fixture produces the same dead-chain output.

export type CleanupCategory =
  | "unused-measures"
  | "dead-chain-measures"
  | "measures-all";

export interface BuildCleanupPromptOptions {
  /** Override the ISO date stamp emitted in the prompt body. Used by tests. */
  now?: Date;
}

export interface CleanupTargetCounts {
  /** Directly-unused user measures, EXTERNALMEASURE proxies excluded. */
  stage1: number;
  /** Dead-chain user measures (reachable only via Stage 1), EXTERNALMEASURE proxies excluded. */
  stage2: number;
}

interface KillTarget {
  table: string;
  name: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function userMeasures(data: FullData): ModelMeasure[] {
  // Same filter as runImprovementChecks — auto-date tables are engine-
  // generated and not user-managed, so their measures are never kill
  // candidates even if they look unused.
  return data.measures.filter(m => {
    const t = data.tables.find(tt => tt.name === m.table);
    return !t || t.origin !== "auto-date";
  });
}

function isExternalProxy(m: ModelMeasure): boolean {
  return m.externalProxy !== null;
}

function stage1Targets(data: FullData): KillTarget[] {
  return userMeasures(data)
    .filter(m => m.status === "unused" && !isExternalProxy(m))
    .map(m => ({ table: m.table, name: m.name }));
}

/**
 * Inline copy of improvements.deadChainMeasures so this module has no
 * dependency on improvements.ts (allows it to be inlined into the
 * dashboard's classic-script bundle without dragging improvements.ts
 * along). Same algorithm: BFS from every status:"direct" measure
 * through the dep graph; anything unreachable AND not already marked
 * unused is dead-chain. Two callers, one definition — kept in sync by
 * shared-fixture tests on both sides.
 */
function findDeadChainMeasures(data: FullData): string[] {
  const byName = new Map<string, ModelMeasure>(data.measures.map(m => [m.name, m]));
  const reachable = new Set<string>();
  const queue: string[] = data.measures
    .filter(m => m.status === "direct")
    .map(m => m.name);
  while (queue.length) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const m = byName.get(current);
    if (!m) continue;
    for (const dep of m.daxDependencies) {
      if (!reachable.has(dep)) queue.push(dep);
    }
  }
  return data.measures
    .filter(m => !reachable.has(m.name) && m.status !== "unused")
    .map(m => m.name);
}

function stage2Targets(data: FullData): KillTarget[] {
  const um = userMeasures(data);
  const byName = new Map(um.map(m => [m.name, m]));
  const deadNames = findDeadChainMeasures(data);
  return deadNames
    .map(n => byName.get(n))
    .filter((m): m is ModelMeasure => m !== undefined)
    .filter(m => m.status !== "unused" && !isExternalProxy(m))
    .map(m => ({ table: m.table, name: m.name }));
}

function renderTargetList(targets: KillTarget[]): string {
  if (targets.length === 0) return "_(none flagged)_";
  return targets.map(t => `- \`${t.table}[${t.name}]\``).join("\n");
}

const RECOMMENDED_TOOL = `## Recommended tool
If you are Claude Code and the \`pbi-desktop\` plugin from data-goblins is
installed, use its \`connect-pbid\` skill. Otherwise, use TOM via PowerShell
or the Tabular Editor CLI. Do **not** edit TMDL files directly while
Power BI Desktop is open.`;

const SAFETY_CONSTRAINTS = `## Safety constraints — read before acting
1. Confirm with me before each deletion.
2. Process **Stage 1 (directly unused)** completely before touching Stage 2 (dead-chain).
   After Stage 1, re-run the audit; some Stage 2 items may need to stay.
3. Before deleting each measure, read its DAX from the live model. If the
   expression contains \`EXTERNALMEASURE(...)\` it is bound to a remote
   Analysis Services cube and looks orphaned only from this side — skip it.
   (PowerBI-Lineage already excludes proxies it can identify statically, but
   verify directly as belt-and-braces.)
4. If a measure's name starts with \`_\` it may be an intentional helper —
   prompt me before deleting, do not auto-skip.
5. After all deletions, call \`$model.SaveChanges()\` once; verify the model
   still opens in Power BI Desktop with no broken-reference errors.
6. Power BI Desktop's Ctrl+Z does NOT undo TOM changes. Make a \`.pbip\`
   git commit before starting.`;

const VERIFICATION = `## Verification
After all stages complete:
- Re-open the \`.pbip\` in Power BI Desktop; no error dialog should appear.
- Open the Improvements tab in PowerBI-Lineage; the "unused measures" and
  "dead-chain measures" findings should be empty or reduced as expected.
- If anything looks wrong, \`git reset --hard\` to the pre-cleanup commit.`;

function titleFor(category: CleanupCategory): string {
  switch (category) {
    case "unused-measures":     return "Cleanup task — delete unused Power BI measures";
    case "dead-chain-measures": return "Cleanup task — delete dead-chain Power BI measures";
    case "measures-all":        return "Cleanup task — delete unused + dead-chain Power BI measures";
  }
}

function goalFor(category: CleanupCategory, date: string): string {
  const common = `This list was generated by PowerBI-Lineage's static audit on ${date}.`;
  switch (category) {
    case "unused-measures":
      return `## Goal
Delete the measures listed in \`## Targets\` below from my Power BI model.
${common} Each measure is consumed by **zero** visuals across **zero** pages
and is not referenced by any other in-use measure.`;
    case "dead-chain-measures":
      return `## Goal
Delete the measures listed in \`## Targets\` below from my Power BI model.
${common} Each measure IS referenced by other measures, but those measures
are themselves never on a visual — the whole chain terminates in nothing.
**This is Stage 2 work.** Complete Stage 1 (directly unused) first and
re-run the audit; some items below may no longer apply.`;
    case "measures-all":
      return `## Goal
Delete the measures listed in \`## Targets\` below from my Power BI model.
${common} Stage 1 = directly unused (zero visual bindings, no other measure
references them). Stage 2 = dead-chain (referenced only by Stage 1 measures).
Do Stage 1 first, then re-audit before touching Stage 2.`;
  }
}

/**
 * Count what `buildCleanupPrompt` would emit for each stage, without
 * rendering the prompt. Used by the Unused-tab toolbar to decide
 * whether to show the "Generate AI cleanup prompt" button and what
 * to label it with. Numbers match what ends up in the prompt body
 * (EXTERNALMEASURE proxies excluded, auto-date tables excluded),
 * which can be lower than the Unused-tab card count.
 */
export function countCleanupTargets(data: FullData): CleanupTargetCounts {
  return {
    stage1: stage1Targets(data).length,
    stage2: stage2Targets(data).length,
  };
}

export function buildCleanupPrompt(
  data: FullData,
  category: CleanupCategory,
  opts: BuildCleanupPromptOptions = {},
): string {
  const date = isoDate(opts.now ?? new Date());
  const s1 = stage1Targets(data);
  const s2 = stage2Targets(data);

  const sections: string[] = [
    `# ${titleFor(category)}`,
    goalFor(category, date),
    RECOMMENDED_TOOL,
    SAFETY_CONSTRAINTS,
  ];

  const targetSection: string[] = ["## Targets"];

  if (category === "unused-measures" || category === "measures-all") {
    targetSection.push(`### Stage 1 — directly unused (${s1.length} measure${s1.length === 1 ? "" : "s"})

${renderTargetList(s1)}`);
  }

  if (category === "dead-chain-measures" || category === "measures-all") {
    targetSection.push(`### Stage 2 — dead-chain (${s2.length} measure${s2.length === 1 ? "" : "s"}, only kill after Stage 1 + re-audit)

${renderTargetList(s2)}`);
  }

  sections.push(targetSection.join("\n\n"));
  sections.push(VERIFICATION);

  return sections.join("\n\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────
// Tabular Editor C# script (.csx) generator
//
// Targets TE2 (free) + TE3 (paid) — both run on .NET Framework 4.7.2+
// or .NET 5+/.NET 6+, all of which support C# 6+ syntax including
// string interpolation (`$"..."`) and anonymous types (used here).
//
// Anonymous types over value tuples on purpose: anonymous types
// existed since C# 3.0, value tuples need C# 7 + System.ValueTuple.
// Anonymous-type targets are universally portable across TE2/TE3
// versions without dragging in any extra references.
// ─────────────────────────────────────────────────────────────────────

interface ScriptEntry {
  table: string;
  name: string;
  stage: "Stage 1" | "Stage 2";
}

/** Escape a string for safe inclusion as a C# double-quoted literal. */
function csLit(s: string): string {
  return '"' + s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    + '"';
}

function teScriptHeader(category: CleanupCategory, date: string, s1Count: number, s2Count: number): string {
  let summary: string;
  switch (category) {
    case "unused-measures":
      summary = `${s1Count} directly-unused measure${s1Count === 1 ? "" : "s"}`;
      break;
    case "dead-chain-measures":
      summary = `${s2Count} dead-chain measure${s2Count === 1 ? "" : "s"}`;
      break;
    case "measures-all":
      summary = `${s1Count} directly-unused + ${s2Count} dead-chain`;
      break;
  }
  return `// PowerBI-Lineage cleanup script — generated ${date}
// Category: ${category} (${summary})
//
// USAGE
//   1. Open the model in Tabular Editor 2 or 3.
//   2. Paste this script into the "Advanced Scripting" tab.
//   3. Run (F5).
//   4. Tabular Editor does NOT auto-save — press Ctrl+S to persist
//      deletions to the .pbix / .pbip / database.
//   5. Re-open the project in PowerBI-Lineage to confirm the audit
//      shrinks as expected.
//
// SAFETY GUARDS
//   - Missing tables / measures are skipped, not errored — script is
//     safe to re-run after a partial save.
//   - EXTERNALMEASURE proxies are double-guarded at runtime in case
//     one slipped past Lineage's static filter (rare but possible
//     with multi-line/comment-obscured DAX).
//   - Helper measures whose name starts with "_" are deleted along
//     with the rest. If you want to spare them, edit the targets
//     array below before running.
//
// Lineage never mutates models itself — this script is the user's
// chosen way to act on the audit's findings. PBI Desktop's Ctrl+Z
// does NOT undo TOM-level changes; make a git commit of the .pbip
// before running if you want a rollback path.`;
}

function teScriptBody(entries: ScriptEntry[]): string {
  if (entries.length === 0) {
    return `

Output("PowerBI-Lineage: no measures flagged for this category. Nothing to do.");
`;
  }
  const tupleLines = entries.map(e =>
    `    new { Table = ${csLit(e.table)}, Measure = ${csLit(e.name)}, Stage = ${csLit(e.stage)} },`,
  ).join("\n");
  return `

var targets = new[] {
${tupleLines}
};

int deleted = 0, skipped = 0;
foreach (var t in targets) {
    var tbl = Model.Tables.FindByName(t.Table);
    if (tbl == null) {
        Output($"SKIP {t.Stage}: table [{t.Table}] not found");
        skipped++; continue;
    }
    var m = tbl.Measures.FindByName(t.Measure);
    if (m == null) {
        Output($"SKIP {t.Stage}: [{t.Table}].[{t.Measure}] not found (already deleted?)");
        skipped++; continue;
    }
    if (m.Expression != null &&
        m.Expression.IndexOf("EXTERNALMEASURE", StringComparison.OrdinalIgnoreCase) >= 0) {
        Output($"SKIP {t.Stage}: [{t.Table}].[{t.Measure}] is an EXTERNALMEASURE proxy");
        skipped++; continue;
    }
    m.Delete();
    Output($"DELETED {t.Stage}: [{t.Table}].[{t.Measure}]");
    deleted++;
}
Output("");
Output($"Done. Deleted {deleted}, skipped {skipped}. Press Ctrl+S to persist.");
`;
}

/**
 * Generate a paste-into-Tabular-Editor cleanup script for the given
 * category. Same filtering as buildCleanupPrompt — EXTERNALMEASURE
 * proxies and auto-date measures excluded statically, with a runtime
 * EXTERNALMEASURE guard inside the script as defence-in-depth.
 *
 * Stage 1 entries come first regardless of category. For measures-all,
 * the script processes Stage 1 then Stage 2 in one pass — TE doesn't
 * need the "re-audit between stages" beat that the AI prompt uses,
 * because deletion is atomic within a single script run.
 */
export function buildTabularEditorScript(
  data: FullData,
  category: CleanupCategory,
  opts: BuildCleanupPromptOptions = {},
): string {
  const date = isoDate(opts.now ?? new Date());
  const s1 = stage1Targets(data);
  const s2 = stage2Targets(data);
  const entries: ScriptEntry[] = [];
  if (category === "unused-measures" || category === "measures-all") {
    for (const t of s1) entries.push({ table: t.table, name: t.name, stage: "Stage 1" });
  }
  if (category === "dead-chain-measures" || category === "measures-all") {
    for (const t of s2) entries.push({ table: t.table, name: t.name, stage: "Stage 2" });
  }
  return teScriptHeader(category, date, s1.length, s2.length) + teScriptBody(entries);
}
