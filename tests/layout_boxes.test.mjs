// Layout Boxes: the canvas's geometry and its saved form
// (js/shared/layout_boxes.mjs). The backend half, and the check against
// ComfyUI's own Create Bounding Boxes, are tests/test_layout_boxes_*.py.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ANGLE_LIMIT,
  ANGLE_SNAP,
  CHIPS_MAX,
  DIM_MAX,
  DIM_MIN,
  EMPTY_LAYOUT,
  FREE_MIN_PX,
  GRID_SIZES,
  HANDLE_PX,
  KEPT_WORDS_NOTE,
  KNOB_GAP_PX,
  LAYOUTS,
  MAX_COLORS,
  MIDDLE_HANDLE_FROM_PX,
  NUDGE_PX,
  NUDGE_SHIFT_PX,
  PLAIN_BOX,
  TAG_HEIGHT_PX,
  TILT_FROM,
  angleLabel,
  angleOf,
  applyLayout,
  boxColor,
  boxCorners,
  boxKind,
  boxMarks,
  boxPixels,
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
  handleCursor,
  keptWordsNote,
  knobSide,
  leveledRect,
  movedRect,
  movedTurnedRect,
  newBox,
  normalizeHex,
  nudgeStep,
  nudgedRect,
  parseLayout,
  readAngle,
  resizedRect,
  resizedTurnedRect,
  serializeLayout,
  sideForPicture,
  snapTo,
  snapping,
  tagWidthPx,
  textOn,
  tiltPhrase,
  turnPoint,
  turnStep,
  turnedAngle,
  turnedBounds,
  turnedTagPlace,
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

// ---------- turned boxes ----------
// Words on a sign at a slant could only get a level box, which redraws what
// sits in its corners. A box can now be turned with a knob over its top edge.

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test("a turn is kept in degrees from -90 to 90, without noise, and a level box has none", () => {
  assert.equal(ANGLE_LIMIT, 90);
  for (const [value, angle] of [[25, 25], [25.2, 25.2], [-55, -55], [90, 90], [-90, -90], [120, -60], [-120, 60], [270, -90], [-270, 90],
    [450, 90], ["12.5", 12.5], [null, 0], [undefined, 0], ["x", 0], [true, 0], [NaN, 0], [Infinity, 0]]) {
    assert.equal(readAngle(value), angle, `${value}`);
  }
  assert.ok(Object.is(readAngle(-0), 0), "no minus zero");
  assert.equal(angleOf({}), 0);
  assert.equal(angleOf(null), 0);
});

test("the saved form keeps a turn; an old layout reads level and writes exactly as before", () => {
  const sign = { ...box(613, 771, 982, 873, { type: "text", text: "No Phones" }), angle: 25.2 };
  const text = serializeLayout([sign, box(0, 0, 64, 64)]);
  const data = JSON.parse(text);
  assert.equal(data.boxes[0].angle, 25.2);
  assert.deepEqual(Object.keys(data.boxes[0]), ["x", "y", "w", "h", "type", "text", "desc", "palette", "angle"], "the angle comes last, after the keys every layout has");
  assert.equal("angle" in data.boxes[1], false, "a level box is written without one");
  assert.equal(parseLayout(text, W, H).boxes[0].angle, 25.2);
  // A layout saved before boxes could turn: read level, written back byte for byte.
  const old = '{"v":1,"boxes":[{"x":0.25,"y":0.1,"w":0.5,"h":0.8,"type":"obj","text":"","desc":"a cat","palette":["#ff3399"]}],"from_input":"abc"}';
  const read = parseLayout(old, W, H);
  assert.equal("angle" in read.boxes[0], false);
  assert.equal(serializeLayout(read.boxes, read.fromInput), old);
  for (const zero of [0, -0, "0", null, "level"]) {
    assert.equal("angle" in parseLayout(JSON.stringify({ v: 1, boxes: [{ x: 0, y: 0, w: 0.5, h: 0.5, angle: zero }] })).boxes[0], false, `${zero}`);
  }
  assert.equal(parseLayout(JSON.stringify({ v: 1, boxes: [{ x: 0, y: 0, w: 0.5, h: 0.5, angle: 200 }] })).boxes[0].angle, 20);
});

test("the corners of a turned box, at 0, 25, -55 and 90 degrees", () => {
  const at = (angle) => ({ ...newBox({ x0: 300, y0: 250, x1: 700, y1: 350 }, 1000, 1000), ...(angle ? { angle } : {}) });
  assert.deepEqual(boxCorners(at(0), 1000, 1000), [[300, 250], [700, 250], [700, 350], [300, 350]]);
  assert.deepEqual(boxCorners(at(90), 1000, 1000), [[550, 100], [550, 500], [450, 500], [450, 100]], "a quarter turn is exact");
  assert.deepEqual(turnedBounds(at(90), 1000, 1000), { x0: 450, y0: 100, x1: 550, y1: 500 });
  for (const angle of [25, -55, 25.2, -89.9]) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = boxCorners(at(angle), 1000, 1000);
    assert.ok(close(Math.hypot(x1 - x0, y1 - y0), 400) && close(Math.hypot(x3 - x0, y3 - y0), 100), `${angle}: same size`);
    assert.ok(close((x1 - x0) * (x3 - x0) + (y1 - y0) * (y3 - y0), 0, 1e-6), `${angle}: square corners`);
    assert.ok(close((x0 + x2) / 2, 500) && close((y0 + y2) / 2, 300), `${angle}: turned about its centre`);
    assert.ok(close((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI, angle), `${angle}: clockwise on the screen`);
  }
  assert.ok(boxCorners(at(25), 1000, 1000)[1][1] > boxCorners(at(25), 1000, 1000)[0][1], "plus runs downhill to the right");
  assert.ok(boxCorners(at(-55), 1000, 1000)[1][1] < boxCorners(at(-55), 1000, 1000)[0][1], "minus runs uphill to the right");
  // On a canvas that is not square the turn is made in pixels: still a rectangle.
  const [[a0, b0], [a1, b1], , [a3, b3]] = boxCorners({ ...box(320, 96, 832, 160), angle: 30 }, W, H);
  assert.ok(close((a1 - a0) * (a3 - a0) + (b1 - b0) * (b3 - b0), 0, 1e-6));
  assert.ok(close(Math.hypot(a1 - a0, b1 - b0), 512, 1e-6));
  const [px, py] = turnPoint(10, 20, 5, 0, 90);
  assert.deepEqual([px, py], [10, 25]);
});

test("the knob turns the box the short way round, held to -90..90, on tenths, on 5 degree steps with Shift", () => {
  assert.equal(ANGLE_SNAP, 5);
  assert.ok(close(turnStep(3, -3), 2 * Math.PI - 6), "across the line left of the centre: a small step on");
  assert.ok(close(turnStep(-3, 3), 6 - 2 * Math.PI));
  assert.ok(close(turnStep(0.1, 0.3), 0.2));
  assert.equal(turnedAngle(0, 25.24), 25.2);
  assert.equal(turnedAngle(0, 25.26), 25.3);
  assert.equal(turnedAngle(0, 23, { snap: true }), 25);
  assert.equal(turnedAngle(0, 22.4, { snap: true }), 20);
  assert.equal(turnedAngle(25.2, 8, { snap: true }), 35, "Shift lands on a whole step, not on start + 5");
  assert.equal(turnedAngle(80, 30), 90, "it stops at a quarter turn");
  assert.equal(turnedAngle(-80, -30), -90);
  assert.equal(turnedAngle(88, 0, { snap: true }), 90);
  assert.ok(Object.is(turnedAngle(10, -10.04), 0), "back to level is 0, not -0");
  assert.equal(turnedAngle(10, "x"), 10);
});

test("a turned box moves by whole pixels, its centre kept on the canvas so its corners can reach past the edges", () => {
  const start = boxPixels({ ...newBox({ x0: 613, y0: 771, x1: 982, y1: 873 }, 992, 1488), angle: 25 }, 992, 1488);
  const moved = movedTurnedRect(start, 10.4, -3.6, 992, 1488);
  assert.ok(close(moved.x0 - start.x0, 10, 1e-9) && close(moved.y0 - start.y0, -4, 1e-9), "whole pixels");
  assert.ok(close(moved.x1 - moved.x0, 369, 1e-9) && close(moved.y1 - moved.y0, 102, 1e-9), "the same size");
  const far = movedTurnedRect(start, 5000, 5000, 992, 1488);
  assert.deepEqual([(far.x0 + far.x1) / 2, (far.y0 + far.y1) / 2], [992, 1488], "the centre stops at the edge");
  assert.ok(far.x1 > 992, "the rest of the box may reach past it");
  const back = movedTurnedRect(start, -5000, -5000, 992, 1488);
  assert.deepEqual([(back.x0 + back.x1) / 2, (back.y0 + back.y1) / 2], [0, 0]);
});

test("sizing a turned box pulls along its own sides and keeps the far side still", () => {
  const start = { x0: 300, y0: 250, x1: 700, y1: 350 };
  // Level, it is the free resize.
  const free = snapping(1000, 1000, false);
  for (const [handle, dx, dy] of [["e", 30, 0], ["w", -20, 5], ["n", 0, -12], ["s", 3, 40], ["se", 25, 15], ["nw", -10, -10]]) {
    assert.deepEqual(resizedTurnedRect(start, handle, dx, dy, 0, 1000, 1000), resizedRect(start, handle, dx, dy, 1000, 1000, free), `${handle} level`);
  }
  const a = (25 * Math.PI) / 180;
  const along = [Math.cos(a), Math.sin(a)];
  const across = [-Math.sin(a), Math.cos(a)];
  const leftMiddle = (rect) => turnPoint((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, -(rect.x1 - rect.x0) / 2, 0, 25);
  const wider = resizedTurnedRect(start, "e", 30 * along[0], 30 * along[1], 25, 1000, 1000);
  assert.ok(close(wider.x1 - wider.x0, 430, 1e-9) && close(wider.y1 - wider.y0, 100, 1e-9), "30 px wider along its own side");
  const [lx0, ly0] = leftMiddle(start);
  const [lx1, ly1] = leftMiddle(wider);
  assert.ok(close(lx0, lx1, 1e-9) && close(ly0, ly1, 1e-9), "the left side stays where it was");
  assert.deepEqual(resizedTurnedRect(start, "e", 40 * across[0], 40 * across[1], 25, 1000, 1000), start, "a pull across the side does not size it");
  const corner = resizedTurnedRect(start, "nw", -12 * along[0] - 8 * across[0], -12 * along[1] - 8 * across[1], 25, 1000, 1000);
  assert.ok(close(corner.x1 - corner.x0, 412, 1e-9) && close(corner.y1 - corner.y0, 108, 1e-9), "a corner sizes both sides");
  const squeezed = resizedTurnedRect(start, "w", 900 * along[0], 900 * along[1], 25, 1000, 1000);
  assert.equal(squeezed.x1 - squeezed.x0, FREE_MIN_PX, "never thinner than FREE_MIN_PX");
  const whole = resizedTurnedRect(start, "s", 0.4 * across[0] + 7.3 * across[0], 7.7 * across[1], 25, 1000, 1000);
  assert.ok(Number.isInteger(Math.round((whole.y1 - whole.y0) * 1e6) / 1e6), "sides stay whole pixels");
});

test("a box turned back to level lands on whole pixels and on the canvas", () => {
  assert.deepEqual(leveledRect({ x0: 100.4, y0: 50.6, x1: 300.4, y1: 90.6 }, 1000, 1000), { x0: 100, y0: 51, x1: 300, y1: 91 });
  assert.deepEqual(leveledRect({ x0: -40.2, y0: 980, x1: 159.8, y1: 1030 }, 1000, 1000), { x0: 0, y0: 950, x1: 200, y1: 1000 }, "pushed back on");
  assert.deepEqual(leveledRect({ x0: -500, y0: 0, x1: 1500, y1: 10 }, 1000, 1000), { x0: 0, y0: 0, x1: 1000, y1: 10 }, "never wider than the canvas");
  // Turned and turned back, a box is exactly the box it was: the outputs are the same.
  const drawn = newBox({ x0: 613, y0: 771, x1: 982, y1: 873 }, 992, 1488);
  const back = fromPixels(leveledRect(boxPixels(drawn, 992, 1488), 992, 1488), 992, 1488);
  assert.deepEqual([back.x, back.y, back.w, back.h], [drawn.x, drawn.y, drawn.w, drawn.h]);
});

test("the knob goes over the box, under it at the top of the canvas, inside when neither fits", () => {
  assert.equal(KNOB_GAP_PX, 22);
  assert.equal(knobSide({ x: 100, y: 100, w: 200, h: 60 }, 0, 400, 400), "above");
  assert.equal(knobSide({ x: 100, y: 10, w: 200, h: 60 }, 0, 400, 400), "below", "no room over a box at the top");
  assert.equal(knobSide({ x: 100, y: 5, w: 200, h: 390 }, 0, 400, 400), "in", "a box as tall as the canvas");
  assert.equal(knobSide({ x: 100, y: 100, w: 200, h: 60 }, 90, 400, 400), "above", "turned, the knob turns with it");
  assert.equal(knobSide({ x: 280, y: 100, w: 100, h: 60 }, 90, 400, 400), "above", "turned a quarter, over the top edge is to the right: room enough");
  assert.equal(knobSide({ x: 320, y: 100, w: 60, h: 60 }, 90, 400, 400), "below", "turned near the right edge, it goes to the other side");
});

test("a turned box's tag goes where it stays on the canvas", () => {
  assert.deepEqual(turnedTagPlace({ x: 100, y: 100, w: 200, h: 60 }, 25, 400, 400, 70), { tagInside: false, tagFromRight: false });
  assert.deepEqual(turnedTagPlace({ x: 100, y: 2, w: 200, h: 60 }, -10, 400, 400, 70), { tagInside: true, tagFromRight: false }, "at the top: inside");
  assert.deepEqual(turnedTagPlace({ x: 100, y: 0, w: 200, h: 60 }, 10, 400, 400, 70), { tagInside: true, tagFromRight: true }, "its top-left corner off the canvas: inside, on the right");
  assert.deepEqual(turnedTagPlace({ x: 100, y: 100, w: 200, h: 60 }, -90, 400, 400, 70), { tagInside: false, tagFromRight: false });
});

test("the resize cursors point the way a turned box's handles pull", () => {
  assert.equal(handleCursor("e", 0), "ew-resize");
  assert.equal(handleCursor("se", 0), "nwse-resize");
  assert.equal(handleCursor("n", 0), "ns-resize");
  assert.equal(handleCursor("ne", 0), "nesw-resize");
  assert.equal(handleCursor("e", 45), "nwse-resize");
  assert.equal(handleCursor("n", 90), "ew-resize");
  assert.equal(handleCursor("ne", -45), "ns-resize");
  assert.equal(handleCursor("w", 20), "ew-resize", "the nearest of the four");
  assert.equal(handleCursor("w", 25), "nwse-resize");
  for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) assert.equal(handleCursor(handle, 180), handleCursor(handle, 0));
});

test("a turned box's tag says its turn; the chip keeps number and type", () => {
  assert.equal(boxTag({ type: "text", angle: 25 }, 0), "1 text 25°");
  assert.equal(boxTag({ type: "obj", angle: -7.5 }, 1), "2 object -7.5°");
  assert.equal(boxTag({ type: "text", angle: 0 }, 0), "1 text");
  assert.equal(angleLabel(25.04), "25°");
  assert.equal(angleLabel(25.25), "25.3°");
  assert.equal(angleLabel(-0.01), "0°");
  assert.ok(tagWidthPx(boxTag({ type: "obj", angle: -55.5 }, 9)) >= "10 object -55.5°".length * 6);
});

// The same words as nodes/_layout_boxes_helpers.py tilt_phrase (tests/test_layout_boxes_helpers.py TILT_WORDS).
test("a turned text box tells the model its slant: from 2 degrees, downhill for clockwise, uphill the other way", () => {
  assert.equal(TILT_FROM, 2);
  for (const [angle, words] of [
    [25.25, "tilted about 25 degrees, running downhill to the right"],
    [-54.5, "tilted about 55 degrees, running uphill to the right"],
    [2, "tilted about 2 degrees, running downhill to the right"],
    [-2, "tilted about 2 degrees, running uphill to the right"],
    [90, "tilted about 90 degrees, running downhill to the right"],
    [1.99, ""], [-1.5, ""], [0, ""],
  ]) assert.equal(tiltPhrase(angle), words, `${angle}`);
});

test("the face: the knob turns the box, Shift snaps, the Turn field and 0° set it, a turned box leaves the grid alone", () => {
  const source = readFileSync(new URL("../js/layout_boxes/index.js", import.meta.url), "utf-8");
  const body = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `js/layout_boxes/index.js has no ${name}`);
    return source.slice(start, source.indexOf("\n}\n", start));
  };
  assert.match(body("onStagePointerDown"), /if \(target\.closest\?\.\("\.ausboss-lb-knob"\) && index >= 0\) \{\s*setSelected\(state, index\);\s*beginTurn\(state, index, event\);/, "a press on the knob no longer turns the box");
  assert.match(body("beginTurn"), /turnedAngle\(start, turned, \{ snap: moveEvent\.shiftKey \}\)/, "Shift no longer snaps the turn");
  assert.match(body("beginTurn"), /turnStep\(last, now\)/);
  assert.match(body("beginBoxDrag"), /if \(angle\) \{\s*rect = handle \? resizedTurnedRect\([^;]*: movedTurnedRect\(/, "a turned box no longer moves and sizes along its own sides");
  assert.match(body("onStageKey"), /angleOf\(box\)\s*\? movedTurnedRect\(boxPixels\(box, width, height\), step\[0\], step\[1\], width, height\)/);
  assert.match(body("placeBox"), /element\.style\.transform = angle \? `rotate\(\$\{angle\}deg\)` : "";/, "the box no longer draws turned");
  assert.match(body("buildEditor"), /makeScrubInput\(\{[^}]*unit: "°"/, "the Turn field is no longer a scrub field in degrees");
  assert.match(body("buildEditor"), /button\("ausboss-lb-tool", "0°", [^,]+, \(\) => setAngle\(state, state\.selected, 0\)\)/, "0° no longer levels the box");
  assert.match(source, /if \(event\.target\.closest\("\.ausboss-lb-knob"\)\) setAngle\(state, state\.selected, 0\);/, "a double click on the knob no longer levels it");
  // The knob is one of the handles: their size on the screen, at any zoom.
  const rule = source.match(/\n\.ausboss-lb-knob\{([^\n]*)/)?.[1] ?? "";
  assert.match(rule, /width:calc\(\$\{HANDLE_PX\}px\*var\(--lb-u\)\)/);
  assert.match(rule, /translateY\(calc\(\$\{-KNOB_GAP_PX\}px\*var\(--lb-u\)\)\)/);
  assert.match(source, /\.ausboss-lb-box\.sel>\.ausboss-lb-knob,\.ausboss-lb-box\.sel>\.ausboss-lb-stem\{display:block\}/, "the knob shows on other boxes than the chosen one");
});
