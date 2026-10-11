import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SEE_THROUGH_KEEP_PERCENT, blurMask, featherGeneratedMask, generatedAreaMask, growShrinkMask, overlayPlan, seeThroughMap,
  stitchBlendFromMask,
} from "../js/shared/stitch_preview.mjs";
import { resolveCrop, resolvePadding, rotatedSize, scaleToMegapixels } from "../js/shared/transform_geometry.mjs";

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

// ---------- Show blend: the generated area on the preview's raster ----------

const TRANSFORM_DEFAULTS = {
  rotation_degrees: 0, crop_x: 0, crop_y: 0, crop_width: 0, crop_height: 0, crop_aspect_ratio: "free",
  pad_left: 0, pad_top: 0, pad_right: 0, pad_bottom: 0, canvas_multiple: 1, feather: 0, stitch_blend: 32, stitch_grow: 0,
};

// The generated area for a set of the node's values, and Show blend from
// it, both built as the editor builds them (blendOverlayCanvas in
// transform_editor.mjs) for a picture with no see-through parts.
function generatedArea(sourceWidth, sourceHeight, values) {
  const current = { ...TRANSFORM_DEFAULTS, ...values };
  const rotation = current.rotation_degrees;
  const source = rotatedSize(sourceWidth, sourceHeight, rotation);
  const crop = resolveCrop(current, source);
  const padding = resolvePadding(current, crop);
  const resize = current.resize_to_megapixels
    ? scaleToMegapixels(padding.outputWidth, padding.outputHeight, current.megapixels, current.resolution_steps)
    : null;
  const plan = overlayPlan(padding.outputWidth, padding.outputHeight, resize);
  const { width, height } = plan;
  const generated = generatedAreaMask(width, height, { source, crop, padding, sourceWidth, sourceHeight, rotation });
  return { current, source, crop, padding, plan, width, height, generated };
}

function showBlend(sourceWidth, sourceHeight, values) {
  const area = generatedArea(sourceWidth, sourceHeight, values);
  const { current, plan, width, height } = area;
  const feathered = featherGeneratedMask(area.generated, width, height, current.feather * plan.k);
  const blend = stitchBlendFromMask(feathered, width, height, current.stitch_blend * plan.unit, current.stitch_grow * plan.unit);
  return { ...area, blend };
}

// The four edges of a raster and one line across the middle each way.
function rasterLines(values, width, height) {
  const across = (y) => Array.from({ length: width }, (_, x) => values[y * width + x]);
  const down = (x) => Array.from({ length: height }, (_, y) => values[y * width + x]);
  return {
    top: across(0), bottom: across(height - 1), left: down(0), right: down(width - 1),
    row: across(Math.floor(height / 2)), column: down(Math.floor(width / 2)),
  };
}

test("no blend on an edge the picture reaches: 1916 x 821 with padding on top only", () => {
  // 921 canvas rows are 184.58 rows of a 384-wide preview, so the raster is
  // 185 tall. Its last row is all picture: exactly 0, as the run's mask is.
  const { width, height, generated, blend } = showBlend(1916, 821, { pad_top: 100 });
  assert.deepEqual([width, height], [384, 185]);
  // The band is 100 * 185 / 921 = 20.09 rows: 20 whole ones, then its share.
  for (let y = 0; y < height; y++) {
    const want = y < 20 ? 1 : y === 20 ? 100 * 185 / 921 - 20 : 0;
    for (const x of [0, 191, width - 1]) assert.ok(Math.abs(generated[y * width + x] - want) < 1e-6, `row ${y}`);
  }
  assert.ok(generated.subarray(21 * width).every((value) => value === 0));
  // The run: blend[-40:].max() == 0 on the 921 rows; 40 of them are 8 here.
  assert.ok(blend.subarray((height - 8) * width).every((value) => value === 0));
  // The ramp under the band is still there, and ends before the bottom.
  const column = rasterLines(blend, width, height).column;
  assert.equal(column[19], 1);
  assert.ok(column[26] > 0.2 && column[26] < 0.8);
  assert.equal(column[40], 0);
});

test("an edge without padding holds no generated cell, for any size, crop, padding and quarter turn", () => {
  let seed = 23;
  const random = (limit) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
  for (let run = 0; run < 2000; run += 1) {
    const sourceWidth = 1 + random(5000), sourceHeight = 1 + random(5000);
    const pads = [0, 1, 2, 3].map(() => (random(2) ? 1 + random(700) : 0));
    const values = {
      rotation_degrees: [0, 90, 180, -90][random(4)],
      pad_left: pads[0], pad_top: pads[1], pad_right: pads[2], pad_bottom: pads[3],
      ...(random(2) ? { crop_x: random(sourceWidth), crop_y: random(sourceHeight), crop_width: random(sourceWidth), crop_height: random(sourceHeight) } : {}),
    };
    const { crop, padding, width, height, generated } = generatedArea(sourceWidth, sourceHeight, values);
    // A raster cell is the canvas span [index, index + 1] * canvas / raster.
    // Whole numbers on both sides, so "inside the picture" is exact here.
    const inside = (index, raster, canvas, from, size) => index * canvas >= from * raster && (index + 1) * canvas <= (from + size) * raster;
    const outside = (index, raster, canvas, from, size) => (index + 1) * canvas <= from * raster || index * canvas >= (from + size) * raster;
    const columns = [0, Math.floor(width / 2), width - 1], rows = [0, Math.floor(height / 2), height - 1];
    const label = `${sourceWidth} x ${sourceHeight} ${JSON.stringify(values)}`;
    const check = (x, y) => {
      const value = generated[y * width + x];
      const inX = inside(x, width, padding.outputWidth, padding.left, crop.width), inY = inside(y, height, padding.outputHeight, padding.top, crop.height);
      const outX = outside(x, width, padding.outputWidth, padding.left, crop.width), outY = outside(y, height, padding.outputHeight, padding.top, crop.height);
      if (inX && inY) assert.equal(value, 0, `${label}: picture cell ${x}, ${y}`);
      else if (outX || outY) assert.equal(value, 1, `${label}: padding cell ${x}, ${y}`);
      else assert.ok(value > 0 && value < 1, `${label}: seam cell ${x}, ${y} is ${value}`);
    };
    for (let x = 0; x < width; x++) for (const y of rows) check(x, y);
    for (let y = 0; y < height; y++) for (const x of columns) check(x, y);
  }
});

test("a tilted picture: the generated area adds up, and cells inside the picture are 0", () => {
  let seed = 5;
  const random = (limit) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
  for (let run = 0; run < 60; run += 1) {
    const sourceWidth = 200 + random(3000), sourceHeight = 200 + random(3000);
    const rotation = (random(3590) - 1795) / 10;
    const values = { rotation_degrees: rotation, pad_left: random(2) ? random(300) : 0, pad_bottom: random(2) ? random(300) : 0 };
    // Every other run crops into the turned picture.
    if (run % 2) Object.assign(values, { crop_x: random(sourceWidth >> 2), crop_y: random(sourceHeight >> 2), crop_width: sourceWidth >> 1, crop_height: sourceHeight >> 1 });
    const { source, crop, padding, width, height, generated } = generatedArea(sourceWidth, sourceHeight, values);
    const label = `${sourceWidth} x ${sourceHeight} ${JSON.stringify(values)}`;
    const scaleX = width / padding.outputWidth, scaleY = height / padding.outputHeight;
    if (!(run % 2)) {
      // The whole turned picture is on the canvas: what is not it, is generated.
      const total = generated.reduce((sum, value) => sum + value, 0);
      const want = (padding.outputWidth * padding.outputHeight - sourceWidth * sourceHeight) * scaleX * scaleY;
      assert.ok(Math.abs(total - want) < 1e-3 * Math.max(1, want), `${label}: ${total} generated, ${want} expected`);
    }
    // A point of the canvas is picture when it is in the crop and, turned
    // back, in the source. A cell with all four corners in is picture.
    const radians = rotation * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
    const centerX = padding.left - crop.x + source.width / 2, centerY = padding.top - crop.y + source.height / 2;
    const picture = (x, y) => {
      const canvasX = x / scaleX, canvasY = y / scaleY;
      if (canvasX < padding.left || canvasX > padding.left + crop.width || canvasY < padding.top || canvasY > padding.top + crop.height) return false;
      const dx = canvasX - centerX, dy = canvasY - centerY;
      return Math.abs(dx * cosine + dy * sine) <= sourceWidth / 2 - 1e-6 && Math.abs(dy * cosine - dx * sine) <= sourceHeight / 2 - 1e-6;
    };
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const value = generated[y * width + x];
        assert.ok(value >= 0 && value <= 1, `${label}: cell ${x}, ${y} is ${value}`);
        if (picture(x, y) && picture(x + 1, y) && picture(x, y + 1) && picture(x + 1, y + 1)) assert.equal(value, 0, `${label}: picture cell ${x}, ${y}`);
      }
    }
  }
});

// The run's own blend for a few settings, reduced to the preview's raster by
// tests/test_show_blend_fixture.py, which also holds the fixture to the run.
const runFixture = JSON.parse(readFileSync(new URL("./fixtures/show_blend_canvas.json", import.meta.url), "utf8"));

test("Show blend follows the run's blend on every edge and across the middle", () => {
  for (const sample of runFixture.cases) {
    const { width, height, blend } = showBlend(sample.source[0], sample.source[1], sample.values);
    assert.deepEqual([width, height], sample.raster, sample.name);
    for (const [name, line] of Object.entries(rasterLines(blend, width, height))) {
      const run = sample[name];
      // Where the run blends nothing along the whole line, neither does the
      // preview: not a faint ramp, nothing.
      if (run.every((value) => value === 0)) {
        assert.ok(line.every((value) => value === 0), `${sample.name}: ${name} shows a blend the run does not have`);
        continue;
      }
      // Elsewhere the preview is the run at a fifth of the size or less, so
      // a ramp sits within part of a preview pixel of the run's.
      const gaps = line.map((value, index) => Math.abs(value - run[index]));
      assert.ok(Math.max(...gaps) < 0.12, `${sample.name}: ${name} is ${Math.max(...gaps).toFixed(3)} off the run`);
      assert.ok(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length < 0.01, `${sample.name}: ${name} drifts from the run`);
    }
  }
});
