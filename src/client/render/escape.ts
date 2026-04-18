/**
 * Client-side escape + classifier helpers.
 *
 * Carved out of src/client/main.ts as a type-safe module during
 * Stop 5 pass 2. Four pure string functions, no DOM access, no
 * state. Compiled alongside the rest of the client as a SCRIPT
 * (no imports, no exports) and concatenated into the inline
 * <script> block by src/html-generator.ts BEFORE main.js — so the
 * symbols defined here are already in scope by the time main.js's
 * code runs.
 *
 * Paired with the SERVER-side helpers at src/render/safe.ts, which
 * cover the same contexts from the TypeScript generator's side. The
 * client versions exist independently because the server's code
 * can't run in the browser (import paths, Node crypto deps, etc.).
 */

/**
 * HTML text context. Escape the five HTML-sensitive characters so
 * the returned string is safe to splice into element body text OR
 * into a double-quoted attribute value.
 *
 * Null / undefined collapse to empty string. Non-strings coerce via
 * `String()` — mirrors the server-side helper's tolerance.
 */
function escHtml(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML attribute context. Functionally identical to escHtml today
 * (same five-character table works for both). Kept as a separate
 * name so call sites self-document the context and we can diverge
 * later if we add URL-context escaping for href/src attributes.
 */
function escAttr(s: unknown): string { return escHtml(s); }

/**
 * Status-class helper. Maps a measure/column `status` value to the
 * CSS class name used on the row wrapper — empty string for the
 * "direct" case (no class added).
 */
function sc(s: string): string {
  return s === "unused" ? "unused" : s === "indirect" ? "indirect" : "";
}

/**
 * Usage-count classifier for the coloured count pills. Zero usage
 * gets the "zero" (red) pill, 1 gets "low" (amber), ≥ 2 gets "good"
 * (green). Used for `usageCount` and `pageCount` cells across every
 * data table in the dashboard.
 */
function uc(n: number): string {
  return n === 0 ? "zero" : n <= 1 ? "low" : "good";
}
