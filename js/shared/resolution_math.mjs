// Pure geometry for the Resolution Master 🆎 node: snapping, ratio math, drag
// mapping, and readouts. DOM-free so node:test covers it
// (tests/resolution_math.test.mjs); js/resolution/index.js wires it to the
// panel.

export const DIM_MIN = 64;
export const DIM_MAX = 8192;
export const SNAP_STEPS = [8, 16, 32, 64];
export const DEFAULT_SNAP = 32;

export function clampDim(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DIM_MIN;
  return Math.max(DIM_MIN, Math.min(DIM_MAX, number));
}

// Round to the step without ever snapping below one step, so a small
// dimension snaps UP instead of collapsing to zero.
export function snapDim(value, step = DEFAULT_SNAP) {
  const s = Number(step) > 0 ? Number(step) : 1;
  return clampDim(Math.max(s, Math.round(Number(value) / s) * s));
}

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function lcm(a, b) {
  return (a * b) / gcd(a, b);
}

// One snap system for ratio-locked sizes: with width = rx*k and
// height = ry*k, both dimensions land on the snap grid exactly when k is a
// multiple of lcm(step/gcd(step,rx), step/gcd(step,ry)). 7:4 at /32 gives
// stride 32 (k=192 -> 1344x768); 16:9 at /16 gives stride 16 (k=80 ->
// 1280x720). The ratio stays mathematically exact AND on-grid - no second
// snapping pass, no drift.
export function ratioStride(ratio, step) {
  const s = Number(step) > 0 ? Math.round(step) : 1;
  if (s <= 1) return 1;
  return lcm(s / gcd(s, ratio.x), s / gcd(s, ratio.y));
}

// Some ratio/step pairs only align at coarse strides (16:9 at /32 moves
// width in 512px jumps). The panel warns past this per-axis step so the
// user can pick a finer snap instead of thinking the drag is stuck.
export function strideWarning(ratio, step, threshold = 256) {
  const stride = ratioStride(ratio, step);
  return stride * Math.max(ratio.x, ratio.y) > threshold;
}

// Reduced integer ratio of a size, e.g. 1344x768 -> {x: 7, y: 4}.
export function reduceRatio(width, height) {
  const d = gcd(width, height);
  return { x: Math.round(width / d), y: Math.round(height / d) };
}

// Human ratio label: exact when the reduced terms stay small, otherwise a
// one-decimal approximation ("~1.78:1" / "~1:1.42") that reads better than
// a monster fraction like 341:192.
export function ratioLabel(width, height) {
  const { x, y } = reduceRatio(width, height);
  if (x <= 32 && y <= 32) return `${x}:${y}`;
  const value = width / height;
  return value >= 1
    ? `~${(Math.round(value * 100) / 100)}:1`
    : `~1:${(Math.round((1 / value) * 100) / 100)}`;
}

export function megapixels(width, height) {
  return Math.round((width * height) / 10000) / 100;
}

export function readout(width, height) {
  return `${width} × ${height}  ·  ${megapixels(width, height).toFixed(2)} MP  ·  ${ratioLabel(width, height)}`;
}

// Largest w x h with the given aspect that fits a box - the chip and stage
// thumbnails.
export function fitRectInBox(aspectW, aspectH, boxW, boxH) {
  const scale = Math.min(boxW / aspectW, boxH / aspectH);
  return { w: Math.max(1, aspectW * scale), h: Math.max(1, aspectH * scale) };
}

// A size on an exact integer ratio nearest a pixel target for the driving
// axis: width = rx*k, height = ry*k for whole k, so the ratio never drifts
// however far the drag travels or however coarse the snap. When snapping,
// k moves in ratioStride multiples so BOTH dimensions stay on the grid.
export function ratioSizeForAxis(ratio, axis, target, step = 1) {
  const r = axis === "height" ? ratio.y : ratio.x;
  const kStep = ratioStride(ratio, step);
  const minK = Math.ceil(Math.max(DIM_MIN / ratio.x, DIM_MIN / ratio.y) / kStep) * kStep;
  const maxK = Math.floor(Math.min(DIM_MAX / ratio.x, DIM_MAX / ratio.y) / kStep) * kStep;
  if (minK > maxK) {
    // Extreme ratios and coarse grids may have no exact solution. Keep
    // dimensions legal and use the nearest bounded approximation.
    const factor = Math.min(DIM_MAX / Math.max(ratio.x, ratio.y),
      Math.max(DIM_MIN / Math.min(ratio.x, ratio.y), target / r));
    return { width: snapDim(ratio.x * factor, step), height: snapDim(ratio.y * factor, step) };
  }
  const k = Math.max(minK, Math.min(maxK, Math.round(target / r / kStep) * kStep));
  const width = ratio.x * k;
  const height = ratio.y * k;
  return { width, height };
}

// Nearest size on the ratio to a free wxh point, judged by area, driven by
// the longer axis for stability.
export function ratioSizeNear(ratio, width, height, step = 1) {
  const byW = ratioSizeForAxis(ratio, "width", width, step);
  const byH = ratioSizeForAxis(ratio, "height", height, step);
  const errW = Math.abs(byW.width - width) + Math.abs(byW.height - height);
  const errH = Math.abs(byH.width - width) + Math.abs(byH.height - height);
  return errW <= errH ? byW : byH;
}

// ---------- the stage drag model ----------
//
// The stage shows the current rectangle centered in a fixed box at a live
// scale (px per CSS px). A drag grabs an edge or corner and moves that
// edge; the rectangle stays centered, so moving the right edge out grows
// width symmetrically. deltas are CSS px; scale converts to image px.
//
//   handle: "e" | "w" grow width; "n" | "s" grow height;
//           "ne" "nw" "se" "sw" grow both.
//   modifiers: snap (default true; false = 1px freedom),
//              lockRatio (true = keep the grab-time ratio exactly).

export function stageScale(width, height, boxW, boxH) {
  // Fit with fixed headroom for the handles, corner hints, and the label
  // (the design's 90px horizontal / 60px vertical margins), never below a
  // sliver on a tiny stage.
  const usableW = Math.max(40, boxW - 90);
  const usableH = Math.max(40, boxH - 60);
  return Math.max(0.002, Math.min(usableW / width, usableH / height));
}

const HANDLE_AXES = {
  e: { x: 1, y: 0 }, w: { x: 1, y: 0 },
  n: { x: 0, y: 1 }, s: { x: 0, y: 1 },
  ne: { x: 1, y: 1 }, nw: { x: 1, y: 1 }, se: { x: 1, y: 1 }, sw: { x: 1, y: 1 },
};

// Outward-positive delta for a handle: dragging the east edge right, the
// west edge left, the north edge up, or the south edge down all GROW.
export function outwardDelta(handle, dx, dy) {
  const sx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const sy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  return { ox: dx * sx, oy: dy * sy };
}

export function dragResize({
  handle, startWidth, startHeight, dx, dy, scale,
  snap = DEFAULT_SNAP, snapOn = true, lockRatio = false,
}) {
  const axes = HANDLE_AXES[handle] ?? { x: 1, y: 1 };
  const { ox, oy } = outwardDelta(handle, dx, dy);
  // Centered rectangle: an edge moving out d grows the dimension 2d.
  const growX = axes.x ? (ox * 2) / scale : 0;
  const growY = axes.y ? (oy * 2) / scale : 0;
  const step = snapOn ? snap : 1;

  if (lockRatio) {
    const ratio = reduceRatio(startWidth, startHeight);
    // Exact-k locking is only pleasant when the ratio aligns to the grid
    // at a workable stride. Custom ratios (a snapped 88:115, say) would
    // jump hundreds of pixels per step, so they scale proportionally at
    // snap granularity instead - fluid, ratio approximately kept.
    if (snapOn && strideWarning(ratio, snap)) {
      const factor = Math.max(
        0.05,
        1 + (growX / startWidth + growY / startHeight) / 2,
      );
      return {
        width: snapDim(startWidth * factor, step),
        height: snapDim(startHeight * factor, step),
      };
    }
    // The dominant travel axis drives; the other follows the exact ratio.
    const useWidth = axes.x && (!axes.y || Math.abs(growX) >= Math.abs(growY));
    return useWidth
      ? ratioSizeForAxis(ratio, "width", startWidth + growX, step)
      : ratioSizeForAxis(ratio, "height", startHeight + growY, step);
  }
  return {
    width: axes.x ? snapDim(startWidth + growX, step) : snapDim(startWidth, 1),
    height: axes.y ? snapDim(startHeight + growY, step) : snapDim(startHeight, 1),
  };
}

// ---------- chip policy: SHAPE x BUDGET ----------

// Clicking a ratio chip changes the SHAPE while keeping the pixel budget
// and the current orientation: 3:2 clicked while portrait yields 2:3, and
// the area stays as close to the current area as the grid allows. From the
// 1024x1024 default this lands exactly on the real-world sizes: 7:4 at /32
// gives 1344x768, 16:9 at /16 gives 1280x720.
// portrait defaults to the size's own orientation; a square caller passes
// the orientation it wants, since a square has none to read.
export function applyRatioAtBudget(width, height, ratio, step = DEFAULT_SNAP, portrait = height > width) {
  const flipped = portrait !== ratio.y > ratio.x && ratio.x !== ratio.y;
  const shaped = flipped ? { x: ratio.y, y: ratio.x } : { x: ratio.x, y: ratio.y };
  const area = width * height;
  const idealWidth = Math.sqrt(area * (shaped.x / shaped.y));
  const kStep = ratioStride(shaped, step);
  const candidates = [
    ratioSizeForAxis(shaped, "width", idealWidth, step),
    ratioSizeForAxis(shaped, "width", idealWidth + kStep * shaped.x, step),
    ratioSizeForAxis(shaped, "width", idealWidth - kStep * shaped.x, step),
  ];
  let best = candidates[0];
  let bestError = Infinity;
  for (const size of candidates) {
    const error = Math.abs(size.width * size.height - area);
    if (error < bestError) {
      bestError = error;
      best = size;
    }
  }
  return best;
}

// How the current size relates to a chip's ratio: "exact", "near" (within
// tolerance, rendered outlined), or null. Orientation-blind - a portrait
// 2:3 lights the 3:2 chip with flipped:true.
export function chipMatch(width, height, ratio, tolerance = 0.015) {
  const current = reduceRatio(width, height);
  const flippedMatch = current.x === ratio.y && current.y === ratio.x;
  if ((current.x === ratio.x && current.y === ratio.y) || (flippedMatch && ratio.x !== ratio.y)) {
    return { state: "exact", flipped: flippedMatch && ratio.x !== ratio.y };
  }
  const value = width / height;
  const chipValue = ratio.x / ratio.y;
  const drift = Math.abs(Math.log(value / chipValue));
  const driftFlipped = Math.abs(Math.log(value / (ratio.y / ratio.x)));
  if (drift <= tolerance) return { state: "near", flipped: false };
  if (ratio.x !== ratio.y && driftFlipped <= tolerance) return { state: "near", flipped: true };
  return null;
}

// Parse the gear menu's editable rail text ("1:1, 4:3, 7:4") into ratio
// objects; junk entries drop, duplicates collapse, and an empty result
// falls back to the shipped defaults so the rail can never vanish.
export const DEFAULT_RAIL = "1:1, 4:3, 3:2, 16:9, 7:4, 2:1";

export function parseRail(text) {
  const seen = new Set();
  const rail = [];
  for (const token of String(text ?? "").split(",")) {
    const match = token.trim().match(/^(\d{1,3})\s*[:x]\s*(\d{1,3})$/i);
    if (!match) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!x || !y) continue;
    const d = gcd(x, y);
    const key = `${x / d}:${y / d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rail.push({ x: x / d, y: y / d, label: `${x}:${y}` });
  }
  return rail.length ? rail : parseRail(DEFAULT_RAIL);
}

// The rail shows every ratio in the CANVAS's current orientation - a
// portrait canvas renders the 3:2 chip as "2:3" with a portrait glyph -
// so what you see is exactly what a click gives you.
export function orientRatio(ratio, portrait) {
  const long = Math.max(ratio.x, ratio.y), short = Math.min(ratio.x, ratio.y);
  const x = portrait ? short : long, y = portrait ? long : short;
  return { x, y, label: `${x}:${y}` };
}

// ---------- quick sizes ----------

// The per-ratio quick list, anchored to the canonical square areas
// (512^2, 768^2, 1024^2, 1280^2, 1536^2, 1792^2, 2048^2): each rung is
// the nearest on-ratio, on-grid size to that pixel budget. Generated,
// never curated - so 1:1 at /64 IS the familiar 512/768/1024/1280/1536/
// 1792/2048 ladder, and every other ratio gets the equivalent rungs
// (16:9 at /16 includes 1280x720, 7:4 at /32 includes 1344x768).
export const LADDER_EDGES = [512, 768, 1024, 1280, 1536, 1792, 2048];

export function quickSizes(width, height, step, count = 8) {
  const ratio = reduceRatio(width, height);
  const kStep = ratioStride(ratio, step);
  const area = ratio.x * ratio.y;
  const seen = new Set();
  const list = [];
  for (const edge of LADDER_EDGES) {
    const idealK = Math.sqrt((edge * edge) / area);
    const k = Math.max(kStep, Math.round(idealK / kStep) * kStep);
    const w = ratio.x * k;
    const h = ratio.y * k;
    if (w < DIM_MIN || h < DIM_MIN || w > DIM_MAX || h > DIM_MAX) continue;
    const key = `${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ width: w, height: h });
  }
  return list
    .sort((a, b) => a.width * a.height - b.width * b.height)
    .slice(0, count);
}

// Every ratio's canonical default - the ~1MP rung, exactly what a chip
// click lands on (1:1 -> 1024x1024, 16:9 at /16 -> 1280x720, 7:4 at /32
// -> 1344x768). Same idea as Pixaroma's hand-written per-ratio default
// table, derived instead of curated.
export function defaultSizeForRatio(ratio, step) {
  return applyRatioAtBudget(1024, 1024, ratio, step, ratio.y > ratio.x);
}

// ---------- megapixel ladder ----------

export const MP_LADDER = [0.25, 0.5, 1, 1.5, 2, 3, 4];

// Walk the rung ladder from wherever the current area sits: nearest rung
// first (by log distance), then one step in the asked direction.
export function stepMegapixels(currentMp, direction) {
  let nearest = 0;
  let bestDistance = Infinity;
  MP_LADDER.forEach((rung, index) => {
    const distance = Math.abs(Math.log(Math.max(0.01, currentMp) / rung));
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = index;
    }
  });
  const next = Math.max(0, Math.min(MP_LADDER.length - 1, nearest + Math.sign(direction)));
  return MP_LADDER[next];
}

// ---------- pins (user presets) ----------

export const MAX_PINS = 12;

export function parsePins(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((pin) => pin && Number.isFinite(pin.w) && Number.isFinite(pin.h))
      .map((pin) => ({ w: clampDim(pin.w), h: clampDim(pin.h) }))
      .slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

export function serializePins(pins) {
  return JSON.stringify(pins);
}

// Star toggles: pinning an already-pinned size removes it.
export function togglePin(pins, width, height) {
  const list = pins.filter((pin) => !(pin.w === width && pin.h === height));
  if (list.length === pins.length) list.unshift({ w: clampDim(width), h: clampDim(height) });
  return list.slice(0, MAX_PINS);
}

export function pinLabel(pin) {
  return `${pin.w}×${pin.h}`;
}

// ---------- misc panel helpers ----------

export function offGrid(width, height, step) {
  const s = Number(step) > 0 ? step : 1;
  return width % s !== 0 || height % s !== 0;
}

// The W/H boxes reuse the pack's scrub grammar: pointer travel past a dead
// zone moves the value in snap-step increments.
export function scrubDim(startValue, deltaX, step, pixelsPerStep = 4, deadZone = 3) {
  if (Math.abs(deltaX) <= deadZone) return clampDim(startValue);
  const travel = deltaX - Math.sign(deltaX) * deadZone;
  const steps = Math.round(travel / pixelsPerStep);
  return snapDim(startValue + steps * (Number(step) > 0 ? step : 1), Number(step) > 0 ? step : 1);
}

// ---------- megapixel retarget ----------

// Scale a size to a megapixel target. Exact-ratio version of sqrt scaling:
// walk the reduced ratio's integer k to the area nearest the target, so
// 2/3-ish sizes do not drift ratio when retargeted.
export function sizeForMegapixels(width, height, targetMp, step = DEFAULT_SNAP) {
  const ratio = reduceRatio(width, height);
  const targetPixels = Math.max(0.05, Number(targetMp) || 0.05) * 1_000_000;
  const idealWidth = Math.sqrt(targetPixels * (ratio.x / ratio.y));
  const candidates = [
    ratioSizeForAxis(ratio, "width", idealWidth, step),
    ratioSizeForAxis(ratio, "width", idealWidth + step, step),
    ratioSizeForAxis(ratio, "width", idealWidth - step, step),
  ];
  let best = candidates[0];
  let bestError = Infinity;
  for (const size of candidates) {
    const error = Math.abs(size.width * size.height - targetPixels);
    if (error < bestError) {
      bestError = error;
      best = size;
    }
  }
  return best;
}
