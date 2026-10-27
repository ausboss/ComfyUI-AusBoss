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

import { BRUSH_SOFT_DEFAULT, clampBrushSize, clampSoft, steppedBrushSize } from "./brush.mjs";
import { thinStroke } from "./touch_math.mjs";

// The brush itself is the pack's shared one (brush.mjs): Mask by Touch
// paints with the same.
export {
  ADJUST_DEAD_ZONE,
  ADJUST_TURN,
  adjustAxis,
  adjustedBrush,
  brushCore,
  brushSigma,
  clampSoft,
  moveAdjust,
  startAdjust,
  steppedSoft,
} from "./brush.mjs";

export const ERASE_SIZE = [2, 2000];
export const ERASE_MAX_STROKES = 400;
export const ERASE_MAX_STROKE_POINTS = 600;
export const ERASE_MAX_POINTS = 40000;
// A path may leave the picture while the button is held, but not by miles.
export const ERASE_OUTSIDE = 4096;
export const ERASE_SOFT_DEFAULT = BRUSH_SOFT_DEFAULT;
// The longest side of the mask the panel paints its preview from. The saved
// mix does not depend on it: the server draws the strokes again at full size.
export const PREVIEW_SIDE = 2048;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function clampSize(value) {
  return clampBrushSize(value, ERASE_SIZE);
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

// A see-through picture shows over a checkerboard, as in an editor: its
// squares' side in CSS pixels and their two colours.
export const CHECKER = { side: 8, light: "#4d4d4d", dark: "#383838" };

// The padding that holds a contained picture's own background to the
// picture: the bars beside it, as CSS. Empty when there is nothing to fit.
export function backdropPadding(boxWidth, boxHeight, width, height) {
  const fit = fitRect(boxWidth, boxHeight, width, height);
  if (!(fit.scale > 0)) return "";
  return `${fit.top}px ${fit.left}px`;
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

// The next brush size for the [ and ] keys.
export function steppedSize(size, up) {
  return steppedBrushSize(size, up, ERASE_SIZE);
}

// What a saved mix is called when no name is given, and how long a name
// may be (nodes/_compare_helpers.py holds the same two).
export const SAVE_NAME = "compare";
export const SAVE_NAME_MAX = 80;

// The name field as it is typed in: letters, digits, spaces, dots, dashes
// and underscores stay, everything else is left out, so a folder can never
// be part of it. The server checks the same rule and refuses the rest.
export function typedName(text) {
  return String(text ?? "").replace(/[^\p{L}\p{N}_ .\-]/gu, "").replace(/\.{2,}/g, ".").replace(/^[ .]+/, "").slice(0, SAVE_NAME_MAX);
}

// What the files will be called, for the hint under the pointer.
export function nameHint(name, layers) {
  const base = typedName(name).trim().replace(/[ .]+$/, "") || SAVE_NAME;
  return layers ? `${base}_00001.png, with ${base}_00001.psd and ${base}_00001_mask.png` : `${base}_00001.png`;
}

// What the Save button sends: the run's key for its two pictures, never a
// file to read, and the name typed for the new files.
export function saveRequest({ pair, top, strokes, layers, name }) {
  return {
    pair: typeof pair === "string" ? pair : "",
    top: normalizeTop(top),
    strokes: strokes ?? [],
    layers: layers === true,
    name: typedName(name).trim(),
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
