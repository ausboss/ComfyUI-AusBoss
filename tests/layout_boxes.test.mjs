// Layout Boxes: the canvas's geometry and its saved form
// (js/shared/layout_boxes.mjs). The backend half, and the check against
// ComfyUI's own Create Bounding Boxes, are tests/test_layout_boxes_*.py.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHIPS_MAX,
  DIM_MAX,
  DIM_MIN,
  EMPTY_LAYOUT,
  FREE_MIN_PX,
  GRID_SIZES,
  HANDLE_PX,
  KEPT_WORDS_NOTE,
  LAYOUTS,
  MAX_COLORS,
  MIDDLE_HANDLE_FROM_PX,
  NUDGE_PX,
  NUDGE_SHIFT_PX,
  PLAIN_BOX,
  TAG_HEIGHT_PX,
  applyLayout,
  boxColor,
  boxKind,
  boxMarks,
  boxTag,
  boxWords,
  canvasSide,
  chipWindow,
  cleanPalette,
  copiedRect,
  drawnRect,
  faceCanvas,
  fromCoreBoxes,
  fromPixels,
  gridCell,
  gridCellOf,
  gridIsOn,
  keptWordsNote,
  movedRect,
  newBox,
  normalizeHex,
  nudgeStep,
  nudgedRect,
  parseLayout,
  resizedRect,
  serializeLayout,
  sideForPicture,
  snapTo,
  snapping,
  tagWidthPx,
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

// The arrows used to move a box one grid cell (32 px, Shift four cells), so on
// a small picture a box had few places it could go; only Alt + arrow moved one
// pixel, and nobody finds Alt.
test("an arrow key moves the chosen box one pixel, ten with Shift, whatever the grid", () => {
  assert.equal(NUDGE_PX, 1);
  assert.equal(NUDGE_SHIFT_PX, 10);
  assert.deepEqual(nudgeStep("ArrowRight"), [1, 0]);
  assert.deepEqual(nudgeStep("ArrowLeft", { shiftKey: false }), [-1, 0]);
  assert.deepEqual(nudgeStep("ArrowUp", {}), [0, -1]);
  assert.deepEqual(nudgeStep("ArrowDown", {}), [0, 1]);
  assert.deepEqual(nudgeStep("ArrowRight", { shiftKey: true }), [10, 0]);
  assert.deepEqual(nudgeStep("ArrowLeft", { shiftKey: true }), [-10, 0]);
  assert.deepEqual(nudgeStep("ArrowUp", { shiftKey: true }), [0, -10]);
  assert.deepEqual(nudgeStep("ArrowDown", { shiftKey: true }), [0, 10]);
  assert.deepEqual(nudgeStep("ArrowRight", { altKey: true }), [1, 0], "Alt + arrow is still one pixel");
  assert.deepEqual(nudgeStep("ArrowRight", { altKey: true, shiftKey: true }), [10, 0]);
  for (const key of ["a", "Enter", "Arrow", "constructor", "", undefined]) assert.equal(nudgeStep(key), null, `${key} is no arrow`);
});

test("a nudged box lands exactly one pixel over, also on a canvas that is not whole cells", () => {
  // A 728 x 824 picture makes a 736 x 832 canvas; neither is whole 32 px cells.
  const [w, h] = [sideForPicture(728), sideForPicture(824)];
  assert.deepEqual([w, h], [736, 832]);
  let made = newBox({ x0: 101, y0: 203, x1: 301, y1: 263 }, w, h, { type: "text", text: "OPEN" });
  const press = (key, mods) => {
    const [dx, dy] = nudgeStep(key, mods);
    made = { ...made, ...fromPixels(nudgedRect(wholePixels(made, w, h), dx, dy, w, h), w, h) };
    return wholePixels(made, w, h);
  };
  assert.deepEqual(press("ArrowRight"), { x0: 102, y0: 203, x1: 302, y1: 263 }, "one pixel, off the grid");
  assert.deepEqual(press("ArrowRight", { shiftKey: true }), { x0: 112, y0: 203, x1: 312, y1: 263 });
  assert.deepEqual(press("ArrowUp", { altKey: true }), { x0: 112, y0: 202, x1: 312, y1: 262 });
  for (let i = 0; i < 200; i += 1) press("ArrowDown");
  assert.deepEqual(wholePixels(made, w, h), { x0: 112, y0: 402, x1: 312, y1: 462 }, "200 presses, 200 pixels: no drift");
  for (let i = 0; i < 100; i += 1) press("ArrowRight", { shiftKey: true });
  assert.deepEqual(wholePixels(made, w, h), { x0: w - 200, y0: 402, x1: w, y1: 462 }, "and it stops at the edge");
  assert.equal(made.type, "text", "the words stay with the box");
});

test("the grid is on for an empty canvas, off over a picture, and a choice the person made wins", () => {
  assert.equal(gridIsOn(undefined, false), true, "an empty canvas has the grid, as before");
  assert.equal(gridIsOn(undefined, true), false, "over a picture the grid starts off");
  assert.equal(gridIsOn(null, true), false);
  assert.equal(gridIsOn(true, true), true, "turned on over a picture, it stays on");
  assert.equal(gridIsOn(false, false), false, "turned off on an empty canvas, it stays off");
  assert.equal(gridIsOn(true, false), true);
  assert.equal(gridIsOn(false, true), false);
});

test("the canvas takes its arrow steps and its grid from these rules", () => {
  const source = readFileSync(new URL("../js/layout_boxes/index.js", import.meta.url), "utf-8");
  const start = source.indexOf("function onStageKey(");
  assert.ok(start >= 0, "js/layout_boxes/index.js has no onStageKey");
  const keys = source.slice(start, source.indexOf("\n}\n", start));
  assert.match(keys, /nudgeStep\(key, event\)/, "the arrow keys no longer take their step from nudgeStep");
  assert.doesNotMatch(keys, /gridOn|gridCell|snapping/, "the arrow keys follow the grid again");
  // The saved choice first, then whether a picture comes in on `background`.
  assert.match(
    source,
    /const gridOn = \(state\) => gridIsOn\(state\.node\.properties\?\.\[GRID_PROPERTY\], [^;\n]*wiredSource\(state\.node, "background"\)/,
    "the grid no longer follows the saved choice and the picture",
  );
});

test("the grid size from the gear: Auto keeps the 32 px rule, a number is that many pixels", () => {
  assert.deepEqual(GRID_SIZES, ["Auto", "8", "16", "32", "64"]);
  for (const side of [512, 1024, 4096, 16384]) assert.equal(gridCellOf(side, "Auto"), gridCell(side), `Auto on ${side}`);
  assert.equal(gridCellOf(4096), 64, "no size given is Auto");
  assert.equal(gridCellOf(4096, "8"), 8);
  assert.equal(gridCellOf(1024, "64"), 64);
  assert.equal(gridCellOf(1024, "12"), 32, "a size the gear does not offer is Auto");
  assert.equal(gridCellOf(1024, null), 32);
  assert.deepEqual(snapping(W, H, true), GRID, "a canvas without a size from the gear snaps as before");
  const fine = snapping(W, H, true, "8");
  assert.deepEqual([fine.cellX, fine.cellY], [8, 8]);
  assert.deepEqual(drawnRect(101, 93, 503, 701, W, H, fine), { x0: 104, y0: 96, x1: 504, y1: 704 }, "an 8 px grid lands on 8 px");
  assert.deepEqual(movedRect({ x0: 96, y0: 96, x1: 416, y1: 608 }, 13, 0, W, H, fine).x0, 112);
});

// Zoomed in, the box number covered a third of the box and the handles were
// huge: they grew with the graph's zoom like the rest of the face.
test("the marks around a box: middle handles only where they fit, the tag outside the box", () => {
  assert.equal(HANDLE_PX, 14);
  assert.equal(MIDDLE_HANDLE_FROM_PX, 48, "room for a corner, a middle and a corner handle, and a little more");
  const wide = boxMarks({ x: 40, y: 60, w: 200, h: 120 }, 400, 60);
  assert.deepEqual(wide, { middleTopBottom: true, middleLeftRight: true, tagInside: false, tagFromRight: false });
  const small = boxMarks({ x: 40, y: 60, w: 30, h: 30 }, 400, 60);
  assert.equal(small.middleTopBottom, false, "a small box keeps its corners only");
  assert.equal(small.middleLeftRight, false);
  const line = boxMarks({ x: 40, y: 60, w: 300, h: 24 }, 400, 60);
  assert.deepEqual([line.middleTopBottom, line.middleLeftRight], [true, false], "a line of text keeps its top and bottom handles");
  assert.equal(boxMarks({ x: 40, y: TAG_HEIGHT_PX - 1, w: 200, h: 120 }, 400, 60).tagInside, true, "no room above: the tag goes inside");
  assert.equal(boxMarks({ x: 40, y: TAG_HEIGHT_PX, w: 200, h: 120 }, 400, 60).tagInside, false);
  assert.equal(boxMarks({ x: 360, y: 60, w: 40, h: 40 }, 400, 60).tagFromRight, true, "at the right edge the tag runs leftward");
  assert.equal(boxMarks({ x: 340, y: 60, w: 60, h: 40 }, 400, 60).tagFromRight, false);
});

test("a box's tag and its chip say its number and its type", () => {
  assert.equal(boxTag({ type: "text" }, 0), "1 text");
  assert.equal(boxTag({ type: "obj" }, 1), "2 object");
  assert.equal(boxKind({ type: "something else" }), "object");
  assert.ok(tagWidthPx("12 object") >= 9 * 6, "wide enough for its monospace letters");
});

test("the chips: every box up to six, else six around the chosen box", () => {
  assert.equal(CHIPS_MAX, 6);
  assert.deepEqual(chipWindow(0, -1), [0, 0]);
  assert.deepEqual(chipWindow(2, -1), [0, 2]);
  assert.deepEqual(chipWindow(6, 5), [0, 6]);
  assert.deepEqual(chipWindow(9, -1), [0, 6], "nothing chosen: the first six");
  assert.deepEqual(chipWindow(9, 0), [0, 6]);
  assert.deepEqual(chipWindow(9, 4), [2, 8], "the chosen box near the middle");
  assert.deepEqual(chipWindow(9, 8), [3, 9], "the last box");
  for (let selected = 0; selected < 20; selected += 1) {
    const [first, end] = chipWindow(20, selected);
    assert.equal(end - first, CHIPS_MAX);
    assert.ok(first <= selected && selected < end, `box ${selected + 1} has its chip`);
  }
});

// A sign's text box became an object box when "object" was clicked to reach
// another box: the Text field hid, the words were kept unseen, and the model
// drew letters of its own.
test("an object box with words says so, and switching back to text brings them back", () => {
  assert.equal(keptWordsNote({ type: "obj", text: "AusBoss", desc: "white letters" }), KEPT_WORDS_NOTE);
  assert.match(KEPT_WORDS_NOTE, /^Object boxes do not write words\. Your words are kept for when you switch back to text\.$/);
  assert.equal(keptWordsNote({ type: "obj", text: "   " }), "", "no words, nothing to say");
  assert.equal(keptWordsNote({ type: "obj", text: "" }), "");
  assert.equal(keptWordsNote({ type: "text", text: "AusBoss" }), "", "a text box shows its words in the Text field");
  assert.equal(keptWordsNote(null), "");
  // The words stay in the saved form while the box is an object, so text gets them back.
  const sign = box(100, 200, 400, 260, { type: "text", text: "AusBoss", desc: "white letters on a red sign" });
  const asObject = parseLayout(serializeLayout([{ ...sign, type: "obj" }]), W, H).boxes[0];
  assert.equal(asObject.type, "obj");
  assert.equal(asObject.text, "AusBoss");
  const back = parseLayout(serializeLayout([{ ...asObject, type: "text" }]), W, H).boxes[0];
  assert.deepEqual(back, sign, "switched back, the box is the box it was");
});

test("the editor shows that line where the Text field was, and the type reads as the chosen box's own", () => {
  const source = readFileSync(new URL("../js/layout_boxes/index.js", import.meta.url), "utf-8");
  const start = source.indexOf("function syncEditor(");
  assert.ok(start >= 0, "js/layout_boxes/index.js has no syncEditor");
  const sync = source.slice(start, source.indexOf("\n}\n", start));
  assert.match(sync, /state\.textField\.hidden = !box \|\| box\.type !== "text";/, "the Text field is for text boxes");
  assert.match(sync, /const kept = keptWordsNote\(box\);\s*state\.keptNote\.hidden = !kept;/, "the kept words line follows keptWordsNote");
  assert.match(sync, /state\.kindLabel\.textContent = `Box \$\{state\.selected \+ 1\} is`;/, "the type has its box's name before it");
  assert.match(sync, /renderChips\(state\)/, "the chips follow the chosen box");
  const order = source.match(/editor\.append\(([^)]*)\)/)?.[1] ?? "";
  assert.match(order, /state\.textField, state\.keptNote, state\.descField/, "the line sits where the Text field was");
  // Switching the type writes the type alone: the words stay on the box.
  assert.match(source, /setBoxField\(state, "type", value\);/);
});

test("the marks keep one size on the screen at any graph zoom, in both looks", () => {
  const source = readFileSync(new URL("../js/layout_boxes/index.js", import.meta.url), "utf-8");
  const rule = (selector) => source.match(new RegExp(`\\n${selector.replace(/[.[\]>,()]/g, "\\$&")}\\{([^\\n]*)`))?.[1] ?? "";
  assert.match(rule(".ausboss-lb-handle"), /width:calc\(\$\{HANDLE_PX\}px\*var\(--lb-u\)\)/, "the handles grow with the zoom again");
  assert.match(rule(".ausboss-lb-tag"), /bottom:100%/, "the tag is back inside the box");
  assert.match(rule(".ausboss-lb-tag"), /height:calc\(\$\{TAG_HEIGHT_PX\}px\*var\(--lb-u\)\)/, "the tag grows with the zoom again");
  // A border is no good here: Chrome snaps one thinner than a face pixel up to
  // a whole pixel, and the zoom then makes it three pixels wide.
  assert.match(rule(".ausboss-lb-box"), /box-shadow:inset 0 0 0 calc\(1\.5px\*var\(--lb-u\)\) var\(--c\)/, "the outline grows with the zoom again");
  assert.doesNotMatch(rule(".ausboss-lb-box"), /border:/, "a border snaps to whole face pixels and grows with the zoom");
  assert.doesNotMatch(source.match(/\n\.ausboss-lb-handle::after\{([^\n]*)/)?.[1] ?? "border:", /border:/, "the handle's ring grows with the zoom again");
  assert.match(rule(".ausboss-lb-frame.pic .ausboss-lb-words"), /display:none/, "words cover the picture inside the boxes again");
  // --lb-u is measured on the face itself, and again whenever the canvas
  // draws at a new zoom: a node's own draw hook never runs in Nodes 2.0.
  assert.match(source, /state\.root\.getBoundingClientRect\(\)\.width \/ width/);
  assert.match(source, /state\.root\.style\.setProperty\("--lb-u", String\(1 \/ zoom\)\)/);
  assert.match(source, /chainCallback\(canvas, "onDrawForeground", \(\) => \{\s*const scale = zoomCanvas\?\.ds\?\.scale;/);
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

// With width and height wired from Latent Size (1024 x 1536), the face drew an
// 864 x 1184 picture stretched to 1024 x 1536, while the node makes the mask
// on the picture itself.
test("a picture on background is the canvas, at its own size, whatever width and height say", () => {
  assert.deepEqual(faceCanvas([864, 1184], 1024, 1536), { width: 864, height: 1184, picture: true }, "wired numbers do not stretch it");
  assert.deepEqual(faceCanvas([728, 824], 736, 832), { width: 728, height: 824, picture: true }, "its own pixels, not the 16 px steps");
  assert.deepEqual(faceCanvas(null, 1024, 1536), { width: 1024, height: 1536, picture: false }, "no picture: width and height");
  assert.deepEqual(faceCanvas(undefined, "x", 99999), { width: 1024, height: DIM_MAX, picture: false });
  assert.deepEqual(faceCanvas([0, 0], 640, 480), { width: 640, height: 480, picture: false }, "a picture with no size yet is no picture");
  // A box keeps its place on the picture: the same fractions, whatever the canvas around it.
  const sign = newBox({ x0: 100, y0: 300, x1: 400, y1: 380 }, 864, 1184);
  assert.deepEqual(wholePixels(sign, 864, 1184), { x0: 100, y0: 300, x1: 400, y1: 380 });
  const source = readFileSync(new URL("../js/layout_boxes/index.js", import.meta.url), "utf-8");
  assert.match(source, /return faceCanvas\(state\.pictureSize, read\("width", 0\), read\("height", 1\)\);/, "the face no longer takes its canvas from faceCanvas");
  assert.match(source, /const size = wanted\.size \?\? \[picture\.naturalWidth, picture\.naturalHeight\];\s*showPicture\(state, true, size\);/, "the picture's own size no longer reaches the canvas");
  assert.match(source, /const from = size\.picture \? "picture" : wired \? "wired" : "";/, "the size label no longer says where the size comes from");
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
