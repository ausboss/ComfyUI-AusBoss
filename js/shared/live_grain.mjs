// Film Grain in the browser: the same maths as nodes/_grain_helpers.py, for
// the live preview (js/shared/live_stage.mjs), plus Auto's noise reading.
//
// What matches the node: the grain's size, roughness and colour shaping, the
// tone curve, the strength, the mask, and Auto's measure and picks. What
// does not: the random numbers. The node draws them with torch's generator;
// here a hash of the grain cell's position gives each cell its value, so a
// preview of a part of the picture (100%) has the same grain wherever it is
// panned to. The pattern is therefore another draw of the same grain: the
// same strength and look, not the same specks. tests/live_preview.test.mjs
// feeds this code the node's own random numbers (tests/fixtures/
// live_parity.json) and checks the result against the node's.
import { areaTaps, bicubicTaps, makeImage, planeStd, pyRound } from "./live_image.mjs";

// The same constants as nodes/_grain_helpers.py.
export const FULL_STRENGTH = 0.15;
export const TONE_FLOOR = 0.2;
export const CLUMP_DEPTH = 0.6;
export const CLUMP_SCALE = 4.0;
export const GRAIN_LIMIT = 3.0;
export const LUMA = [0.2126, 0.7152, 0.0722];
export const AUTO_AMOUNT = 0.25;
export const AUTO_SIZE_MEGAPIXELS = 1.0;
export const AUTO_AMOUNT_RANGE = [0.05, 1.0];
export const AUTO_SIZE_RANGE = [0.5, 16.0];
export const OWN_GRAIN_FLOOR = 0.0015;
export const NOISE_BINS = 4096;
export const NOISE_TOP = 0.25;
export const NOISE_GAIN = 6.0;
export const HALF_NORMAL_MEDIAN = 0.6744897501960817;

// ---------- random cells ----------

function mix32(a) {
  let h = a | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// A normal random number for grid cell (i, j) of channel `ch`, from a seed.
// Two hashes give two uniform numbers, Box-Muller turns them into one normal.
export function cellNormal(seed, ch, i, j) {
  let h = mix32(seed ^ 0x9e3779b9);
  h = mix32(h + Math.imul(ch + 1, 0x632be5ab));
  h = mix32(h + Math.imul(i + 0x10000, 0x85ebca6b));
  const a = mix32(h + Math.imul(j + 0x10000, 0xc2b2ae35));
  const b = mix32(a ^ 0x68e31da4);
  const u = (a + 1) / 4294967297;
  const v = b / 4294967296;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// The cell source for a frame's grain: the n-th field drawn gets its own
// stream, so fields never repeat each other.
//
// Grain far smaller than a pixel (a big picture shrunk to fit) averages
// hundreds of cells into each pixel. The average of n independent cells is a
// normal with 1 / sqrt(n) of their spread, so the browser draws that
// directly (`fast`) instead of drawing every cell: the same distribution,
// at the cost of the pixels shown.
export function hashedCells(seed) {
  const base = mix32((Number(BigInt(seed) & 0xffffffffn) ^ Number((BigInt(seed) >> 32n) & 0xffffffffn)) >>> 0);
  const source = (index) => (ch, i, j) => cellNormal(mix32(base + index * 0x9e3779b1), ch, i, j);
  source.fast = true;
  return source;
}

// ---------- grain ----------

// Noise in grains about `size` pixels across for a window of the picture
// (`win` = { x0, y0, w, h }) of a picture that is `height` x `width`, as C
// planes. The grid is laid over the whole picture, as the node does:
// round(height / size) rows by round(width / size) columns of random cells,
// smoothed up (bicubic) or, finer than the picture, averaged down (area).
export function field(cells, height, width, size, channels, win, fast = false) {
  const rows = Math.max(1, pyRound(height / size));
  const cols = Math.max(1, pyRound(width / size));
  const { x0, y0 } = win;
  const cw = win.w;
  const ch = win.h;
  const out = new Float32Array(channels * cw * ch);
  if (rows === height && cols === width) {
    for (let k = 0; k < channels; k += 1) {
      for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) out[(k * ch + y) * cw + x] = cells(k, y0 + y, x0 + x);
    }
    return out;
  }
  const area = rows > height || cols > width;
  if (fast && rows > height && cols > width && rows * cols > 4 * height * width) {
    const spread = Math.sqrt((height * width) / (rows * cols));
    for (let k = 0; k < channels; k += 1) {
      for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) out[(k * ch + y) * cw + x] = cells(k, y0 + y, x0 + x) * spread;
    }
    return out;
  }
  // The cells each window column and row reads, with their weights.
  const colTaps = area
    ? areaTaps(cols, width).slice(x0, x0 + cw).map(([a, b]) => ({ at: Array.from({ length: b - a }, (_, n) => a + n), weights: Array(b - a).fill(1 / (b - a)) }))
    : bicubicTaps(cols, width, x0, cw);
  const rowTaps = area
    ? areaTaps(rows, height).slice(y0, y0 + ch).map(([a, b]) => ({ at: Array.from({ length: b - a }, (_, n) => a + n), weights: Array(b - a).fill(1 / (b - a)) }))
    : bicubicTaps(rows, height, y0, ch);
  const used = (taps) => {
    const set = new Set();
    for (const tap of taps) for (const at of tap.at) set.add(at);
    return [...set].sort((a, b) => a - b);
  };
  const usedRows = used(rowTaps);
  const rowSlot = new Map(usedRows.map((row, slot) => [row, slot]));
  for (let k = 0; k < channels; k += 1) {
    // Each needed row of cells, smoothed across to the window's columns.
    const across = new Float32Array(usedRows.length * cw);
    for (let slot = 0; slot < usedRows.length; slot += 1) {
      const cell = new Map();
      for (let x = 0; x < cw; x += 1) {
        let sum = 0;
        const tap = colTaps[x];
        for (let n = 0; n < tap.at.length; n += 1) {
          const j = tap.at[n];
          const key = j;
          let value = cell.get(key);
          if (value === undefined) {
            value = cells(k, usedRows[slot], j);
            cell.set(key, value);
          }
          sum += value * tap.weights[n];
        }
        across[slot * cw + x] = sum;
      }
    }
    for (let y = 0; y < ch; y += 1) {
      const tap = rowTaps[y];
      for (let x = 0; x < cw; x += 1) {
        let sum = 0;
        for (let n = 0; n < tap.at.length; n += 1) sum += across[rowSlot.get(tap.at[n]) * cw + x] * tap.weights[n];
        out[(k * ch + y) * cw + x] = sum;
      }
    }
  }
  if (!area) {
    const spread = Math.max(planeStd(out), 1e-6);
    for (let i = 0; i < out.length; i += 1) out[i] /= spread;
  }
  return out;
}

// One frame's grain for a window: C x h x w planes, C = 1 (monochrome) or 3.
export function grainFrame(cellsAt, height, width, size, roughness, color, win = { x0: 0, y0: 0, w: width, h: height }) {
  size = Math.max(Number(size), 1e-3);
  roughness = Math.min(Math.max(Number(roughness), 0), 1);
  color = Math.min(Math.max(Number(color), 0), 1);
  const n = win.w * win.h;
  let drawn = 0;
  const draw = (fieldSize, channels) => field(cellsAt(drawn++), height, width, fieldSize, channels, win, Boolean(cellsAt.fast));
  // Drawn in the node's order, so a setting that adds a layer never changes
  // the layers drawn before it.
  let layers = [{ c: 1, d: draw(size, 1) }];
  if (color > 0) layers.push({ c: 3, d: draw(size, 3) });
  if (roughness > 0) {
    const clump = draw(size * CLUMP_SCALE, 1);
    const weight = Float32Array.from(clump, (v) => Math.exp(CLUMP_DEPTH * v));
    const fine = layers.map((layer) => draw(size / 2, layer.c));
    const rough = fine.map((f, index) => {
      const out = new Float32Array(f.length);
      for (let i = 0; i < f.length; i += 1) out[i] = f[i] * weight[i % n];
      const scale = planeStd(f) / Math.max(planeStd(out), 1e-6);
      for (let i = 0; i < out.length; i += 1) out[i] *= scale;
      return out;
    });
    const mixer = Math.sqrt((1 - roughness) ** 2 + roughness ** 2);
    layers = layers.map((layer, index) => {
      const d = new Float32Array(layer.d.length);
      for (let i = 0; i < d.length; i += 1) d[i] = ((1 - roughness) * layer.d[i] + roughness * rough[index][i]) / mixer;
      return { c: layer.c, d };
    });
  }
  let grain = layers[0].d;
  let channels = 1;
  if (color > 0) {
    channels = 3;
    const mixer = Math.sqrt((1 - color) ** 2 + color ** 2);
    grain = new Float32Array(3 * n);
    for (let k = 0; k < 3; k += 1) {
      for (let i = 0; i < n; i += 1) grain[k * n + i] = ((1 - color) * layers[0].d[i] + color * layers[1].d[k * n + i]) / mixer;
    }
  }
  for (let i = 0; i < grain.length; i += 1) grain[i] = GRAIN_LIMIT * Math.tanh(grain[i] / GRAIN_LIMIT);
  return { c: channels, w: win.w, h: win.h, data: grain };
}

// How strong the grain is for a pixel of this luma: 1 at mid grey, falling to
// TONE_FLOOR at black and white.
export function toneWeight(luma) {
  const l = Math.min(Math.max(luma, 0), 1);
  return TONE_FLOOR + (1 - TONE_FLOOR) * 4 * l * (1 - l);
}

// The picture with the grain laid on: strength = amount * FULL_STRENGTH,
// `mask` (one plane the picture's size, or null) limits where.
export function layGrain(image, grain, amount, mask = null) {
  const { w, h, c } = image;
  const strength = Number(amount) * FULL_STRENGTH;
  const out = new Float32Array(image.data);
  const n = w * h;
  for (let i = 0; i < n; i += 1) {
    const r = image.data[i * c];
    const g = c >= 3 ? image.data[i * c + 1] : r;
    const b = c >= 3 ? image.data[i * c + 2] : r;
    const tone = toneWeight(LUMA[0] * r + LUMA[1] * g + LUMA[2] * b);
    const gate = mask ? mask[i] : 1;
    for (let k = 0; k < Math.min(c, 3); k += 1) {
      const value = grain.c === 3 ? grain.data[k * n + i] : grain.data[i];
      const next = image.data[i * c + k] + value * tone * strength * gate;
      out[i * c + k] = next < 0 ? 0 : next > 1 ? 1 : next;
    }
  }
  return makeImage(w, h, c, out);
}

// A window of a picture with film grain, as the node would make it.
// `image` is the window's pixels; `height` x `width` is the whole picture
// the grain grid is laid over and `win` where the window sits in it.
export function filmGrain(image, { amount, size, roughness, color, cellsAt, height = image.h, width = image.w, win = null, mask = null }) {
  if (!(Number(amount) > 0)) return image;
  const window = win ?? { x0: 0, y0: 0, w: image.w, h: image.h };
  const grain = grainFrame(cellsAt, height, width, size, roughness, color, window);
  return layGrain(image, grain, amount, mask);
}

// ---------- Auto ----------

// How much fine noise the picture has in its flat areas (one standard
// deviation in 0-1 values), as nodes/_grain_helpers.py measure_noise does:
// the median of a Laplacian-difference filter's size, read from a histogram.
export function measureNoise(image) {
  const { w, h, c } = image;
  if (w < 3 || h < 3) return 0;
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = image.data[i * c];
    const g = c >= 3 ? image.data[i * c + 1] : r;
    const b = c >= 3 ? image.data[i * c + 2] : r;
    luma[i] = c >= 3 ? LUMA[0] * r + LUMA[1] * g + LUMA[2] * b : r * (LUMA[0] + LUMA[1] + LUMA[2]);
  }
  const bins = new Int32Array(NOISE_BINS);
  let count = 0;
  const top = NOISE_TOP * (1 - 1e-6);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const at = y * w + x;
      const d = Math.abs(
        luma[at - w - 1] - 2 * luma[at - w] + luma[at - w + 1]
        - 2 * luma[at - 1] + 4 * luma[at] - 2 * luma[at + 1]
        + luma[at + w - 1] - 2 * luma[at + w] + luma[at + w + 1],
      );
      bins[Math.floor((Math.min(d, top) / NOISE_TOP) * NOISE_BINS)] += 1;
      count += 1;
    }
  }
  let reached = 0;
  let middle = NOISE_BINS - 1;
  for (let b = 0; b < NOISE_BINS; b += 1) {
    reached += bins[b];
    if (reached >= count / 2) { middle = b; break; }
  }
  return ((middle + 0.5) / NOISE_BINS * NOISE_TOP) / (NOISE_GAIN * HALF_NORMAL_MEDIAN);
}

// Auto's picks for a picture: grain size follows the square root of the
// megapixels, the amount is the normal 0.25 plus the picture's own grain.
export function autoGrain(height, width, noise) {
  const megapixels = Math.max((height * width) / 1e6, 1e-6);
  const size = Math.sqrt(megapixels / AUTO_SIZE_MEGAPIXELS);
  const amount = AUTO_AMOUNT + Math.max(0, noise - OWN_GRAIN_FLOOR) / FULL_STRENGTH;
  const clamp = (v, [low, high]) => Math.min(Math.max(v, low), high);
  return { amount: clamp(amount, AUTO_AMOUNT_RANGE), size: clamp(size, AUTO_SIZE_RANGE) };
}

// What Auto does for a picture: its own picks and the numbers used (the picks
// times the card's multipliers, kept inside the same limits as the node).
export function autoValues(height, width, noise, amountTimes, sizeTimes) {
  const base = autoGrain(height, width, noise);
  return {
    baseAmount: base.amount,
    baseSize: base.size,
    amount: Math.min(Math.max(base.amount * Number(amountTimes), 0), 1),
    size: Math.min(Math.max(base.size * Number(sizeTimes), AUTO_SIZE_RANGE[0]), AUTO_SIZE_RANGE[1]),
    noise,
  };
}
