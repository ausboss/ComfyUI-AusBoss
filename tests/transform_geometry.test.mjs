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
  stageHandleLayout,
  stageHeightForWidth,
  zoomAround,
  scaleToMegapixels,
} from "../js/shared/transform_geometry.mjs";

test("rotated size handles positive and negative angles", () => {
  assert.deepEqual(rotatedSize(100, 50, 90), { width: 50, height: 100 });
  assert.deepEqual(rotatedSize(100, 50, -90), { width: 50, height: 100 });
  // Mixed odd/even sides hit Pillow's exact transpose fast path.
  assert.deepEqual(rotatedSize(2, 3, -90), { width: 3, height: 2 });
});

test("rotated size matches Pillow expand output exactly", () => {
  // Expected values generated with Pillow's Image.rotate(expand=True); see
  // the note on rotatedSize. The old width*cos+height*sin formula was 1px
  // short on most free angles (e.g. 512@45 gave 725, Pillow produces 726).
  assert.deepEqual(rotatedSize(512, 512, 45), { width: 726, height: 726 });
  assert.deepEqual(rotatedSize(512, 512, -12.5), { width: 612, height: 612 });
  assert.deepEqual(rotatedSize(512, 512, 179.9), { width: 514, height: 514 });
  assert.deepEqual(rotatedSize(1920, 1080, 15), { width: 2136, height: 1542 });
  assert.deepEqual(rotatedSize(1920, 1080, 60), { width: 1896, height: 2204 });
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

test("panel stage height tracks node width within its clamps", () => {
  assert.equal(stageHeightForWidth(100), 200); // floor
  assert.equal(stageHeightForWidth(330), 218);
  assert.equal(stageHeightForWidth(500), 330);
  assert.equal(stageHeightForWidth(2000), 520); // ceiling
  assert.equal(stageHeightForWidth(undefined), 200);
});

test("handle layout keeps the editor's classic geometry on large stages", () => {
  // A full-screen editor stage must render exactly as before the panel
  // re-home: classic offsets and the min(90, w/10, h/10) margin.
  const layout = stageHandleLayout(1246, 758);
  assert.equal(layout.padOffset, 38);
  assert.equal(layout.rotateArm, 34);
  assert.ok(Math.abs(layout.margin - 75.8) < 1e-9);
});

test("handle layout pulls handles inward but keeps them visible on the panel", () => {
  const layout = stageHandleLayout(312, 214);
  assert.ok(layout.padOffset < 38 && layout.padOffset >= 16);
  assert.ok(layout.rotateArm < 34 && layout.rotateArm >= 14);
  // The fit margin always covers the outboard handles: the pad diamond's
  // half-diagonal (~11px) past its offset, the knob radius (13px) past the
  // rotate arm — otherwise the panel would clip its own controls.
  assert.ok(layout.margin >= layout.padOffset + 11);
  assert.ok(layout.margin >= layout.rotateArm + 13);
});

test("handle layout stays finite on degenerate stage sizes", () => {
  const layout = stageHandleLayout(0, 0);
  assert.ok(Number.isFinite(layout.margin));
  assert.ok(layout.padOffset >= 16 && layout.rotateArm >= 14);
});

test("reset and source change restore identity including timeline", () => {
  const reset = resetTransformValues(true);
  assert.equal(reset.canvas_multiple, 1);
  assert.equal(reset.pad_bottom, 0);
  assert.equal(reset.feather, 24); // feather defaults on; no-op until padding/rotation exists
  assert.equal(reset.frame_index, 0);
  assert.equal(sourceChanged("a", "b", true), true);
  assert.equal(sourceChanged("a", "b", false), false);
  assert.equal(sourceChanged("a", "a", true), false);
});

test("scaleToMegapixels mirrors the backend fixtures", () => {
  assert.deepEqual(scaleToMegapixels(1024, 1024, 1.0, 1), { width: 1024, height: 1024 });
  assert.deepEqual(scaleToMegapixels(512, 512, 4.0, 1), { width: 2048, height: 2048 });
  assert.deepEqual(scaleToMegapixels(1920, 1080, 1.0, 64), { width: 1344, height: 768 });
  assert.deepEqual(scaleToMegapixels(1000, 707, 1.0, 8), { width: 1216, height: 864 });
  assert.deepEqual(scaleToMegapixels(100, 100, 0.01, 64), { width: 128, height: 128 });
});
