// Layout Boxes: the boxes' geometry and their saved form. No DOM and no
// ComfyUI imports, so node:test covers it (tests/layout_boxes.test.mjs); the
// canvas itself is js/layout_boxes/index.js.
//
// A box is kept as fractions of the canvas: { x, y, w, h, type, text, desc,
// palette }, x and y its top-left corner, w and h its size. A gesture works
// in canvas pixels, lands on whole pixels, and turns back into fractions by
// one division per number (pixels / side). The backend reads pixel boxes the
// same way, so a box drawn here gives the same outputs on either node.
//
// A turned box also has `angle`: degrees, clockwise on the screen, -90 to 90,
// about its centre. A level box has no `angle` at all, so its saved form is
// what it always was. The turn is made in canvas pixels, so a turned box is a
// true rectangle on a canvas of any shape (nodes/_layout_boxes_helpers.py
// turns it the same way).

export const DIM_MIN = 64;
export const DIM_MAX = 16384;
export const DIM_STEP = 16;
export const DEFAULT_SIZE = 1024;
// A prompt element carries up to five colors.
export const MAX_COLORS = 5;
// Enough for any layout; it stops a held Ctrl + D from filling the canvas.
export const MAX_BOXES = 64;
// The smallest box side with the grid off, in canvas pixels.
export const FREE_MIN_PX = 8;
// Grid cells are 32 px, or bigger on a big canvas so a side has at most 64.
export const GRID_MIN_CELL = 32;
export const GRID_MAX_CELLS = 64;
// An arrow key moves the chosen box this far, in canvas pixels; with Shift,
// the bigger step.
export const NUDGE_PX = 1;
export const NUDGE_SHIFT_PX = 10;
export const EMPTY_LAYOUT = '{"v": 1, "boxes": []}';
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
// Boxes without a color of their own (the backend's preview uses the same).
export const PLAIN_BOX = "#5fc9c0";
// How far a box can be turned, either way, in degrees.
export const ANGLE_LIMIT = 90;
// Shift while turning lands on steps of this many degrees.
export const ANGLE_SNAP = 5;
// A text box turned at least this far tells the model its slant.
export const TILT_FROM = 2;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function finiteNumber(value) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ---------- turning ----------

// A box's turn as it is kept: degrees, clockwise on the screen, -90 to 90. A
// turn past 90 is the same rectangle as one 180 degrees back, so it is read
// that way. Anything that is not a number is 0, a level box.
export function readAngle(value) {
  let number = finiteNumber(value);
  if (number === null) return 0;
  // Only a turn out of range is worked out again: the sums would add noise
  // (25.2 would come back as 25.200000000000045).
  if (Math.abs(number) > ANGLE_LIMIT) {
    number = ((((number + 180) % 360) + 360) % 360) - 180;
    if (number > ANGLE_LIMIT) number -= 180;
    else if (number < -ANGLE_LIMIT) number += 180;
  }
  return number + 0;
}

export const angleOf = (box) => readAngle(box?.angle);

// A turn as the tag and the readout say it: "25°", "-7.5°".
export function angleLabel(angle) {
  const tenths = Math.round(readAngle(angle) * 10) / 10 + 0;
  return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)}°`;
}

// What a turned text box adds to its description for the model (the backend
// adds it, nodes/_layout_boxes_helpers.py tilt_phrase; the same words here
// for the editor to show): "tilted about 25 degrees, running downhill to the
// right" for a box turned clockwise, "uphill" the other way, nothing for a
// turn under TILT_FROM degrees.
export function tiltPhrase(angle) {
  const turn = readAngle(angle);
  if (Math.abs(turn) < TILT_FROM) return "";
  return `tilted about ${Math.floor(Math.abs(turn) + 0.5)} degrees, running ${turn > 0 ? "downhill" : "uphill"} to the right`;
}

// [cos, sin] of a turn, exact at a quarter turn.
function turnOf(angle) {
  const turn = readAngle(angle);
  if (Math.abs(turn) === ANGLE_LIMIT) return [0, Math.sign(turn)];
  const radians = (turn * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

// The point (u along the box's own top edge, v down its own left edge) from
// the centre (cx, cy), on the canvas, for a box turned by `angle`.
export function turnPoint(cx, cy, u, v, angle) {
  const [cos, sin] = turnOf(angle);
  return [cx + u * cos - v * sin, cy + u * sin + v * cos];
}

// A box's corners in canvas pixels: its top-left, top-right, bottom-right and
// bottom-left corner as drawn, turned about its centre.
export function boxCorners(box, width, height) {
  const rect = boxPixels(box, width, height);
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const hw = Math.abs(rect.x1 - rect.x0) / 2;
  const hh = Math.abs(rect.y1 - rect.y0) / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => turnPoint(cx, cy, u, v, box?.angle));
}

// The straight box around a box, turned or not, in canvas pixels.
export function turnedBounds(box, width, height) {
  const corners = boxCorners(box, width, height);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// How far the pointer went round a centre from one of its angles to the next
// (radians), the short way: crossing the line left of the centre is a small
// step, not a whole turn.
export function turnStep(from, to) {
  let step = to - from;
  while (step > Math.PI) step -= 2 * Math.PI;
  while (step < -Math.PI) step += 2 * Math.PI;
  return step;
}

// The angle a turn gives: where it started plus how far the pointer went
// round (degrees), held to -90..90, on ANGLE_SNAP steps with Shift (`snap`),
// else on tenths of a degree.
export function turnedAngle(start, turned, { snap = false } = {}) {
  const raw = clamp(readAngle(start) + (finiteNumber(turned) ?? 0), -ANGLE_LIMIT, ANGLE_LIMIT);
  const landed = snap ? Math.round(raw / ANGLE_SNAP) * ANGLE_SNAP : Math.round(raw * 10) / 10;
  return clamp(landed, -ANGLE_LIMIT, ANGLE_LIMIT) + 0;
}

// A turned box moved by (dx, dy) canvas pixels, whole pixels at a time. Its
// centre stays on the canvas and its corners may reach past the edges, so it
// can cover words that run to the edge of a picture. The grid steers level
// boxes only.
export function movedTurnedRect(start, dx, dy, width, height) {
  const w = start.x1 - start.x0;
  const h = start.y1 - start.y0;
  const cx = clamp((start.x0 + start.x1) / 2 + Math.round(dx), 0, width);
  const cy = clamp((start.y0 + start.y1) / 2 + Math.round(dy), 0, height);
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

// A handle of a turned box dragged by (dx, dy) canvas pixels. The drag is
// read along the box's own sides, the side (or corner) across from the
// handle stays where it is, and the sides keep whole pixels, at least
// FREE_MIN_PX and at most the canvas's diagonal. The centre stays on the
// canvas, as when the box is moved.
export function resizedTurnedRect(start, handle, dx, dy, angle, width, height) {
  const [cos, sin] = turnOf(angle);
  const du = dx * cos + dy * sin;
  const dv = -dx * sin + dy * cos;
  const longest = Math.ceil(Math.hypot(width, height));
  const side = (value) => clamp(Math.round(value), FREE_MIN_PX, Math.max(FREE_MIN_PX, longest));
  const hw = (start.x1 - start.x0) / 2;
  const hh = (start.y1 - start.y0) / 2;
  let [left, right, top, bottom] = [-hw, hw, -hh, hh];
  if (handle.includes("e")) right = left + side(right + du - left);
  if (handle.includes("w")) left = right - side(right - left - du);
  if (handle.includes("s")) bottom = top + side(bottom + dv - top);
  if (handle.includes("n")) top = bottom - side(bottom - top - dv);
  const [x, y] = turnPoint((start.x0 + start.x1) / 2, (start.y0 + start.y1) / 2, (left + right) / 2, (top + bottom) / 2, angle);
  const cx = clamp(x, 0, width);
  const cy = clamp(y, 0, height);
  const w = right - left;
  const h = bottom - top;
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

// A box turned back to level: on whole pixels and on the canvas again, as
// level boxes always are.
export function leveledRect(rect, width, height) {
  const w = clamp(Math.round(rect.x1 - rect.x0), 1, width);
  const h = clamp(Math.round(rect.y1 - rect.y0), 1, height);
  const x0 = clamp(Math.round(rect.x0), 0, width - w);
  const y0 = clamp(Math.round(rect.y0), 0, height - h);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

// A canvas side as the node takes it: a whole number inside the limits.
export function canvasSide(value, fallback = DEFAULT_SIZE) {
  const number = finiteNumber(value);
  return number === null ? fallback : clamp(Math.round(number), DIM_MIN, DIM_MAX);
}

// The canvas the face draws, as { width, height, picture }: the picture on
// `background` when one is shown, at its own size and shape whatever width
// and height say (the mask is made on the picture, so the boxes are placed
// on it), else width and height as the node takes them.
export function faceCanvas(picture, width, height) {
  const across = finiteNumber(Array.isArray(picture) ? picture[0] : null);
  const down = finiteNumber(Array.isArray(picture) ? picture[1] : null);
  if (across > 0 && down > 0) return { width: Math.round(across) || 1, height: Math.round(down) || 1, picture: true };
  return { width: canvasSide(width), height: canvasSide(height), picture: false };
}

// The size a picture gives the canvas: its own size on the 16 px steps.
export function sideForPicture(pixels) {
  const number = finiteNumber(pixels);
  if (number === null || number <= 0) return null;
  return clamp(Math.max(DIM_STEP, Math.round(number / DIM_STEP) * DIM_STEP), DIM_MIN, DIM_MAX);
}

// ---------- colors ----------

// "#abc", "#aabbcc" or "#aabbccdd" in lower case, or null.
export function normalizeHex(color) {
  if (typeof color !== "string") return null;
  const hex = color.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(hex) ? hex : null;
}

export function cleanPalette(colors) {
  const list = Array.isArray(colors) ? colors : colors && typeof colors === "object" ? Object.values(colors) : [];
  return list.map(normalizeHex).filter(Boolean).slice(0, MAX_COLORS);
}

// What a box is drawn in: its first color, or the plain box color.
export function boxColor(box) {
  return box?.palette?.find((color) => normalizeHex(color)) ?? PLAIN_BOX;
}

// Dark letters on a light color, light ones on a dark color.
export function textOn(color) {
  const hex = normalizeHex(color) ?? PLAIN_BOX;
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#061010" : "#ffffff";
}

// ---------- the saved form ----------

function cleanBox(item) {
  if (!item || typeof item !== "object") return null;
  const numbers = ["x", "y", "w", "h"].map((key) => finiteNumber(item[key]));
  if (numbers.some((number) => number === null)) return null;
  const [x, y, w, h] = numbers;
  const box = {
    x, y, w, h,
    type: item.type === "text" ? "text" : "obj",
    text: typeof item.text === "string" ? item.text : "",
    desc: typeof item.desc === "string" ? item.desc : "",
    palette: cleanPalette(item.palette),
  };
  // Only a turned box carries its angle; a level one reads as it always did.
  const angle = readAngle(item.angle);
  if (angle) box.angle = angle;
  return box;
}

// Pixel boxes in Create Bounding Boxes' own form ({ x, y, width, height,
// metadata }) as boxes of this canvas.
export function fromCoreBoxes(list, width, height) {
  const across = width || 1;
  const down = height || 1;
  const boxes = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== "object") continue;
    const numbers = ["x", "y", "width", "height"].map((key) => finiteNumber(item[key] ?? 0));
    if (numbers.some((number) => number === null)) continue;
    const meta = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    boxes.push(cleanBox({
      x: numbers[0] / across, y: numbers[1] / down, w: numbers[2] / across, h: numbers[3] / down,
      type: meta.type, text: meta.text, desc: meta.desc, palette: meta.palette,
    }));
  }
  return boxes;
}

// The hidden widget's value as { boxes, fromInput, broken }. The node writes
// { v: 1, boxes: [...], from_input }; a list in Create Bounding Boxes' form
// is read against the canvas size. This never throws.
export function parseLayout(value, width = DEFAULT_SIZE, height = DEFAULT_SIZE) {
  let data = value;
  if (typeof value === "string") {
    if (!value.trim()) return { boxes: [], fromInput: "", broken: false };
    try {
      data = JSON.parse(value);
    } catch {
      return { boxes: [], fromInput: "", broken: true };
    }
  }
  if (Array.isArray(data)) return { boxes: fromCoreBoxes(data, width, height), fromInput: "", broken: false };
  if (!data || typeof data !== "object") return { boxes: [], fromInput: "", broken: value !== null && value !== undefined };
  const boxes = (Array.isArray(data.boxes) ? data.boxes : []).map(cleanBox).filter(Boolean);
  return { boxes, fromInput: typeof data.from_input === "string" ? data.from_input : "", broken: false };
}

export function serializeLayout(boxes, fromInput = "") {
  const data = {
    v: 1,
    boxes: boxes.map((box) => {
      const saved = {
        x: box.x, y: box.y, w: box.w, h: box.h,
        type: box.type === "text" ? "text" : "obj",
        text: box.text ?? "",
        desc: box.desc ?? "",
        palette: cleanPalette(box.palette),
      };
      const angle = angleOf(box);
      if (angle) saved.angle = angle;
      return saved;
    }),
  };
  if (fromInput) data.from_input = fromInput;
  return JSON.stringify(data);
}

export function newBox(rect, width, height, extra = {}) {
  return fromPixels(rect, width, height, { type: "obj", text: "", desc: "", palette: [], ...extra });
}

// ---------- pixels ----------

export function boxPixels(box, width, height) {
  return { x0: box.x * width, y0: box.y * height, x1: (box.x + box.w) * width, y1: (box.y + box.h) * height };
}

// Where a gesture starts: the box on whole pixels.
export function wholePixels(box, width, height) {
  const rect = boxPixels(box, width, height);
  return { x0: Math.round(rect.x0), y0: Math.round(rect.y0), x1: Math.round(rect.x1), y1: Math.round(rect.y1) };
}

// A rectangle in whole pixels back to fractions, one division per number.
export function fromPixels(rect, width, height, base = {}) {
  return {
    ...base,
    x: rect.x0 / width,
    y: rect.y0 / height,
    w: (rect.x1 - rect.x0) / width,
    h: (rect.y1 - rect.y0) / height,
  };
}

export function boxSizePx(box, width, height) {
  const rect = wholePixels(box, width, height);
  return [rect.x1 - rect.x0, rect.y1 - rect.y0];
}

// ---------- the grid ----------

export function gridCell(side) {
  return Math.max(GRID_MIN_CELL, Math.ceil(Math.max(1, side) / GRID_MAX_CELLS));
}

// The grid sizes the gear offers. Auto is the rule above.
export const GRID_SIZES = ["Auto", "8", "16", "32", "64"];

// A side's grid cell for a size from the gear: that many pixels, or Auto's
// rule for Auto and for anything it does not know.
export function gridCellOf(side, size = "Auto") {
  const fixed = GRID_SIZES.includes(String(size)) ? Number(size) : NaN;
  return Number.isFinite(fixed) && fixed > 0 ? fixed : gridCell(side);
}

// The nearest grid line, or the far edge of the canvas when that is nearer
// (a side that is not a whole number of cells still has its edge to snap to).
export function snapTo(value, cell, side) {
  const at = clamp(value, 0, side);
  const line = Math.round(at / cell) * cell;
  return clamp(Math.abs(side - at) < Math.abs(line - at) ? side : line, 0, side);
}

// { snap, cellX, cellY } for a canvas, the grid on or off, at a size from
// the gear (Auto when none is given).
export function snapping(width, height, on = true, size = "Auto") {
  return { snap: Boolean(on), cellX: gridCellOf(width, size), cellY: gridCellOf(height, size) };
}

// Whether the grid is on: the person's own choice once they made one (saved
// with the node), else on for an empty canvas and off over a picture, where
// a box has to fit what is in the picture rather than the cells.
export function gridIsOn(saved, overPicture) {
  return typeof saved === "boolean" ? saved : !overPicture;
}

function edge(value, cell, side, snap) {
  return snap ? snapTo(value, cell, side) : clamp(Math.round(value), 0, side);
}

function smallest(cell, snap, side) {
  return Math.min(side, snap ? cell : FREE_MIN_PX);
}

// A new box from where the drag started to where the pointer is, in canvas
// pixels, any direction. It is at least one cell (or FREE_MIN_PX) each way.
export function drawnRect(ax, ay, bx, by, width, height, { snap = true, cellX = GRID_MIN_CELL, cellY = GRID_MIN_CELL } = {}) {
  const span = (a, b, cell, side) => {
    let lo = edge(Math.min(a, b), cell, side, snap);
    let hi = edge(Math.max(a, b), cell, side, snap);
    const least = smallest(cell, snap, side);
    if (hi - lo < least) {
      if (b >= a) hi = lo + least;
      else lo = hi - least;
      if (hi > side) { hi = side; lo = side - least; }
      if (lo < 0) { lo = 0; hi = least; }
    }
    return [lo, hi];
  };
  const [x0, x1] = span(ax, bx, cellX, width);
  const [y0, y1] = span(ay, by, cellY, height);
  return { x0, y0, x1, y1 };
}

// One side of a moved box: its near edge on a grid line, or its far edge on
// one (or on the canvas edge), whichever is nearer to where it was dragged.
function movedSide(start, delta, size, side, cell, snap) {
  const raw = start + delta;
  if (!snap) return clamp(Math.round(raw), 0, Math.max(0, side - size));
  const near = Math.round(raw / cell) * cell;
  const far = snapTo(raw + size, cell, side) - size;
  const pick = Math.abs(near - raw) <= Math.abs(far - raw) ? near : far;
  return clamp(pick, 0, Math.max(0, side - size));
}

// The box moved by (dx, dy) canvas pixels from where it started. It keeps
// its size and stays on the canvas.
export function movedRect(start, dx, dy, width, height, { snap = true, cellX = GRID_MIN_CELL, cellY = GRID_MIN_CELL } = {}) {
  const w = start.x1 - start.x0;
  const h = start.y1 - start.y0;
  const x0 = movedSide(start.x0, dx, w, width, cellX, snap);
  const y0 = movedSide(start.y0, dy, h, height, cellY, snap);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

// One handle dragged by (dx, dy). The edges it does not hold stay where
// they are, and the box keeps at least one cell (or FREE_MIN_PX) each way.
export function resizedRect(start, handle, dx, dy, width, height, { snap = true, cellX = GRID_MIN_CELL, cellY = GRID_MIN_CELL } = {}) {
  let { x0, y0, x1, y1 } = start;
  const leastX = smallest(cellX, snap, width);
  const leastY = smallest(cellY, snap, height);
  if (handle.includes("w")) x0 = clamp(edge(start.x0 + dx, cellX, width, snap), 0, Math.max(0, x1 - leastX));
  if (handle.includes("e")) x1 = clamp(edge(start.x1 + dx, cellX, width, snap), Math.min(width, x0 + leastX), width);
  if (handle.includes("n")) y0 = clamp(edge(start.y0 + dy, cellY, height, snap), 0, Math.max(0, y1 - leastY));
  if (handle.includes("s")) y1 = clamp(edge(start.y1 + dy, cellY, height, snap), Math.min(height, y0 + leastY), height);
  return { x0, y0, x1, y1 };
}

// How far an arrow key moves the chosen box, as [dx, dy] in canvas pixels,
// or null for any other key: one pixel, ten with Shift. The grid steers only
// the mouse, so the keys reach every pixel with it on or off, and Alt + arrow
// is one pixel as it always was.
export function nudgeStep(key, { shiftKey = false } = {}) {
  const step = shiftKey ? NUDGE_SHIFT_PX : NUDGE_PX;
  if (key === "ArrowLeft") return [-step, 0];
  if (key === "ArrowRight") return [step, 0];
  if (key === "ArrowUp") return [0, -step];
  if (key === "ArrowDown") return [0, step];
  return null;
}

// A nudge from the keyboard: an exact step, the box kept on the canvas.
export function nudgedRect(start, dx, dy, width, height) {
  const w = start.x1 - start.x0;
  const h = start.y1 - start.y0;
  const x0 = clamp(start.x0 + dx, 0, Math.max(0, width - w));
  const y0 = clamp(start.y0 + dy, 0, Math.max(0, height - h));
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

// Where a copy goes: one cell down and right, or up and left at the edge.
export function copiedRect(start, width, height, cellX = GRID_MIN_CELL, cellY = GRID_MIN_CELL) {
  const w = start.x1 - start.x0;
  const h = start.y1 - start.y0;
  const step = (lo, size, cell, side) => (lo + cell + size <= side ? lo + cell : Math.max(0, lo - cell));
  const x0 = step(start.x0, w, cellX, width);
  const y0 = step(start.y0, h, cellY, height);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

// ---------- the marks around a box ----------

// The handles, the tag and the outline keep one size on the screen at any
// graph zoom; these sizes are screen pixels.
export const HANDLE_PX = 14;
export const TAG_HEIGHT_PX = 15;
// A side this long holds a handle at its middle as well as at its corners.
export const MIDDLE_HANDLE_FROM_PX = 3 * HANDLE_PX + 6;

// A box's type in words, as its tag and its chip say it.
export function boxKind(box) {
  return box?.type === "text" ? "text" : "object";
}

// What a box's tag says: its number, its type in words, and how far it is
// turned when it is ("1 text 25°"). The chips say the first two.
export function boxTag(box, index) {
  const angle = angleOf(box);
  return `${index + 1} ${boxKind(box)}${angle ? ` ${angleLabel(angle)}` : ""}`;
}

// The tag's width on the screen, a little over: its letters are monospace.
export function tagWidthPx(tag) {
  return Math.ceil(String(tag).length * 6.5) + 10;
}

// Which marks a box gets, from its place on the screen ({ x, y, w, h } in
// screen pixels from the canvas's top-left corner) and the canvas's width on
// the screen. A side shorter than MIDDLE_HANDLE_FROM_PX has handles at its
// corners only. The tag sits just outside the top-left corner, inside the
// box when the box touches the top of the canvas, and runs leftward from the
// box's right edge when it would leave the canvas on the right.
export function boxMarks(rect, canvasWidth, tagWidth) {
  return {
    middleTopBottom: rect.w >= MIDDLE_HANDLE_FROM_PX,
    middleLeftRight: rect.h >= MIDDLE_HANDLE_FROM_PX,
    tagInside: rect.y < TAG_HEIGHT_PX,
    tagFromRight: rect.x + tagWidth > canvasWidth,
  };
}

// The turn handle (the knob) sits this far from the box's edge, centre to
// edge, in screen pixels; it is as big as the other handles.
export const KNOB_GAP_PX = 22;

// True when every point lies on a canvas of this size (screen pixels), with
// `room` to spare.
function onCanvas(points, canvasWidth, canvasHeight, room = 0) {
  return points.every(([x, y]) => x >= room - 0.5 && y >= room - 0.5 && x <= canvasWidth - room + 0.5 && y <= canvasHeight - room + 0.5);
}

// Where the knob goes, from the box's place on the screen ({ x, y, w, h } as
// drawn, before the turn) and its angle: "above" its top edge, "below" its
// bottom edge when the canvas has no room above, else "in" the box under its
// top edge. The canvas cuts off whatever is outside it.
export function knobSide(rect, angle, canvasWidth, canvasHeight) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const reach = rect.h / 2 + KNOB_GAP_PX;
  for (const [side, v] of [["above", -reach], ["below", reach]]) {
    if (onCanvas([turnPoint(cx, cy, 0, v, angle)], canvasWidth, canvasHeight, HANDLE_PX / 2)) return side;
  }
  return "in";
}

// Where a turned box's tag goes: the first of above its top-left corner,
// above its top-right corner (running leftward), inside under the top-left
// corner and inside under the top-right corner that stays on the canvas, as
// a level box's tag does. Level boxes keep boxMarks' rule.
export function turnedTagPlace(rect, angle, canvasWidth, canvasHeight, tagWidth) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  const tall = TAG_HEIGHT_PX;
  const places = [
    [false, false, [-hw, -hh - tall], [-hw + tagWidth, -hh]],
    [false, true, [hw - tagWidth, -hh - tall], [hw, -hh]],
    [true, false, [-hw, -hh], [-hw + tagWidth, -hh + tall]],
    [true, true, [hw - tagWidth, -hh], [hw, -hh + tall]],
  ];
  for (const [inside, fromRight, [u0, v0], [u1, v1]] of places) {
    const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => turnPoint(cx, cy, u, v, angle));
    if (onCanvas(corners, canvasWidth, canvasHeight)) return { tagInside: inside, tagFromRight: fromRight };
  }
  return { tagInside: true, tagFromRight: false };
}

// The resize cursor for a handle of a box turned by `angle`: the one of the
// four that points the way the handle pulls on the screen.
const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
const HANDLE_HEADING = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
export function handleCursor(handle, angle) {
  const heading = (HANDLE_HEADING[handle] ?? 0) + readAngle(angle);
  return RESIZE_CURSORS[((Math.round(heading / 45) % 4) + 4) % 4];
}

// ---------- words ----------

// What a box says on the canvas: the text in quotes for a text box, then
// the description.
export function boxWords(box) {
  const desc = String(box?.desc ?? "").trim();
  const text = String(box?.text ?? "").trim();
  if (box?.type === "text" && text) return desc ? `"${text}" - ${desc}` : `"${text}"`;
  return desc;
}

// ---------- choosing a box ----------

// The editor has a chip per box, up to this many; with more boxes, the chips
// of the boxes around the chosen one, and ‹ › to step through the rest.
export const CHIPS_MAX = 6;

// The boxes that have a chip, as [first, end): every box when they fit, else
// CHIPS_MAX of them with the chosen one among them.
export function chipWindow(count, selected, max = CHIPS_MAX) {
  if (count <= max) return [0, Math.max(0, count)];
  const start = clamp(Math.max(0, selected) - Math.floor((max - 1) / 2), 0, count - max);
  return [start, start + max];
}

// An object box keeps the words typed while it was a text box, but they do
// not go to the model. The line the editor shows in their place, or "" when
// there is nothing to say.
export const KEPT_WORDS_NOTE = "Object boxes do not write words. Your words are kept for when you switch back to text.";
export function keptWordsNote(box) {
  return box && box.type !== "text" && String(box.text ?? "").trim() ? KEPT_WORDS_NOTE : "";
}

// ---------- ready-made layouts ----------

// Places as fractions [x, y, w, h]; a `type` is what a new box there is.
export const LAYOUTS = [
  { id: "middle", label: "One in the middle", boxes: [{ at: [0.2, 0.1, 0.6, 0.82] }] },
  { id: "two", label: "Two side by side", boxes: [{ at: [0.04, 0.1, 0.44, 0.82] }, { at: [0.52, 0.1, 0.44, 0.82] }] },
  { id: "three", label: "Three across", boxes: [{ at: [0.03, 0.12, 0.3, 0.76] }, { at: [0.35, 0.12, 0.3, 0.76] }, { at: [0.67, 0.12, 0.3, 0.76] }] },
  { id: "stack", label: "Top and bottom", boxes: [{ at: [0.06, 0.04, 0.88, 0.44] }, { at: [0.06, 0.52, 0.88, 0.44] }] },
  { id: "title", label: "Title over a picture", boxes: [{ at: [0.1, 0.05, 0.8, 0.14], type: "text" }, { at: [0.1, 0.24, 0.8, 0.7] }] },
  { id: "corners", label: "Four corners", boxes: [
    { at: [0.04, 0.04, 0.44, 0.44] }, { at: [0.52, 0.04, 0.44, 0.44] },
    { at: [0.04, 0.52, 0.44, 0.44] }, { at: [0.52, 0.52, 0.44, 0.44] },
  ] },
];

// A layout's places for this canvas, on the grid. The boxes already there
// move into them and keep their words, type and colors: in order, except
// that a place meant for text takes the first text box (and an empty text
// box when there is none). Boxes the layout has no place for stay where
// they are, so nothing typed is lost.
export function applyLayout(layout, existing, width, height, grid = snapping(width, height)) {
  const left = [...existing];
  const take = (wanted) => {
    const at = wanted ? left.findIndex((box) => box.type === wanted) : 0;
    return at >= 0 && left.length ? left.splice(at, 1)[0] : null;
  };
  const placed = layout.boxes.map((slot) => {
    const [fx, fy, fw, fh] = slot.at;
    const rect = drawnRect(fx * width, fy * height, (fx + fw) * width, (fy + fh) * height, width, height, grid);
    const old = take(slot.type === "text" ? "text" : null);
    const base = old
      ? { type: old.type, text: old.text, desc: old.desc, palette: [...(old.palette ?? [])] }
      : { type: slot.type === "text" ? "text" : "obj", text: "", desc: "", palette: [] };
    return fromPixels(rect, width, height, base);
  });
  return [...placed, ...left];
}

// ---------- a size on a wire ----------

function linkOf(graph, id) {
  if (id === null || id === undefined || !graph) return null;
  return graph.getLink?.(id) ?? graph.links?.get?.(id) ?? graph.links?.[id] ?? null;
}

// The link into a node's input, found by the input's name. The frontend's
// own accessor first (newer frontends warn on reading input.link), the link
// table after it.
export function inputLink(node, name) {
  const index = node?.inputs?.findIndex((slot) => slot?.name === name || slot?.widget?.name === name) ?? -1;
  return index < 0 ? null : inputLinkAt(node, index);
}

function inputLinkAt(node, index) {
  if (typeof node?.getInputLink === "function" && node.graph) {
    try {
      return node.getInputLink(index) ?? null;
    } catch {
      return null;
    }
  }
  return linkOf(node?.graph, node?.inputs?.[index]?.link);
}

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

// The number an input gets from its wire, when the page can know it before
// a run: the widget of the same name as the output on the node it comes
// from (Latent Size's width and height), or the value of a number node
// (Integer, Primitive). Reroutes are followed. Null when the input is not
// wired or the value is only known once the workflow runs.
export function wiredNumber(node, inputName) {
  const source = wiredSource(node, inputName);
  return source ? wiredFrom(source.node, source.slot) : null;
}

// The node (and its output slot) an input is wired to, through Reroutes.
export function wiredSource(node, inputName) {
  const graph = node?.graph;
  let link = inputLink(node, inputName);
  for (let hops = 0; link && hops < 16; hops += 1) {
    const source = graph?.getNodeById?.(link.origin_id) ?? null;
    if (!source) return null;
    if ((source.comfyClass ?? source.type) !== "Reroute") return { node: source, slot: link.origin_slot };
    link = inputLinkAt(source, 0);
  }
  return null;
}

function wiredFrom(source, slot) {
  const output = source.outputs?.[slot];
  const widgets = source.widgets ?? [];
  const named = widgets.find((widget) => widget?.name === output?.name && isNumber(widget.value));
  if (named) return named.value;
  const value = widgets.find((widget) => widget?.name === "value" && isNumber(widget.value));
  if (value) return value.value;
  // ComfyUI's Primitive node holds the value of the widget it feeds.
  if ((source.comfyClass ?? source.type) === "PrimitiveNode" && isNumber(widgets[0]?.value)) return widgets[0].value;
  return null;
}
