/**
 * report-scanner — data-visual counting.
 *
 * Confirms that the scanner separates "actual data visuals" (charts,
 * tables, cards, slicers, maps, AI visuals, plus any unknown custom
 * visual type) from non-data canvas elements (shapes, textboxes,
 * images, action buttons, page navigators, groups). The fixture has
 * one of each so the math checks out independent of fixture drift.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { scanReportBindings, isDataVisual } from "../src/report-scanner.js";

const FIXTURE = path.resolve("tests/fixtures/scanner-pbir/MixedReport.Report");

test("scanReportBindings counts data visuals separately from total elements", () => {
  const result = scanReportBindings(FIXTURE);

  // Fixture: 1 chart + 1 shape + 1 textbox + 1 image + 1 button + 1 custom
  assert.equal(result.visualCount, 6, "total element count includes shapes/textboxes/images/buttons");
  assert.equal(result.dataVisualCount, 2, "only the chart and the unknown custom visual count as data visuals");
  assert.equal(result.pageCount, 1);
  assert.equal(result.allPages.length, 1);
  assert.equal(result.allPages[0].visualCount, 6);
  assert.equal(result.allPages[0].dataVisualCount, 2);
});

test("scanReportBindings marks each ScannedVisual with isDataVisual matching the predicate", () => {
  const result = scanReportBindings(FIXTURE);
  const byId = new Map(result.scannedVisuals.map(v => [v.visualId, v]));

  assert.equal(byId.get("chart1")?.isDataVisual, true);
  assert.equal(byId.get("customViz1")?.isDataVisual, true, "unknown custom visual types count as data");
  assert.equal(byId.get("shape1")?.isDataVisual, false);
  assert.equal(byId.get("textbox1")?.isDataVisual, false);
  assert.equal(byId.get("image1")?.isDataVisual, false);
  assert.equal(byId.get("button1")?.isDataVisual, false);
});

test("isDataVisual handles missing / empty / case-variant visualType defensively", () => {
  assert.equal(isDataVisual({ visual: { visualType: "clusteredBarChart" } }), true);
  assert.equal(isDataVisual({ visual: { visualType: "SHAPE" } }), false, "case-insensitive deny match");
  assert.equal(isDataVisual({ visual: { visualType: "  textbox  " } }), false, "whitespace-tolerant deny match");
  assert.equal(isDataVisual({ visual: { visualType: "" } }), false, "missing visualType → non-data (defensive)");
  assert.equal(isDataVisual({ visual: {} }), false);
  assert.equal(isDataVisual({}), false);
  assert.equal(isDataVisual(null), false);
});
