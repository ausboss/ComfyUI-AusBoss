// Layout Boxes: the canvas's geometry and its saved form
// (js/shared/layout_boxes.mjs). The backend half, and the check against
// ComfyUI's own Create Bounding Boxes, are tests/test_layout_boxes_*.py.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DIM_MAX,
  DIM_MIN,
  EMPTY_LAYOUT,
  FREE_MIN_PX,
  LAYOUTS,
  MAX_COLORS,
  PLAIN_BOX,
  applyLayout,
  boxColor,
  boxWords,
  canvasSide,
  cleanPalette,
  copiedRect,
  drawnRect,
  fromCoreBoxes,
  fromPixels,
  gridCell,
  movedRect,
  newBox,
  normalizeHex,
  nudgedRect,
  parseLayout,
  resizedRect,
  serializeLayout,
  sideForPicture,
  snapTo,
  snapping,
  textOn,
  wholePixels,
  wiredNumber,
  wiredSource,
} from "../js/shared/layout_boxes.mjs";

const W = 1344;
const H = 768;
const GRID = snapping(W, H, true);
const FREE = snapping(W, H, false);
const box = (x0, y0, x1, y1, extra = {}) => newBox({ x0, y0, x1, y1 }, W, H, extra);

test("a box turns into fractions by one division per number, as the backend reads pixel boxes", () => {
  const made = fromPixels({ x0: 320, y0: 96, x1: 832, y1: 736 }, W, H);
  assert.equal(made.x, 320 / W);
  assert.equal(made.y, 96 / H);
  assert.equal(made.w, 512 / W);
  assert.equal(made.h, 640 / H);
  assert.deepEqual(wholePixels(made, W, H), { x0: 320, y0: 96, x1: 832, y1: 736 });
});

test("the saved form keeps every number exactly", () => {
  const boxes = [box(320, 96, 832, 736, { desc: "a cat", palette: ["#FF3399"] }), box(0, 0, 1344, 64, { type: "text", text: "HELLO" })];
  const text = serializeLayout(boxes, "abc123");
  const back = parseLayout(text, W, H);
  assert.equal(back.fromInput, "abc123");
  assert.equal(back.broken, false);
  assert.deepEqual(back.boxes.map((b) => [b.x, b.y, b.w, b.h]), boxes.map((b) => [b.x, b.y, b.w, b.h]));
  assert.deepEqual(back.boxes[0].palette, ["#ff3399"], "colors are kept in lower case, as the canvas writes them");
  assert.equal(back.boxes[1].type, "text");
  assert.equal(back.boxes[1].text, "HELLO");
  assert.equal(JSON.parse(serializeLayout([])).from_input, undefined, "no fingerprint, no key");
});

test("reading the saved form never throws and drops what it cannot use", () => {
  assert.deepEqual(parseLayout(EMPTY_LAYOUT).boxes, []);
  assert.deepEqual(parseLayout("").boxes, []);
  assert.equal(parseLayout("{not json").broken, true);
  assert.deepEqual(parseLayout(null).boxes, []);
  const mixed = parseLayout(JSON.stringify({ v: 1, boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: "a" }, null, { x: 0, y: 0, w: 1 }] }));
  assert.equal(mixed.boxes.length, 1);
  assert.equal(mixed.boxes[0].type, "obj");
  assert.equal(mixed.boxes[0].desc, "");
});

test("Create Bounding Boxes' own pixel boxes are read against the canvas size", () => {
  const core = [{ x: 544, y: 128, width: 416, height: 192, metadata: { type: "text", text: "OPEN", desc: "neon", palette: ["#F00"] } }];
  const [read] = fromCoreBoxes(core, 1024, 1536);
  assert.equal(read.x, 544 / 1024);
  assert.equal(read.h, 192 / 1536);
  assert.equal(read.type, "text");
  assert.deepEqual(read.palette, ["#ff0000"]);
  assert.deepEqual(parseLayout(core, 1024, 1536).boxes, [read], "a list in the widget is read the same way");
});

test("the grid has cells of 32 px, bigger on a big canvas, and snaps to the far edge too", () => {
  assert.equal(gridCell(1024), 32);
  assert.equal(gridCell(2048), 32);
  assert.equal(gridCell(4096), 64);
  assert.equal(gridCell(16384), 256);
  assert.equal(snapTo(47, 32, 1000), 32);
  assert.equal(snapTo(49, 32, 1000), 64);
  assert.equal(snapTo(998, 32, 1000), 1000, "1000 is not a multiple of 32, its edge still snaps");
  assert.equal(snapTo(995, 32, 1000), 992, "the nearer of the two");
  assert.equal(snapTo(-20, 32, 1000), 0);
});

test("drawing snaps both corners, in any direction, and keeps at least one cell", () => {
  assert.deepEqual(drawnRect(100, 90, 500, 700, W, H, GRID), { x0: 96, y0: 96, x1: 512, y1: 704 });
  assert.deepEqual(drawnRect(500, 700, 100, 90, W, H, GRID), { x0: 96, y0: 96, x1: 512, y1: 704 }, "dragged up and left");
  const tiny = drawnRect(200, 200, 203, 201, W, H, GRID);
  assert.equal(tiny.x1 - tiny.x0, 32);
  assert.equal(tiny.y1 - tiny.y0, 32);
  const corner = drawnRect(W - 2, H - 2, W - 1, H - 1, W, H, GRID);
  assert.ok(corner.x1 <= W && corner.y1 <= H && corner.x1 - corner.x0 >= 32, "a box at the far corner stays on the canvas");
  const free = drawnRect(100.4, 90.6, 103, 92, W, H, FREE);
  assert.equal(free.x0, 100);
  assert.equal(free.x1 - free.x0, FREE_MIN_PX, "with the grid off the smallest box is FREE_MIN_PX");
});

test("moving keeps the size, lands an edge on the grid, and stays on the canvas", () => {
  const start = { x0: 96, y0: 96, x1: 416, y1: 608 };
  assert.deepEqual(movedRect(start, 40, 20, W, H, GRID), { x0: 128, y0: 128, x1: 448, y1: 640 });
  const far = movedRect(start, 100000, 100000, W, H, GRID);
  assert.deepEqual(far, { x0: W - 320, y0: H - 512, x1: W, y1: H });
  const back = movedRect(start, -100000, -100000, W, H, GRID);
  assert.deepEqual([back.x0, back.y0], [0, 0]);
  // A box whose width is not whole cells can still sit flush with the canvas edge.
  const odd = { x0: 0, y0: 0, x1: 300, y1: 100 };
  assert.equal(movedRect(odd, W - 300 - 3, 0, W, H, GRID).x1, W);
  assert.deepEqual(movedRect(start, 7.6, 0, W, H, FREE), { x0: 104, y0: 96, x1: 424, y1: 608 }, "free moves land on whole pixels");
});

test("resizing moves only the edges the handle holds and keeps one cell", () => {
  const start = { x0: 96, y0: 96, x1: 416, y1: 608 };
  assert.deepEqual(resizedRect(start, "e", 100, 0, W, H, GRID), { x0: 96, y0: 96, x1: 512, y1: 608 });
  assert.deepEqual(resizedRect(start, "nw", -40, -40, W, H, GRID), { x0: 64, y0: 64, x1: 416, y1: 608 });
  const squeezed = resizedRect(start, "w", 100000, 0, W, H, GRID);
  assert.equal(squeezed.x1 - squeezed.x0, 32);
  assert.equal(squeezed.x1, 416);
  const out = resizedRect(start, "se", 100000, 100000, W, H, GRID);
  assert.deepEqual([out.x1, out.y1], [W, H]);
});

test("arrow keys and copies keep the box on the canvas", () => {
  const start = { x0: 1200, y0: 700, x1: 1344, y1: 768 };
  assert.deepEqual(nudgedRect(start, 32, 32, W, H), start, "already at the corner");
  assert.deepEqual(nudgedRect(start, -1, 0, W, H), { x0: 1199, y0: 700, x1: 1343, y1: 768 });
  assert.deepEqual(copiedRect({ x0: 0, y0: 0, x1: 100, y1: 100 }, W, H), { x0: 32, y0: 32, x1: 132, y1: 132 });
  assert.deepEqual(copiedRect(start, W, H), { x0: 1168, y0: 668, x1: 1312, y1: 736 }, "at the edge the copy goes up and left");
});

test("colors: hex in lower case, five at most, the first one colors the box", () => {
  assert.equal(normalizeHex("#ABC"), "#aabbcc");
  assert.equal(normalizeHex(" #A1B2C3 "), "#a1b2c3");
  assert.equal(normalizeHex("#a1b2c3d4"), "#a1b2c3d4");
  assert.equal(normalizeHex("red"), null);
  assert.deepEqual(cleanPalette(["#111", "x", "#222222", "#333", "#444", "#555", "#666"]), ["#111111", "#222222", "#333333", "#444444", "#555555"]);
  assert.equal(cleanPalette(["#1", "#2", "#333", "#444", "#555", "#666", "#777", "#888"]).length, MAX_COLORS);
  assert.equal(boxColor({ palette: [] }), PLAIN_BOX);
  assert.equal(boxColor({ palette: ["#ff0000"] }), "#ff0000");
  assert.equal(textOn("#ffffff"), "#061010");
  assert.equal(textOn("#000000"), "#ffffff");
});

test("what a box says on the canvas", () => {
  assert.equal(boxWords({ type: "obj", desc: " a cat ", text: "ignored" }), "a cat");
  assert.equal(boxWords({ type: "text", text: "OPEN", desc: "neon" }), '"OPEN" - neon');
  assert.equal(boxWords({ type: "text", text: "OPEN", desc: "" }), '"OPEN"');
  assert.equal(boxWords({ type: "text", text: "", desc: "neon" }), "neon");
});

test("a ready-made layout moves the boxes in and keeps every word", () => {
  const title = LAYOUTS.find((layout) => layout.id === "title");
  const kept = applyLayout(title, [box(0, 0, 320, 320, { desc: "a dog" })], W, H);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].type, "text", "the title place takes a text box, a new one when there is none");
  assert.equal(kept[1].desc, "a dog", "the object goes to the picture place");
  const withText = applyLayout(title, [box(0, 0, 320, 320, { desc: "a dog" }), box(0, 400, 320, 500, { type: "text", text: "HI" })], W, H);
  assert.equal(withText[0].text, "HI");
  assert.equal(withText[1].desc, "a dog");
  const two = LAYOUTS.find((layout) => layout.id === "two");
  const three = [box(0, 0, 64, 64, { desc: "a" }), box(0, 0, 64, 64, { desc: "b" }), box(0, 0, 64, 64, { desc: "c" })];
  const placed = applyLayout(two, three, W, H);
  assert.deepEqual(placed.map((b) => b.desc), ["a", "b", "c"], "a box the layout has no place for stays");
  assert.deepEqual(placed[2], three[2]);
  for (const layout of LAYOUTS) {
    for (const made of applyLayout(layout, [], W, H)) {
      const rect = wholePixels(made, W, H);
      assert.ok(rect.x0 >= 0 && rect.y0 >= 0 && rect.x1 <= W && rect.y1 <= H, `${layout.id} stays on the canvas`);
      assert.equal(rect.x0 % 32, 0, `${layout.id} is on the grid`);
    }
  }
});

test("canvas sides stay inside the node's limits; a picture's size lands on 16 px steps", () => {
  assert.equal(canvasSide(1000.4), 1000);
  assert.equal(canvasSide(10), DIM_MIN);
  assert.equal(canvasSide(99999), DIM_MAX);
  assert.equal(canvasSide("x", 512), 512);
  assert.equal(sideForPicture(832), 832);
  assert.equal(sideForPicture(1213), 1216);
  assert.equal(sideForPicture(20), DIM_MIN);
  assert.equal(sideForPicture(0), null);
});

// A tiny graph of plain objects, as the frontend keeps one.
function graphWith(nodes, links) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const graph = { getNodeById: (id) => byId.get(id) ?? null, links: new Map(links.map((link) => [link.id, link])) };
  for (const node of nodes) node.graph = graph;
  return graph;
}

test("a size on a wire is read from the node it comes from", () => {
  const latent = { id: 1, comfyClass: "AUSBOSS_NODES_Resolution", outputs: [{ name: "width" }, { name: "height" }], widgets: [{ name: "width", value: 1344 }, { name: "height", value: 768 }] };
  const reroute = { id: 2, type: "Reroute", inputs: [{ name: "", link: 11 }], outputs: [{ name: "" }] };
  const number = { id: 3, comfyClass: "AUSBOSS_NODES_Integer", outputs: [{ name: "INT" }], widgets: [{ name: "value", value: 640 }] };
  const unknown = { id: 4, comfyClass: "ImageSize", outputs: [{ name: "width" }], widgets: [] };
  const boxes = { id: 9, inputs: [{ name: "width", link: 10 }, { name: "height", link: 12 }, { name: "background", link: null }] };
  graphWith([latent, reroute, number, unknown, boxes], [
    { id: 10, origin_id: 2, origin_slot: 0 },
    { id: 11, origin_id: 1, origin_slot: 0 },
    { id: 12, origin_id: 1, origin_slot: 1 },
  ]);
  assert.equal(wiredNumber(boxes, "width"), 1344, "through a Reroute, by the output's name");
  assert.equal(wiredNumber(boxes, "height"), 768);
  assert.equal(wiredNumber(boxes, "background"), null);
  assert.equal(wiredSource(boxes, "width").node, latent);
  const fromNumber = { id: 7, inputs: [{ name: "width", link: 13 }] };
  const fromUnknown = { id: 8, inputs: [{ name: "width", link: 14 }] };
  graphWith([number, unknown, fromNumber, fromUnknown], [{ id: 13, origin_id: 3, origin_slot: 0 }, { id: 14, origin_id: 4, origin_slot: 0 }]);
  assert.equal(wiredNumber(fromNumber, "width"), 640, "a number node's value");
  assert.equal(wiredNumber(fromUnknown, "width"), null, "known only once the workflow runs");
});
