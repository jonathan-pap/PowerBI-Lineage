/**
 * Structural XSS fuzz tests for the rendered dashboard.
 *
 * Stop 4 replaced every onclick="…\${field}…" splice with
 * data-action="…" + data-<prop>="<escAttr(field)>". The browser
 * HTML-decodes the attribute when exposing it via element.dataset,
 * so a malicious field name like `foo'),alert(1),('bar` can't
 * reach a JS parser anymore.
 *
 * These tests assert the structural invariant:
 *   1. No onclick= HTML attribute appears in any rendered output
 *      (only safe DOM-property assignments in the embedded script,
 *      which we don't inspect — they splice no user data).
 *   2. Adversarial entity names do not leak a raw </script> into
 *      the embed block.
 *   3. The data-name / data-type attributes for every click target
 *      contain HTML-encoded forms of the entity name, never raw
 *      quote/angle characters.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHTML } from "../src/html-generator.js";
import type { FullData } from "../src/data-builder.js";

const ADVERSARIAL = "foo'),alert(1),('bar";
const BREAKOUT    = "</script><script>alert('pwn')</script>";
const HTML_SPECIAL = '<img src=x onerror="alert(1)">';

/**
 * Build a FullData with a single adversarial name in every
 * user-splice-able field across the model. The whole payload is
 * type-cast because the v0.2 types layer hasn't been extracted yet
 * (Stop 5); we only need a shape that satisfies generateHTML.
 */
function buildAdversarialData(name: string): FullData {
  return {
    measures: [{
      name,
      table: name,
      daxExpression: "SUM(" + name + "[X])",
      formatString: name,
      description: name,
      daxDependencies: [name],
      usedIn: [{
        pageId: "p1", pageName: name, visualId: "v1",
        visualType: name, visualTitle: name, bindingRole: name,
      }],
      usageCount: 1,
      pageCount: 1,
      status: "direct",
      dependedOnBy: [],
      externalProxy: null,
    }],
    columns: [{
      name,
      table: name,
      dataType: name,
      description: name,
      status: "direct",
      usageCount: 1,
      pageCount: 1,
      usedIn: [],
      isKey: false, isInferredPK: false, isFK: false,
      isCalculated: false, isHidden: false, isSlicerField: false,
    } as any],
    relationships: [],
    functions: [],
    calcGroups: [],
    tables: [{
      name,
      description: name,
      columnCount: 1, measureCount: 1, keyCount: 0, fkCount: 0,
      isCalcGroup: false,
      columns: [{
        name, table: name, dataType: name,
        description: name, status: "direct",
        usageCount: 0, pageCount: 0, usedIn: [],
        isKey: false, isInferredPK: false, isFK: false,
        isCalculated: false, isHidden: false, isSlicerField: false,
      }],
      measures: [{ name, table: name, formatString: "", status: "direct", usageCount: 0 }],
      relationships: [],
      partitions: [],
      hierarchies: [],
    } as any],
    pages: [{
      name,
      visualCount: 0,
      measures: [name],
      columns: [name],
      measureCount: 1,
      columnCount: 1,
      slicerCount: 0,
      typeCounts: {},
      coverage: 0,
      visuals: [],
    } as any],
    hiddenPages: [],
    allPages: [{ name, hidden: false, visualCount: 0 }],
    expressions: [],
    compatibilityLevel: null,
    modelProperties: { name: "Test", description: "" } as any,
    totals: {
      measuresInModel: 1, measuresDirect: 1, measuresIndirect: 0, measuresUnused: 0,
      columnsInModel: 1, columnsDirect: 1, columnsIndirect: 0, columnsUnused: 0,
      relationships: 0, functions: 0, calcGroups: 0, tables: 1,
      pages: 1, visuals: 0,
    },
  } as unknown as FullData;
}

function generate(name: string): string {
  return generateHTML(
    buildAdversarialData(name),
    name,            // reportName also adversarial
    "# " + name,     // every markdown uses the name
    "# " + name,
    "# " + name,
    "# " + name,
    "# " + name,
    "# " + name,
    "0.0.0-test"
  );
}

// ──────────────────────────────────────────────────────────────────────
// Structural invariants
// ──────────────────────────────────────────────────────────────────────

test("XSS fuzz — no inline on*= HTML event-handler attributes in rendered output", () => {
  // Stop 4 banned onclick="…" splices because field names in those
  // contexts reached a JS parser. Same reasoning applies to every
  // on*-prefixed HTML attribute (oninput, onchange, onsubmit,
  // onkeyup, onmouseover, onerror, …). Original test only checked
  // onclick — the Stop-5 /sc:analyze found two oninput= sites that
  // slipped past. This broader assertion backfills that gap.
  //
  // DOM-property assignments like `btn.onclick=...` live in the
  // literal script body and don't match `\s on…=` because there's
  // no whitespace before `onclick` in `btn.onclick`.
  // Require the attribute VALUE to start with an actual quote. Real
  // HTML in our generator always quotes attribute values, so this
  // catches every inline on-handler we might accidentally emit.
  // Payloads that the generator HTML-escaped into text nodes land as
  // `onerror=&quot;…&quot;` — the `=` is followed by `&`, not `"` or
  // `'`, so this tighter pattern ignores them (correctly — they're
  // harmless text, not event handlers).
  const BANNED = /\son[a-z]+\s*=\s*['"]/i;
  for (const payload of [ADVERSARIAL, BREAKOUT, HTML_SPECIAL]) {
    const html = generate(payload);
    const m = html.match(BANNED);
    if (m) {
      const idx = m.index ?? 0;
      const ctx = html.slice(Math.max(0, idx - 40), idx + 80);
      assert.fail(
        "Found inline on*= attribute for payload " +
        JSON.stringify(payload) + " near: " + JSON.stringify(ctx)
      );
    }
  }
});

test("XSS fuzz — adversarial name in data-* attributes is HTML-encoded", () => {
  const html = generate(ADVERSARIAL);
  // Every data-action / data-name / data-type / data-tab / data-md
  // / data-mode / data-section / data-entity / data-key / data-table
  // / data-path attribute value must contain only HTML-safe chars —
  // no raw single-quote, double-quote, < or >. The browser decodes
  // these back into the adversarial payload when reading dataset.*,
  // so the structural guarantee is: nothing touches a JS parser.
  const attrRx = /\sdata-(?:name|type|tab|md|mode|section|entity|key|table|path)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  let checked = 0;
  while ((m = attrRx.exec(html))) {
    checked++;
    const value = m[1];
    assert.ok(!value.includes("'"), "raw ' in attribute: " + m[0]);
    assert.ok(!value.includes("<"), "raw < in attribute: " + m[0]);
    assert.ok(!value.includes(">"), "raw > in attribute: " + m[0]);
  }
  assert.ok(checked > 0, "no data-* attributes found — test is probably broken");
});

test("XSS fuzz — </script> payload does not inflate embed-block count", () => {
  // Baseline: count legitimate </script> tags with a benign name.
  // Adversarial: re-render with a </script>-breakout payload. The
  // count must not grow — if it did, a breakout succeeded and an
  // extra </script> was injected into the document.
  const baseline = (generate("benign").match(/<\/script>/g) || []).length;
  const adversarial = (generate(BREAKOUT).match(/<\/script>/g) || []).length;
  assert.equal(
    adversarial,
    baseline,
    `</script> count grew: baseline=${baseline} adversarial=${adversarial}`
  );
});

test("XSS fuzz — <img onerror> HTML in a name is escaped, not rendered", () => {
  const html = generate(HTML_SPECIAL);
  // The raw <img…> tag must NOT be present in the HTML as an actual
  // tag. It should appear escaped inside either a text node or an
  // attribute value.
  assert.ok(
    !/<img\s+src=x\s+onerror=/i.test(html),
    "raw <img onerror> tag present in output"
  );
});

// ──────────────────────────────────────────────────────────────────────
// Delegated-action contract
// ──────────────────────────────────────────────────────────────────────

test("Event delegation — document-level click listener is present", () => {
  // Assert the delegator we added in Stop 4 is still wired. If a
  // future refactor removes it, every data-action element stops
  // working silently; this test is the canary.
  const html = generate("x");
  assert.ok(
    html.includes("document.addEventListener('click'"),
    "document-level click delegator missing from embedded script"
  );
  assert.ok(
    html.includes("[data-action]"),
    "delegator doesn't use [data-action] selector"
  );
});

test("Event delegation — every data-action verb has a case in the switch", () => {
  // Collect all data-action values emitted by the generator and all
  // case labels in the delegator, assert every emitted verb has a
  // handler.
  const html = generate("x");
  const emittedVerbs = new Set<string>();
  const rx = /data-action="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html))) emittedVerbs.add(m[1]);

  // Handled verbs: scan for `case 'verb':` inside the delegator.
  const handled = new Set<string>();
  const caseRx = /case\s+'([a-z-]+)'\s*:/g;
  while ((m = caseRx.exec(html))) handled.add(m[1]);

  for (const verb of emittedVerbs) {
    assert.ok(
      handled.has(verb),
      "emitted data-action=\"" + verb + "\" has no handler in the delegator"
    );
  }
});
