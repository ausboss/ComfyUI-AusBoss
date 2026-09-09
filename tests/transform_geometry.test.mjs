import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasLocalPoint,
  fitSourceToAspect,
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

test("pad to aspect preserves portrait and centers new landscape canvas", () => {
  const source = { width: 576, height: 1024 };
  const patch = fitSourceToAspect(source, "16:9", "pad");
  const crop = resolveCrop(patch, source);
  assert.deepEqual(crop, { x: 0, y: 0, ...source });
  assert.equal(patch.crop_aspect_ratio, "free");
  assert.deepEqual(resolvePadding(patch, crop), {
    left: 622, right: 623, top: 0, bottom: 0, outputWidth: 1821, outputHeight: 1024,
  });
});

test("pad to portrait and rotation preserve all source pixels", () => {
  const source = rotatedSize(576, 1024, 90);
  const patch = fitSourceToAspect(source, "9:16", "pad");
  assert.equal(patch.pad_left, 0);
  assert.equal(patch.pad_right, 0);
  assert.equal(patch.pad_top, 622);
  assert.equal(patch.pad_bottom, 623);
  assert.deepEqual(resolveCrop(patch, source), { x: 0, y: 0, ...source });
});

test("crop to aspect centers the largest crop and clears old padding", () => {
  for (const [source, aspect, expected] of [
    [{ width: 576, height: 1024 }, "16:9", { x: 0, y: 350, width: 576, height: 324 }],
    [{ width: 1024, height: 576 }, "9:16", { x: 350, y: 0, width: 324, height: 576 }],
  ]) {
    const patch = fitSourceToAspect(source, aspect);
    assert.deepEqual(resolveCrop(patch, source), expected);
    assert.equal(patch.pad_left + patch.pad_right + patch.pad_top + patch.pad_bottom, 0);
  }
});

test("free, source and already-matching aspects do not add padding", () => {
  const source = { width: 1920, height: 1080 };
  for (const aspect of ["free", "source", "16:9"]) {
    const patch = fitSourceToAspect(source, aspect, "pad");
    assert.deepEqual(resolveCrop(patch, source), { x: 0, y: 0, ...source });
    assert.equal(patch.pad_left + patch.pad_right + patch.pad_top + patch.pad_bottom, 0);
  }
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

// --- Aspect lock ------------------------------------------------------------
import { lockPadding, lockedPadMinimum, paddingAxis } from "../js/shared/transform_geometry.mjs";

const RATIO_16_9 = 16 / 9;

function canvasOf(pads, crop) {
  return {
    width: crop.width + pads.pad_left + pads.pad_right,
    height: crop.height + pads.pad_top + pads.pad_bottom,
  };
}

function assertRatio(pads, crop, ratio) {
  const { width, height } = canvasOf(pads, crop);
  assert.ok(Math.abs(width / height - ratio) * height <= 1.01, `${width}x${height} is not ${ratio}`);
  for (const value of Object.values(pads)) assert.ok(value >= 0);
}

test("lock: a taller padding drag widens the side bands symmetrically", () => {
  // The 16:9 pad of a 9:16 source, then pad_top pulled up by 100.
  const crop = { width: 576, height: 1024 };
  const pads = lockPadding({ pad_left: 622, pad_right: 623, pad_top: 100, pad_bottom: 0 }, crop, RATIO_16_9, "y");
  assertRatio(pads, crop, RATIO_16_9);
  assert.equal(pads.pad_top, 100);
  assert.equal(pads.pad_bottom, 0);
  assert.ok(Math.abs(pads.pad_right - pads.pad_left) <= 2); // the 622/623 split stays centred
  assert.equal(canvasOf(pads, crop).height, 1124);
});

test("lock: a side pad cannot shrink below what the crop's height needs", () => {
  const crop = { width: 576, height: 1024 };
  const values = { pad_left: 622, pad_right: 623, pad_top: 0, pad_bottom: 0 };
  // 16:9 around a 1024-tall crop is 1821 wide: left can go no lower than
  // 1821 - 576 - 623 = 622, i.e. not at all.
  assert.equal(lockedPadMinimum(values, crop, RATIO_16_9, "pad_left"), 622);
  // With bands above and below there is room to narrow.
  assert.equal(lockedPadMinimum({ ...values, pad_top: 200, pad_bottom: 200 }, crop, RATIO_16_9, "pad_left"), 622);
  assert.equal(lockedPadMinimum({ ...values, pad_top: 200 }, crop, RATIO_16_9, "pad_top"), 0);
  assert.equal(paddingAxis("pad_left"), "x");
  assert.equal(paddingAxis("pad_bottom"), "y");
});

test("lock: cropping the height in narrows the bands", () => {
  const crop = { width: 576, height: 924 };
  const pads = lockPadding({ pad_left: 622, pad_right: 623, pad_top: 0, pad_bottom: 0 }, crop, RATIO_16_9, "y");
  assertRatio(pads, crop, RATIO_16_9);
  assert.equal(pads.pad_top + pads.pad_bottom, 0);
  assert.ok(pads.pad_left < 622 && pads.pad_right < 623);
});

test("lock: cropping the width in gives the strip back as fill", () => {
  // No vertical bands to shrink, so the canvas keeps its width: the 100
  // cropped pixels come back as padding split over left and right.
  const crop = { width: 476, height: 1024 };
  const pads = lockPadding({ pad_left: 622, pad_right: 623, pad_top: 0, pad_bottom: 0 }, crop, RATIO_16_9, "x");
  assertRatio(pads, crop, RATIO_16_9);
  const canvas = canvasOf(pads, crop);
  assert.equal(canvas.height, 1024);
  assert.ok(canvas.width === 1820 || canvas.width === 1821, `width ${canvas.width}`);
  assert.equal(pads.pad_top + pads.pad_bottom, 0);
});

test("lock: the canvas a format chip padded is already a fixed point", () => {
  const source = { width: 576, height: 1024 };
  const padded = fitSourceToAspect(source, "16:9", "pad");
  for (const driver of ["x", "y"]) {
    assert.deepEqual(lockPadding(padded, source, RATIO_16_9, driver), {
      pad_left: 622, pad_top: 0, pad_right: 623, pad_bottom: 0,
    });
  }
});

test("lock: with nothing to shrink the canvas refits around the crop", () => {
  // A square lock on a crop with zero padding on both axes: the only way is
  // to grow the short axis around the crop.
  const crop = { width: 1000, height: 400 };
  const pads = lockPadding({ pad_left: 0, pad_right: 0, pad_top: 0, pad_bottom: 0 }, crop, 1, "y");
  assert.deepEqual(pads, { pad_left: 0, pad_right: 0, pad_top: 300, pad_bottom: 300 });
  // A rotation that made the crop taller than the 16:9 canvas can hold:
  // side bands cannot go negative, so the bands regrow around the crop.
  const tall = lockPadding({ pad_left: 10, pad_right: 10, pad_top: 0, pad_bottom: 0 }, { width: 500, height: 1000 }, RATIO_16_9, "x");
  assertRatio(tall, { width: 500, height: 1000 }, RATIO_16_9);
  assert.equal(tall.pad_top + tall.pad_bottom, 0);
});

test("lock: an invalid ratio or crop is a no-op", () => {
  assert.equal(lockPadding({}, { width: 10, height: 10 }, null), null);
  assert.equal(lockPadding({}, { width: 0, height: 10 }, 1), null);
  assert.equal(lockedPadMinimum({}, { width: 10, height: 10 }, 0, "pad_left"), 0);
});

test("lock: the result already satisfies a second pass", () => {
  const crop = { width: 640, height: 360 };
  for (const ratio of [1, 4 / 3, RATIO_16_9, 9 / 16, 21 / 9]) {
    for (const driver of ["x", "y"]) {
      const first = lockPadding({ pad_left: 30, pad_right: 5, pad_top: 80, pad_bottom: 0 }, crop, ratio, driver);
      assertRatio(first, crop, ratio);
      assert.deepEqual(lockPadding(first, crop, ratio, driver), first);
    }
  }
});

// --- Source changes ---------------------------------------------------------
import { SOURCE_GEOMETRY_KEYS, declaredTransformDefaults, sourceResetValues } from "../js/shared/transform_geometry.mjs";

test("a source change resets geometry but never the canvas style", () => {
  const reset = sourceResetValues(true);
  for (const name of ["fill_color", "feather", "canvas_multiple"]) assert.ok(!(name in reset), `${name} must survive a source swap`);
  for (const name of SOURCE_GEOMETRY_KEYS) assert.ok(name in reset);
  assert.equal(reset.pad_left, 0);
  assert.equal(reset.rotation_degrees, 0);
  assert.equal(reset.crop_aspect_ratio, "free");
  assert.equal(reset.frame_index, 0);
  assert.ok(!("frame_index" in sourceResetValues(false)));
});

test("reset returns to the node's declared defaults over the shared identity", () => {
  // The clip node declares a black fill and feather 0 (video outpaint);
  // the image nodes keep the shared grey / 24.
  const clipDef = { input: { required: { feather: ["INT", { default: 0, hidden: true }], fill_color: ["STRING", { default: "#000000" }] } } };
  const reset = declaredTransformDefaults(clipDef, true);
  assert.equal(reset.feather, 0);
  assert.equal(reset.fill_color, "#000000");
  assert.equal(reset.pad_left, 0);
  assert.equal(reset.frame_index, 0);
  assert.deepEqual(declaredTransformDefaults(undefined, false), resetTransformValues(false));
  assert.deepEqual(declaredTransformDefaults({ input: { required: {} } }, false), resetTransformValues(false));
  // A declared default only overrides keys the transform owns.
  const stray = declaredTransformDefaults({ input: { optional: { feather: ["INT", { default: 8 }], every_nth: ["INT", { default: 2 }] } } });
  assert.equal(stray.feather, 8);
  assert.ok(!("every_nth" in stray));
});
