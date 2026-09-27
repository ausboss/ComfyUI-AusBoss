import assert from "node:assert/strict";
import test from "node:test";

import {
  EDGE_HIT_BAND,
  THIN_BAND_PX,
  canvasHeightForWidth,
  edgeCursor,
  finalOutputSize,
  fitRect,
  hitPadEdge,
  labelMode,
  padDragValue,
  padGeometry,
  parseImageReference,
  stageGeometry,
} from "../js/shared/pad_canvas.mjs";

test("image references parse subfolders, backslashes, and type annotations", () => {
  assert.deepEqual(parseImageReference("photo.png"), {
    filename: "photo.png",
    subfolder: "",
    type: "input",
  });
  assert.deepEqual(parseImageReference("sub/dir/photo.png"), {
    filename: "photo.png",
    subfolder: "sub/dir",
    type: "input",
  });
  assert.deepEqual(parseImageReference("sub\\dir\\photo.png [temp]"), {
    filename: "photo.png",
    subfolder: "sub/dir",
    type: "temp",
  });
  assert.deepEqual(parseImageReference("clip.png [output]"), {
    filename: "clip.png",
    subfolder: "",
    type: "output",
  });
  assert.equal(parseImageReference(""), null);
  assert.equal(parseImageReference("  "), null);
  assert.equal(parseImageReference(null), null);
});

const NO_TRIM = { trimLeft: 0, trimTop: 0, trimRight: 0, trimBottom: 0 };
const pads = (left, top, right, bottom, canvas_multiple, target_megapixels = 0) => ({
  pad_left: left, pad_top: top, pad_right: right, pad_bottom: bottom, canvas_multiple, target_megapixels,
});

test("both padded sides keep the multiple remainder on the far side", () => {
  const geom = padGeometry(800, 600, {
    pad_left: 10, pad_top: 20, pad_right: 30, pad_bottom: 40, canvas_multiple: 8,
  });
  // Pinned against nodes/_pad_helpers.py resolve_pad_geometry — the same
  // numbers appear in tests/test_pad_helpers.py so drift breaks both.
  assert.deepEqual(geom, {
    left: 10, top: 20, right: 30, bottom: 44, outputWidth: 840, outputHeight: 664, ...NO_TRIM,
  });
});

test("one padded side takes the whole remainder", () => {
  // Pinned in tests/test_pad_helpers.py too.
  assert.deepEqual(padGeometry(100, 64, pads(20, 0, 0, 0, 16)), {
    left: 28, top: 0, right: 0, bottom: 0, outputWidth: 128, outputHeight: 64, ...NO_TRIM,
  });
  assert.deepEqual(padGeometry(100, 64, pads(0, 0, 20, 0, 16)), {
    left: 0, top: 0, right: 28, bottom: 0, outputWidth: 128, outputHeight: 64, ...NO_TRIM,
  });
  assert.deepEqual(padGeometry(128, 100, pads(0, 30, 0, 0, 64)), {
    left: 0, top: 92, right: 0, bottom: 0, outputWidth: 128, outputHeight: 192, ...NO_TRIM,
  });
  assert.deepEqual(padGeometry(128, 100, pads(0, 0, 0, 30, 64)), {
    left: 0, top: 0, right: 0, bottom: 92, outputWidth: 128, outputHeight: 192, ...NO_TRIM,
  });
});

test("an axis nobody padded trims the source instead of growing a strip", () => {
  assert.deepEqual(padGeometry(1130, 638, pads(0, 271, 0, 509, 16)), {
    left: 0, top: 271, right: 0, bottom: 515, outputWidth: 1120, outputHeight: 1424,
    trimLeft: 5, trimTop: 0, trimRight: 5, trimBottom: 0,
  });
  assert.deepEqual(padGeometry(1000, 750, pads(0, 0, 0, 0, 64)), {
    left: 0, top: 0, right: 0, bottom: 0, outputWidth: 960, outputHeight: 704,
    trimLeft: 20, trimTop: 23, trimRight: 20, trimBottom: 23,
  });
  const odd = padGeometry(1001, 64, pads(0, 0, 0, 0, 16));
  assert.deepEqual([odd.trimLeft, odd.trimRight, odd.outputWidth], [4, 5, 992]);
  // Smaller than one multiple: nothing to trim to, so it grows on the far side.
  const tiny = padGeometry(10, 750, pads(0, 0, 0, 0, 16));
  assert.deepEqual([tiny.right, tiny.outputWidth, tiny.trimTop, tiny.trimBottom], [6, 16, 7, 7]);
});

test("the published Krea 2 Outpaint canvas has no strip, to the pixel of the Python plan", () => {
  // plan_pad_canvas(2720, 1536, 0, 652, 0, 1212, 16, 1.6): the width is
  // resized onto the multiple and sets the scale, where it used to leave a
  // 6 px strip on the right.
  const bridge = finalOutputSize(2720, 1536, pads(0, 652, 0, 1212, 16, 1.6));
  assert.deepEqual(bridge, { width: 1136, height: 1424, scale: 1136 / 2720 });
  assert.deepEqual(finalOutputSize(2720, 1536, pads(0, 652, 0, 1212, 64, 1.6)), {
    width: 1088, height: 1408, scale: 0.4,
  });
  // Padded top and right: the height's remainder joins the top.
  const rain = finalOutputSize(502, 634, pads(0, 240, 320, 0, 16, 1.6));
  assert.deepEqual([rain.width, rain.height], [1216, 1296]);
  assert.equal(rain.scale, 1.4782809899727065);
  // Nothing padded: each side snaps to the nearest multiple.
  const plain = finalOutputSize(1000, 750, pads(0, 0, 0, 0, 16, 1.0));
  assert.deepEqual([plain.width, plain.height], [1152, 864]);
});

test("a side under half a multiple keeps the budget scale", () => {
  // plan_pad_canvas(2000, 20, 100, 0, 100, 0, 64, 0.25): snapping 26 px up
  // to 64 would more than double the scale, so it grows on the far side.
  assert.deepEqual(finalOutputSize(2000, 20, pads(100, 0, 100, 0, 64, 0.25)), {
    width: 2944, height: 64, scale: Math.sqrt(0.25e6 / (2240 * 64)),
  });
});

test("the stage draws an unpadded axis edge to edge when a megapixel target resizes it", () => {
  const values = pads(0, 271, 0, 509, 16);
  assert.deepEqual(stageGeometry(1130, 638, values), padGeometry(1130, 638, values));
  const resized = stageGeometry(1130, 638, { ...values, target_megapixels: 1.6 });
  assert.deepEqual(resized, {
    left: 0, top: 271, right: 0, bottom: 515, outputWidth: 1130, outputHeight: 1424, ...NO_TRIM,
  });
  // Also below one multiple, where the geometry alone would grow a strip.
  const tiny = stageGeometry(10, 64, pads(0, 8, 0, 8, 16, 1.0));
  assert.deepEqual([tiny.right, tiny.outputWidth], [0, 10]);
});

test("final output size mirrors the Python megapixel plan to the pixel", () => {
  const values = {
    pad_left: 10, pad_top: 20, pad_right: 30, pad_bottom: 40,
    canvas_multiple: 8, target_megapixels: 1.0,
  };
  const final = finalOutputSize(800, 600, values);
  // Pinned against plan_pad_canvas(800, 600, 10, 20, 30, 40, 8, 1.0).
  assert.equal(final.width, 1128);
  assert.equal(final.height, 888);
  assert.ok(Math.abs(final.scale - 1.3389868666385072) < 1e-9);
  // The badge lands within multiple-rounding distance of the target.
  assert.ok(Math.abs((final.width * final.height) / 1e6 - 1.0) < 0.02);
});

test("megapixels off is a passthrough of the multiple-rounded size", () => {
  const final = finalOutputSize(800, 600, {
    pad_left: 10, pad_top: 20, pad_right: 30, pad_bottom: 40,
    canvas_multiple: 8, target_megapixels: 0,
  });
  assert.deepEqual(final, { width: 840, height: 664, scale: 1 });
});

test("the whole edge is the handle and corners resolve to the nearer edge", () => {
  const rect = { x: 100, y: 100, width: 200, height: 150 };
  assert.equal(hitPadEdge({ x: 100, y: 175 }, rect), "left");
  assert.equal(hitPadEdge({ x: 108, y: 130 }, rect), "left");
  assert.equal(hitPadEdge({ x: 300, y: 175 }, rect), "right");
  assert.equal(hitPadEdge({ x: 200, y: 96 }, rect), "top");
  assert.equal(hitPadEdge({ x: 240, y: 252 }, rect), "bottom");
  // Corners: the strictly nearer edge wins.
  assert.equal(hitPadEdge({ x: 102, y: 99 }, rect), "top");
  assert.equal(hitPadEdge({ x: 99, y: 104 }, rect), "left");
  // Middle of the rect and far outside are not handles (clicks fall through).
  assert.equal(hitPadEdge({ x: 200, y: 175 }, rect), null);
  assert.equal(hitPadEdge({ x: 400, y: 175 }, rect), null);
  assert.equal(hitPadEdge({ x: 200, y: 175 - 0 }, rect, 100), "top"); // wider band reaches further
  assert.equal(hitPadEdge({ x: 200, y: 175 }, null), null);
  assert.ok(EDGE_HIT_BAND >= 12); // generous by contract
});

test("drag deltas map to raw pads with outward-positive signs and a floor at 0", () => {
  const start = { left: 10, top: 0, right: 5, bottom: 20 };
  assert.equal(padDragValue("left", start, -30, 0), 40);
  assert.equal(padDragValue("left", start, 30, 0), 0);
  assert.equal(padDragValue("right", start, 30.4, 0), 35);
  assert.equal(padDragValue("top", start, 0, -12), 12);
  assert.equal(padDragValue("bottom", start, 0, 12), 32);
  assert.equal(padDragValue("bottom", start, 0, -100), 0);
});

test("labels hop onto the pill exactly below the thin-band threshold", () => {
  assert.equal(labelMode(THIN_BAND_PX), "band");
  assert.equal(labelMode(THIN_BAND_PX - 0.1), "pill");
  assert.equal(labelMode(0), "pill");
  assert.equal(labelMode(400), "band");
});

test("cursors match the drag axis", () => {
  assert.equal(edgeCursor("left"), "ew-resize");
  assert.equal(edgeCursor("right"), "ew-resize");
  assert.equal(edgeCursor("top"), "ns-resize");
  assert.equal(edgeCursor("bottom"), "ns-resize");
  assert.equal(edgeCursor(null), "");
});

test("panel height tracks width inside the clamp", () => {
  assert.equal(canvasHeightForWidth(200), 180);
  assert.equal(canvasHeightForWidth(400), 264);
  assert.equal(canvasHeightForWidth(2000), 520);
});

test("fitRect centers the world rect at the limiting scale", () => {
  assert.deepEqual(fitRect(100, 50, 200, 100, 0), { scale: 2, x: 0, y: 0 });
  const fit = fitRect(100, 100, 220, 120, 10);
  assert.equal(fit.scale, 1); // limited by height: (120-20)/100
  assert.equal(fit.x, 60);
  assert.equal(fit.y, 10);
});

