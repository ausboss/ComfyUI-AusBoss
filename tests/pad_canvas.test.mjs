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

test("pad geometry appends the multiple remainder to right and bottom", () => {
  const geom = padGeometry(800, 600, {
    pad_left: 10, pad_top: 20, pad_right: 30, pad_bottom: 40, canvas_multiple: 8,
  });
  // Pinned against nodes/_pad_helpers.py resolve_pad_geometry — the same
  // numbers appear in tests/test_pad_helpers.py so drift breaks both.
  assert.deepEqual(geom, {
    left: 10, top: 20, right: 30, bottom: 44, outputWidth: 840, outputHeight: 664,
  });
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

