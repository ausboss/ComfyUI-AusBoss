// Keep Detail in the browser: the same maths as nodes/_detail_helpers.py, for
// the live preview (js/shared/live_stage.mjs). Both pictures are split into a
// base (the picture blurred by `detailSize` pixels) and detail (the ratio of
// each pixel to that base, in linear light); the result is the edit's base
// with the original's detail on it. See the Python file for why.
import { boxBlur, gaussianBlur, makeImage, pyRound } from "./live_image.mjs";

export const LIGHT_FLOOR = 2e-3;
const HUE_KEEP = 1e-6;
export const EDGE_STEP = 0.15;
const LUMA = [0.2126, 0.7152, 0.0722];

export function srgbToLinear(v) {
  const x = v < 0 ? 0 : v > 1 ? 1 : v;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(v) {
  const x = v < 0 ? 0 : v;
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.max(x, 1e-12) ** (1 / 2.4) - 0.055;
}

const mapImage = (image, fn) => makeImage(image.w, image.h, image.c, Float32Array.from(image.data, fn));

// The box radius that spreads as far as a Gaussian of this sigma.
export function boxRadius(sigma) {
  return Math.max(1, pyRound(Math.sqrt(3 * Number(sigma) ** 2 + 0.25) - 0.5));
}

function guided(image, radius) {
  const mean = boxBlur(image, radius);
  const squares = boxBlur(mapImage(image, (v) => v * v), radius);
  const keep = makeImage(image.w, image.h, image.c, new Float32Array(image.data.length));
  const offset = makeImage(image.w, image.h, image.c, new Float32Array(image.data.length));
  for (let i = 0; i < image.data.length; i += 1) {
    const spread = Math.max(squares.data[i] - mean.data[i] * mean.data[i], 0);
    keep.data[i] = spread / (spread + EDGE_STEP ** 2);
    offset.data[i] = mean.data[i] - keep.data[i] * mean.data[i];
  }
  const keepBlur = boxBlur(keep, radius);
  const offsetBlur = boxBlur(offset, radius);
  const out = new Float32Array(image.data.length);
  for (let i = 0; i < out.length; i += 1) out[i] = keepBlur.data[i] * image.data[i] + offsetBlur.data[i];
  return makeImage(image.w, image.h, image.c, out);
}

// The base of linear light: what is left once detail smaller than
// `detailSize` pixels is smoothed away (on sRGB-curved values).
export function baseLight(light, detailSize, edgeSafe) {
  const curved = mapImage(light, linearToSrgb);
  const smooth = edgeSafe ? guided(curved, boxRadius(detailSize)) : gaussianBlur(curved, Math.max(Number(detailSize), 0.5));
  return mapImage(smooth, srgbToLinear);
}

function lightOf(rgb, colorDetail) {
  const { w, h, c } = rgb;
  if (colorDetail) {
    const out = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i += 1) for (let k = 0; k < 3; k += 1) out[i * 3 + k] = srgbToLinear(rgb.data[i * c + Math.min(k, c - 1)]);
    return makeImage(w, h, 3, out);
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    let sum = 0;
    for (let k = 0; k < 3; k += 1) sum += LUMA[k] * srgbToLinear(rgb.data[i * c + Math.min(k, c - 1)]);
    out[i] = sum;
  }
  return makeImage(w, h, 1, out);
}

// How far a window must reach past what it shows for the result inside it to
// be the whole picture's: the guided filter boxes twice, the blur is cut at
// three sigma.
export function detailReach(detailSize, edgeSafe) {
  return edgeSafe ? 2 * boxRadius(detailSize) + 1 : Math.ceil(3 * Math.max(Number(detailSize), 0.5)) + 1;
}

// The edit with the original's detail. `edit` and `original` are pictures of
// the same size (c = 3 or 4; alpha is left alone), `mask` one plane or null.
export function keepDetail(edit, original, { detailSize = 4, strength = 1, colorDetail = false, edgeSafe = true, mask = null } = {}) {
  strength = Math.max(Number(strength), 0);
  if (strength === 0) return edit;
  const own = Math.max(0, 1 - strength);
  const { w, h, c } = edit;
  const editLight = lightOf(edit, colorDetail);
  const origLight = lightOf(original, colorDetail);
  const editBase = baseLight(editLight, detailSize, edgeSafe);
  const origBase = baseLight(origLight, detailSize, edgeSafe);
  const lc = editLight.c;
  const out = new Float32Array(edit.data);
  for (let i = 0; i < w * h; i += 1) {
    const factor = [0, 0, 0];
    for (let k = 0; k < lc; k += 1) {
      const at = i * lc + k;
      const base = editBase.data[at] + LIGHT_FLOOR;
      const origDetail = (origLight.data[at] + LIGHT_FLOOR) / (origBase.data[at] + LIGHT_FLOOR);
      const editDetail = (editLight.data[at] + LIGHT_FLOOR) / base;
      const target = base * origDetail ** strength * editDetail ** own;
      factor[k] = target / (editLight.data[at] + LIGHT_FLOOR);
    }
    const gate = mask ? mask[i] : 1;
    const linears = [0, 1, 2].map((k) => srgbToLinear(edit.data[i * c + k]));
    // Light only: the floor's light goes to each channel in proportion, so hue holds.
    const luma = linears[0] * LUMA[0] + linears[1] * LUMA[1] + linears[2] * LUMA[2];
    for (let k = 0; k < 3; k += 1) {
      const f = lc === 1 ? factor[0] : factor[k];
      const rgb = edit.data[i * c + k];
      const linear = linears[k];
      const share = lc === 1 ? (linear + HUE_KEEP) / (luma + HUE_KEEP) : 1;
      const lit = linear * f + LIGHT_FLOOR * (f - 1) * share;
      const change = (linearToSrgb(lit) - linearToSrgb(linear)) * gate;
      const next = rgb + change;
      out[i * c + k] = next < 0 ? 0 : next > 1 ? 1 : next;
    }
  }
  return makeImage(w, h, c, out);
}
