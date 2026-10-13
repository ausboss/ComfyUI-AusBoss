// Pure logic for Image Compare A/B's Erase mode. No DOM in here: the canvas
// and the buttons live in compare_erase_stage.mjs, so this stays testable
// under node:test.
//
// In Erase mode one picture lies on top of the other and a brush rubs the
// top one away. What is kept is the strokes, not a painted bitmap: the panel
// draws its preview from them, and the server builds the saved mix from the
// same strokes at the picture's full size (nodes/_compare_helpers.py holds
// the same numbers; tests/test_compare_erase.py keeps the two equal).
//
// A stroke is { o, d, s, p }: o 1 rubs the top picture away and 0 brings it
// back, d is the brush's width in pixels of the picture, s its softness in
// percent, and p the path as x0, y0, x1, y1 ... in pixels of the picture.

import { thinStroke } from "./touch_math.mjs";

export const ERASE_SIZE = [2, 2000];
export const ERASE_MAX_STROKES = 400;
export const ERASE_MAX_STROKE_POINTS = 600;
export const ERASE_MAX_POINTS = 40000;
// A path may leave the picture while the button is held, but not by miles.
export const ERASE_OUTSIDE = 4096;
export const ERASE_SOFT_DEFAULT = 50;
// The longest side of the mask the panel paints its preview from. The saved
// mix does not depend on it: the server draws the strokes again at full size.
export const PREVIEW_SIDE = 2048;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Radius of the brush's solid middle. `soft` runs 0 to 1.
export function brushCore(size, soft) {
  return (size / 2) * (1 - soft / 2);
}

// How far the edge is blurred: 0 for a hard brush, an eighth of the size at
// full soft. The blur reaches about three of these past the middle's rim, so
// the brush fades out near the ring the pointer shows.
export function brushSigma(size, soft) {
  return (soft * size) / 8;
}

export function clampSize(value) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? Math.round(number) : ERASE_SIZE[0], ERASE_SIZE[0], ERASE_SIZE[1]);
}

export function clampSoft(value) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? Math.round(number) : ERASE_SOFT_DEFAULT, 0, 100);
}

// The brush a picture opens with: about a twelfth of its longer side.
export function defaultBrushSize(width, height) {
  const side = Math.max(Number(width) || 0, Number(height) || 0);
  return side > 0 ? clampSize(Math.round(side / 24) * 2) : 64;
}

export function normalizeTop(value) {
  return value === "B" ? "B" : "A";
}

// One stored stroke, checked. Null for anything that is not a stroke: what a
// workflow holds is somebody else's text.
export function cleanStroke(raw, width, height) {
  const path = raw?.p;
  if (!Array.isArray(path) || path.length < 2 || path.length % 2) return null;
  if (path.length / 2 > ERASE_MAX_STROKE_POINTS) return null;
  const points = [];
  for (let index = 0; index < path.length; index += 2) {
    const x = Number(path[index]);
    const y = Number(path[index + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push(
      clamp(Math.round(x), -ERASE_OUTSIDE, width + ERASE_OUTSIDE),
      clamp(Math.round(y), -ERASE_OUTSIDE, height + ERASE_OUTSIDE),
    );
  }
  return { o: raw.o === 0 ? 0 : 1, d: clampSize(raw.d), s: clampSoft(raw.s), p: points };
}

export function pointCount(strokes) {
  return strokes.reduce((total, stroke) => total + stroke.p.length / 2, 0);
}

// Does one more stroke still fit in the mix?
export function strokeFits(strokes, stroke) {
  if (strokes.length + 1 > ERASE_MAX_STROKES) return false;
  return pointCount(strokes) + stroke.p.length / 2 <= ERASE_MAX_POINTS;
}

// The paint a node keeps with its workflow: the strokes and the size of the
// picture they were made on. Paint made on a picture of another size is
// dropped, since its places no longer mean anything.
export function readPaint(raw, width, height) {
  const empty = { w: width, h: height, strokes: [] };
  if (!raw || raw.w !== width || raw.h !== height || !Array.isArray(raw.strokes)) return empty;
  const strokes = [];
  for (const item of raw.strokes.slice(0, ERASE_MAX_STROKES)) {
    const stroke = cleanStroke(item, width, height);
    if (stroke && strokeFits(strokes, stroke)) strokes.push(stroke);
  }
  return { w: width, h: height, strokes };
}

// A finished stroke from the points the pointer left, in picture pixels.
// Points that add nothing to the line are dropped, more of them for a wide
// brush, which hides a wobble a thin one would show.
export function makeStroke(points, { erase = true, size, soft }, width, height) {
  const d = clampSize(size);
  const thinned = thinStroke(points, Math.max(0.75, d / 40), ERASE_MAX_STROKE_POINTS);
  return cleanStroke({ o: erase ? 1 : 0, d, s: clampSoft(soft), p: thinned.flat() }, width, height);
}

// Where a picture sits in a box when it is shown whole and centred.
export function fitRect(boxWidth, boxHeight, width, height) {
  if (!(boxWidth > 0) || !(boxHeight > 0) || !(width > 0) || !(height > 0)) {
    return { left: 0, top: 0, width: 0, height: 0, scale: 0 };
  }
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const fitWidth = width * scale;
  const fitHeight = height * scale;
  return { left: (boxWidth - fitWidth) / 2, top: (boxHeight - fitHeight) / 2, width: fitWidth, height: fitHeight, scale };
}

// A place in the box as a place on the picture, in picture pixels.
export function toPicture(fit, x, y) {
  if (!(fit?.scale > 0)) return null;
  return [(x - fit.left) / fit.scale, (y - fit.top) / fit.scale];
}

// How much smaller than the picture the panel's own mask is kept.
export function previewScale(width, height, cap = PREVIEW_SIDE) {
  const side = Math.max(width, height);
  return side > cap ? cap / side : 1;
}

// The next brush size for the [ and ] keys: a fifth up or down, never less
// than two pixels of change.
export function steppedSize(size, up) {
  const next = up ? Math.max(size + 2, Math.round((size * 1.2) / 2) * 2) : Math.min(size - 2, Math.round(size / 1.2 / 2) * 2);
  return clampSize(next);
}

// The next softness for Shift + [ and Shift + ]: a quarter softer or harder.
export function steppedSoft(soft, softer) {
  return clampSoft(soft + (softer ? 25 : -25));
}

// Setting the brush with a drag, as in Photoshop: hold Alt and the right
// mouse button, then drag across for the size or up and down for the edge.
// The drag changes one of the two at a time, so a shaky hand setting the
// size does not move the edge. The first few pixels pick which, and turning
// the drag the other way switches to the other from there.
export const ADJUST_DEAD_ZONE = 6;
// How far the pointer travels the other way before the drag switches.
export const ADJUST_TURN = 12;

export function adjustAxis(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < ADJUST_DEAD_ZONE) return null;
  return Math.abs(dx) >= Math.abs(dy) ? "size" : "soft";
}

// The brush after a drag of dx, dy screen pixels. Across, the brush's rim
// follows the pointer: `perPixel` is how many pixels of the picture one
// screen pixel covers. Up is softer and down is harder, half a percent a
// pixel, so the whole range is a short drag.
export function adjustedBrush({ size, soft }, axis, dx, dy, perPixel = 1) {
  if (axis === "size") return { size: clampSize(size + 2 * dx * perPixel), soft };
  if (axis === "soft") return { size, soft: clampSoft(soft - dy / 2) };
  return { size, soft };
}

// A brush drag that begins at x, y (screen pixels) with this brush.
export function startAdjust(x, y, { size, soft }) {
  return { axis: null, origin: [x, y], base: { size, soft }, trail: [x, y], brush: { size, soft } };
}

// The drag after the pointer moved to x, y. `trail` follows the pointer a
// few pixels behind: when the stretch from it to the pointer runs clearly
// the other way (twice as far that way as this way), the drag has turned.
// What it had set stays, and the other value starts from the pointer.
export function moveAdjust(state, x, y, perPixel = 1) {
  let { axis, origin, base, trail } = state;
  const tx = x - trail[0];
  const ty = y - trail[1];
  if (Math.hypot(tx, ty) >= ADJUST_TURN) {
    const heading = Math.abs(tx) >= 2 * Math.abs(ty) ? "size" : Math.abs(ty) >= 2 * Math.abs(tx) ? "soft" : null;
    if (axis && heading && heading !== axis) {
      base = adjustedBrush(base, axis, x - origin[0], y - origin[1], perPixel);
      origin = [x, y];
      axis = heading;
    }
    trail = [x, y];
  }
  axis ??= adjustAxis(x - origin[0], y - origin[1]);
  return { axis, origin, base, trail, brush: adjustedBrush(base, axis, x - origin[0], y - origin[1], perPixel) };
}

// What the Save button sends: the run's key, never a file name.
export function saveRequest({ pair, top, strokes, layers }) {
  return {
    pair: typeof pair === "string" ? pair : "",
    top: normalizeTop(top),
    strokes: strokes ?? [],
    layers: layers === true,
  };
}

// The line the panel shows once a save is done.
export function savedMessage(files) {
  const names = (files ?? []).map((file) => (file?.subfolder ? `${file.subfolder}/${file.filename}` : file?.filename)).filter(Boolean);
  if (!names.length) return "Saved.";
  return names.length > 1 ? `Saved ${names[0]}, with its PSD and mask, in the output folder.` : `Saved ${names[0]} in the output folder.`;
}

// The saved files as short links for the row under the picture, so a mix
// made on another computer can be downloaded from the node.
export function savedLinks(files) {
  return (files ?? []).filter((file) => file?.filename).map((file) => {
    const name = String(file.filename).toLowerCase();
    const label = name.endsWith("_mask.png") ? "MASK" : name.endsWith(".psd") ? "PSD" : "PNG";
    return { label, file };
  });
}
