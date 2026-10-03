import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SEE_THROUGH_KEEP_PERCENT, blurMask, featherGeneratedMask, growShrinkMask, overlayPlan, seeThroughMap, stitchBlendFromMask,
} from "../js/shared/stitch_preview.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/stitch_blend_parity.json", import.meta.url), "utf8"));
const { width, height } = fixture;
const mask = Float32Array.from(fixture.mask);
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

test("grow and shrink match the backend square max filter", () => {
  assert.ok(maxDiff(growShrinkMask(mask, width, height, 3), fixture.grow_3) < 1e-6);
  assert.ok(maxDiff(growShrinkMask(mask, width, height, -3), fixture.shrink_3) < 1e-6);
});

test("gaussian blur matches the backend to float precision", () => {
  assert.ok(maxDiff(blurMask(mask, width, height, 2), fixture.blur_sigma_2) < 2e-6);
});

test("stitchBlendFromMask reproduces the Python helper for every fixture case", () => {
  for (const c of fixture.cases) {
    const out = stitchBlendFromMask(mask, width, height, c.blend, c.grow);
    assert.ok(maxDiff(out, c.values) < 2e-6, `blend ${c.blend} grow ${c.grow}`);
  }
});

test("zero settings return an equal copy, not the same buffer", () => {
  const out = stitchBlendFromMask(mask, width, height, 0, 0);
  assert.deepEqual(Array.from(out), Array.from(mask));
  assert.notEqual(out, mask);
});

test("feather ramps into the kept side and never lowers the generated side", () => {
  const out = featherGeneratedMask(mask, width, height, 3);
  for (let i = 0; i < out.length; i++) assert.ok(out[i] >= mask[i] - 1e-7);
  // row 20, just past the step at column 16: the ramp is still partially on;
  // far from both the step and the fixture's island it stays exactly zero.
  assert.ok(out[20 * width + 17] > 0.2 && out[20 * width + 17] < 1);
  assert.equal(out[20 * width + 36], 0);
});

test("overlayPlan converts output pixels into work pixels through the resize", () => {
  const plan = overlayPlan(1821, 1024, { width: 1280, height: 704 }, 384);
  assert.equal(plan.width, 384);
  assert.equal(plan.height, Math.round(1024 * 384 / 1821));
  // 32 output px is ~45.6 pre-resize px, then scaled to the work canvas.
  const perOutputPixel = (1821 / 1280 + 1024 / 704) / 2 * plan.k;
  assert.ok(Math.abs(plan.unit - perOutputPixel) < 1e-9);
  const plain = overlayPlan(200, 100, null, 384);
  assert.equal(plain.k, 1);
  assert.equal(plain.unit, 1);
});

// The node's picture shows what the run paints from the picture itself (a
// MaskEditor mask, a cutout's see-through parts), so the rule must be the
// backend's: the cases of tests/test_transform_see_through.py.
const pixels = (...alphas) => Uint8ClampedArray.from(alphas.flatMap((alpha) => [10, 20, 30, alpha]));

test("seeThroughMap keeps 90% of the most solid pixel, as the run does", () => {
  assert.deepEqual(Array.from(seeThroughMap(pixels(0, 25, 128, 229, 230, 254, 255))), [1, 1, 1, 1, 0, 0, 0]);
  // Measured against the most solid pixel: here 200, so 180 stays.
  assert.deepEqual(Array.from(seeThroughMap(pixels(0, 100, 179, 180, 200))), [1, 1, 1, 0, 0]);
});

test("seeThroughMap leaves a solid picture alone and paints an empty one", () => {
  assert.equal(seeThroughMap(pixels(255, 255, 255, 255)), null);
  assert.equal(seeThroughMap(pixels(230, 230, 249, 254)), null);
  // 229 everywhere is kept whole, but no longer left exactly as loaded.
  assert.deepEqual(Array.from(seeThroughMap(pixels(229, 229))), [0, 0]);
  assert.deepEqual(Array.from(seeThroughMap(pixels(0, 0, 0))), [1, 1, 1]);
});

test("the see-through threshold is the backend's", () => {
  const engine = readFileSync(new URL("../nodes/_transform_engine.py", import.meta.url), "utf8");
  assert.equal(Number(/^SEE_THROUGH_KEEP_PERCENT = (\d+)$/m.exec(engine)?.[1]), SEE_THROUGH_KEEP_PERCENT);
});
