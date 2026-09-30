import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CARD_PADDING, GROUP_HEIGHT, ROW_GAP, ROW_HEIGHT, SECTION_HEIGHT, SLOT_OFFSET,
  cardHeight, commitWidgetValue, holdsUnknownValue, resetUnknownValues, rowHeight, rowKind, rowMuted, rowTops,
  scrubSteps, segmentFits, socketWidgetY, visibleRows,
} from "../js/shared/widget_card_math.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

test("a muted row keeps its place and the card its height", () => {
  const rows = [
    { widget: "tone", mute: (v) => v.seam === "blend in" },
    { widget: "halo", mute: (v) => v.seam === "blend in" },
  ];
  assert.equal(rowMuted(rows[0], { seam: "blend in" }), true);
  assert.equal(rowMuted(rows[0], { seam: "classic" }), false);
  // No predicate, or one that says anything but true, never mutes.
  assert.equal(rowMuted({ widget: "plain" }, { seam: "blend in" }), false);
  assert.equal(rowMuted({ widget: "odd", mute: () => "yes" }, {}), false);
  // Muting is not hiding: the same rows show and the card is as tall.
  for (const seam of ["classic", "blend in"]) {
    const visible = visibleRows(rows, { seam });
    assert.deepEqual(visible.map((row) => row.widget), ["tone", "halo"]);
    assert.equal(cardHeight(visible), CARD_PADDING * 2 + ROW_HEIGHT * 2 + ROW_GAP);
    assert.deepEqual(rowTops(visible), [CARD_PADDING, CARD_PADDING + ROW_HEIGHT + ROW_GAP]);
  }
});

test("commitWidgetValue sets the value, runs the callback, then tells the node", () => {
  const calls = [];
  const widget = { name: "image", value: "old.png", callback: (value, canvas, node) => calls.push(["callback", value, canvas, node.id]) };
  const node = { id: 5, onWidgetChanged: (name, value, previous, changed) => calls.push(["changed", name, value, previous, changed === widget]) };
  commitWidgetValue(node, widget, "new.png", "canvas");
  assert.equal(widget.value, "new.png");
  assert.deepEqual(calls, [
    ["callback", "new.png", "canvas", 5],
    ["changed", "image", "new.png", "old.png", true],
  ]);
});

test("commitWidgetValue copes with a widget that has no callback and a node that has no hook", () => {
  const widget = { name: "seed", value: 1 };
  commitWidgetValue({}, widget, 2, null);
  assert.equal(widget.value, 2);
});

test("a switch holds only on or off, a choice only one of its options, a number only a number", () => {
  for (const value of [true, false]) assert.equal(holdsUnknownValue({ type: "toggle", value }), false);
  for (const value of ["", null, undefined, 0, "true"]) assert.equal(holdsUnknownValue({ type: "toggle", value }), true);
  const seam = (value) => ({ type: "combo", value, options: { values: ["classic", "blend in"] } });
  assert.equal(holdsUnknownValue(seam("blend in")), false);
  for (const value of ["", null, "blend"]) assert.equal(holdsUnknownValue(seam(value)), true);
  // A number holds only a finite number: an old save's "" is not one.
  for (const value of [0, 2.5, -3]) assert.equal(holdsUnknownValue({ type: "number", value }), false);
  for (const value of ["", "image", null, undefined, Number.NaN, "2"]) assert.equal(holdsUnknownValue({ type: "number", value }), true);
  // Other widgets are never judged: an empty text field is a real value.
  assert.equal(holdsUnknownValue({ type: "text", value: "" }), false);
});

// ---------- saves from before an input was appended ----------
// The frontend hands saved values out by position, and the card is a widget
// that saves an empty value of its own, so an input appended since a save
// receives the card's "" when that save loads.

function restoreByPosition(names, saved, types = {}) {
  return names.map((name, index) => ({ name, type: types[name] ?? "number", value: saved[index] }));
}

// Today's widgets, in order: every input but the sockets, then the card.
function widgetNames(nodeId, sockets) {
  const api = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "node_api.json"), "utf-8"))[nodeId];
  return [...api.required, ...api.optional].filter((name) => !sockets.includes(name)).concat("ausboss_widget_card");
}

// The card's resetUnknown fallbacks, read from js/widget_cards/index.js.
function cardFallbacks(nodeId) {
  const source = readFileSync(join(ROOT, "js", "widget_cards", "index.js"), "utf-8");
  const start = source.indexOf(`\n  ${nodeId}: {`);
  assert.ok(start >= 0, `js/widget_cards/index.js has no card for ${nodeId}`);
  const next = source.slice(start + 1).search(/\n {2}AUSBOSS_NODES_\w+: \{/);
  const entry = next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
  const literal = entry.match(/resetUnknown: (\{[^}]*\})/)?.[1];
  return literal ? JSON.parse(literal.replace(/(\w+):/g, '"$1":')) : {};
}

// Crop For Inpaint's keep_inside default, read from the Python source: the
// widget default a new node gets, and the argument default an API prompt
// without keep_inside runs with.
function keepInsideDefaults() {
  const source = readFileSync(join(ROOT, "nodes", "node_inpaint_crop_stitch.py"), "utf-8");
  const asBool = (text) => (text === "True" ? true : text === "False" ? false : undefined);
  const widget = source.slice(source.indexOf('"keep_inside": (')).match(/"default": (True|False)/)?.[1];
  const argument = source.match(/^\s+keep_inside=(True|False),$/m)?.[1];
  return { widget: asBool(widget), argument: asBool(argument) };
}

// Crop For Inpaint as the LaMa Object Removal example saved it before 2.4.0:
// its fifteen settings, then the card's own empty value.
const CROP_BEFORE_KEEP_INSIDE = [2, 16, 8, 0, 0, 0, 0, false, 0, 0, "bilinear", 0, 0, 0, 0, ""];
const CROP_TYPES = { invert_mask: "toggle", keep_inside: "toggle", rescale_algorithm: "combo" };

test("Crop For Inpaint saved before Stay in picture opens with it on, as an API prompt without it runs", () => {
  const names = widgetNames("AUSBOSS_NODES_CropForInpaint", ["image", "mask"]);
  const widgets = restoreByPosition(names, CROP_BEFORE_KEEP_INSIDE, CROP_TYPES);
  const keepInside = widgets.find((widget) => widget.name === "keep_inside");
  assert.equal(keepInside.value, "", "the old save hands keep_inside the card's empty value");

  assert.deepEqual(resetUnknownValues(widgets, cardFallbacks("AUSBOSS_NODES_CropForInpaint")), ["keep_inside"]);
  const defaults = keepInsideDefaults();
  assert.equal(keepInside.value, true);
  assert.equal(keepInside.value, defaults.widget, "a new node's default");
  assert.equal(keepInside.value, defaults.argument, "what an API prompt without keep_inside runs with");
  // Every other setting keeps what was saved.
  const others = widgets.filter((widget) => widget.name !== "keep_inside" && widget.name !== "ausboss_widget_card");
  assert.deepEqual(others.map((widget) => widget.value), CROP_BEFORE_KEEP_INSIDE.slice(0, 15));
});

test("Crop For Inpaint saved since keeps its Stay in picture", () => {
  const names = widgetNames("AUSBOSS_NODES_CropForInpaint", ["image", "mask"]);
  const fallbacks = cardFallbacks("AUSBOSS_NODES_CropForInpaint");
  for (const choice of [true, false]) {
    const widgets = restoreByPosition(names, [...CROP_BEFORE_KEEP_INSIDE.slice(0, 15), choice, ""], CROP_TYPES);
    assert.deepEqual(resetUnknownValues(widgets, fallbacks), []);
    assert.equal(widgets.find((widget) => widget.name === "keep_inside").value, choice);
  }
  // Saved again on 2.4.0 while it still showed the stale value: on as well.
  const resaved = restoreByPosition(names, [...CROP_BEFORE_KEEP_INSIDE.slice(0, 15), "", ""], CROP_TYPES);
  resetUnknownValues(resaved, fallbacks);
  assert.equal(resaved.find((widget) => widget.name === "keep_inside").value, true);
});

// Mask Refine's max_hole_size default, read from the Python source: the
// widget default a new node gets, and the argument default an API prompt
// without max_hole_size runs with.
function maxHoleSizeDefaults() {
  const source = readFileSync(join(ROOT, "nodes", "node_refine_mask.py"), "utf-8");
  const widget = source.slice(source.indexOf('"max_hole_size": (')).match(/"default": ([\d.]+)/)?.[1];
  const argument = source.match(/^\s+max_hole_size=([\d.]+),$/m)?.[1];
  return { widget: Number(widget), argument: Number(argument) };
}

// Mask Refine as the Krea 2 Inpaint Masked example saved it on 2.4.0: its
// eight settings, then the card's and the preview panel's empty values.
const REFINE_BEFORE_MAX_HOLE = [12, 4, true, 0, 0, 1, "off", true, "", ""];
const REFINE_TYPES = { fill_holes: "toggle", edge_refine: "combo", preview: "toggle" };

test("Mask Refine saved before Max hole size opens with no limit, as an API prompt without it runs", () => {
  const names = widgetNames("AUSBOSS_NODES_RefineMask", ["mask", "guide_image"]);
  const widgets = restoreByPosition(names, REFINE_BEFORE_MAX_HOLE, REFINE_TYPES);
  widgets.find((widget) => widget.name === "edge_refine").options = { values: ["off", "guided filter", "matting"] };
  const maxHole = widgets.find((widget) => widget.name === "max_hole_size");
  assert.equal(maxHole.value, "", "the old save hands max_hole_size the card's empty value");

  assert.deepEqual(resetUnknownValues(widgets, cardFallbacks("AUSBOSS_NODES_RefineMask")), ["max_hole_size"]);
  const defaults = maxHoleSizeDefaults();
  assert.equal(maxHole.value, 0);
  assert.equal(maxHole.value, defaults.widget, "a new node's default");
  assert.equal(maxHole.value, defaults.argument, "what an API prompt without max_hole_size runs with");
  const others = widgets.filter((widget) => widget.name !== "max_hole_size" && widget.name !== "ausboss_widget_card");
  assert.deepEqual(others.map((widget) => widget.value), REFINE_BEFORE_MAX_HOLE.slice(0, 8));
});

test("Mask Refine saved since keeps its Max hole size", () => {
  const names = widgetNames("AUSBOSS_NODES_RefineMask", ["mask", "guide_image"]);
  const fallbacks = cardFallbacks("AUSBOSS_NODES_RefineMask");
  for (const size of [0, 2, 0.5]) {
    const widgets = restoreByPosition(names, [...REFINE_BEFORE_MAX_HOLE.slice(0, 8), size], REFINE_TYPES);
    widgets.find((widget) => widget.name === "edge_refine").options = { values: ["off", "guided filter", "matting"] };
    assert.deepEqual(resetUnknownValues(widgets, fallbacks), []);
    assert.equal(widgets.find((widget) => widget.name === "max_hole_size").value, size);
  }
});

test("Stitch Inpaint saved before Seam still opens classic", () => {
  const names = widgetNames("AUSBOSS_NODES_StitchInpaint", ["stitcher", "inpainted"]);
  const types = { fix_edge_halo: "toggle", seam: "combo" };
  const widgets = restoreByPosition(names, [false, 0.5, ""], types);
  widgets.find((widget) => widget.name === "seam").options = { values: ["classic", "blend in"] };
  assert.deepEqual(resetUnknownValues(widgets, cardFallbacks("AUSBOSS_NODES_StitchInpaint")), ["seam"]);
  assert.deepEqual(widgets.map((widget) => widget.value), [false, 0.5, "classic", undefined]);
  // A real choice is left alone.
  const chosen = restoreByPosition(names, [false, 0.5, "blend in", ""], types);
  chosen.find((widget) => widget.name === "seam").options = { values: ["classic", "blend in"] };
  assert.deepEqual(resetUnknownValues(chosen, cardFallbacks("AUSBOSS_NODES_StitchInpaint")), []);
});
