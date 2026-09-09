import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_PADDING, GROUP_HEIGHT, ROW_GAP, ROW_HEIGHT, SECTION_HEIGHT, SLOT_OFFSET,
  cardHeight, rowHeight, rowKind, rowTops, scrubSteps, segmentFits, socketWidgetY, visibleRows,
} from "../js/shared/widget_card_math.mjs";

test("visibleRows honors when() and closed groups but keeps the header", () => {
  const rows = [
    { widget: "mode" },
    { widget: "width", when: (v) => v.mode === "size" },
    { group: "advanced", label: "More" },
    { widget: "extra", inGroup: "advanced" },
  ];
  assert.deepEqual(visibleRows(rows, { mode: "size" }, { advanced: false }).map((r) => r.widget ?? r.group), ["mode", "width", "advanced"]);
  assert.deepEqual(visibleRows(rows, { mode: "other" }, { advanced: true }).map((r) => r.widget ?? r.group), ["mode", "advanced", "extra"]);
});

test("cardHeight sums rows, captions and headers with one gap between each", () => {
  assert.equal(cardHeight([]), CARD_PADDING * 2);
  assert.equal(cardHeight([{ widget: "a" }]), CARD_PADDING * 2 + ROW_HEIGHT);
  assert.equal(
    cardHeight([{ section: "Crop" }, { widget: "a" }, { group: "x" }]),
    CARD_PADDING * 2 + SECTION_HEIGHT + ROW_HEIGHT + GROUP_HEIGHT + ROW_GAP * 2,
  );
});

test("segmentFits takes a few short labels and rejects long lists", () => {
  assert.equal(segmentFits(["lab", "rgb", "mkl", "histogram"]), true);
  assert.equal(segmentFits(["overwrite", "skip", "error"]), true);
  assert.equal(segmentFits(["lanczos", "bicubic", "bilinear", "nearest", "area"]), false);
  assert.equal(segmentFits(["width+height", "longest_edge", "shortest_edge"]), false);
  assert.equal(segmentFits(["only"]), false);
});

test("scrubSteps: 0..1 floats move by 0.05, wide floats by ten increments, big ints by 8", () => {
  assert.deepEqual(scrubSteps({ min: 0, max: 1, step: 0.1, step2: 0.01, precision: 2 }, true), { step: 0.05, fineStep: 0.01, decimals: 2 });
  assert.deepEqual(scrubSteps({ min: 0, max: 64, step: 0.1, step2: 0.01, precision: 2 }, true), { step: 0.1, fineStep: 0.01, decimals: 2 });
  assert.deepEqual(scrubSteps({ min: 0, max: 16384, step: 10, step2: 1, precision: 0 }, false), { step: 8, fineStep: 1, decimals: 0 });
  assert.deepEqual(scrubSteps({ min: 1, max: 128, step: 10, step2: 1, precision: 0 }, false), { step: 1, fineStep: 1, decimals: 0 });
});

test("rowKind follows the widget type unless the row names a kind", () => {
  assert.equal(rowKind({ widget: "strength" }, { type: "number" }), "scrub");
  assert.equal(rowKind({ widget: "method" }, { type: "combo", options: { values: ["lab", "rgb"] } }), "segment");
  assert.equal(rowKind({ widget: "interpolation" }, { type: "combo", options: { values: ["lanczos", "bicubic", "bilinear", "nearest", "area"] } }), "select");
  assert.equal(rowKind({ widget: "flag" }, { type: "toggle" }), "switch");
  assert.equal(rowKind({ widget: "fill_color" }, { type: "text", value: "#000000" }), "color");
  assert.equal(rowKind({ widget: "prefix" }, { type: "text", value: "AusBoss" }), "text");
  assert.equal(rowKind({ widget: "caption" }, { type: "customtext" }), "skip");
  assert.equal(rowKind({ widget: "method", kind: "select" }, { type: "combo", options: { values: ["a", "b"] } }), "select");
});

test("rowHeight and cardHeight honor a textarea row's own height", () => {
  assert.equal(rowHeight({ widget: "prompt", kind: "textarea", height: 96 }), 96);
  assert.equal(rowHeight({ widget: "a" }), ROW_HEIGHT);
  assert.equal(
    cardHeight([{ widget: "prompt", kind: "textarea", height: 96 }, { widget: "flag" }]),
    CARD_PADDING * 2 + 96 + ROW_HEIGHT + ROW_GAP,
  );
});

test("rowTops walks the visible rows from the card's padding", () => {
  const rows = [{ widget: "a" }, { section: "More" }, { widget: "b", kind: "textarea", height: 60 }, { group: "x" }];
  assert.deepEqual(rowTops(rows), [
    CARD_PADDING,
    CARD_PADDING + ROW_HEIGHT + ROW_GAP,
    CARD_PADDING + ROW_HEIGHT + ROW_GAP + SECTION_HEIGHT + ROW_GAP,
    CARD_PADDING + ROW_HEIGHT + ROW_GAP + SECTION_HEIGHT + ROW_GAP + 60 + ROW_GAP,
  ]);
});

test("socketWidgetY puts a row's socket on its centre line and a tall row's near its top", () => {
  // The frontend draws the socket SLOT_OFFSET below the widget's y.
  const cardY = 120;
  const row = socketWidgetY(cardY, 10, CARD_PADDING, ROW_HEIGHT);
  assert.equal(row + SLOT_OFFSET, cardY + 10 + CARD_PADDING + ROW_HEIGHT / 2);
  const tall = socketWidgetY(cardY, 10, CARD_PADDING, 96);
  assert.equal(tall + SLOT_OFFSET, cardY + 10 + CARD_PADDING + 13);
});

test("rowKind: an explicit textarea kind wins over the customtext skip", () => {
  assert.equal(rowKind({ widget: "prompt", kind: "textarea" }, { type: "customtext" }), "textarea");
  assert.equal(rowKind({ widget: "caption" }, { type: "customtext" }), "skip");
});
