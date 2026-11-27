// Cut Out in the browser: the same maths as nodes/_cut_out_helpers.py, for the
// live preview (js/shared/live_stage.mjs). The mask becomes the alpha in a
// fixed order (white or black part, grow or shrink, feather, clear haze and
// solid core), and where the alpha is in between the colours are cleaned of
// the old background with the node's blur-fusion pass (clean_colours in
// nodes/_fine_edge_helpers.py).
import { areaResize, bilinearResize, boxBlur, gaussianBlur, makeImage, pyRound, slidingMax } from "./live_image.mjs";

export const SNAP = 1e-4;
export const CLEAN_RADII = [90, 6];
export const CLEAN_FOR = 1440;

// Grow (positive) or shrink (negative) a plane by whole pixels, soft values
// kept: a square maximum, or minimum, of 2n + 1 pixels.
export function growShrink(plane, w, h, pixels) {
  const steps = Math.abs(Math.trunc(pixels));
  if (steps === 0) return plane;
  const sign = pixels > 0 ? 1 : -1;
  let values = sign > 0 ? plane : Float32Array.from(plane, (v) => -v);
  values = slidingMax(slidingMax(values, w, h, steps, true), w, h, steps, false);
  return sign > 0 ? values : Float32Array.from(values, (v) => -v);
}

// A Gaussian feather, 3 sigma wide, edges repeated.
export function feather(plane, w, h, sigma) {
  if (!(sigma > 0)) return plane;
  const image = makeImage(w, h, 1, plane);
  return gaussianBlur(image, sigma, Math.max(1, Math.ceil(sigma * 3))).data;
}

// The cut-out's alpha for one mask plane the picture's size: 1 where the
// picture is kept.
export function cutOutAlpha(mask, w, h, { keep = "white", grow = 0, feather: soft = 1, clearHaze = 0, solidAbove = 1 } = {}) {
  let alpha = Float32Array.from(mask, (v) => (v < 0 ? 0 : v > 1 ? 1 : v));
  if (keep === "black") alpha = Float32Array.from(alpha, (v) => 1 - v);
  alpha = growShrink(alpha, w, h, grow);
  alpha = feather(alpha, w, h, soft);
  if (clearHaze > 0 || solidAbove < 1) {
    const span = Math.max(solidAbove - clearHaze, 1e-6);
    alpha = Float32Array.from(alpha, (v) => Math.min(1, Math.max(0, (v - clearHaze) / span)));
  }
  return Float32Array.from(alpha, (v) => (v >= 1 - SNAP ? 1 : v <= SNAP ? 0 : Math.min(1, Math.max(0, v))));
}

// The blur the colour clean-up uses: three box passes, on a smaller copy
// when it reaches far.
function blur(image, reach) {
  const step = Math.max(1, Math.floor(reach / 3));
  return boxBlur(boxBlur(boxBlur(image, step), step), step);
}

function wideBlur(image, reach) {
  const shrink = Math.max(1, Math.floor(reach / 12));
  if (shrink === 1) return blur(image, reach);
  const small = areaResize(image, Math.max(1, Math.floor(image.h / shrink)), Math.max(1, Math.floor(image.w / shrink)));
  return bilinearResize(blur(small, Math.max(1, Math.floor(reach / shrink))), image.h, image.w);
}

// How far the colour clean-up reaches for a picture whose long side is
// `longSide`: the wide pass.
export function cleanReach(longSide) {
  return Math.max(1, pyRound(CLEAN_RADII[0] * (longSide / CLEAN_FOR)));
}

// The subject's own colour for every pixel of `rgb` (3 channels), given its
// alpha plane. `longSide` is the long side of the whole picture, so a window
// of a big picture reaches as far as the whole one would.
export function cleanColours(rgb, alpha, longSide = Math.max(rgb.w, rgb.h)) {
  const { w, h } = rgb;
  const n = w * h;
  const image = makeImage(w, h, 3, Float32Array.from(rgb.data, (v) => (v < 0 ? 0 : v > 1 ? 1 : v)));
  const cover = makeImage(w, h, 1, Float32Array.from(alpha, (v) => (v < 0 ? 0 : v > 1 ? 1 : v)));
  const grow = longSide / CLEAN_FOR;
  let thing = image;
  let behind = image;
  for (const base of CLEAN_RADII) {
    const reach = Math.max(1, pyRound(base * grow));
    const weight = wideBlur(cover, reach);
    const byCover = makeImage(w, h, 3, new Float32Array(n * 3));
    const byRest = makeImage(w, h, 3, new Float32Array(n * 3));
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < 3; k += 1) {
        byCover.data[i * 3 + k] = thing.data[i * 3 + k] * cover.data[i];
        byRest.data[i * 3 + k] = behind.data[i * 3 + k] * (1 - cover.data[i]);
      }
    }
    const blurThing = wideBlur(byCover, reach);
    const blurBehind = wideBlur(byRest, reach);
    const nextThing = new Float32Array(n * 3);
    const nextBehind = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < 3; k += 1) {
        const at = i * 3 + k;
        const nearThing = blurThing.data[at] / (weight.data[i] + 1e-5);
        const nearBehind = blurBehind.data[at] / (1 - weight.data[i] + 1e-5);
        const t = nearThing + cover.data[i] * (image.data[at] - cover.data[i] * nearThing - (1 - cover.data[i]) * nearBehind);
        nextThing[at] = t < 0 ? 0 : t > 1 ? 1 : t;
        nextBehind[at] = nearBehind < 0 ? 0 : nearBehind > 1 ? 1 : nearBehind;
      }
    }
    thing = makeImage(w, h, 3, nextThing);
    behind = makeImage(w, h, 3, nextBehind);
  }
  return thing;
}

// How far past a window the mask must be read for the alpha inside it to be
// the whole picture's, and how far the colour clean-up looks.
export function cutOutReach({ grow = 0, feather: soft = 1, cleanEdges = true }, longSide) {
  const alpha = Math.abs(Math.trunc(grow)) + Math.ceil(Math.max(soft, 0) * 3) + 1;
  return alpha + (cleanEdges ? 3 * cleanReach(longSide) + 3 : 0);
}

// The cut-out as RGBA: `image` (c = 3 or 4) and its mask plane the same size.
// Pixels the alpha keeps fully solid keep their colours exactly.
export function cutOut(image, mask, { keep = "white", grow = 0, feather: soft = 1, cleanEdges = true, clearHaze = 0, solidAbove = 1, longSide = null } = {}) {
  const { w, h, c } = image;
  const n = w * h;
  const alpha = cutOutAlpha(mask, w, h, { keep, grow, feather: soft, clearHaze, solidAbove });
  const cover = Float32Array.from(alpha);
  if (c === 4) for (let i = 0; i < n; i += 1) cover[i] *= Math.min(1, Math.max(0, image.data[i * 4 + 3]));
  const rgb = c === 3 ? image : makeImage(w, h, 3, Float32Array.from({ length: n * 3 }, (_, at) => image.data[Math.floor(at / 3) * 4 + (at % 3)]));
  let colours = rgb;
  if (cleanEdges && cover.some((v) => v > 0 && v < 1)) {
    const clean = cleanColours(rgb, cover, longSide ?? Math.max(w, h));
    colours = makeImage(w, h, 3, Float32Array.from(rgb.data));
    for (let i = 0; i < n; i += 1) {
      if (cover[i] >= 1) continue;
      for (let k = 0; k < 3; k += 1) colours.data[i * 3 + k] = clean.data[i * 3 + k];
    }
  }
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    out[i * 4] = colours.data[i * 3];
    out[i * 4 + 1] = colours.data[i * 3 + 1];
    out[i * 4 + 2] = colours.data[i * 3 + 2];
    out[i * 4 + 3] = cover[i];
  }
  return makeImage(w, h, 4, out);
}
