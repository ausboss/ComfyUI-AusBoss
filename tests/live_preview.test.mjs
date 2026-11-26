// The live preview's maths (Film Grain, Keep Detail, Cut Out in the browser)
// against what the Python nodes return, on the small picture in
// tests/fixtures/live_parity.json (made by tests/test_live_parity.py).
//
// Tolerances: the pictures and masks are 0-1 values and both sides work in
// 32-bit floats, so the same maths lands within a few millionths. A bound of
// 1e-4 on every value is the stated parity for grain and Keep Detail; Cut
// Out's colour clean-up is a chain of blurs and gets 5e-4.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeImage } from "../js/shared/live_image.mjs";
import { autoGrain, autoValues, cellNormal, filmGrain, grainFrame, hashedCells, layGrain, measureNoise } from "../js/shared/live_grain.mjs";
import { keepDetail } from "../js/shared/live_detail.mjs";
import { cutOut } from "../js/shared/live_cutout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(HERE, "fixtures", "live_parity.json"), "utf-8"));
const { height, width } = FIX;
const pic = (flat, c = 3, h = height, w = width) => makeImage(w, h, c, Float32Array.from(flat));
const maxDiff = (a, b) => {
  assert.equal(a.length, b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};

// The node's recorded random grids, handed out in the order the node drew them.
const recorded = (cells) => (index) => {
  const [channels, rows, cols] = [...cells[index].shape];
  return (ch, i, j) => {
    assert.ok(ch < channels && i < rows && j < cols, "cell outside the recorded grid");
    return cells[index].data[(ch * rows + i) * cols + j];
  };
};

test("grain: the node's own random cells give the node's grain and result", () => {
  for (const item of FIX.cases.grain) {
    const cellsAt = recorded(item.cells);
    const grain = grainFrame(cellsAt, height, width, item.size, item.roughness, item.color);
    assert.equal(grain.c, item.grain_channels, item.name);
    const grainDiff = maxDiff(grain.data, item.grain);
    assert.ok(grainDiff < 5e-5, `${item.name}: grain differs by ${grainDiff}`);
    const out = layGrain(pic(FIX.image), grain, item.amount);
    const diff = maxDiff(out.data, item.result);
    assert.ok(diff < 5e-5, `${item.name}: result differs by ${diff}`);
  }
});

test("grain: a window of the picture has the same grain as the whole", () => {
  const whole = grainFrame(hashedCells(5), 64, 80, 1.5, 0.5, 0.4);
  const win = { x0: 20, y0: 12, w: 30, h: 22 };
  const part = grainFrame(hashedCells(5), 64, 80, 1.5, 0.5, 0.4, win);
  // The grid and its random cells are the whole picture's; only the
  // normalising spread is read from the window, so the two agree closely.
  let worst = 0;
  for (let k = 0; k < whole.c; k += 1) {
    for (let y = 0; y < win.h; y += 1) {
      for (let x = 0; x < win.w; x += 1) {
        worst = Math.max(worst, Math.abs(whole.data[(k * 64 + win.y0 + y) * 80 + win.x0 + x] - part.data[(k * win.h + y) * win.w + x]));
      }
    }
  }
  assert.ok(worst < 0.25, `window grain strays ${worst} from the whole's`);
});

test("grain: the browser's random cells have the node's strength and grain size", () => {
  const flat = makeImage(96, 96, 3, new Float32Array(96 * 96 * 3).fill(0.5));
  for (const size of [1, 2.5]) {
    const out = filmGrain(flat, { amount: 0.25, size, roughness: 0, color: 0, cellsAt: hashedCells(3) });
    let sum = 0;
    for (const v of out.data) sum += (v - 0.5) ** 2;
    const spread = Math.sqrt(sum / out.data.length);
    // Amount 0.25 at mid grey is a spread of 0.25 * 0.15 = 0.0375.
    assert.ok(Math.abs(spread - 0.0375) < 0.004, `size ${size}: spread ${spread}`);
  }
  // Bigger grain is smoother: neighbouring pixels agree more.
  const lag = (size) => {
    const out = filmGrain(flat, { amount: 0.25, size, roughness: 0, color: 0, cellsAt: hashedCells(4) });
    let same = 0; let all = 0;
    for (let y = 0; y < 96; y += 1) for (let x = 1; x < 96; x += 1) { same += (out.data[(y * 96 + x) * 3] - 0.5) * (out.data[(y * 96 + x - 1) * 3] - 0.5); all += (out.data[(y * 96 + x) * 3] - 0.5) ** 2; }
    return same / all;
  };
  assert.ok(lag(3) > lag(1) + 0.3, "larger size should give smoother, more correlated grain");
  const normals = Array.from({ length: 4000 }, (_, i) => cellNormal(9, 0, i, 7));
  const mean = normals.reduce((a, b) => a + b, 0) / normals.length;
  const sd = Math.sqrt(normals.reduce((a, b) => a + (b - mean) ** 2, 0) / normals.length);
  assert.ok(Math.abs(mean) < 0.06 && Math.abs(sd - 1) < 0.06, `cell normals: mean ${mean}, sd ${sd}`);
});

test("auto: the noise reading and Auto's picks match the node", () => {
  for (const item of FIX.cases.noise) {
    const got = measureNoise(pic(item.image, 3, item.height, item.width));
    assert.ok(Math.abs(got - item.measured) < 2e-5, `${item.name}: ${got} vs ${item.measured}`);
  }
  for (const item of FIX.cases.auto) {
    const got = autoGrain(item.height, item.width, item.noise);
    assert.ok(Math.abs(got.amount - item.amount) < 1e-6 && Math.abs(got.size - item.size) < 1e-6, JSON.stringify(item));
  }
});

test("auto: 4 MP gets twice the grain size of 1 MP, and a clean picture starts at 0.25", () => {
  const small = autoValues(1000, 1000, 0, 1, 1);
  const big = autoValues(2000, 2000, 0, 1, 1);
  assert.equal(small.size, 1);
  assert.equal(big.size, 2);
  assert.equal(small.amount, 0.25);
  const times = autoValues(2000, 2000, 0, 1.5, 2);
  assert.equal(times.amount, 0.375);
  assert.equal(times.size, 4);
  assert.ok(autoValues(1000, 1000, 0.03, 1, 1).amount > 0.4, "a grainy picture gets more");
});

test("keep detail: the same result as the node", () => {
  for (const item of FIX.cases.detail) {
    const out = keepDetail(pic(FIX.smooth), pic(FIX.original), {
      detailSize: item.detail_size, strength: item.strength, colorDetail: item.color_detail, edgeSafe: item.edge_safe,
    });
    const diff = maxDiff(out.data, item.result);
    assert.ok(diff < 5e-5, `${item.name}: differs by ${diff}`);
  }
});

test("cut out: the same alpha and cut-out as the node", () => {
  for (const item of FIX.cases.cutout) {
    const out = cutOut(pic(FIX.image), Float32Array.from(FIX.mask), {
      keep: item.keep, grow: item.grow, feather: item.feather, cleanEdges: item.clean_edges, clearHaze: item.clear_haze, solidAbove: item.solid_above,
    });
    const alpha = Float32Array.from({ length: height * width }, (_, i) => out.data[i * 4 + 3]);
    const alphaDiff = maxDiff(alpha, item.alpha);
    assert.ok(alphaDiff < 5e-5, `${item.name}: alpha differs by ${alphaDiff}`);
    const diff = maxDiff(out.data, item.result);
    assert.ok(diff < 5e-5, `${item.name}: cut-out differs by ${diff}`);
  }
});
