// The maths behind the 3D viewer's Blender keys (js/viewer_keys): G moves,
// R rotates and S scales the model while the mouse moves, the way Blender
// does it. Plain arrays [x, y, z]; nothing here touches the page, so it is
// tested on its own (tests/blender_transform.test.mjs).

export const AXES = Object.freeze({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
export const AXIS_NAMES = Object.freeze(["x", "y", "z"]);

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const times = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const n = length(a); return n > 1e-12 ? times(a, 1 / n) : [0, 0, 0]; };

/**
 * Blender's axis lock. X locks to the world's X axis, X again to the
 * model's own X, a third time unlocks. Shift+X locks to the plane that
 * leaves X out (move or scale along the other two), with the same cycle.
 */
export function nextConstraint(current, axis, plane = false) {
  const kind = plane ? "plane" : "axis";
  if (!current || current.axis !== axis || current.kind !== kind) return { kind, axis, space: "global" };
  if (current.space === "global") return { kind, axis, space: "local" };
  return null;
}

/** Where a ray meets a plane, as a distance along the ray; null when it runs parallel. */
export function rayPlane(origin, dir, point, normal) {
  const denom = dot(dir, normal);
  if (Math.abs(denom) < 1e-9) return null;
  return dot(sub(point, origin), normal) / denom;
}

export const along = (origin, dir, t) => add(origin, times(dir, t));

/**
 * The spot on an axis line (through `point`, along unit `axis`) nearest a
 * ray, as a distance along the axis. null when the axis points along the
 * ray, where every spot is as near as any other.
 */
export function closestOnAxis(origin, dir, point, axis) {
  const w = sub(point, origin);
  const a = dot(axis, axis);
  const b = dot(axis, dir);
  const c = dot(dir, dir);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9 * a * c) return null;
  return (b * dot(dir, w) - c * dot(axis, w)) / denom;
}

/** The turn from screen point `a` to `b` around `center`, counter-clockwise positive, in (-pi, pi]. Screen y points down. */
export function screenTurn(center, a, b) {
  const ax = a[0] - center[0], ay = center[1] - a[1];
  const bx = b[0] - center[0], by = center[1] - b[1];
  if (Math.hypot(ax, ay) < 1e-6 || Math.hypot(bx, by) < 1e-6) return 0;
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

/** Round to the nearest step; a step of 0 leaves the value alone. */
export const snapTo = (value, step) => (step > 0 ? Math.round(value / step) * step : value);

/**
 * A typed number as Blender takes it while a move runs: digits, one point,
 * and a minus anywhere that flips the sign. null while nothing usable is typed.
 */
export function parseTyped(text) {
  if (typeof text !== "string") return null;
  const negative = (text.match(/-/g)?.length ?? 0) % 2 === 1;
  const digits = text.replace(/-/g, "");
  if (!/^\d*\.?\d*$/.test(digits) || !/\d/.test(digits)) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

/** Edit the typed text with one key: a digit, ".", "-" (flip), or Backspace. */
export function typeKey(text, key) {
  if (key === "Backspace") return text.slice(0, -1);
  if (key === "-") return text.startsWith("-") ? text.slice(1) : `-${text}`;
  if (key === ".") return text.includes(".") ? text : `${text}.`;
  if (/^\d$/.test(key)) return text + key;
  return text;
}

/** How fine Ctrl snapping is: Shift makes it ten times finer, as in Blender. */
export function snapStep(mode, precise) {
  if (mode === "rotate") return precise ? 1 : 5; // degrees
  return precise ? 0.01 : 0.1; // world units, or scale factor
}

/**
 * The model's own axis that lies closest to a world axis, for scaling along
 * a world axis: scale belongs to the model's own axes, so a turned model
 * is scaled along the one that points most that way.
 * `localAxes` are the model's three axes in world space.
 */
export function nearestLocalAxis(localAxes, worldAxis) {
  let best = 0;
  let score = -1;
  localAxes.forEach((axis, i) => {
    const s = Math.abs(dot(unit(axis), worldAxis));
    if (s > score) { score = s; best = i; }
  });
  return best;
}

/** The scale factors on the model's own axes for a scale of `factor` under a lock. */
export function scaleFactors(factor, constraint, lockedIndex) {
  if (!constraint) return [factor, factor, factor];
  return [0, 1, 2].map((i) => {
    const on = constraint.kind === "axis" ? i === lockedIndex : i !== lockedIndex;
    return on ? factor : 1;
  });
}

/** How far (screen px) the mouse must travel before the middle button picks an axis. */
export const PICK_PX = 8;

/**
 * The mouse move that picks the axis for Blender's middle-button lock: the
 * move since the middle button went down once it is long enough (hold and
 * slide along an axis), else the move since G, R or S began (move, then
 * click the middle button). null while neither is long enough; then a click
 * waits for the mouse to move and picks from that.
 */
export function pickVector(start, press, now, min = PICK_PX) {
  if (press) {
    const held = [now[0] - press[0], now[1] - press[1]];
    if (Math.hypot(held[0], held[1]) >= min) return held;
  }
  const whole = [now[0] - start[0], now[1] - start[1]];
  return Math.hypot(whole[0], whole[1]) >= min ? whole : null;
}

/**
 * Of the axes as drawn on screen (2D directions, any length), the one a
 * mouse move runs most nearly along: Blender picks the axis line nearest
 * the mouse's move. Axes shorter than `minLength` on screen (pointing at
 * the camera) are left out; -1 when none is left or the move is empty.
 */
export function nearestScreenAxis(move, screenAxes, minLength = 1e-3) {
  if (!move || Math.hypot(move[0], move[1]) < 1e-9) return -1;
  let best = -1;
  let score = Infinity;
  screenAxes.forEach((d, i) => {
    const n = Math.hypot(d[0], d[1]);
    if (!(n >= minLength)) return;
    // The move's distance from the axis line through the start.
    const off = Math.abs(move[0] * d[1] - move[1] * d[0]) / n;
    if (off < score - 1e-9) { score = off; best = i; }
  });
  return best;
}

/** The lock the middle button gives for the picked axis (Shift: the plane without it). */
export const autoConstraint = (axis, plane = false) => ({ kind: plane ? "plane" : "axis", axis, space: "global" });

/** Words for the lock, for the header line. */
export function constraintLabel(constraint) {
  if (!constraint) return "";
  const name = constraint.axis.toUpperCase();
  const where = constraint.space === "local" ? "local" : "global";
  if (constraint.kind === "plane") {
    const others = AXIS_NAMES.filter((a) => a !== constraint.axis).map((a) => a.toUpperCase()).join("");
    return `on ${where} ${others}`;
  }
  return `along ${where} ${name}`;
}

const num = (v, digits = 3) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(digits);

/**
 * The amount in Blender's header words, without the lock: "D: 0.500 (0.500)"
 * along a locked axis (`along` is the signed distance on it), "Dx: .. Dy: ..
 * Dz: .. (length)" otherwise, "Rot: 45.0°", "Scale: 1.200" or "Scale X: ..
 * Y: .. Z: ..". `value` is the move [x, y, z], the degrees, the factor, or
 * [dx, dy] degrees for the trackball.
 */
export function readout(mode, value, constraint = null, along = null) {
  if (mode === "grab") {
    const size = num(length(value));
    if (constraint?.kind === "axis" && along != null) return `D: ${num(along)} (${size})`;
    return `Dx: ${num(value[0])}  Dy: ${num(value[1])}  Dz: ${num(value[2])} (${size})`;
  }
  if (mode === "trackball") return `Trackball: ${num(value[0], 1)}°  ${num(value[1], 1)}°`;
  if (mode === "rotate") return `Rot: ${num(value, 1)}°`;
  if (constraint) return `Scale: ${num(value)}`;
  return `Scale X: ${num(value)}  Y: ${num(value)}  Z: ${num(value)}`;
}
