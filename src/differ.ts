/**
 * Model diff — compare two FullData snapshots and emit a structured,
 * risk-tiered report of what changed between them.
 *
 * Primary use case: generating a Markdown diff for PR comments so
 * reviewers can see the impact of a TMDL change without hand-reading
 * the raw diff. CLI entry point is `app.ts diff <old> <new>`; the
 * diff-md.ts renderer turns this module's `DiffResult` into MD.
 *
 * Design principles:
 *   - **Pure function**: `diffModels(old, new)` has no side effects.
 *   - **Order-independent matching**: entities matched by identity
 *     (table.column names, relationship endpoint tuples), not array
 *     position — TMDL ordering isn't meaningful.
 *   - **Noise-free**: lineage tags, usage counts, derived flags (e.g.
 *     `isInferredPK`), and report-dependent fields are NOT compared.
 *     Those churn without a real model change.
 *   - **Risk-tiered**: every change carries a `risk` tier so downstream
 *     renderers / CI can filter (e.g. `--fail-on breaking`).
 *
 * Risk tiers:
 *   🔴 breaking — consumers *will* fail or return different results
 *                   (removed public measure, dropped relationship,
 *                   column dataType changed, partition mode flipped)
 *   🟡 caution  — may change results (measure DAX edited, partition
 *                   source changed, FK active flag flipped)
 *   🟢 safe     — additive / cosmetic (added entity, description edit,
 *                   format string change, new hidden column)
 *
 * Not in v1:
 *   - Semantic DAX diff (we do textual; doesn't claim results-unchanged)
 *   - RLS / OLS (parser support landing separately)
 *   - Sensitivity labels (ditto)
 *   - Three-way merge / branch-base detection
 */

import type {
  FullData,
  TableData,
  ModelMeasure,
  ModelColumn,
} from "./data-builder.js";
import type {
  ModelRelationship,
  ModelFunction,
  ModelCalcGroup,
  CalcItem,
} from "./model-parser.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type Risk = "breaking" | "caution" | "safe";

/**
 * A single change between old and new. `key` is the display identifier
 * (e.g. `dim_injury[Prior Year Count]`); `kind` is the machine-readable
 * tag the renderer / filter uses to group or drop change types.
 */
export interface DiffChange {
  risk: Risk;
  kind: string;
  entity:
    | "table" | "column" | "measure" | "relationship"
    | "calcgroup" | "calcitem" | "function" | "partition" | "model";
  key: string;
  /** Short one-line context (what changed, not how — keep for MD). */
  detail?: string;
  /** Previous value — string form for easy MD rendering. */
  oldValue?: string;
  /** New value — string form. */
  newValue?: string;
  /**
   * For measure/column removals: consumers in the OLD model that
   * referenced this entity. Lets the MD renderer warn about probable
   * downstream breakage.
   */
  consumers?: string[];
  /**
   * For DAX / expression changes: pre-formatted unified-diff style
   * body (already has `- ` / `+ ` line prefixes). Renderer wraps in
   * a ```diff fence.
   */
  diffBody?: string;
}

export interface DiffResult {
  oldLabel: string;
  newLabel: string;
  summary: {
    breaking: number;
    caution: number;
    safe: number;
    total: number;
  };
  breaking: DiffChange[];
  caution: DiffChange[];
  safe: DiffChange[];
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const qt = (tableName: string, col: string): string => `${tableName}[${col}]`;

/** Stable key for a measure — table is always part of it because two
 *  tables can (rarely but validly) host measures with the same name. */
const measureKey = (m: { table: string; name: string }): string =>
  qt(m.table, m.name);

/** Stable key for a column. */
const columnKey = (c: { table: string; name: string }): string =>
  qt(c.table, c.name);

/** Stable key for a relationship — order-independent would actively
 *  mislead (A→B is different from B→A in Power BI), so include the
 *  direction. */
const relKey = (r: ModelRelationship): string =>
  `${qt(r.fromTable, r.fromColumn)} → ${qt(r.toTable, r.toColumn)}`;

/** Build a Map keyed by a stable identifier so we can O(1)-match
 *  entries between old and new without relying on array order. */
function byKey<T>(items: T[], keyOf: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(keyOf(it), it);
  return m;
}

/** Normalise whitespace in DAX / M so trivial formatting changes don't
 *  register as "DAX changed". Collapses runs of whitespace to a single
 *  space, trims, strips blank lines. Good enough for change detection;
 *  the original text is still shown in the diff body. */
function normalizeExpression(s: string | undefined | null): string {
  if (!s) return "";
  return s.replace(/\r\n?/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join("\n")
    .replace(/[ \t]+/g, " ");
}

/** Small unified-diff renderer — zero deps. Produces a body suitable
 *  for wrapping in a ```diff fence. Not a full Myers diff; does a
 *  line-by-line prefix-match which reads fine for measures where most
 *  lines are stable and one or two change. */
function unifiedDiff(oldText: string, newText: string): string {
  const oldLines = (oldText || "").split("\n");
  const newLines = (newText || "").split("\n");
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      out.push("  " + oldLines[i]);
      i++; j++;
    } else {
      // Find next matching line to resynchronize
      const nextMatch = findNextMatch(oldLines, newLines, i, j);
      while (i < nextMatch.oldIdx) out.push("- " + oldLines[i++]);
      while (j < nextMatch.newIdx) out.push("+ " + newLines[j++]);
    }
  }
  return out.join("\n");
}

function findNextMatch(
  oldLines: string[], newLines: string[], i: number, j: number,
): { oldIdx: number; newIdx: number } {
  // Look ahead up to 20 lines on each side for a matching pair.
  const MAX_LOOKAHEAD = 20;
  for (let d = 1; d <= MAX_LOOKAHEAD; d++) {
    for (let oi = i; oi <= Math.min(i + d, oldLines.length); oi++) {
      for (let ni = j; ni <= Math.min(j + d, newLines.length); ni++) {
        if (oi === i && ni === j) continue;
        if (oi >= oldLines.length || ni >= newLines.length) continue;
        if (oldLines[oi] === newLines[ni]) return { oldIdx: oi, newIdx: ni };
      }
    }
  }
  // No resync point — consume the rest as a pure replace block.
  return { oldIdx: oldLines.length, newIdx: newLines.length };
}

/** For a removed measure/column, list the measures in OLD that
 *  textually reference it. These are the "probably broken" consumers.
 *  Uses `measure.daxDependencies` where available (measure-to-measure
 *  deps) plus a regex scan for column refs. */
function findMeasureConsumers(
  removedMeasureName: string,
  measures: ModelMeasure[],
): string[] {
  return measures
    .filter(m => m.daxDependencies.includes(removedMeasureName))
    .map(m => measureKey(m));
}

/** For a removed column, find measures whose DAX body references it.
 *  Regex-based — looks for `Table[Column]` or bare `[Column]` inside
 *  the DAX body. Imprecise but directionally useful for a PR comment. */
function findColumnConsumers(
  table: string,
  column: string,
  measures: ModelMeasure[],
): string[] {
  // Escape regex metacharacters in column name
  const esc = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualified = new RegExp(`${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[${esc}\\]`);
  const bare = new RegExp(`\\[${esc}\\]`);
  const hits = new Set<string>();
  for (const m of measures) {
    const dax = m.daxExpression || "";
    if (qualified.test(dax) || bare.test(dax)) hits.add(measureKey(m));
  }
  return [...hits];
}

// ─────────────────────────────────────────────────────────────────────
// Per-entity differs
// ─────────────────────────────────────────────────────────────────────

function diffTables(
  oldTables: TableData[],
  newTables: TableData[],
  out: DiffChange[],
): void {
  // Filter out auto-date infrastructure — those are machine-generated
  // and churn with every date column add/remove without being a
  // meaningful user change.
  const isUser = (t: TableData) => t.origin !== "auto-date";
  const oldM = byKey(oldTables.filter(isUser), t => t.name);
  const newM = byKey(newTables.filter(isUser), t => t.name);

  for (const [name, newT] of newM) {
    if (!oldM.has(name)) {
      out.push({
        risk: "safe",
        kind: "table-added",
        entity: "table",
        key: name,
        detail: `${newT.columnCount} col${newT.columnCount === 1 ? "" : "s"}` +
          (newT.measureCount > 0 ? `, ${newT.measureCount} measure${newT.measureCount === 1 ? "" : "s"}` : ""),
      });
    }
  }
  for (const [name, oldT] of oldM) {
    if (!newM.has(name)) {
      out.push({
        risk: "breaking",
        kind: "table-removed",
        entity: "table",
        key: name,
        detail: `had ${oldT.columnCount} col${oldT.columnCount === 1 ? "" : "s"}, ${oldT.measureCount} measure${oldT.measureCount === 1 ? "" : "s"}`,
      });
    }
  }
}

function diffColumns(
  oldCols: ModelColumn[],
  newCols: ModelColumn[],
  out: DiffChange[],
  oldMeasures: ModelMeasure[],
): void {
  const oldM = byKey(oldCols, columnKey);
  const newM = byKey(newCols, columnKey);

  for (const [key, newC] of newM) {
    const oldC = oldM.get(key);
    if (!oldC) {
      out.push({
        risk: "safe",
        kind: "column-added",
        entity: "column",
        key,
        detail: `type: ${newC.dataType}` +
          (newC.isHidden ? " (hidden)" : "") +
          (newC.isCalculated ? " (calculated)" : ""),
      });
      continue;
    }
    // dataType change is breaking — casts or aggregations may fail.
    if (oldC.dataType !== newC.dataType) {
      out.push({
        risk: "breaking",
        kind: "column-datatype-changed",
        entity: "column",
        key,
        oldValue: oldC.dataType,
        newValue: newC.dataType,
        detail: `dataType: ${oldC.dataType} → ${newC.dataType}`,
      });
    }
    if (oldC.isKey !== newC.isKey) {
      out.push({
        risk: "caution",
        kind: "column-iskey-changed",
        entity: "column",
        key,
        oldValue: String(oldC.isKey),
        newValue: String(newC.isKey),
        detail: `isKey: ${oldC.isKey} → ${newC.isKey}`,
      });
    }
    if (oldC.isHidden !== newC.isHidden) {
      out.push({
        risk: newC.isHidden ? "caution" : "safe",
        kind: "column-ishidden-changed",
        entity: "column",
        key,
        oldValue: String(oldC.isHidden),
        newValue: String(newC.isHidden),
        detail: `isHidden: ${oldC.isHidden} → ${newC.isHidden}`,
      });
    }
    if (oldC.isCalculated !== newC.isCalculated) {
      out.push({
        risk: "caution",
        kind: "column-iscalculated-changed",
        entity: "column",
        key,
        oldValue: String(oldC.isCalculated),
        newValue: String(newC.isCalculated),
        detail: `isCalculated: ${oldC.isCalculated} → ${newC.isCalculated}`,
      });
    }
    if ((oldC.summarizeBy || "") !== (newC.summarizeBy || "")) {
      out.push({
        risk: "caution",
        kind: "column-summarizeby-changed",
        entity: "column",
        key,
        oldValue: oldC.summarizeBy || "(unset)",
        newValue: newC.summarizeBy || "(unset)",
        detail: `summarizeBy: ${oldC.summarizeBy || "(unset)"} → ${newC.summarizeBy || "(unset)"}`,
      });
    }
    if ((oldC.formatString || "") !== (newC.formatString || "")) {
      out.push({
        risk: "safe",
        kind: "column-formatstring-changed",
        entity: "column",
        key,
        oldValue: oldC.formatString || "(unset)",
        newValue: newC.formatString || "(unset)",
      });
    }
    if ((oldC.dataCategory || "") !== (newC.dataCategory || "")) {
      out.push({
        risk: "caution",
        kind: "column-datacategory-changed",
        entity: "column",
        key,
        oldValue: oldC.dataCategory || "(unset)",
        newValue: newC.dataCategory || "(unset)",
        detail: `dataCategory: ${oldC.dataCategory || "(unset)"} → ${newC.dataCategory || "(unset)"}`,
      });
    }
    if ((oldC.description || "") !== (newC.description || "")) {
      out.push({
        risk: "safe",
        kind: "column-description-changed",
        entity: "column",
        key,
      });
    }
    if ((oldC.displayFolder || "") !== (newC.displayFolder || "")) {
      out.push({
        risk: "safe",
        kind: "column-displayfolder-changed",
        entity: "column",
        key,
        oldValue: oldC.displayFolder || "(root)",
        newValue: newC.displayFolder || "(root)",
      });
    }
    if ((oldC.sortByColumn || "") !== (newC.sortByColumn || "")) {
      out.push({
        risk: "caution",
        kind: "column-sortby-changed",
        entity: "column",
        key,
        oldValue: oldC.sortByColumn || "(none)",
        newValue: newC.sortByColumn || "(none)",
        detail: `sortByColumn: ${oldC.sortByColumn || "(none)"} → ${newC.sortByColumn || "(none)"}`,
      });
    }
  }
  for (const [key, oldC] of oldM) {
    if (!newM.has(key)) {
      const consumers = findColumnConsumers(oldC.table, oldC.name, oldMeasures);
      out.push({
        risk: "breaking",
        kind: "column-removed",
        entity: "column",
        key,
        detail: `was ${oldC.dataType}` + (oldC.isHidden ? ", hidden" : ""),
        consumers: consumers.length ? consumers : undefined,
      });
    }
  }
}

function diffMeasures(
  oldMeasures: ModelMeasure[],
  newMeasures: ModelMeasure[],
  out: DiffChange[],
): void {
  const oldM = byKey(oldMeasures, measureKey);
  const newM = byKey(newMeasures, measureKey);

  for (const [key, newMe] of newM) {
    const oldMe = oldM.get(key);
    if (!oldMe) {
      out.push({
        risk: "safe",
        kind: "measure-added",
        entity: "measure",
        key,
      });
      continue;
    }
    // DAX change — normalised comparison, but show original text in diff.
    if (normalizeExpression(oldMe.daxExpression) !== normalizeExpression(newMe.daxExpression)) {
      out.push({
        risk: "caution",
        kind: "measure-dax-changed",
        entity: "measure",
        key,
        diffBody: unifiedDiff(oldMe.daxExpression, newMe.daxExpression),
      });
    }
    if ((oldMe.formatString || "") !== (newMe.formatString || "")) {
      out.push({
        risk: "safe",
        kind: "measure-formatstring-changed",
        entity: "measure",
        key,
        oldValue: oldMe.formatString || "(unset)",
        newValue: newMe.formatString || "(unset)",
      });
    }
    if ((oldMe.description || "") !== (newMe.description || "")) {
      out.push({
        risk: "safe",
        kind: "measure-description-changed",
        entity: "measure",
        key,
      });
    }
    if ((oldMe.displayFolder || "") !== (newMe.displayFolder || "")) {
      out.push({
        risk: "safe",
        kind: "measure-displayfolder-changed",
        entity: "measure",
        key,
        oldValue: oldMe.displayFolder || "(root)",
        newValue: newMe.displayFolder || "(root)",
      });
    }
    // EXTERNALMEASURE proxy change — flipping between local / proxy
    // is a cross-model composition change, not just a DAX edit.
    const oldProxy = oldMe.externalProxy;
    const newProxy = newMe.externalProxy;
    if (!!oldProxy !== !!newProxy) {
      out.push({
        risk: "breaking",
        kind: "measure-proxy-changed",
        entity: "measure",
        key,
        oldValue: oldProxy ? `proxy → ${oldProxy.externalModel}[${oldProxy.remoteName}]` : "local",
        newValue: newProxy ? `proxy → ${newProxy.externalModel}[${newProxy.remoteName}]` : "local",
      });
    } else if (oldProxy && newProxy &&
      (oldProxy.externalModel !== newProxy.externalModel || oldProxy.remoteName !== newProxy.remoteName)) {
      out.push({
        risk: "breaking",
        kind: "measure-proxy-target-changed",
        entity: "measure",
        key,
        oldValue: `${oldProxy.externalModel}[${oldProxy.remoteName}]`,
        newValue: `${newProxy.externalModel}[${newProxy.remoteName}]`,
      });
    }
  }
  for (const [key, oldMe] of oldM) {
    if (!newM.has(key)) {
      const consumers = findMeasureConsumers(oldMe.name, oldMeasures);
      out.push({
        risk: "breaking",
        kind: "measure-removed",
        entity: "measure",
        key,
        consumers: consumers.length ? consumers : undefined,
      });
    }
  }
}

function diffRelationships(
  oldRels: ModelRelationship[],
  newRels: ModelRelationship[],
  out: DiffChange[],
): void {
  const oldM = byKey(oldRels, relKey);
  const newM = byKey(newRels, relKey);

  for (const [key, newR] of newM) {
    const oldR = oldM.get(key);
    if (!oldR) {
      out.push({
        risk: "safe",
        kind: "relationship-added",
        entity: "relationship",
        key,
        detail: newR.isActive ? "active" : "inactive",
      });
      continue;
    }
    if (oldR.isActive !== newR.isActive) {
      // Flipping active changes the implicit filter path — measures
      // relying on auto-propagation may silently shift.
      out.push({
        risk: "caution",
        kind: "relationship-active-changed",
        entity: "relationship",
        key,
        oldValue: oldR.isActive ? "active" : "inactive",
        newValue: newR.isActive ? "active" : "inactive",
        detail: `isActive: ${oldR.isActive} → ${newR.isActive}`,
      });
    }
  }
  for (const [key, _oldR] of oldM) {
    if (!newM.has(key)) {
      out.push({
        risk: "breaking",
        kind: "relationship-removed",
        entity: "relationship",
        key,
        detail: "any measure crossing these tables via implicit filter may regress",
      });
    }
  }
}

function diffCalcGroups(
  oldCGs: ModelCalcGroup[],
  newCGs: ModelCalcGroup[],
  out: DiffChange[],
): void {
  const oldM = byKey(oldCGs, cg => cg.name);
  const newM = byKey(newCGs, cg => cg.name);

  for (const [name, newCG] of newM) {
    const oldCG = oldM.get(name);
    if (!oldCG) {
      out.push({
        risk: "safe",
        kind: "calcgroup-added",
        entity: "calcgroup",
        key: name,
        detail: `${newCG.items.length} item${newCG.items.length === 1 ? "" : "s"}`,
      });
      continue;
    }
    if (oldCG.precedence !== newCG.precedence) {
      out.push({
        risk: "caution",
        kind: "calcgroup-precedence-changed",
        entity: "calcgroup",
        key: name,
        oldValue: String(oldCG.precedence),
        newValue: String(newCG.precedence),
        detail: `precedence: ${oldCG.precedence} → ${newCG.precedence}`,
      });
    }
    // Items: by name within the group
    const oldItems = byKey(oldCG.items, (i: CalcItem) => i.name);
    const newItems = byKey(newCG.items, (i: CalcItem) => i.name);
    for (const [itemName, newI] of newItems) {
      const oldI = oldItems.get(itemName);
      const itemKey = `${name}/${itemName}`;
      if (!oldI) {
        out.push({
          risk: "safe",
          kind: "calcitem-added",
          entity: "calcitem",
          key: itemKey,
        });
        continue;
      }
      if (normalizeExpression(oldI.expression) !== normalizeExpression(newI.expression)) {
        out.push({
          risk: "caution",
          kind: "calcitem-expression-changed",
          entity: "calcitem",
          key: itemKey,
          diffBody: unifiedDiff(oldI.expression, newI.expression),
        });
      }
      if ((oldI.formatStringExpression || "") !== (newI.formatStringExpression || "")) {
        out.push({
          risk: "safe",
          kind: "calcitem-formatstring-changed",
          entity: "calcitem",
          key: itemKey,
        });
      }
    }
    for (const [itemName, _oldI] of oldItems) {
      if (!newItems.has(itemName)) {
        out.push({
          risk: "breaking",
          kind: "calcitem-removed",
          entity: "calcitem",
          key: `${name}/${itemName}`,
        });
      }
    }
  }
  for (const [name, _oldCG] of oldM) {
    if (!newM.has(name)) {
      out.push({
        risk: "breaking",
        kind: "calcgroup-removed",
        entity: "calcgroup",
        key: name,
      });
    }
  }
}

function diffFunctions(
  oldFns: ModelFunction[],
  newFns: ModelFunction[],
  out: DiffChange[],
): void {
  const oldM = byKey(oldFns, f => f.name);
  const newM = byKey(newFns, f => f.name);

  for (const [name, newF] of newM) {
    const oldF = oldM.get(name);
    if (!oldF) {
      if (name.endsWith(".About")) continue; // .About shim is noise
      out.push({
        risk: "safe",
        kind: "function-added",
        entity: "function",
        key: name,
      });
      continue;
    }
    if ((oldF.parameters || "") !== (newF.parameters || "")) {
      out.push({
        risk: "breaking",
        kind: "function-signature-changed",
        entity: "function",
        key: name,
        oldValue: oldF.parameters || "()",
        newValue: newF.parameters || "()",
        detail: `parameters: ${oldF.parameters || "()"} → ${newF.parameters || "()"}`,
      });
    }
    if (normalizeExpression(oldF.expression) !== normalizeExpression(newF.expression)) {
      out.push({
        risk: "caution",
        kind: "function-body-changed",
        entity: "function",
        key: name,
        diffBody: unifiedDiff(oldF.expression, newF.expression),
      });
    }
  }
  for (const [name, _oldF] of oldM) {
    if (!newM.has(name) && !name.endsWith(".About")) {
      out.push({
        risk: "breaking",
        kind: "function-removed",
        entity: "function",
        key: name,
      });
    }
  }
}

function diffPartitions(
  oldTables: TableData[],
  newTables: TableData[],
  out: DiffChange[],
): void {
  // Match partitions by (tableName, partitionName) — TMDL auto-names
  // are stable across a model's lifetime. Partition MODE and KIND
  // changes are meaningful; order isn't.
  const oldMap = new Map<string, { tableName: string; p: TableData["partitions"][0] }>();
  const newMap = new Map<string, { tableName: string; p: TableData["partitions"][0] }>();
  for (const t of oldTables.filter(t => t.origin !== "auto-date")) {
    for (const p of t.partitions) oldMap.set(`${t.name}::${p.name}`, { tableName: t.name, p });
  }
  for (const t of newTables.filter(t => t.origin !== "auto-date")) {
    for (const p of t.partitions) newMap.set(`${t.name}::${p.name}`, { tableName: t.name, p });
  }

  for (const [key, entry] of newMap) {
    const old = oldMap.get(key);
    if (!old) continue; // new partition = table-added territory, covered by diffTables
    if (old.p.mode !== entry.p.mode) {
      out.push({
        risk: "breaking",
        kind: "partition-mode-changed",
        entity: "partition",
        key,
        oldValue: old.p.mode,
        newValue: entry.p.mode,
        detail: `mode: ${old.p.mode} → ${entry.p.mode} (storage mode switch)`,
      });
    }
    if ((old.p.sourceType || "") !== (entry.p.sourceType || "")) {
      out.push({
        risk: "caution",
        kind: "partition-sourcetype-changed",
        entity: "partition",
        key,
        oldValue: old.p.sourceType,
        newValue: entry.p.sourceType,
        detail: `sourceType: ${old.p.sourceType} → ${entry.p.sourceType}`,
      });
    }
    if ((old.p.sourceLocation || "") !== (entry.p.sourceLocation || "")) {
      out.push({
        risk: "caution",
        kind: "partition-sourcelocation-changed",
        entity: "partition",
        key,
        oldValue: old.p.sourceLocation || "(none)",
        newValue: entry.p.sourceLocation || "(none)",
      });
    }
    if ((old.p.expressionSource || "") !== (entry.p.expressionSource || "")) {
      out.push({
        risk: "caution",
        kind: "partition-expressionsource-changed",
        entity: "partition",
        key,
        oldValue: old.p.expressionSource || "(none)",
        newValue: entry.p.expressionSource || "(none)",
      });
    }
  }
}

function diffModelProperties(
  oldFull: FullData,
  newFull: FullData,
  out: DiffChange[],
): void {
  const oldMP = oldFull.modelProperties;
  const newMP = newFull.modelProperties;
  if (!oldMP || !newMP) return;

  if (oldMP.culture !== newMP.culture) {
    out.push({
      risk: "caution",
      kind: "model-culture-changed",
      entity: "model",
      key: "modelProperties.culture",
      oldValue: oldMP.culture || "(unset)",
      newValue: newMP.culture || "(unset)",
      detail: `culture: ${oldMP.culture || "(unset)"} → ${newMP.culture || "(unset)"}`,
    });
  }
  if (oldMP.discourageImplicitMeasures !== newMP.discourageImplicitMeasures) {
    out.push({
      risk: "caution",
      kind: "model-discourageimplicitmeasures-changed",
      entity: "model",
      key: "modelProperties.discourageImplicitMeasures",
      oldValue: String(oldMP.discourageImplicitMeasures),
      newValue: String(newMP.discourageImplicitMeasures),
    });
  }
  if ((oldMP.valueFilterBehavior || "") !== (newMP.valueFilterBehavior || "")) {
    out.push({
      risk: "caution",
      kind: "model-valuefilterbehavior-changed",
      entity: "model",
      key: "modelProperties.valueFilterBehavior",
      oldValue: oldMP.valueFilterBehavior || "(Automatic)",
      newValue: newMP.valueFilterBehavior || "(Automatic)",
    });
  }
  if (oldFull.compatibilityLevel !== newFull.compatibilityLevel) {
    out.push({
      risk: "caution",
      kind: "model-compatibilitylevel-changed",
      entity: "model",
      key: "compatibilityLevel",
      oldValue: String(oldFull.compatibilityLevel ?? "(unset)"),
      newValue: String(newFull.compatibilityLevel ?? "(unset)"),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

/**
 * Compare two FullData snapshots. `oldLabel` / `newLabel` are display
 * identifiers (typically the report folder path or a short name) used
 * in the rendered output headers.
 */
export function diffModels(
  oldData: FullData,
  newData: FullData,
  oldLabel = "old",
  newLabel = "new",
): DiffResult {
  const all: DiffChange[] = [];

  diffTables(oldData.tables, newData.tables, all);
  diffColumns(oldData.columns, newData.columns, all, oldData.measures);
  diffMeasures(oldData.measures, newData.measures, all);
  diffRelationships(oldData.relationships, newData.relationships, all);
  diffCalcGroups(oldData.calcGroups, newData.calcGroups, all);
  diffFunctions(oldData.functions, newData.functions, all);
  diffPartitions(oldData.tables, newData.tables, all);
  diffModelProperties(oldData, newData, all);

  const breaking = all.filter(c => c.risk === "breaking");
  const caution = all.filter(c => c.risk === "caution");
  const safe = all.filter(c => c.risk === "safe");

  // Stable sort within tier — alphabetical by key so the output is
  // deterministic across runs / platforms.
  const byKeyAsc = (a: DiffChange, b: DiffChange) => a.key.localeCompare(b.key);
  breaking.sort(byKeyAsc);
  caution.sort(byKeyAsc);
  safe.sort(byKeyAsc);

  return {
    oldLabel,
    newLabel,
    summary: {
      breaking: breaking.length,
      caution: caution.length,
      safe: safe.length,
      total: all.length,
    },
    breaking,
    caution,
    safe,
  };
}
