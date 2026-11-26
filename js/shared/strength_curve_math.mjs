// Strength Curve's points and line, shared by its face and its tests. No
// DOM and no ComfyUI imports, so node:test loads it as it is.
//
// The same curve as nodes/_curve_helpers.py: points from 0 to 1 joined by a
// monotone cubic (Fritsch and Carlson), which never swings past a point. The
// face draws what the node will output.

export const MAX_POINTS = 32;
// Two points never sit closer than this along the run.
export const MIN_GAP = 0.01;

export const PRESETS = Object.freeze([
  { name: "flat", title: "The same strength all the way", points: [[0, 1], [1, 1]] },
  { name: "fade out", title: "Full at the start, gone at the end", points: [[0, 1], [1, 0]] },
  { name: "fade in", title: "Off at the start, full at the end", points: [[0, 0], [1, 1]] },
  { name: "ease out", title: "Holds, fades out smoothly through the middle, then stays low", points: [[0, 1], [0.25, 0.92], [0.75, 0.08], [1, 0]] },
  { name: "ease in", title: "Stays low, comes in smoothly through the middle, then holds", points: [[0, 0], [0.25, 0.08], [0.75, 0.92], [1, 1]] },
]);

const clamp01 = (value) => Math.min(1, Math.max(0, value));

// Clean, sorted points that start at 0 and end at 1, as the backend reads
// them. Anything that cannot be read is a flat line at 1.
export function parsePoints(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try { data = raw.trim() ? JSON.parse(raw) : []; } catch { data = []; }
  }
  if (!Array.isArray(data)) data = [];
  const found = new Map();
  for (const entry of data.slice(0, MAX_POINTS)) {
    const pair = Array.isArray(entry) ? entry : [entry?.x, entry?.y];
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    found.set(clamp01(x), clamp01(y));
  }
  const points = [...found.entries()].sort((a, b) => a[0] - b[0]);
  if (!points.length) return [[0, 1], [1, 1]];
  if (points[0][0] > 0) points.unshift([0, points[0][1]]);
  if (points[points.length - 1][0] < 1) points.push([1, points[points.length - 1][1]]);
  return points;
}

// Rounded so a saved value stays short and reads back the same.
const tidy = (value) => Math.round(value * 10000) / 10000;
export const pointsText = (points) => JSON.stringify(points.map(([x, y]) => [tidy(x), tidy(y)]));

function slopes(xs, ys) {
  const count = xs.length;
  const secants = [];
  for (let i = 0; i < count - 1; i++) secants.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const out = new Array(count).fill(0);
  out[0] = secants[0];
  out[count - 1] = secants[count - 2];
  for (let i = 1; i < count - 1; i++) {
    out[i] = secants[i - 1] * secants[i] <= 0 ? 0 : (secants[i - 1] + secants[i]) / 2;
  }
  secants.forEach((secant, i) => {
    if (secant === 0) { out[i] = 0; out[i + 1] = 0; return; }
    const a = out[i] / secant;
    const b = out[i + 1] / secant;
    const length = a * a + b * b;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      out[i] = scale * a * secant;
      out[i + 1] = scale * b * secant;
    }
  });
  return out;
}

// The curve's value (0..1) at each place (0..1).
export function curveValues(points, places) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  if (points.length < 2) return places.map(() => ys[0] ?? 1);
  const m = slopes(xs, ys);
  return places.map((raw) => {
    const place = clamp01(Number(raw));
    let piece = 0;
    while (piece < xs.length - 2 && place > xs[piece + 1]) piece += 1;
    const width = xs[piece + 1] - xs[piece];
    const t = (place - xs[piece]) / width;
    const t2 = t * t;
    const t3 = t2 * t;
    const value = (2 * t3 - 3 * t2 + 1) * ys[piece] + (t3 - 2 * t2 + t) * width * m[piece]
      + (-2 * t3 + 3 * t2) * ys[piece + 1] + (t3 - t2) * width * m[piece + 1];
    return clamp01(value);
  });
}

export const curveAt = (points, place) => curveValues(points, [place])[0];

// The preset these points are, or "" for a hand-drawn curve.
export function presetOf(points) {
  const same = (a, b) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-4 && Math.abs(p[1] - b[i][1]) < 1e-4);
  return PRESETS.find((preset) => same(points, preset.points))?.name ?? "";
}

// Move one point. The two ends stay at the start and the end of the run;
// a point between them stays between its neighbours.
export function movePoint(points, index, x, y) {
  const next = points.map((point) => [...point]);
  const last = next.length - 1;
  if (index < 0 || index > last) return next;
  let place = clamp01(Number(x));
  if (index === 0) place = 0;
  else if (index === last) place = 1;
  else place = Math.min(next[index + 1][0] - MIN_GAP, Math.max(next[index - 1][0] + MIN_GAP, place));
  next[index] = [place, clamp01(Number(y))];
  return next;
}

// Add a point; gives the new points and the new point's index, or null when
// there is no room (too many points, or too close to one).
export function addPoint(points, x, y) {
  if (points.length >= MAX_POINTS) return null;
  const place = clamp01(Number(x));
  if (points.some((point) => Math.abs(point[0] - place) < MIN_GAP)) return null;
  const next = [...points.map((point) => [...point]), [place, clamp01(Number(y))]].sort((a, b) => a[0] - b[0]);
  return { points: next, index: next.findIndex((point) => point[0] === place) };
}

// Remove a point between the ends; the ends always stay.
export function removePoint(points, index) {
  if (index <= 0 || index >= points.length - 1) return points.map((point) => [...point]);
  return points.filter((_, i) => i !== index).map((point) => [...point]);
}

// The strength a value of the box (0..1) stands for.
export const strengthOf = (value, low, high) => Number(low) + (Number(high) - Number(low)) * value;
