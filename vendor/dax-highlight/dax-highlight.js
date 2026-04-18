/*!
 * dax-highlight — tiny, dependency-free syntax highlighter for DAX
 *
 * Works as:
 *   • Plain <script> — exposes window.DaxHighlight
 *   • ES module     — import { highlightDax, highlightAll } from "./dax-highlight.js"
 *   • CommonJS      — const { highlightDax, highlightAll } = require("./dax-highlight.js")
 *
 * Pair with dax-highlight.css for theming.
 *
 * Usage:
 *   // 1. Auto-highlight every <pre><code class="language-dax"> in the page
 *   DaxHighlight.highlightAll();
 *
 *   // 2. Highlight a specific element
 *   DaxHighlight.highlightElement(document.querySelector("pre code"));
 *
 *   // 3. Get highlighted HTML from raw DAX source
 *   const html = DaxHighlight.highlightDax("SUM(Sales[Amount])");
 *
 *   // 4. Extend the known-function list
 *   DaxHighlight.addFunctions(["MYCUSTOMFUNC", "COMPANY_METRIC"]);
 */

(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;                    // CommonJS
  } else if (typeof define === "function" && define.amd) {
    define([], () => api);                   // AMD
  } else {
    root.DaxHighlight = api;                 // <script> global
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --------------------------------------------------------------------------
  // Known tokens
  // --------------------------------------------------------------------------

  const DAX_KEYWORDS = new Set([
    "VAR", "RETURN", "IF", "SWITCH", "TRUE", "FALSE", "BLANK",
    "IN", "NOT", "AND", "OR",
  ]);

  const DAX_FUNCTIONS = new Set([
    // Date & time
    "CALENDAR", "DATE", "DATEDIFF", "DATEVALUE", "DAY", "WEEKNUM", "MONTH", "QUARTER",
    "YEAR", "NOW", "TODAY", "HOUR", "MINUTE", "SECOND", "TIME", "EOMONTH", "EDATE",

    // Time intelligence
    "DATEADD", "DATESBETWEEN", "DATESINPERIOD", "DATESMTD", "DATESQTD", "DATESYTD",
    "TOTALMTD", "TOTALQTD", "TOTALYTD", "SAMEPERIODLASTYEAR",
    "PREVIOUSDAY", "PREVIOUSMONTH", "PREVIOUSQUARTER", "PREVIOUSYEAR",
    "NEXTDAY", "NEXTMONTH", "NEXTQUARTER", "NEXTYEAR",
    "STARTOFMONTH", "ENDOFMONTH", "STARTOFQUARTER", "ENDOFQUARTER",
    "STARTOFYEAR", "ENDOFYEAR", "PARALLELPERIOD", "FIRSTDATE", "LASTDATE",

    // Information
    "COLUMNSTATISTICS", "HASONEVALUE", "HASONEFILTER",
    "ISBLANK", "ISLOGICAL", "ISNUMBER", "ISTEXT", "ISERROR", "IFERROR",
    "ISFILTERED", "ISCROSSFILTERED", "ISINSCOPE", "ISSELECTEDMEASURE",
    "SELECTEDVALUE", "SELECTEDMEASURE", "USERPRINCIPALNAME", "USERNAME",

    // Math & statistical
    "SUM", "SUMX", "AVERAGE", "AVERAGEX", "MEDIAN", "MEDIANX", "GEOMEAN", "GEOMEANX",
    "COUNT", "COUNTA", "COUNTX", "COUNTAX", "COUNTBLANK", "DIVIDE",
    "MIN", "MINX", "MAX", "MAXX", "COUNTROWS", "DISTINCTCOUNT", "DISTINCTCOUNTNOBLANK",
    "RANKX", "RANK", "TOPN", "ABS", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "TRUNC",
    "CEILING", "FLOOR", "MOD", "POWER", "SQRT", "EXP", "LN", "LOG", "LOG10",
    "STDEV.P", "STDEV.S", "VAR.P", "VAR.S",

    // Filter
    "FILTER", "CALCULATE", "CALCULATETABLE",
    "ALL", "ALLEXCEPT", "ALLSELECTED", "ALLNOBLANKROW", "REMOVEFILTERS",
    "KEEPFILTERS", "EARLIER", "EARLIEST",
    "VALUES", "USERELATIONSHIP", "TREATAS",

    // Relationship
    "CROSSFILTER", "RELATED", "RELATEDTABLE", "LOOKUPVALUE",

    // Table manipulation
    "SUMMARIZE", "SUMMARIZECOLUMNS", "DISTINCT", "ADDCOLUMNS", "SELECTCOLUMNS",
    "GROUPBY", "INTERSECT", "NATURALINNERJOIN", "NATURALLEFTOUTERJOIN", "UNION",
    "EXCEPT", "ROW", "GENERATE", "GENERATEALL", "CROSSJOIN", "ADDMISSINGITEMS",

    // Text
    "EXACT", "FIND", "SEARCH", "FORMAT", "LEFT", "RIGHT", "MID", "LEN",
    "LOWER", "UPPER", "PROPER", "TRIM", "CONCATENATE", "CONCATENATEX",
    "SUBSTITUTE", "REPLACE", "REPT", "UNICHAR", "VALUE",
  ]);

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function isLetter(ch) { return !!ch && /[A-Za-z_]/.test(ch); }
  function isDigit(ch)  { return !!ch && /[0-9]/.test(ch); }
  function isWord(ch)   { return !!ch && /[A-Za-z0-9_]/.test(ch); }

  function wrap(cls, value) {
    return `<span class="${cls}">${escapeHtml(value)}</span>`;
  }

  // --------------------------------------------------------------------------
  // Tokenizer
  //
  // Class legend (pair with dax-highlight.css):
  //   dax-k  keyword       (VAR, RETURN, IF, SWITCH, TRUE, FALSE, IN, AND, OR, NOT, BLANK)
  //   dax-f  function      (known DAX function immediately followed by `(`)
  //   dax-v  variable      (identifier after VAR, or any identifier starting with `_`)
  //   dax-m  measure/col   ([Sales Amount])
  //   dax-r  table[col]    ('Sales'[Amount] or Sales[Amount])
  //   dax-s  string        ("text")
  //   dax-c  comment       (// line or /* block */)
  //   dax-n  number        (123, 12.5)
  // --------------------------------------------------------------------------

  function highlightDax(source) {
    const s = String(source || "");
    let i = 0;
    let out = "";
    let expectVarName = false;

    while (i < s.length) {
      const ch = s[i];
      const next = s[i + 1] || "";

      // Line comment
      if (ch === "/" && next === "/") {
        const start = i;
        i += 2;
        while (i < s.length && s[i] !== "\n") i++;
        out += wrap("dax-c", s.slice(start, i));
        continue;
      }

      // Block comment
      if (ch === "/" && next === "*") {
        const start = i;
        i += 2;
        while (i < s.length - 1 && !(s[i] === "*" && s[i + 1] === "/")) i++;
        if (i < s.length - 1) i += 2;
        out += wrap("dax-c", s.slice(start, i));
        continue;
      }

      // String literal ("..." with doubled-quote escape)
      if (ch === "\"") {
        const start = i;
        i++;
        while (i < s.length) {
          if (s[i] === "\"") {
            if (s[i + 1] === "\"") { i += 2; continue; }
            i++;
            break;
          }
          i++;
        }
        out += wrap("dax-s", s.slice(start, i));
        continue;
      }

      // 'Quoted table'[Column] reference (column part optional)
      if (ch === "'") {
        const start = i;
        i++;
        while (i < s.length) {
          if (s[i] === "'") {
            if (s[i + 1] === "'") { i += 2; continue; }
            i++;
            break;
          }
          i++;
        }
        if (s[i] === "[") {
          i++;
          while (i < s.length && s[i] !== "]") i++;
          if (s[i] === "]") i++;
          out += wrap("dax-r", s.slice(start, i));
        } else {
          out += escapeHtml(s.slice(start, i));
        }
        continue;
      }

      // [Measure or Column] reference (no preceding table name)
      if (ch === "[") {
        const start = i;
        i++;
        while (i < s.length && s[i] !== "]") i++;
        if (s[i] === "]") i++;
        out += wrap("dax-m", s.slice(start, i));
        continue;
      }

      // Numeric literal
      if (isDigit(ch)) {
        const start = i;
        i++;
        while (i < s.length && (isDigit(s[i]) || s[i] === ".")) i++;
        out += wrap("dax-n", s.slice(start, i));
        continue;
      }

      // Identifier / keyword / function / variable
      if (isLetter(ch)) {
        const start = i;
        i++;
        while (i < s.length && isWord(s[i])) i++;
        const ident = s.slice(start, i);
        const upper = ident.toUpperCase();

        if (expectVarName) {
          out += wrap("dax-v", ident);
          expectVarName = false;
          continue;
        }

        if (DAX_KEYWORDS.has(upper)) {
          out += wrap("dax-k", ident);
          if (upper === "VAR") expectVarName = true;
          continue;
        }

        // Identifiers starting with _ are variables by convention
        if (ident.startsWith("_")) {
          out += wrap("dax-v", ident);
          continue;
        }

        // Function call: identifier followed (after whitespace) by `(`
        let j = i;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === "(") {
          if (DAX_FUNCTIONS.has(upper)) {
            out += wrap("dax-f", ident);
          } else {
            out += escapeHtml(ident);
          }
        } else {
          out += escapeHtml(ident);
        }
        continue;
      }

      // Any other character
      out += escapeHtml(ch);
      i++;
    }

    return out;
  }

  // --------------------------------------------------------------------------
  // DOM helpers
  // --------------------------------------------------------------------------

  /** Highlight a single <code> element in-place. */
  function highlightElement(codeEl) {
    if (!codeEl || codeEl.__daxHighlighted) return;
    const raw = codeEl.textContent || "";
    codeEl.innerHTML = highlightDax(raw);
    codeEl.classList.add("code-dax");
    codeEl.__daxHighlighted = true;
  }

  /**
   * Scan the DOM for DAX code blocks and highlight them.
   *
   * Default selector matches markdown-it / marked / showdown output:
   *   <pre><code class="language-dax">…</code></pre>
   *   <pre><code class="lang-dax">…</code></pre>
   *
   * @param {ParentNode} [root=document]     Where to search
   * @param {string}     [selector]          Override selector
   */
  function highlightAll(root, selector) {
    const scope = root || document;
    const sel = selector || "pre code.language-dax, pre code.lang-dax, code.code-dax";
    scope.querySelectorAll(sel).forEach(highlightElement);
  }

  /** Add custom DAX function names that should be highlighted as functions. */
  function addFunctions(names) {
    (names || []).forEach(n => DAX_FUNCTIONS.add(String(n).toUpperCase()));
  }

  /** Add custom DAX keywords. */
  function addKeywords(names) {
    (names || []).forEach(n => DAX_KEYWORDS.add(String(n).toUpperCase()));
  }

  return {
    highlightDax,
    highlightElement,
    highlightAll,
    addFunctions,
    addKeywords,
  };
});
