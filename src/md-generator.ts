import type { FullData, TableData, ModelMeasure } from "./data-builder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Semantic-Model Technical Specification — Markdown
//
// Two documents are produced:
//   generateMarkdown       → Technical specification (front matter → data dictionary → ...)
//   generateMeasuresMd     → Measures reference: A–Z grouped, each measure collapsible
//
// DAX expressions are intentionally omitted from both.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function statusLabel(s: "direct" | "indirect" | "unused" | string): string {
  if (s === "direct") return "Direct";
  if (s === "indirect") return "Indirect";
  if (s === "unused") return "Unused";
  return String(s);
}

/** GitHub-compatible slug for in-document anchor links. */
function slug(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Bucket letter used for A–Z grouping. Non-letter starts go to "#". */
function bucketLetter(name: string): string {
  const ch = (name.trim().charAt(0) || "").toUpperCase();
  return ch >= "A" && ch <= "Z" ? ch : "#";
}

type TableRole = "Fact" | "Dimension" | "Bridge" | "Disconnected" | "Calculation Group";

/** Infer a table's role from its relationship topology. */
function classifyTable(t: TableData): TableRole {
  if (t.isCalcGroup) return "Calculation Group";
  const out = t.relationships.filter(r => r.direction === "outgoing").length;
  const inc = t.relationships.filter(r => r.direction === "incoming").length;
  if (out > 0 && inc === 0) return "Fact";
  if (out === 0 && inc > 0) return "Dimension";
  if (out > 0 && inc > 0) return "Bridge";
  return "Disconnected";
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateMarkdown — Technical specification for the semantic model
// ═══════════════════════════════════════════════════════════════════════════════

export function generateMarkdown(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const hiddenSet = new Set(data.hiddenPages || []);
  const lines: string[] = [];

  const tables = [...data.tables].sort((a, b) => a.name.localeCompare(b.name));
  const pages = [...data.pages].sort((a, b) => a.name.localeCompare(b.name));
  const functions = data.functions.filter(f => !f.name.endsWith(".About"));
  const calcGroups = data.calcGroups;
  const rolesByTable = new Map<string, TableRole>();
  for (const t of tables) rolesByTable.set(t.name, classifyTable(t));
  const roleCounts: Record<TableRole, number> = {
    "Fact": 0, "Dimension": 0, "Bridge": 0, "Disconnected": 0, "Calculation Group": 0,
  };
  for (const r of rolesByTable.values()) roleCounts[r]++;
  const activeRelCount = data.relationships.filter(r => r.isActive).length;
  const inactiveRelCount = data.relationships.length - activeRelCount;
  const isStar = roleCounts.Bridge === 0 && roleCounts.Disconnected === 0 && roleCounts.Fact > 0;

  const mp = data.modelProperties;
  const culturesLabel = mp.cultures.length > 0
    ? mp.cultures.join(", ")
    : (mp.culture || "_unknown_");
  const implicitLabel = mp.discourageImplicitMeasures ? "Discouraged" : "Allowed";
  const valueFilterLabel = mp.valueFilterBehavior || "Automatic (default)";

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Semantic Model Technical Specification`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  if (mp.description) {
    // Render the model-level description as a leading blockquote so it sits
    // between the title and the metadata table.
    lines.push(`> ${mp.description.replace(/\n/g, " ")}`);
    lines.push("");
  }
  lines.push("| | |");
  lines.push("|---|---|");
  // UDF count excludes the `.About` shim entries Tabular Editor emits.
  const udfCount = functions.length;
  // Calc-group count plus the total number of items across all groups.
  const cgItemCount = calcGroups.reduce((acc, cg) => acc + cg.items.length, 0);

  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Compatibility level** | ${data.compatibilityLevel != null ? data.compatibilityLevel : "_unknown_"} |`);
  lines.push(`| **Cultures** | ${esc(culturesLabel)} |`);
  lines.push(`| **Implicit measures** | ${implicitLabel} |`);
  lines.push(`| **Value filter behavior** | ${esc(valueFilterLabel)} |`);
  lines.push(`| **Model entities** | ${data.totals.tables} tables · ${data.totals.columnsInModel} columns · ${data.totals.measuresInModel} measures · ${data.totals.relationships} relationships |`);
  lines.push(`| **User-defined functions** | ${udfCount} |`);
  lines.push(`| **Calculation groups** | ${calcGroups.length}${calcGroups.length > 0 ? ` (${cgItemCount} item${cgItemCount === 1 ? "" : "s"})` : ""} |`);
  lines.push(`| **Report surface** | ${data.totals.pages} pages · ${data.totals.visuals} visuals |`);
  lines.push(`| **Scope** | Schema, relationships, usage classification. DAX expressions omitted. |`);
  lines.push(`| **Companion documents** | Measures Reference · Functions Reference · Calculation Groups Reference · Data Quality Review |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Document contents ─────────────────────────────────────────────────────
  lines.push("## Document Contents");
  lines.push("");
  lines.push("1. [Introduction](#1-introduction)");
  lines.push("    - 1.1 [Purpose](#11-purpose)");
  lines.push("    - 1.2 [Conventions](#12-conventions)");
  lines.push("    - 1.3 [Terminology](#13-terminology)");
  lines.push("2. [Model Architecture](#2-model-architecture)");
  lines.push("    - 2.1 [Schema summary](#21-schema-summary)");
  lines.push("    - 2.2 [Tables by role](#22-tables-by-role)");
  lines.push("    - 2.3 [Relationship inventory](#23-relationship-inventory)");
  lines.push("3. [Data Sources](#3-data-sources)");
  lines.push("    - 3.1 [Storage modes](#31-storage-modes)");
  lines.push("    - 3.2 [Parameters and expressions](#32-parameters-and-expressions)");
  lines.push("    - 3.3 [Per-table sources](#33-per-table-sources)");
  lines.push("4. [Data Dictionary](#4-data-dictionary)");
  for (const t of tables) lines.push(`    - [${t.name}](#${slug(t.name)})`);
  lines.push("5. [Measures — Summary](#5-measures--summary)");
  lines.push("6. [Calculation Groups](#6-calculation-groups)");
  lines.push("7. [User-Defined Functions](#7-user-defined-functions)");
  lines.push("8. [Report Pages](#8-report-pages)");
  lines.push("");
  lines.push("Appendix A — [Generation metadata](#appendix-a--generation-metadata)");
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 1. Introduction ───────────────────────────────────────────────────────
  lines.push("## 1. Introduction");
  lines.push("");

  lines.push("### 1.1 Purpose");
  lines.push("");
  lines.push(`This document is a reference specification of the **${reportName}** semantic model. ` +
    `It describes the entities the model exposes, how those entities are related, and how each ` +
    `measure and column is consumed by the accompanying Power BI report. It is intended for data ` +
    `engineers, report developers, and analysts who need to understand, review, or modify the model.`);
  lines.push("");
  lines.push(`The document is generated automatically from the ${"`"}.Report${"`"} and ${"`"}.SemanticModel${"`"} folders. ` +
    `It reflects the current state of those folders at generation time.`);
  lines.push("");

  lines.push("### 1.2 Conventions");
  lines.push("");
  lines.push("- Table **roles** are inferred from relationship topology:");
  lines.push("    - **Fact** — at least one outgoing foreign key and no incoming references.");
  lines.push("    - **Dimension** — referenced by at least one other table and has no outgoing foreign keys.");
  lines.push("    - **Bridge** — both outgoing and incoming relationships (many-to-many or role-playing).");
  lines.push("    - **Disconnected** — no relationships.");
  lines.push("    - **Calculation Group** — exposes a calculation-group object.");
  lines.push("- **Key annotations** on columns:");
  lines.push("    - **PK** — primary key set explicitly on the column.");
  lines.push("    - **PK\\*** — inferred primary key (column is the target of at least one relationship).");
  lines.push("    - **FK** — foreign key (column is the source of at least one relationship).");
  lines.push("- **Status** classification for measures and columns:");
  lines.push("    - **Direct** — bound to at least one visual, filter, or conditional-formatting expression.");
  lines.push("    - **Indirect** — not bound to a visual, but referenced by a Direct measure via DAX, or (for columns) used in a relationship.");
  lines.push("    - **Unused** — not referenced anywhere in the model or the report.");
  lines.push("- DAX expressions are omitted by design. See the companion **Measures Reference** for per-measure descriptions and dependency graphs.");
  lines.push("");

  lines.push("### 1.3 Terminology");
  lines.push("");
  lines.push("| Term | Meaning |");
  lines.push("|------|---------|");
  lines.push("| Semantic model | The tabular model exposed to Power BI — tables, columns, measures, relationships. |");
  lines.push("| Relationship | An active or inactive link between two columns that defines filter propagation. |");
  lines.push("| Calculation group | A Tabular feature that rewrites measure expressions based on a selected calc-group item. |");
  lines.push("| User-defined function | A reusable DAX function declared in the model (Tabular 1702+). Counted excluding the `.About` shim entries Tabular Editor sometimes emits. |");
  lines.push("| Compatibility level | Tabular engine capability marker (e.g. 1500, 1567, 1702). Higher levels enable newer features such as user-defined functions, INFO functions, and value-filter behaviours. |");
  lines.push("| Culture | Locale used for sorting, formatting, and translations. Each culture has its own file under `definition/cultures/`. |");
  lines.push("| Implicit measures | Power BI's auto-aggregation behaviour. When **discouraged**, dragging a numeric column directly to a visual will not implicitly create a SUM/COUNT — modellers must define explicit measures. |");
  lines.push("| Value filter behavior | How DAX value filters interact with strong-relationship cardinality (Automatic / Independent / Coalesce). Affects measure totals when many-to-many relationships are present. |");
  lines.push("| Visual binding | A field placed on a visual (data well), in a filter, or referenced by a conditional-formatting expression. |");
  lines.push("| Slicer field | A column bound to a slicer visual, making it interactively filterable by the user. |");
  lines.push("| Display folder | A modeller-defined grouping label that organises measures or columns under a named folder in the field list. |");
  lines.push("| Storage mode | How a table's data is loaded: **Import** (data copied into the model), **DirectQuery** (queried live), or **Dual** (both). |");
  lines.push("| Partition | A unit of storage backing a table — most tables have one. Each partition has its own source query (M code). |");
  lines.push("");

  lines.push("---");
  lines.push("");

  // ── 2. Model Architecture ─────────────────────────────────────────────────
  lines.push("## 2. Model Architecture");
  lines.push("");

  lines.push("### 2.1 Schema summary");
  lines.push("");
  lines.push(`- **${tables.length}** tables: ` +
    `${roleCounts.Fact} fact · ${roleCounts.Dimension} dimension · ` +
    `${roleCounts.Bridge} bridge · ${roleCounts["Calculation Group"]} calc group · ` +
    `${roleCounts.Disconnected} disconnected.`);
  lines.push(`- **${data.relationships.length}** relationships (${activeRelCount} active, ${inactiveRelCount} inactive).`);
  lines.push(`- **${data.totals.columnsInModel}** columns, **${data.totals.measuresInModel}** measures, **${data.totals.functions}** user-defined functions, **${data.totals.calcGroups}** calculation groups.`);
  lines.push(`- Topology: ${isStar ? "**star schema**" : "**not a pure star schema** (bridge or disconnected tables present)"}.`);
  lines.push("");

  lines.push("### 2.2 Tables by role");
  lines.push("");
  lines.push("| Table | Role | Columns | Measures | Keys | FKs | Hidden cols |");
  lines.push("|-------|------|--------:|---------:|-----:|----:|-----------:|");
  for (const t of tables) {
    const role = rolesByTable.get(t.name) || "Disconnected";
    lines.push(`| [${t.name}](#${slug(t.name)}) | ${role} | ${t.columnCount} | ${t.measureCount} | ${t.keyCount} | ${t.fkCount} | ${t.hiddenColumnCount} |`);
  }
  lines.push("");

  lines.push("### 2.3 Relationship inventory");
  lines.push("");
  if (data.relationships.length === 0) {
    lines.push("_No relationships defined in this model._");
  } else {
    lines.push("| # | From (many) | To (one) | Active |");
    lines.push("|--:|-------------|----------|:------:|");
    data.relationships.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${esc(r.fromTable)}[${esc(r.fromColumn)}] | ${esc(r.toTable)}[${esc(r.toColumn)}] | ${r.isActive ? "✓" : "—"} |`);
    });
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 3. Data Sources ───────────────────────────────────────────────────────
  // Storage-mode summary, top-level expressions / parameters, and per-table
  // datasource inventory (mode + inferred type + best-effort location).
  lines.push("## 3. Data Sources");
  lines.push("");
  lines.push("Where the model gets its data from. Source type is inferred from the M code; location is the first string literal found and may be a file path, server, or URL.");
  lines.push("");

  lines.push("### 3.1 Storage modes");
  lines.push("");
  // Aggregate distinct partition modes across all tables.
  const modeCounts = new Map<string, number>();
  let tablesWithSource = 0;
  for (const t of tables) {
    if (t.partitions.length === 0) continue;
    tablesWithSource++;
    for (const p of t.partitions) {
      const m = (p.mode || "import").toLowerCase();
      modeCounts.set(m, (modeCounts.get(m) || 0) + 1);
    }
  }
  if (modeCounts.size === 0) {
    lines.push("_No partition information found._");
    lines.push("");
  } else {
    const parts: string[] = [];
    [...modeCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([m, c]) => parts.push(`**${c}** ${m}`));
    lines.push(`${tablesWithSource} table${tablesWithSource === 1 ? "" : "s"} with sources — ${parts.join(", ")}.`);
    lines.push("");
  }

  lines.push("### 3.2 Parameters and expressions");
  lines.push("");
  if (data.expressions.length === 0) {
    lines.push("_No top-level parameters or M expressions._");
    lines.push("");
  } else {
    lines.push("Model-level M expressions defined in `expressions.tmdl`. Parameters are referenced by other queries via their name.");
    lines.push("");
    lines.push("| Name | Kind | Value | Description |");
    lines.push("|------|------|-------|-------------|");
    for (const e of data.expressions) {
      const kind = e.kind === "parameter" ? "Parameter" : "M expression";
      // Truncate long M expressions for the table; full value is preserved in the data.
      let val = e.value || "";
      if (val.length > 80) val = val.substring(0, 77) + "…";
      lines.push(`| ${esc(e.name)} | ${kind} | \`${esc(val)}\` | ${esc(e.description) || "—"} |`);
    }
    lines.push("");
  }

  lines.push("### 3.3 Per-table sources");
  lines.push("");
  const tablesWithPartitions = tables.filter(t => t.partitions.length > 0);
  if (tablesWithPartitions.length === 0) {
    lines.push("_No per-table partition information found._");
    lines.push("");
  } else {
    lines.push("| Table | Mode | Source type | Location |");
    lines.push("|-------|------|-------------|----------|");
    for (const t of tablesWithPartitions) {
      // One row per partition. Most tables have exactly one.
      for (const p of t.partitions) {
        const loc = p.sourceLocation ? "`" + esc(p.sourceLocation) + "`" : "—";
        lines.push(`| [${esc(t.name)}](#${slug(t.name)}) | ${esc(p.mode)} | ${esc(p.sourceType)} | ${loc} |`);
      }
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 4. Data Dictionary ────────────────────────────────────────────────────
  lines.push("## 4. Data Dictionary");
  lines.push("");
  lines.push(`One entry per table. Columns are listed in logical order (keys first, then foreign keys, then the remaining columns alphabetically). See §5 for a measures summary and the companion **Measures Reference** for per-measure detail.`);
  lines.push("");

  if (tables.length === 0) {
    lines.push("_No tables found._");
    lines.push("");
  } else {
    tables.forEach((tbl, idx) => {
      const role = rolesByTable.get(tbl.name) || "Disconnected";
      lines.push(`### 4.${idx + 1} ${tbl.name}`);
      lines.push("");
      lines.push("| | |");
      lines.push("|---|---|");
      lines.push(`| **Role** | ${role} |`);
      lines.push(`| **Columns** | ${tbl.columnCount} (${tbl.keyCount} key${tbl.keyCount === 1 ? "" : "s"}, ${tbl.fkCount} FK${tbl.fkCount === 1 ? "" : "s"}, ${tbl.hiddenColumnCount} hidden) |`);
      lines.push(`| **Measures** | ${tbl.measureCount} |`);
      lines.push(`| **Relationships** | ${tbl.relationships.filter(r => r.direction === "outgoing").length} outgoing · ${tbl.relationships.filter(r => r.direction === "incoming").length} incoming |`);
      if (tbl.partitions.length > 0) {
        const p = tbl.partitions[0];
        const loc = p.sourceLocation ? " · `" + esc(p.sourceLocation) + "`" : "";
        const extra = tbl.partitions.length > 1 ? ` (+${tbl.partitions.length - 1} more partition${tbl.partitions.length - 1 === 1 ? "" : "s"})` : "";
        lines.push(`| **Source** | ${esc(p.mode)} · ${esc(p.sourceType)}${loc}${extra} |`);
      }
      if (tbl.description) {
        lines.push(`| **Description** | ${esc(tbl.description)} |`);
      }
      lines.push("");

      // Columns
      lines.push(`#### 4.${idx + 1}.1 Columns`);
      lines.push("");
      if (tbl.columns.length === 0) {
        lines.push("_No columns._");
        lines.push("");
      } else {
        lines.push("| # | Name | Data type | Constraints | Description |");
        lines.push("|--:|------|-----------|-------------|-------------|");
        tbl.columns.forEach((c, ci) => {
          const constraints: string[] = [];
          if (c.isKey) constraints.push("PK");
          else if (c.isInferredPK) constraints.push("PK\\*");
          if (c.isFK && c.fkTarget) constraints.push(`FK → ${c.fkTarget.table}[${c.fkTarget.column}]`);
          if (c.incomingRefs && c.incomingRefs.length > 0) {
            for (const r of c.incomingRefs) {
              constraints.push(`Ref ← ${r.table}[${r.column}]${r.isActive ? "" : " (inactive)"}`);
            }
          }
          if (c.isCalculated) constraints.push("Calculated");
          if (c.isHidden) constraints.push("Hidden");
          const constraintsStr = constraints.length > 0 ? constraints.join("<br>") : "—";
          lines.push(`| ${ci + 1} | ${esc(c.name)} | ${esc(c.dataType)} | ${constraintsStr} | ${esc(c.description) || "—"} |`);
        });
        lines.push("");
      }

      // §4.N.2 (Measures on this table) and §4.N.3 (Relationships) intentionally
      // dropped: per-table measure summaries duplicate §5 + the Measures
      // Reference doc; the relationships subsection just restates the FK / Ref
      // info already in the Constraints column of §4.N.1.
    });
  }

  lines.push("---");
  lines.push("");

  // ── 4. Measures — Summary ─────────────────────────────────────────────────
  lines.push("## 5. Measures — Summary");
  lines.push("");
  if (data.measures.length === 0) {
    lines.push("_No measures defined in this model._");
    lines.push("");
  } else {
    const t = data.totals;
    lines.push(`**${t.measuresInModel}** measures total — ${t.measuresDirect} direct, ${t.measuresIndirect} indirect, ${t.measuresUnused} unused. ` +
      `See the companion **Measures Reference** (A–Z, collapsible) for per-measure descriptions, dependencies, and usage.`);
    lines.push("");
    lines.push("| Home table | Total | Direct | Indirect | Unused |");
    lines.push("|------------|------:|-------:|---------:|-------:|");
    const byTable = new Map<string, { total: number; direct: number; indirect: number; unused: number }>();
    for (const m of data.measures) {
      const cur = byTable.get(m.table) || { total: 0, direct: 0, indirect: 0, unused: 0 };
      cur.total++;
      if (m.status === "direct") cur.direct++;
      else if (m.status === "indirect") cur.indirect++;
      else cur.unused++;
      byTable.set(m.table, cur);
    }
    [...byTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, v]) => {
      lines.push(`| ${esc(name)} | ${v.total} | ${v.direct} | ${v.indirect} | ${v.unused} |`);
    });
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 6. Calculation Groups — summary ───────────────────────────────────────
  lines.push("## 6. Calculation Groups — Summary");
  lines.push("");
  if (calcGroups.length === 0) {
    lines.push("_No calculation groups defined in this model._");
    lines.push("");
  } else {
    lines.push(`**${calcGroups.length}** calculation group${calcGroups.length === 1 ? "" : "s"} (${cgItemCount} item${cgItemCount === 1 ? "" : "s"} total). ` +
      `See the companion **Calculation Groups Reference** for per-item descriptions, format-string overrides, and bodies.`);
    lines.push("");
    lines.push("| Group | Items | Precedence |");
    lines.push("|-------|------:|----------:|");
    [...calcGroups].sort((a, b) => a.name.localeCompare(b.name)).forEach(cg => {
      lines.push(`| ${esc(cg.name)} | ${cg.items.length} | ${cg.precedence} |`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 7. User-Defined Functions — summary ───────────────────────────────────
  lines.push("## 7. User-Defined Functions — Summary");
  lines.push("");
  if (functions.length === 0) {
    lines.push("_No user-defined DAX functions in this model._");
    lines.push("");
  } else {
    lines.push(`**${functions.length}** user-defined function${functions.length === 1 ? "" : "s"}. ` +
      `See the companion **Functions Reference** for parameters, descriptions, and bodies.`);
    lines.push("");
    lines.push("| Function | Parameters | Description |");
    lines.push("|----------|-----------:|-------------|");
    [...functions].sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
      const paramCount = f.parameters ? f.parameters.split(",").filter(s => s.trim()).length : 0;
      const shortDesc = f.description ? esc(f.description.length > 100 ? f.description.substring(0, 97) + "…" : f.description) : "—";
      lines.push(`| ${esc(f.name)} | ${paramCount} | ${shortDesc} |`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 7. Report Pages ───────────────────────────────────────────────────────
  lines.push("## 8. Report Pages");
  lines.push("");
  lines.push(`The semantic model is consumed by the following **${pages.length}** pages in the accompanying report.`);
  lines.push("");
  if (pages.length === 0) {
    lines.push("_No pages analysed._");
    lines.push("");
  } else {
    lines.push("| # | Page | Visibility | Visuals | Measures | Columns | Slicers | Coverage |");
    lines.push("|--:|------|------------|--------:|---------:|--------:|--------:|---------:|");
    pages.forEach((p, i) => {
      const vis = hiddenSet.has(p.name) ? "Hidden" : "Visible";
      lines.push(`| ${i + 1} | ${esc(p.name)} | ${vis} | ${p.visualCount} | ${p.measureCount} | ${p.columnCount} | ${p.slicerCount} | ${p.coverage}% |`);
    });
    lines.push("");
    lines.push("_\"Coverage\" = percentage of all model measures used on this page._");
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // §9 Data Quality Review intentionally lifted out into a separate
  // Quality Review document (generateQualityMd). Keep this main spec
  // strictly technical / structural.

  // ── Appendix ──────────────────────────────────────────────────────────────
  lines.push("## Appendix A — Generation metadata");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Generated at | ${ts} |`);
  lines.push(`| Generator | powerbi-lineage |`);
  lines.push(`| Source format | TMDL or BIM (.SemanticModel) + PBIR (.Report) |`);
  lines.push(`| Report name | ${reportName} |`);
  lines.push("");
  lines.push(`_This document is regenerated on every run; manual edits will be lost. Edit the source model instead._`);
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateMeasuresMd — Companion measures reference
//   Front matter (same style), conventions pointer, A–Z jump nav, collapsible
//   <details> per measure.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateMeasuresMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];
  const t = data.totals;

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Measures Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Measures** | ${t.measuresInModel} total · ${t.measuresDirect} direct · ${t.measuresIndirect} indirect · ${t.measuresUnused} unused |`);
  lines.push(`| **Scope** | Per-measure descriptions, dependencies, usage. DAX expressions omitted. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## How to read this document");
  lines.push("");
  lines.push("- Measures are grouped alphabetically by name. Empty letters are shown struck-through in the jump bar.");
  lines.push("- Each measure is a collapsible block. Click the row to expand / collapse.");
  lines.push("- The summary line shows: **Name** — home table · status marker (only shown when _unused_ or _indirect_).");
  lines.push("- Inside each block:");
  lines.push("    - **Metadata** — home table, format string, status, visual and page usage counts.");
  lines.push("    - **Description** — captured from the model's `///` doc comments or `description:` property.");
  lines.push("    - **Depends on** — other measures referenced by this measure's DAX.");
  lines.push("    - **Used by** — measures that call this one (reverse dependency).");
  lines.push("");
  lines.push("---");
  lines.push("");

  if (data.measures.length === 0) {
    lines.push("_No measures defined in this model._");
    return lines.join("\n");
  }

  // Bucket by first letter A–Z; non-letters into "#".
  const buckets = new Map<string, ModelMeasure[]>();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  for (const L of letters) buckets.set(L, []);
  buckets.set("#", []);
  for (const m of data.measures) buckets.get(bucketLetter(m.name))!.push(m);
  for (const arr of buckets.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  // ── Jump nav ──────────────────────────────────────────────────────────────
  const navItems: string[] = [];
  for (const L of letters) {
    const count = buckets.get(L)!.length;
    if (count > 0) navItems.push(`[${L}](#${L.toLowerCase()})`);
    else navItems.push(`~~${L}~~`);
  }
  if (buckets.get("#")!.length > 0) navItems.push("[#](#other)");
  lines.push("## Jump to");
  lines.push("");
  lines.push(navItems.join(" · "));
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Sections ──────────────────────────────────────────────────────────────
  const renderSection = (heading: string, anchor: string, items: ModelMeasure[]) => {
    lines.push(`## ${heading}`);
    lines.push(`<a id="${anchor}"></a>`);
    lines.push("");
    if (items.length === 0) {
      lines.push(`_No measures starting with ${heading}._`);
      lines.push("");
      lines.push("[↑ Jump to](#jump-to)");
      lines.push("");
      lines.push("---");
      lines.push("");
      return;
    }
    for (const m of items) {
      const statusTag =
        m.status === "unused" ? " · _unused_"
        : m.status === "indirect" ? " · _indirect_"
        : "";
      lines.push(`<details>`);
      lines.push(`<summary><strong>${esc(m.name)}</strong> <small>— ${esc(m.table)}${statusTag}</small></summary>`);
      lines.push("");
      const meta = [
        `**Table:** ${esc(m.table)}`,
        `**Format:** ${esc(m.formatString) || "—"}`,
        `**Status:** ${statusLabel(m.status)}`,
        `**Visuals:** ${m.usageCount}`,
        `**Pages:** ${m.pageCount}`,
      ];
      lines.push(meta.join(" · "));
      lines.push("");
      if (m.description) {
        lines.push(`> ${m.description.replace(/\n/g, " ")}`);
        lines.push("");
      }
      if (m.daxDependencies.length > 0) {
        lines.push(`**Depends on:** ${m.daxDependencies.map(d => "`" + d + "`").join(", ")}`);
        lines.push("");
      }
      if (m.dependedOnBy && m.dependedOnBy.length > 0) {
        lines.push(`**Used by:** ${m.dependedOnBy.map(d => "`" + d + "`").join(", ")}`);
        lines.push("");
      }
      lines.push(`</details>`);
      lines.push("");
    }
    lines.push("[↑ Jump to](#jump-to)");
    lines.push("");
    lines.push("---");
    lines.push("");
  };

  for (const L of letters) renderSection(L, L.toLowerCase(), buckets.get(L)!);
  if (buckets.get("#")!.length > 0) renderSection("Other (non-letter starts)", "other", buckets.get("#")!);

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateFunctionsMd — Companion functions reference
//   Front matter, "How to read", A–Z jump nav, collapsible <details> per UDF
//   with parameters, description, and the function body. The body is included
//   here (unlike the measures doc) because for a UDF the body IS the
//   definition; without it the doc would be content-free.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateFunctionsMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];
  // Same convention as the dashboard: drop Tabular Editor's `.About` shim entries.
  const fns = data.functions.filter(f => !f.name.endsWith(".About"));

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Functions Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Functions** | ${fns.length} |`);
  lines.push(`| **Scope** | Per-function description, parameters, and DAX body. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## How to read this document");
  lines.push("");
  lines.push("- Functions are user-defined DAX functions declared in the model (Tabular 1702+). The `.About` shim entries Tabular Editor emits are excluded from the count and listing.");
  lines.push("- Functions are grouped alphabetically by name. Empty letters are shown struck-through in the jump bar.");
  lines.push("- Each function is collapsible. Click the row to expand / collapse.");
  lines.push("- Inside each block:");
  lines.push("    - **Parameters** — formal parameters with their declared types.");
  lines.push("    - **Description** — captured from the model's `///` doc comments.");
  lines.push("    - **Body** — the function expression itself.");
  lines.push("");
  lines.push("---");
  lines.push("");

  if (fns.length === 0) {
    lines.push("_No user-defined functions in this model._");
    return lines.join("\n");
  }

  // Bucket A–Z + Other.
  const buckets = new Map<string, typeof fns>();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  for (const L of letters) buckets.set(L, []);
  buckets.set("#", []);
  for (const f of fns) buckets.get(bucketLetter(f.name))!.push(f);
  for (const arr of buckets.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  // Jump nav
  const navItems: string[] = [];
  for (const L of letters) {
    const count = buckets.get(L)!.length;
    if (count > 0) navItems.push(`[${L}](#${L.toLowerCase()})`);
    else navItems.push(`~~${L}~~`);
  }
  if (buckets.get("#")!.length > 0) navItems.push("[#](#other)");
  lines.push("## Jump to");
  lines.push("");
  lines.push(navItems.join(" · "));
  lines.push("");
  lines.push("---");
  lines.push("");

  const renderSection = (heading: string, anchor: string, items: typeof fns) => {
    lines.push(`## ${heading}`);
    lines.push(`<a id="${anchor}"></a>`);
    lines.push("");
    if (items.length === 0) {
      lines.push(`_No functions starting with ${heading}._`);
      lines.push("");
      lines.push("[↑ Jump to](#jump-to)");
      lines.push("");
      lines.push("---");
      lines.push("");
      return;
    }
    for (const f of items) {
      const paramCount = f.parameters ? f.parameters.split(",").filter(s => s.trim()).length : 0;
      const sig = paramCount === 0 ? "no parameters" : `${paramCount} parameter${paramCount === 1 ? "" : "s"}`;
      lines.push(`<details>`);
      lines.push(`<summary><strong>${esc(f.name)}</strong> <small>— ${sig}</small></summary>`);
      lines.push("");
      lines.push("**Parameters:** " + (f.parameters ? "`" + f.parameters + "`" : "_none_"));
      lines.push("");
      if (f.description) {
        lines.push(`> ${f.description.replace(/\n/g, " ")}`);
        lines.push("");
      }
      if (f.expression) {
        lines.push("**Body**");
        lines.push("");
        lines.push("```");
        lines.push(f.expression);
        lines.push("```");
        lines.push("");
      }
      lines.push(`</details>`);
      lines.push("");
    }
    lines.push("[↑ Jump to](#jump-to)");
    lines.push("");
    lines.push("---");
    lines.push("");
  };

  for (const L of letters) renderSection(L, L.toLowerCase(), buckets.get(L)!);
  if (buckets.get("#")!.length > 0) renderSection("Other (non-letter starts)", "other", buckets.get("#")!);

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateCalcGroupsMd — Companion calculation-groups reference
//   Front matter, "How to read", one section per calculation group with the
//   precedence and a collapsible block per item. Item bodies are included for
//   the same reason as functions: they ARE the definition.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateCalcGroupsMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];
  const cgs = data.calcGroups;
  const totalItems = cgs.reduce((acc, cg) => acc + cg.items.length, 0);

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Calculation Groups Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Calculation groups** | ${cgs.length} (${totalItems} item${totalItems === 1 ? "" : "s"}) |`);
  lines.push(`| **Scope** | Per-group precedence, items, item descriptions, and item bodies. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## How to read this document");
  lines.push("");
  lines.push("- A calculation group is a Tabular feature that **rewrites** measure expressions based on which calc-group item the user has selected (typically via a slicer). One classic use is a Time Intelligence calc group with items like _Current_, _YTD_, _Prior Year_.");
  lines.push("- **Precedence** controls evaluation order when multiple calc groups apply at once. Higher precedence wins.");
  lines.push("- Each item is collapsible. Click the row to expand / collapse.");
  lines.push("- Inside each item:");
  lines.push("    - **Description** — captured from the model's `///` doc comments.");
  lines.push("    - **Format string expression** — when present, overrides the underlying measure's format string.");
  lines.push("    - **Body** — the DAX expression that rewrites the underlying measure.");
  lines.push("");
  lines.push("---");
  lines.push("");

  if (cgs.length === 0) {
    lines.push("_No calculation groups in this model._");
    return lines.join("\n");
  }

  // Jump nav: one entry per group.
  lines.push("## Jump to");
  lines.push("");
  lines.push(cgs.map(cg => `[${cg.name}](#${slug(cg.name)})`).join(" · "));
  lines.push("");
  lines.push("---");
  lines.push("");

  cgs.forEach((cg, i) => {
    lines.push(`## ${i + 1}. ${cg.name}`);
    lines.push(`<a id="${slug(cg.name)}"></a>`);
    lines.push("");
    if (cg.description) {
      lines.push(`> ${cg.description.replace(/\n/g, " ")}`);
      lines.push("");
    }
    lines.push(`**Precedence:** ${cg.precedence} · **Items:** ${cg.items.length}`);
    lines.push("");

    if (cg.items.length === 0) {
      lines.push("_No items defined._");
      lines.push("");
    } else {
      for (const item of cg.items) {
        lines.push(`<details>`);
        lines.push(`<summary><strong>${esc(item.name)}</strong> <small>— ordinal ${item.ordinal}</small></summary>`);
        lines.push("");
        if (item.description) {
          lines.push(`> ${item.description.replace(/\n/g, " ")}`);
          lines.push("");
        }
        if (item.formatStringExpression) {
          lines.push("**Format string expression**");
          lines.push("");
          lines.push("```");
          lines.push(item.formatStringExpression);
          lines.push("```");
          lines.push("");
        }
        if (item.expression) {
          lines.push("**Body**");
          lines.push("");
          lines.push("```");
          lines.push(item.expression);
          lines.push("```");
          lines.push("");
        }
        lines.push(`</details>`);
        lines.push("");
      }
    }
    lines.push("[↑ Jump to](#jump-to)");
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateQualityMd — Companion data-quality review document
//   Standalone audit doc, separate from the technical specification. Surfaces
//   coverage, removal candidates, indirect entities, and inactive
//   relationships — the actionable findings.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateQualityMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];

  const unusedM   = data.measures.filter(m => m.status === "unused");
  const unusedC   = data.columns.filter(c => c.status === "unused");
  const indirectM = data.measures.filter(m => m.status === "indirect");
  const indirectC = data.columns.filter(c => c.status === "indirect");
  const inactiveRels = data.relationships.filter(r => !r.isActive);

  const measureCoveragePct = data.totals.measuresInModel > 0
    ? Math.round((data.totals.measuresDirect / data.totals.measuresInModel) * 100)
    : 0;
  const columnCoveragePct = data.totals.columnsInModel > 0
    ? Math.round((data.totals.columnsDirect / data.totals.columnsInModel) * 100)
    : 0;

  // ── Documentation coverage ──────────────────────────────────────────────
  // "Undocumented" = no /// doc-comment captured and no description: property.
  // We simply check for an empty description string.
  const undocumentedTables   = data.tables.filter(t => !t.description);
  const undocumentedColumns  = data.columns.filter(c => !c.description);
  const undocumentedMeasures = data.measures.filter(m => !m.description);
  const tableDocPct   = data.totals.tables          > 0 ? Math.round(((data.totals.tables          - undocumentedTables.length)   / data.totals.tables)          * 100) : 0;
  const columnDocPct  = data.totals.columnsInModel  > 0 ? Math.round(((data.totals.columnsInModel  - undocumentedColumns.length)  / data.totals.columnsInModel)  * 100) : 0;
  const measureDocPct = data.totals.measuresInModel > 0 ? Math.round(((data.totals.measuresInModel - undocumentedMeasures.length) / data.totals.measuresInModel) * 100) : 0;

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Data Quality Review`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Measure coverage** | ${data.totals.measuresDirect} of ${data.totals.measuresInModel} (${measureCoveragePct}%) bound to a visual |`);
  lines.push(`| **Column coverage** | ${data.totals.columnsDirect} of ${data.totals.columnsInModel} (${columnCoveragePct}%) bound to a visual |`);
  lines.push(`| **Removal candidates** | ${unusedM.length} measure${unusedM.length === 1 ? "" : "s"} · ${unusedC.length} column${unusedC.length === 1 ? "" : "s"} |`);
  lines.push(`| **Indirect entities** | ${indirectM.length} measure${indirectM.length === 1 ? "" : "s"} · ${indirectC.length} column${indirectC.length === 1 ? "" : "s"} |`);
  lines.push(`| **Inactive relationships** | ${inactiveRels.length} |`);
  lines.push(`| **Missing descriptions** | ${undocumentedTables.length} table${undocumentedTables.length === 1 ? "" : "s"} · ${undocumentedColumns.length} column${undocumentedColumns.length === 1 ? "" : "s"} · ${undocumentedMeasures.length} measure${undocumentedMeasures.length === 1 ? "" : "s"} |`);
  lines.push(`| **Scope** | Coverage, removal candidates, indirect-use entities, inactive relationships, documentation coverage. Action-oriented review of the model. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── How to read ───────────────────────────────────────────────────────────
  lines.push("## How to read this document");
  lines.push("");
  lines.push("This document complements the **Semantic-model specification** (the main technical doc). The spec describes _what is in_ the model; this review surfaces _what to act on_:");
  lines.push("");
  lines.push("- **Coverage** — how much of the model is actually consumed by the report.");
  lines.push("- **Removal candidates** — entities that are not referenced anywhere. Safe to delete after a final eyeball.");
  lines.push("- **Indirect entities** — not on a visual, but referenced via DAX or relationships. **Keep these.** Removing them silently breaks measures or filter propagation.");
  lines.push("- **Inactive relationships** — defined but dormant unless explicitly activated via `USERELATIONSHIP()` in DAX.");
  lines.push("- **Documentation coverage** — tables, columns, and measures lacking a description (`///` doc comment or `description:` property). Undocumented fields are hard to hand over.");
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 1. Coverage ───────────────────────────────────────────────────────────
  lines.push("## 1. Coverage");
  lines.push("");
  lines.push("| Entity | Direct | Indirect | Unused | Total | Direct coverage |");
  lines.push("|--------|------:|---------:|-------:|------:|----------------:|");
  lines.push(`| Measures | ${data.totals.measuresDirect} | ${data.totals.measuresIndirect} | ${data.totals.measuresUnused} | ${data.totals.measuresInModel} | ${measureCoveragePct}% |`);
  lines.push(`| Columns | ${data.totals.columnsDirect} | ${data.totals.columnsIndirect} | ${data.totals.columnsUnused} | ${data.totals.columnsInModel} | ${columnCoveragePct}% |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 2. Removal candidates ─────────────────────────────────────────────────
  lines.push("## 2. Removal candidates");
  lines.push("");
  if (unusedM.length === 0 && unusedC.length === 0) {
    lines.push("_No unused entities — nothing to remove._");
    lines.push("");
  } else {
    lines.push("Entities not referenced by any visual, measure, or relationship. Review then delete.");
    lines.push("");
    if (unusedM.length > 0) {
      lines.push(`### 2.1 Unused measures (${unusedM.length})`);
      lines.push("");
      lines.push("| Measure | Home table | Format |");
      lines.push("|---------|-----------|--------|");
      [...unusedM].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(m => {
        lines.push(`| ${esc(m.name)} | ${esc(m.table)} | ${esc(m.formatString) || "—"} |`);
      });
      lines.push("");
    }
    if (unusedC.length > 0) {
      lines.push(`### 2.${unusedM.length > 0 ? "2" : "1"} Unused columns (${unusedC.length})`);
      lines.push("");
      lines.push("| Column | Home table | Data type | Notes |");
      lines.push("|--------|-----------|-----------|-------|");
      [...unusedC].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(c => {
        const notes: string[] = [];
        if (c.isHidden) notes.push("Hidden");
        if (c.isCalculated) notes.push("Calculated");
        if (c.isKey) notes.push("PK");
        lines.push(`| ${esc(c.name)} | ${esc(c.table)} | ${esc(c.dataType)} | ${notes.join(", ") || "—"} |`);
      });
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  // ── 3. Indirect entities ──────────────────────────────────────────────────
  lines.push("## 3. Indirect entities");
  lines.push("");
  if (indirectM.length === 0 && indirectC.length === 0) {
    lines.push("_No indirect entities detected._");
    lines.push("");
  } else {
    lines.push("Not bound to a visual, but **kept alive** because something else needs them — measure DAX, calc-column DAX, or a relationship. **Do not remove without checking upstream references.**");
    lines.push("");
    if (indirectM.length > 0) {
      lines.push(`### 3.1 Indirect measures (${indirectM.length})`);
      lines.push("");
      lines.push("| Measure | Home table | Used by |");
      lines.push("|---------|-----------|---------|");
      [...indirectM].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(m => {
        const usedBy = m.dependedOnBy && m.dependedOnBy.length > 0
          ? m.dependedOnBy.map(d => "`" + d + "`").join(", ")
          : "—";
        lines.push(`| ${esc(m.name)} | ${esc(m.table)} | ${usedBy} |`);
      });
      lines.push("");
    }
    if (indirectC.length > 0) {
      lines.push(`### 3.${indirectM.length > 0 ? "2" : "1"} Indirect columns (${indirectC.length})`);
      lines.push("");
      lines.push("Referenced by a measure's DAX expression or used in a relationship.");
      lines.push("");
      lines.push("| Column | Home table | Data type |");
      lines.push("|--------|-----------|-----------|");
      [...indirectC].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(c => {
        lines.push(`| ${esc(c.name)} | ${esc(c.table)} | ${esc(c.dataType)} |`);
      });
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  // ── 5. Documentation coverage is pushed after section 4 below. ────────────

  // ── 4. Inactive relationships ─────────────────────────────────────────────
  lines.push("## 4. Inactive relationships");
  lines.push("");
  if (inactiveRels.length === 0) {
    lines.push("_No inactive relationships in this model._");
    lines.push("");
  } else {
    lines.push("Defined but dormant. Inactive relationships only take effect when wrapped in `USERELATIONSHIP()` inside a DAX measure. Often used for role-playing dimensions (e.g. multiple date relationships).");
    lines.push("");
    lines.push("| # | From | To |");
    lines.push("|--:|------|----|");
    inactiveRels.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${esc(r.fromTable)}[${esc(r.fromColumn)}] | ${esc(r.toTable)}[${esc(r.toColumn)}] |`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 5. Documentation coverage ─────────────────────────────────────────────
  lines.push("## 5. Documentation coverage");
  lines.push("");
  lines.push("Tables, columns, and measures that do not expose a description. A description is either a `///` doc comment preceding the entity or a `description:` property on it. Undocumented entities make the model harder to hand over and weaken auto-generated documentation like this one.");
  lines.push("");

  // Overview table
  lines.push("### 5.1 Summary");
  lines.push("");
  lines.push("| Entity | Documented | Missing | Total | Coverage |");
  lines.push("|--------|-----------:|--------:|------:|---------:|");
  lines.push(`| Tables | ${data.totals.tables - undocumentedTables.length} | ${undocumentedTables.length} | ${data.totals.tables} | ${tableDocPct}% |`);
  lines.push(`| Columns | ${data.totals.columnsInModel - undocumentedColumns.length} | ${undocumentedColumns.length} | ${data.totals.columnsInModel} | ${columnDocPct}% |`);
  lines.push(`| Measures | ${data.totals.measuresInModel - undocumentedMeasures.length} | ${undocumentedMeasures.length} | ${data.totals.measuresInModel} | ${measureDocPct}% |`);
  lines.push("");

  // Undocumented tables
  lines.push("### 5.2 Undocumented tables");
  lines.push("");
  if (undocumentedTables.length === 0) {
    lines.push("_All tables have descriptions._");
    lines.push("");
  } else {
    for (const t of [...undocumentedTables].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- ${esc(t.name)}`);
    }
    lines.push("");
  }

  // Undocumented columns — grouped by table so it's actionable
  lines.push("### 5.3 Undocumented columns");
  lines.push("");
  if (undocumentedColumns.length === 0) {
    lines.push("_All columns have descriptions._");
    lines.push("");
  } else {
    const colsByTable = new Map<string, typeof undocumentedColumns>();
    for (const c of undocumentedColumns) {
      const arr = colsByTable.get(c.table) || [];
      arr.push(c);
      colsByTable.set(c.table, arr);
    }
    lines.push("| Table | Missing | Columns |");
    lines.push("|-------|--------:|---------|");
    [...colsByTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([tbl, cs]) => {
      const names = cs.map(c => esc(c.name)).sort((a, b) => a.localeCompare(b)).join(", ");
      lines.push(`| ${esc(tbl)} | ${cs.length} | ${names} |`);
    });
    lines.push("");
  }

  // Undocumented measures — grouped by home table
  lines.push("### 5.4 Undocumented measures");
  lines.push("");
  if (undocumentedMeasures.length === 0) {
    lines.push("_All measures have descriptions._");
    lines.push("");
  } else {
    const msByTable = new Map<string, typeof undocumentedMeasures>();
    for (const m of undocumentedMeasures) {
      const arr = msByTable.get(m.table) || [];
      arr.push(m);
      msByTable.set(m.table, arr);
    }
    lines.push("| Home table | Missing | Measures |");
    lines.push("|------------|--------:|----------|");
    [...msByTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([tbl, ms]) => {
      const names = ms.map(m => esc(m.name)).sort((a, b) => a.localeCompare(b)).join(", ");
      lines.push(`| ${esc(tbl)} | ${ms.length} | ${names} |`);
    });
    lines.push("");
  }

  lines.push("---");
  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}
