// The pack's brush, one for every node that paints on a picture: Image
// Compare A/B's Erase mode and Mask by Touch. What a brush is (a solid middle
// with a soft edge), how the keys and a drag set it, and which press means
// what all live here, so the two nodes can never drift apart. No DOM in
// here: node:test covers it.
//
// A brush has a `size` (its width, in pixels of the picture) and a `soft`
// (how soft its edge is, 0 to 100).

// The widest range a brush's size may have. A node with a narrower range
// passes its own.
export const BRUSH_SIZE = [2, 2000];
export const BRUSH_SOFT_DEFAULT = 50;

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

export function clampBrushSize(value, range = BRUSH_SIZE) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? Math.round(number) : range[0], range[0], range[1]);
}

export function clampSoft(value, fallback = BRUSH_SOFT_DEFAULT) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? Math.round(number) : fallback, 0, 100);
}

// The next brush size for the [ and ] keys: a fifth up or down, never less
// than two pixels of change.
export function steppedBrushSize(size, up, range = BRUSH_SIZE) {
  const next = up ? Math.max(size + 2, Math.round((size * 1.2) / 2) * 2) : Math.min(size - 2, Math.round(size / 1.2 / 2) * 2);
  return clampBrushSize(next, range);
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
export function adjustedBrush({ size, soft }, axis, dx, dy, perPixel = 1, range = BRUSH_SIZE) {
  if (axis === "size") return { size: clampBrushSize(size + 2 * dx * perPixel, range), soft };
  if (axis === "soft") return { size, soft: clampSoft(soft - dy / 2) };
  return { size, soft };
}

// A brush drag that begins at x, y (screen pixels) with this brush.
export function startAdjust(x, y, { size, soft }, range = BRUSH_SIZE) {
  return { axis: null, origin: [x, y], base: { size, soft }, trail: [x, y], brush: { size, soft }, range };
}

// The drag after the pointer moved to x, y. `trail` follows the pointer a
// few pixels behind: when the stretch from it to the pointer runs clearly
// the other way (twice as far that way as this way), the drag has turned.
// What it had set stays, and the other value starts from the pointer.
export function moveAdjust(state, x, y, perPixel = 1) {
  let { axis, origin, base, trail } = state;
  const range = state.range ?? BRUSH_SIZE;
  const tx = x - trail[0];
  const ty = y - trail[1];
  if (Math.hypot(tx, ty) >= ADJUST_TURN) {
    const heading = Math.abs(tx) >= 2 * Math.abs(ty) ? "size" : Math.abs(ty) >= 2 * Math.abs(tx) ? "soft" : null;
    if (axis && heading && heading !== axis) {
      base = adjustedBrush(base, axis, x - origin[0], y - origin[1], perPixel, range);
      origin = [x, y];
      axis = heading;
    }
    trail = [x, y];
  }
  axis ??= adjustAxis(x - origin[0], y - origin[1]);
  return { axis, origin, base, trail, range, brush: adjustedBrush(base, axis, x - origin[0], y - origin[1], perPixel, range) };
}

// ---- which press means what -------------------------------------------------
//
// One rule for every brush in the pack. Ctrl held, or the right mouse
// button, does the opposite of the chosen tool for as long as it is held:
// erase while painting, paint while erasing. Alt belongs to the brush
// itself: Alt with the right button, dragged, sets its size and its edge.

// Whether a press starts a drag that sets the brush. On a Mac a click with
// Control held is the right button, so Control and Option with a click
// count as well.
export function brushAdjusts(event) {
  return Boolean(event?.altKey) && (event.button === 2 || Boolean(event.ctrlKey));
}

// Whether a press does the opposite of the chosen tool.
export function brushFlips(event) {
  return !brushAdjusts(event) && (event?.button === 2 || Boolean(event?.ctrlKey));
}

// What a key press asks of the brush: [ and ] for the size, with Shift for
// the edge, as in Photoshop. The key is read by its place on the keyboard
// too: with Shift it types { and }. Null for any other key.
export function brushKey(event) {
  const smaller = event?.code === "BracketLeft" || event?.key === "[" || event?.key === "{";
  const larger = event?.code === "BracketRight" || event?.key === "]" || event?.key === "}";
  if (!smaller && !larger) return null;
  return event.shiftKey ? { what: "soft", up: smaller } : { what: "size", up: larger };
}

// One letter per tool, as in Photoshop: W the quick selection (Pick), B the
// brush (Paint), E the eraser. Read by the letter, and by the key's place
// on a keyboard whose letters are not Latin. Null for anything else, and
// for a letter typed with Ctrl, Alt or Cmd: those are someone else's.
export function toolKey(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) return null;
  const letter = String(event.key ?? "").toLowerCase();
  const place = { KeyW: "w", KeyB: "b", KeyE: "e" }[event.code] ?? "";
  const chosen = /^[a-z]$/.test(letter) ? letter : place;
  return { w: "pick", b: "paint", e: "erase" }[chosen] ?? null;
}

// How much of a dab of the brush covers a point `distance` from its middle,
// 0 to 1: solid out to the middle's rim, then fading as the blur does. For
// drawing the brush under the pointer; the marks themselves are drawn by
// brushStroke and the server.
export function brushProfile(distance, size, soft) {
  const core = brushCore(size, soft);
  const sigma = brushSigma(size, soft);
  if (!(sigma >= 0.25)) return distance <= size / 2 ? 1 : 0;
  // The edge of a blurred disc, close enough: half of erfc across the rim.
  const x = (distance - core) / (sigma * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return clamp(0.5 * (1 - Math.sign(x) * erf), 0, 1);
}

// How far out a dab of the brush still shows: the ring for a hard brush,
// three blurs past the middle for a soft one.
export function brushReach(size, soft) {
  const sigma = brushSigma(size, soft);
  return sigma >= 0.25 ? Math.max(size / 2, brushCore(size, soft) + 3 * sigma) : size / 2;
}

// The two values in words, for the label under a brush that is being set.
export function brushWords(size, soft) {
  return [`Size ${size} px`, `Soft ${soft}%`];
}
