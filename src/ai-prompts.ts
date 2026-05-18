/**
 * AI cleanup prompt generator.
 *
 * Turns the existing audit's "unused measures" + "dead-chain measures"
 * findings into a markdown prompt the user can paste into the AI tool
 * of their choice (recommended: Claude Code with the `pbi-desktop`
 * plugin) to actually delete those measures from a live model.
 *
 * Lineage itself never mutates the model — this module is the entire
 * v1 surface area of the "AI cleanup handoff" feature. See
 * claudedocs/intake-specs/design-ai-cleanup-handoff.md for the
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
