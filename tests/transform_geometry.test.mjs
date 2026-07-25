import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasLocalPoint,
  cropHandleCenters,
  nearestHandle,
  paddingHandleCenters,
  resetTransformValues,
  resizeCrop,
  resolveCrop,
  resolvePadding,
  rotatedSize,
  sourceChanged,
  zoomAround,
} from "../js/shared/transform_geometry.mjs";

test("rotated size handles positive and negative angles", () => {
  assert.deepEqual(rotatedSize(100, 50, 90), { width: 50, height: 100 });
  assert.deepEqual(rotatedSize(100, 50, -90), { width: 50, height: 100 });
});

test("crop clamps and honors ratios", () => {
  assert.deepEqual(resolveCrop({ crop_x: 95, crop_y: 45, crop_width: 99, crop_height: 99, crop_aspect_ratio: "free" }, { width: 100, height: 50 }), { x: 95, y: 45, width: 5, height: 5 });
  assert.deepEqual(resolveCrop({ crop_x: 0, crop_y: 0, crop_width: 0, crop_height: 0, crop_aspect_ratio: "16:9" }, { width: 100, height: 100 }), { x: 0, y: 0, width: 100, height: 56 });
});

test("canvas multiple adds only right and bottom", () => {
  assert.deepEqual(resolvePadding({ pad_left: 0, pad_top: 0, pad_right: 0, pad_bottom: 0, canvas_multiple: 8 }, { width: 101, height: 99 }), { left: 0, top: 0, right: 3, bottom: 5, outputWidth: 104, outputHeight: 104 });
});

test("handle priority and closest distance are deterministic", () => {
  const selection = nearestHandle({ x: 20, y: 20 }, [
    { kind: "padding", priority: 1, radius: 30, handles: [{ name: "pad_left", x: 20, y: 20 }] },
    { kind: "crop", priority: 2, radius: 30, handles: [{ name: "nw", x: 20, y: 20 }] },
  ]);
  assert.equal(selection.kind, "padding");
});

test("crop resize never leaves the source", () => {
  const resized = resizeCrop({ x: 10, y: 10, width: 40, height: 30 }, "se", 1000, 1000, { width: 100, height: 80 });
  assert.deepEqual(resized, { x: 10, y: 10, width: 90, height: 70 });
});

test("coordinate conversion accounts for CSS scaling", () => {
  const canvas = { clientWidth: 400, clientHeight: 200, getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }) };
  assert.deepEqual(canvasLocalPoint(canvas, { clientX: 110, clientY: 70 }), { x: 200, y: 100 });
});

test("zoom remains anchored under the pointer", () => {
  assert.deepEqual(zoomAround({ zoom: 1, panX: 0, panY: 0 }, 2, { x: 100, y: 50 }), { zoom: 2, panX: -100, panY: -50 });
});

test("reset and source change restore identity including timeline", () => {
  const reset = resetTransformValues(true);
  assert.equal(reset.canvas_multiple, 1);
  assert.equal(reset.pad_bottom, 0);
  assert.equal(reset.frame_index, 0);
  assert.equal(sourceChanged("a", "b", true), true);
  assert.equal(sourceChanged("a", "b", false), false);
  assert.equal(sourceChanged("a", "a", true), false);
});
