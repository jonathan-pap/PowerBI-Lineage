/**
 * Client-side Markdown renderer for the Docs tab.
 *
 * First module carved out of the monolithic src/client/main.ts during
 * Stop 5 pass 2. Kept as a SCRIPT file (no imports, no exports) so
 * tsc emits it as a plain browser-ready .js that concatenates with
 * main.ts into the same classic <script> in the generated HTML.
 *
 * Scope: exactly what the dashboard needs, no more. Supports:
 *   - Headings (# … ######)
 *   - Paragraphs (blank-line separated)
 *   - Bold **…**, italic _…_, strikethrough ~~…~~
 *   - Inline code `…`
 *   - Fenced code blocks ``` / ```lang … ```
 *   - Ordered + unordered lists (1 level of nesting)
 *   - Blockquotes > …
 *   - Horizontal rule ---
 *   - Pipe tables
 *   - Link [text](url)
 *   - Raw <details>/<summary>/<a id="…"> passthrough
 *   - Styled <span class="…"> passthrough for badges / chips
 *
 * It is NOT a general-purpose markdown renderer. It is tuned to the
 * output of src/md-generator.ts on the server side and will happily
 * mangle anything outside that vocabulary.
 *
 * Type safety: all three public functions take `string` and return
 * `string`. The private `mdParseTable` takes `string[]`. Unlike
 * main.ts, this module compiles without @ts-nocheck.
 */

// Escape the five HTML-sensitive characters. The markdown tokens that
// SHOULD become HTML (pipe tables, asterisks, etc.) are unescaped again
// by the inline renderer below, restricted to the specific tags the
// dashboard emits.
function mdEscapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render inline markdown (bold / italic / links / inline code / etc.)
 * plus a handful of dashboard-specific tags that need to pass through.
 */
function mdInline(s: string): string {
  // Preserve inline code spans first via a null-byte placeholder —
  // otherwise backticks would collide with the template-literal escape
  // table below. The placeholder survives mdEscapeHtml because NUL is
  // not one of the five escaped chars.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c);
    return "\u0000" + (codes.length - 1) + "\u0000";
  });
  s = mdEscapeHtml(s);

  // Restore the specific inline HTML tags the server emits and we want
  // to render through. Opening / closing forms of: details, summary,
  // strong, small, br, and <a id="…">/</a>.
  s = s.replace(
    /&lt;(\/?)(details|summary|strong|small|br)(\s*\/?)&gt;/g,
    (_m, slash: string, tag: string, tail: string) => "<" + slash + tag + tail + ">",
  );
  s = s.replace(/&lt;a id=&quot;([^&]*)&quot;&gt;/g, (_m, id: string) => '<a id="' + id + '">');
  s = s.replace(/&lt;\/a&gt;/g, "</a>");
  // <span class="…"> passthrough so badges and chip pills render as
  // their styled components instead of escaped text. Attribute is
  // restricted to class= to limit the surface; mdEscapeHtml has
  // already neutralised &, <, > in the class value.
  s = s.replace(/&lt;span class=&quot;([^&]*)&quot;&gt;/g, (_m, cls: string) => '<span class="' + cls + '">');
  s = s.replace(/&lt;\/span&gt;/g, "</span>");

  // Bold ** **
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic _ _ with word-boundary-ish neighbours so interior
  // underscores inside identifiers don't match.
  s = s.replace(/(^|[\s(>])_([^_]+)_(?=$|[\s.,;:!?)<])/g, "$1<em>$2</em>");
  // Strikethrough ~~ ~~
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) => '<a href="' + u + '">' + t + "</a>");

  // Restore the code spans we stashed at the top.
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) =>
    "<code>" + mdEscapeHtml(codes[parseInt(i, 10)]) + "</code>",
  );
  return s;
}

/**
 * Parse a pipe table: header | separator | row+.
 */
function mdParseTable(block: string[]): string {
  const head = block[0].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const rows = block.slice(2).map(ln =>
    ln.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()),
  );
  let html = "<table><thead><tr>";
  head.forEach(h => { html += "<th>" + mdInline(h) + "</th>"; });
  html += "</tr></thead><tbody>";
  rows.forEach(r => {
    html += "<tr>";
    r.forEach(c => { html += "<td>" + mdInline(c) + "</td>"; });
    html += "</tr>";
  });
  html += "</tbody></table>";
  return html;
}

/**
 * Render a full markdown document to HTML. Line-level state machine —
 * no tokenizer, no AST. Block types recognised in order of precedence:
 *
 *   1. Raw <details>/<summary>/<a> tag passthrough
 *   2. Headings
 *   3. Horizontal rule
 *   4. Blank line (paragraph break)
 *   5. Blockquote
 *   6. Fenced code block
 *   7. Ordered list (with nested bullets)
 *   8. Bullet list
 *   9. Pipe table
 *  10. Default: accumulate into paragraph
 */
function mdRender(md: string): string {
  if (!md) return "";
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let paraBuf: string[] = [];
  const flushPara = (): void => {
    if (paraBuf.length === 0) return;
    const joined = paraBuf.join(" ").trim();
    if (joined) out.push("<p>" + mdInline(joined) + "</p>");
    paraBuf = [];
  };

  while (i < lines.length) {
    const ln = lines[i];

    // Raw HTML passthrough (whole line is one of the tags we produce).
    if (/^\s*<(\/?)(details|summary|a)(\s|>|\/>)/.test(ln)) {
      flushPara();
      out.push(ln);
      i++;
      continue;
    }

    // Headings
    const h = /^(#{1,6})\s+(.+)$/.exec(ln);
    if (h) {
      flushPara();
      out.push("<h" + h[1].length + ">" + mdInline(h[2]) + "</h" + h[1].length + ">");
      i++;
      continue;
    }

    // HR
    if (/^---+$/.test(ln.trim())) {
      flushPara();
      out.push("<hr>");
      i++;
      continue;
    }

    // Blank line
    if (/^\s*$/.test(ln)) {
      flushPara();
      i++;
      continue;
    }

    // Blockquote (consecutive > lines)
    if (/^>\s?/.test(ln)) {
      flushPara();
      const qBuf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        qBuf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push("<blockquote>" + mdInline(qBuf.join(" ")) + "</blockquote>");
      continue;
    }

    // Fenced code block: ``` or ```lang … ```
    // Content is rendered verbatim (HTML-escaped, not Markdown-processed)
    // so DAX bodies and signatures don't accidentally trigger inline-code
    // styling or get their asterisks interpreted as bold markers.
    if (/^\s*```/.test(ln)) {
      flushPara();
      const langLine = ln.trim();
      const lang = langLine.replace(/^```/, "").trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;  // skip closing fence
      const langAttr = lang ? ' data-lang="' + mdEscapeHtml(lang) + '"' : "";
      out.push('<pre class="md-code"' + langAttr + '><code>' + mdEscapeHtml(codeLines.join("\n")) + "</code></pre>");
      continue;
    }

    // Numbered list (ordered). Supports indented bullets nested under each item.
    if (/^\s*\d+\.\s+/.test(ln)) {
      flushPara();
      const olItems: { text: string; subs: string[] }[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (/^\s*\d+\.\s+/.test(cur)) {
          olItems.push({ text: cur.replace(/^\s*\d+\.\s+/, ""), subs: [] });
          i++;
        } else if (/^\s{2,}[-*]\s+/.test(cur) && olItems.length > 0) {
          olItems[olItems.length - 1].subs.push(cur.replace(/^\s*[-*]\s+/, ""));
          i++;
        } else {
          break;
        }
      }
      const olHtml = "<ol>" + olItems.map(it => {
        let li = "<li>" + mdInline(it.text);
        if (it.subs.length > 0) {
          li += "<ul>" + it.subs.map(sub => "<li>" + mdInline(sub) + "</li>").join("") + "</ul>";
        }
        return li + "</li>";
      }).join("") + "</ol>";
      out.push(olHtml);
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(ln)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push("<ul>" + items.map(x => "<li>" + mdInline(x) + "</li>").join("") + "</ul>");
      continue;
    }

    // Pipe table: header line followed by a separator line of dashes+pipes
    if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
      flushPara();
      const block: string[] = [ln, lines[i + 1]];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      out.push(mdParseTable(block));
      continue;
    }

    // Default: accumulate into paragraph
    paraBuf.push(ln);
    i++;
  }
  flushPara();
  return out.join("\n");
}
