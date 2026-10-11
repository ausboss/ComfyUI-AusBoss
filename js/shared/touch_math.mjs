// Pure math for Mask by Touch's face: what was picked, as the node's
// `touches` text; the pieces of the picture a pointer can light up; and the
// same edge steps the node runs on the server (fill holes, smooth, grow,
// soften), on typed arrays, so the picture on the node follows a click or a
// slider without a run. DOM-free: node:test covers it.
//
// A mask here is one value per pixel, row by row: Uint8Array of 0 and 1
// while it is on/off, Float32Array of 0..1 once it has been softened.

// The same caps the server puts on the touches it reads.
export const TOUCH_MAX_CHARS = 400000;
export const TOUCH_MAX_ITEMS = 200;
export const TOUCH_MAX_POINTS = 20000;
// The brush radius, in picture pixels.
export const BRUSH_RADIUS = [2, 2000];
// One stroke never needs more points than this once it is thinned.
export const STROKE_MAX_POINTS = 240;

// The tint the picked area is shown in, and its outline, as 0-255.
export const TINT = [0, 199, 189];
export const OUTLINE = [120, 255, 240];
export const TINT_STRENGTH = 0.5;
// What a lit piece looks like before it is picked: the same colour, fainter
// and with a white line, so the picked area and the piece under the pointer
// never read as one thing.
export const LIT = [0, 199, 189];
export const LIT_STRENGTH = 0.2;
// A hairline of this, just outside every outline, keeps the line readable
// on a bright picture.
export const HALO = [0, 0, 0, 150];
// A piece that would be taken away is lit in a warm colour instead.
export const LIT_AWAY = [255, 150, 120];

const TYPES = new Set(["tap", "name", "find", "paint", "all", "subject", "background"]);
// A word for SAM 3 is cut to this length.
export const NAME_MAX = 60;

// A word as the node sends it to SAM 3: commas, colons and brackets are the
// text reader's own syntax and go; spaces are collapsed.
export function cleanWord(word) {
  return String(word ?? "").replace(/[,:()]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function cleanPoint(pair) {
  if (!Array.isArray(pair) || pair.length < 2 || !finite(pair[0]) || !finite(pair[1])) return null;
  return [Math.round(pair[0]), Math.round(pair[1])];
}

// One touch as the node reads it, or null when it is not one.
export function cleanItem(raw) {
  if (!raw || typeof raw !== "object" || !TYPES.has(raw.t)) return null;
  const op = raw.op === 0 ? 0 : 1;
  if (raw.t === "tap") {
    if (!finite(raw.x) || !finite(raw.y)) return null;
    return { t: "tap", op, x: Math.round(raw.x), y: Math.round(raw.y) };
  }
  // The picture's main subject, or everything but it: no point and no word.
  if (raw.t === "subject" || raw.t === "background") return { t: raw.t, op };
  if (raw.t === "name") {
    const w = cleanWord(raw.w);
    if (!w || !finite(raw.x) || !finite(raw.y)) return null;
    const item = { t: "name", op, w, x: Math.round(raw.x), y: Math.round(raw.y) };
    // `q` marks a word the face did not show, because SAM 3 was not sure of
    // it: the thing is picked, and nobody is told the word.
    if (raw.q === 1 || raw.q === true) item.q = 1;
    return item;
  }
  // Every thing of that name on the picture: a typed name, or "all of these".
  if (raw.t === "all") {
    const w = cleanWord(raw.w);
    return w ? { t: "all", op, w } : null;
  }
  if (!Array.isArray(raw.pts) || !finite(raw.r)) return null;
  const pts = raw.pts.map(cleanPoint).filter(Boolean);
  if (!pts.length) return null;
  return { t: raw.t, op, r: Math.round(clamp(raw.r, BRUSH_RADIUS[0], BRUSH_RADIUS[1])), pts };
}

// A short stamp of a text: 32-bit FNV-1a over its UTF-8 bytes, as eight hex
// digits. The server stamps the touches it answered the same way, so the
// face knows which touches a result belongs to.
const FNV_START = 0x811c9dc5;
const encoder = new TextEncoder();

function feedStamp(state, text) {
  let hash = state;
  for (const byte of encoder.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const stampHex = (hash) => (hash >>> 0).toString(16).padStart(8, "0");

export function stampOf(text) {
  return stampHex(feedStamp(FNV_START, String(text ?? "")));
}

// The stamps of every way these touches can be cut short: entry n - 1 is the
// stamp of the text encodeTouches gives for the first n touches. One pass,
// however many touches there are.
export function prefixStamps(key, items) {
  const clean = (items ?? []).map(cleanItem).filter(Boolean);
  let hash = feedStamp(FNV_START, `{"v":1,"key":${JSON.stringify(String(key ?? ""))},"items":[`);
  return clean.map((item, index) => {
    hash = feedStamp(hash, `${index ? "," : ""}${JSON.stringify(item)}`);
    return stampHex(feedStamp(hash, "]}"));
  });
}

// What a pick is called on its chip under the picture: the thing's name,
// or what kind of touch it was. `count` is how many things an "all" pick
// found, once the node has said.
export function chipLabel(item, count = 0) {
  if (!item) return "";
  const sign = item.op === 0 ? "\u2212 " : "";
  if (item.t === "subject" || item.t === "background") return `${sign}${item.t}`;
  if (item.t === "name") return `${sign}${item.q ? "thing" : item.w}`;
  if (item.t === "all") return `${sign}${count > 1 ? `${count} \u00d7 ` : "every "}${item.w}`;
  if (item.t === "tap") return `${sign}thing`;
  if (item.t === "find") return `${sign}stroke`;
  return `${sign}paint`;
}

// The chips under the picture, as runs of touches: one chip per pick, but
// marks made with Draw that follow each other share one chip, however many
// there are and whether they add or rub out. Painting an area takes many
// marks, and a chip for each says nothing. `adds` is how many of a run's
// marks add; a run that only rubs out reads as taking away.
export function chipGroups(items) {
  const groups = [];
  (items ?? []).forEach((item, index) => {
    const paint = item?.t === "paint";
    const last = groups[groups.length - 1];
    if (paint && last?.paint) {
      last.to = index;
      last.count += 1;
      last.adds += item.op === 0 ? 0 : 1;
      return;
    }
    groups.push({ from: index, to: index, count: 1, paint, adds: item?.op === 0 ? 0 : 1 });
  });
  return groups;
}

// How many points a list of touches holds together (a tap is one).
export function pointCount(items) {
  return (items ?? []).reduce((total, item) => total + (item.pts ? item.pts.length : 1), 0);
}

// The touches as the node's `touches` widget stores them. `key` names the
// picture they were made on. No touches is the empty text.
export function encodeTouches(key, items) {
  const clean = (items ?? []).map(cleanItem).filter(Boolean);
  if (!clean.length) return "";
  return JSON.stringify({ v: 1, key: String(key ?? ""), items: clean });
}

// Whether two runs of touches are the same touches. How they are written
// decides, so a touch fresh from a click and the same one read back from the
// widget compare equal.
export function sameTouches(a, b) {
  return encodeTouches("", a) === encodeTouches("", b);
}

// Read them back. Anything that is not what encodeTouches writes gives no
// touches; the caps are the server's.
export function decodeTouches(text) {
  const nothing = { key: "", items: [] };
  if (typeof text !== "string" || !text.trim() || text.length > TOUCH_MAX_CHARS) return nothing;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return nothing;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.items)) return nothing;
  const items = [];
  let room = TOUCH_MAX_POINTS;
  for (const raw of data.items.slice(0, TOUCH_MAX_ITEMS)) {
    const item = cleanItem(raw);
    if (!item) continue;
    const points = item.pts ? item.pts.length : 1;
    if (points > room) break;
    room -= points;
    items.push(item);
  }
  return { key: typeof data.key === "string" ? data.key.slice(0, 80) : "", items };
}

// Whether one more touch still fits under the server's caps.
export function touchFits(items, item) {
  if ((items?.length ?? 0) >= TOUCH_MAX_ITEMS) return false;
  const points = item.pts ? item.pts.length : 1;
  if (pointCount(items) + points > TOUCH_MAX_POINTS) return false;
  return encodeTouches("x".repeat(80), [...items, item]).length <= TOUCH_MAX_CHARS;
}

// Add a point to a stroke being drawn, unless it is closer than `gap` to
// the last one. Returns true when added.
export function extendStroke(points, x, y, gap) {
  const last = points[points.length - 1];
  if (last) {
    const dx = x - last[0];
    const dy = y - last[1];
    if (dx * dx + dy * dy < gap * gap) return false;
  }
  points.push([x, y]);
  return true;
}

function distanceToSegment(point, from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const span = dx * dx + dy * dy;
  const along = span ? clamp(((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / span, 0, 1) : 0;
  return Math.hypot(point[0] - (from[0] + dx * along), point[1] - (from[1] + dy * along));
}

// Drop the points of a stroke that sit within `tolerance` of the line
// between their neighbours (the usual line simplification), then thin it
// evenly if it is still over `limit`. The ends always stay.
export function thinStroke(points, tolerance, limit = STROKE_MAX_POINTS) {
  if (points.length <= 2) return points.map((pair) => [pair[0], pair[1]]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const spans = [[0, points.length - 1]];
  while (spans.length) {
    const [from, to] = spans.pop();
    let worst = 0;
    let at = -1;
    for (let index = from + 1; index < to; index += 1) {
      const distance = distanceToSegment(points[index], points[from], points[to]);
      if (distance > worst) { worst = distance; at = index; }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      spans.push([from, at], [at, to]);
    }
  }
  let kept = points.filter((_, index) => keep[index]);
  if (kept.length > limit) {
    const step = (kept.length - 1) / (limit - 1);
    kept = Array.from({ length: limit }, (_, index) => kept[Math.round(index * step)]);
  }
  return kept.map((pair) => [pair[0], pair[1]]);
}

// One pass of a square grow along rows or columns: a pixel turns on when any
// pixel within `reach` of it on that line is on. Counting with a running
// total keeps it one visit per pixel however far the mask grows.
function growLines(source, width, height, reach, alongRows) {
  const out = new Uint8Array(source.length);
  const lines = alongRows ? height : width;
  const length = alongRows ? width : height;
  const step = alongRows ? 1 : width;
  for (let line = 0; line < lines; line += 1) {
    const start = alongRows ? line * width : line;
    let total = 0;
    for (let at = 0; at <= Math.min(reach, length - 1); at += 1) total += source[start + at * step];
    for (let at = 0; at < length; at += 1) {
      if (total > 0) out[start + at * step] = 1;
      const leaving = at - reach;
      if (leaving >= 0) total -= source[start + leaving * step];
      const entering = at + reach + 1;
      if (entering < length) total += source[start + entering * step];
    }
  }
  return out;
}

// Grow an on/off mask by `reach` pixels with a square brush, as the server's
// max pool does. Nothing outside the picture counts.
export function growMask(source, width, height, reach) {
  const steps = Math.max(0, Math.round(reach));
  if (!steps) return source;
  return growLines(growLines(source, width, height, steps, true), width, height, steps, false);
}

// Shrink by `reach` pixels: the grow of what is off. The picture's own edge
// does not eat into the mask.
export function shrinkMask(source, width, height, reach) {
  const steps = Math.max(0, Math.round(reach));
  if (!steps) return source;
  const off = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) off[index] = source[index] ? 0 : 1;
  const grown = growMask(off, width, height, steps);
  for (let index = 0; index < grown.length; index += 1) grown[index] = grown[index] ? 0 : 1;
  return grown;
}

// A hole is filled when it has at most this share of the picked area's
// pixels. Bigger openings stay open: the posters on a wall, a mug's handle.
export const SMALL_HOLE = 0.01;

// Fill the small gaps that lie fully inside the mask, as the server does:
// flood what is off from the picture's border; what the flood did not reach
// is a hole, and a hole is filled when it has at most `share` as many
// pixels as the mask had on. `share` of Infinity fills every hole.
export function fillHoles(source, width, height, share = SMALL_HOLE) {
  const count = source.length;
  // 0 = not seen, 1 = reached from the border, 2 = part of a hole
  const seen = new Uint8Array(count);
  const stack = [];
  let area = 0;
  for (let index = 0; index < count; index += 1) area += source[index];
  const limit = share === Infinity ? Infinity : Math.floor(area * share);
  const out = Uint8Array.from(source);
  if (!area || !(limit >= 1)) return out;
  const flood = (start, mark, members) => {
    seen[start] = mark;
    stack.push(start);
    while (stack.length) {
      const index = stack.pop();
      members?.push(index);
      const x = index % width;
      if (x > 0 && !source[index - 1] && !seen[index - 1]) { seen[index - 1] = mark; stack.push(index - 1); }
      if (x < width - 1 && !source[index + 1] && !seen[index + 1]) { seen[index + 1] = mark; stack.push(index + 1); }
      if (index >= width && !source[index - width] && !seen[index - width]) { seen[index - width] = mark; stack.push(index - width); }
      if (index < count - width && !source[index + width] && !seen[index + width]) { seen[index + width] = mark; stack.push(index + width); }
    }
  };
  const border = (index) => { if (!source[index] && !seen[index]) flood(index, 1, null); };
  for (let x = 0; x < width; x += 1) { border(x); border((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { border(y * width); border(y * width + width - 1); }
  for (let index = 0; index < count; index += 1) {
    if (source[index] || seen[index]) continue;
    const members = [];
    flood(index, 2, members);
    if (members.length <= limit) for (const member of members) out[member] = 1;
  }
  return out;
}

// Three box widths whose repeated average comes close to a Gaussian of this
// sigma (the usual construction; within a few percent of the real curve).
function boxWidths(sigma) {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let low = Math.floor(ideal);
  if (low % 2 === 0) low -= 1;
  low = Math.max(1, low);
  const high = low + 2;
  const lows = Math.round((12 * sigma * sigma - 3 * low * low - 12 * low - 9) / (-4 * low - 4));
  return [0, 1, 2].map((index) => (index < lows ? low : high));
}

// One box average along rows or columns, the edge pixel repeated past the
// border (the server pads the same way).
function boxLines(source, out, width, height, radius, alongRows) {
  const lines = alongRows ? height : width;
  const length = alongRows ? width : height;
  const step = alongRows ? 1 : width;
  const size = 2 * radius + 1;
  for (let line = 0; line < lines; line += 1) {
    const start = alongRows ? line * width : line;
    const at = (position) => source[start + Math.min(length - 1, Math.max(0, position)) * step];
    let total = 0;
    for (let position = -radius; position <= radius; position += 1) total += at(position);
    for (let position = 0; position < length; position += 1) {
      out[start + position * step] = total / size;
      total += at(position + radius + 1) - at(position - radius);
    }
  }
}

// Soften a mask by `sigma` pixels. Returns a new Float32Array.
export function softenMask(source, width, height, sigma) {
  let values = Float32Array.from(source);
  if (!(sigma > 0)) return values;
  let spare = new Float32Array(values.length);
  for (const size of boxWidths(sigma)) {
    const radius = (size - 1) / 2;
    if (radius < 1) continue;
    boxLines(values, spare, width, height, radius, true);
    boxLines(spare, values, width, height, radius, false);
  }
  spare = null;
  return values;
}

// Round off a ragged outline, as the server does: soften by `reach` pixels
// and cut the result at half again, so the edge stays hard.
export function smoothMask(source, width, height, reach) {
  if (!(reach > 0)) return source;
  const soft = softenMask(source, width, height, reach);
  const out = new Uint8Array(source.length);
  for (let index = 0; index < out.length; index += 1) out[index] = soft[index] >= 0.5 ? 1 : 0;
  return out;
}

// A pixel amount on the full picture, in preview pixels. A setting that is
// on never rounds away to nothing, or the picture would not answer it.
export function previewPixels(amount, scale) {
  const value = Number(amount) || 0;
  if (!value) return 0;
  const scaled = Math.abs(value) * (Number(scale) || 1);
  return Math.sign(value) * Math.max(1, Math.round(scaled));
}

// The mask the node would return, from the picked area and the settings on
// the node now: fill holes, smooth, grow or shrink, soften, in the server's
// order. `raw` is on/off; the amounts are in these pixels.
export function composeEdge({ raw, width, height, grow = 0, soften = 0, smooth = 0, fill = false }) {
  let mask = raw;
  if (fill) mask = fillHoles(mask, width, height);
  if (smooth > 0) mask = smoothMask(mask, width, height, smooth);
  if (grow > 0) mask = growMask(mask, width, height, grow);
  else if (grow < 0) mask = shrinkMask(mask, width, height, -grow);
  return softenMask(mask, width, height, soften);
}

// The share of the picture a mask covers, 0..1.
export function maskShare(mask) {
  if (!mask?.length) return 0;
  let total = 0;
  for (let index = 0; index < mask.length; index += 1) total += mask[index];
  return total / mask.length;
}

// Draw one stroke into an on/off mask: a round brush of `radius` dragged
// through `points` (all in the mask's own pixels). `value` 1 paints, 0
// takes away. Works row by row, so a long stroke stays cheap.
export function paintStroke(mask, width, height, points, radius, value = 1) {
  if (!points?.length) return mask;
  const reach = Math.max(0.5, radius);
  const set = value ? 1 : 0;
  const disc = (cx, cy) => {
    const top = Math.max(0, Math.ceil(cy - reach));
    const bottom = Math.min(height - 1, Math.floor(cy + reach));
    for (let y = top; y <= bottom; y += 1) {
      const half = Math.sqrt(Math.max(0, reach * reach - (y - cy) * (y - cy)));
      const left = Math.max(0, Math.ceil(cx - half));
      const right = Math.min(width - 1, Math.floor(cx + half));
      if (right >= left) mask.fill(set, y * width + left, y * width + right + 1);
    }
  };
  disc(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    // Discs no further apart than a third of the brush leave no visible
    // scallops along the line.
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, reach / 3)));
    for (let step = 1; step <= steps; step += 1) {
      disc(x0 + ((x1 - x0) * step) / steps, y0 + ((y1 - y0) * step) / steps);
    }
  }
  return mask;
}

// ---- pieces --------------------------------------------------------------
//
// The server sends the pieces of a picture as up to three pictures ("planes")
// whose colour holds one bit per piece: piece i is bit i % 24 of plane
// i // 24, the bits packed as red (0-7), green (8-15), blue (16-23). Pieces
// come smallest first.

export const PIECES_PER_PLANE = 24;

// Turn the RGBA pixels of each plane into one Uint32 per pixel.
export function packPlanes(rgbaPlanes, width, height) {
  const count = width * height;
  return rgbaPlanes.map((rgba) => {
    const bits = new Uint32Array(count);
    for (let index = 0, at = 0; index < count; index += 1, at += 4) {
      bits[index] = rgba[at] | (rgba[at + 1] << 8) | (rgba[at + 2] << 16);
    }
    return bits;
  });
}

// How many pixels each piece has. `count` is the number of pieces.
export function pieceSizes(planes, count) {
  const sizes = new Uint32Array(count);
  planes.forEach((bits, plane) => {
    const base = plane * PIECES_PER_PLANE;
    for (let index = 0; index < bits.length; index += 1) {
      let value = bits[index];
      while (value) {
        const low = value & -value;
        const piece = base + 31 - Math.clz32(low);
        if (piece < count) sizes[piece] += 1;
        value ^= low;
      }
    }
  });
  return sizes;
}

// How many pixels of each piece lie inside `mask` (on/off or soft).
export function piecesInside(planes, count, mask) {
  const inside = new Uint32Array(count);
  if (!mask) return inside;
  planes.forEach((bits, plane) => {
    const base = plane * PIECES_PER_PLANE;
    for (let index = 0; index < bits.length; index += 1) {
      let value = bits[index];
      if (!value || !(mask[index] >= 0.5)) continue;
      while (value) {
        const low = value & -value;
        const piece = base + 31 - Math.clz32(low);
        if (piece < count) inside[piece] += 1;
        value ^= low;
      }
    }
  });
  return inside;
}

// The on/off mask of one piece.
export function pieceMask(planes, piece) {
  const bits = planes[Math.floor(piece / PIECES_PER_PLANE)];
  if (!bits) return null;
  const flag = 1 << (piece % PIECES_PER_PLANE);
  const out = new Uint8Array(bits.length);
  for (let index = 0; index < bits.length; index += 1) out[index] = bits[index] & flag ? 1 : 0;
  return out;
}

// SAM 3 is "sure" of a named piece from this score up.
export const SURE = 0.85;
// A thing's name is shown from this score up. Under it the thing still
// lights up and can be picked, without a name. The node asks SAM 3 about a
// hundred words nobody typed, and a low score there is often a wrong word:
// on 22 test pictures (1137 names), 43% of the names under 0.6 were wrong,
// 20% of those from 0.7 to 0.8, and 4% of those from 0.8 up.
export const NAME_SURE = 0.8;
// A thing that is this much of the picture, or more, needs SAM 3 to be
// this sure before its name is shown: the big wrong names ("mirror" over a
// whole portrait, 0.81; "poster", 0.898) all scored under 0.9, the big
// right ones all 0.958 or more. With both rules the area under a wrong name
// went from 10.3% of a picture to 1.4%, and under a right one from 66% to 61%.
export const BIG_NAME = 0.3;
export const BIG_NAME_SURE = 0.9;

// Whether a named thing's name is shown. `sure` is SAM 3's score for the
// word, `share` how much of the picture the thing covers (0 to 1).
export function nameShown(sure, share = 0) {
  const score = Number(sure) || 0;
  return score >= ((Number(share) || 0) >= BIG_NAME ? BIG_NAME_SURE : NAME_SURE);
}
// A piece over this share of the picture is a backdrop (the sky, a wall):
// it is offered last.
export const BACKDROP = 0.4;

// A thing that is this much of a bigger thing around it is a big part of
// it: a sleeve of a jacket. A click there most likely means the jacket.
export const BIG_PART = 0.25;
// One piece lies in another when this much of it is inside.
const INSIDE = 0.9;
// Words that name a part of a thing. Only these go behind the thing they
// are part of: a sleeve behind its jacket, a car's door behind the car. A
// skirt that SAM 3 also finds as part of a "dress" is a thing of its own.
export const PART_WORDS = new Set([
  "sleeve", "shirt collar", "fur collar", "bag strap", "arm", "leg", "foot", "hand", "neck", "door", "window", "screen",
]);
// Wholes whose parts always come before them: a click on the hair or on a
// jacket does not mean the person, a click on a door does not mean the wall.
const NEVER_BEHIND = new Set(["person", "wall", "floor", "sky"]);

// How many pixels each pair of pieces shares: a count x count table, row by
// row. Only pixels where two or more pieces meet cost anything.
export function pieceOverlaps(planes, count) {
  const shared = new Uint32Array(count * count);
  const here = [];
  const pixels = planes[0]?.length ?? 0;
  for (let index = 0; index < pixels; index += 1) {
    here.length = 0;
    for (let plane = 0; plane < planes.length; plane += 1) {
      let value = planes[plane][index];
      while (value) {
        const low = value & -value;
        const piece = plane * PIECES_PER_PLANE + 31 - Math.clz32(low);
        if (piece < count) here.push(piece);
        value ^= low;
      }
    }
    for (let a = 0; a < here.length; a += 1) {
      for (let b = a + 1; b < here.length; b += 1) {
        shared[here[a] * count + here[b]] += 1;
        shared[here[b] * count + here[a]] += 1;
      }
    }
  }
  return shared;
}

// The thing each piece is a big part of, as its number, or -1. Only a named
// part SAM 3 is sure of has one: the smallest sure thing around it that it
// is a big part of. `overlaps` is the table pieceOverlaps gives; without it
// nothing is part of anything.
export function pieceWholes(list, sizes, pixels, overlaps = null) {
  const count = list.length;
  const wholes = new Int32Array(count).fill(-1);
  if (!overlaps) return wholes;
  const sure = (index) => list[index].kind === "name" && (list[index].sure ?? 0) >= SURE
    && !(pixels > 0 && (sizes[index] ?? 0) / pixels > BACKDROP);
  for (let piece = 0; piece < count; piece += 1) {
    const size = sizes[piece] ?? 0;
    if (!size || !sure(piece) || !PART_WORDS.has(list[piece].name)) continue;
    let best = -1;
    for (let other = 0; other < count; other += 1) {
      if (other === piece || !sure(other) || NEVER_BEHIND.has(list[other].name)) continue;
      const bigger = sizes[other] ?? 0;
      if (bigger <= size || size < BIG_PART * bigger || overlaps[piece * count + other] < INSIDE * size) continue;
      if (best < 0 || bigger < sizes[best]) best = other;
    }
    wholes[piece] = best;
  }
  return wholes;
}

// The order in which the pieces at one spot are offered, as one number per
// piece (lower comes first). Named pieces SAM 3 is sure of come first,
// smallest first: a jacket before the person wearing it, a skirt before the
// outfit it belongs to. A named part that is a big part of a sure thing
// around it goes right behind that thing (the sleeve behind the jacket; see
// pieceWholes). Then pieces found at a point, smallest first. Then names it
// is less sure of, surest first. Backdrops last. `list[i]` is
// { kind, name, sure }, `sizes[i]` its pixels, `overlaps` the table
// pieceOverlaps gives (without it nothing is moved behind anything).
export function pieceRanks(list, sizes, pixels, overlaps = null) {
  const count = list.length;
  const group = (index) => {
    const piece = list[index];
    const size = sizes[index] ?? 0;
    const named = piece.kind === "name";
    if (pixels > 0 && size / pixels > BACKDROP) return 3;
    if (named && (piece.sure ?? 0) >= SURE) return 0;
    return named ? 2 : 1;
  };
  const groups = Array.from({ length: count }, (_, index) => group(index));
  const bySize = (a, b) => (sizes[a] ?? 0) - (sizes[b] ?? 0) || a - b;
  const sure = [];
  const points = [];
  const unsure = [];
  const backdrops = [];
  for (let index = 0; index < count; index += 1) [sure, points, unsure, backdrops][groups[index]].push(index);
  sure.sort(bySize);
  points.sort(bySize);
  unsure.sort((a, b) => (list[b].sure ?? 0) - (list[a].sure ?? 0) || a - b);
  backdrops.sort(bySize);
  // Big parts go behind the thing they are part of.
  const wholes = pieceWholes(list, sizes, pixels, overlaps);
  const behind = new Map();
  const first = [];
  for (const piece of sure) {
    const whole = wholes[piece];
    if (whole < 0) first.push(piece);
    else behind.set(whole, [...(behind.get(whole) ?? []), piece]);
  }
  const order = [];
  const place = (piece) => {
    order.push(piece);
    for (const part of behind.get(piece) ?? []) place(part);
  };
  first.forEach(place);
  order.push(...points, ...unsure, ...backdrops);
  const ranks = new Uint16Array(count);
  order.forEach((piece, rank) => { ranks[piece] = rank; });
  return ranks;
}

// Every piece that covers pixel `index`, in the order they are offered.
export function candidatesAt(planes, index, ranks) {
  const found = [];
  for (let plane = 0; plane < planes.length; plane += 1) {
    let value = planes[plane][index];
    while (value) {
      const low = value & -value;
      found.push(plane * PIECES_PER_PLANE + 31 - Math.clz32(low));
      value ^= low;
    }
  }
  return ranks ? found.sort((a, b) => ranks[a] - ranks[b]) : found;
}

// How much of a stroke lies in each piece: `stroke` is an on/off mask of the
// stroke's own area. Returns { area, inside }: the stroke's pixels, and per
// piece how many of them it covers.
export function strokeCover(planes, count, stroke) {
  const inside = new Uint32Array(count);
  let area = 0;
  for (let index = 0; index < stroke.length; index += 1) {
    if (!stroke[index]) continue;
    area += 1;
    for (let plane = 0; plane < planes.length; plane += 1) {
      let value = planes[plane][index];
      while (value) {
        const low = value & -value;
        const piece = plane * PIECES_PER_PLANE + 31 - Math.clz32(low);
        if (piece < count) inside[piece] += 1;
        value ^= low;
      }
    }
  }
  return { area, inside };
}

// A stroke counts as lying in a piece when this much of it is inside.
export const STROKE_IN = 0.6;
// Part of a pair (one shoe of two): this much of the stroke is enough.
export const STROKE_PART = 0.2;
// A stroke takes at most this many things together.
const PAIR_MOST = 4;

// Which pieces a stroke means, in the order they are offered: the pieces
// most of the stroke lies in. A stroke that crosses two or more named
// pieces SAM 3 is sure of, which together hold most of it (a stroke across
// both shoes), also means those together, as `pair`: the fewest of them
// that hold most of the stroke. `pairAt` is the pair's place among the
// candidates: before the first one that is bigger than the pair, so both
// shoes come before the person standing in them. A big part of a candidate
// (`wholes`, from pieceWholes) is no half of a pair: a stroke over a jacket
// that crosses its sleeve means the jacket.
// Returns { candidates: [piece, ...], pair: [piece, ...] | null, pairAt }.
export function strokePieces(planes, list, sizes, pixels, stroke, ranks, wholes = null) {
  const { area, inside } = strokeCover(planes, list.length, stroke);
  const none = { candidates: [], pair: null, pairAt: 0 };
  if (!area) return none;
  const candidates = [];
  for (let piece = 0; piece < list.length; piece += 1) if (inside[piece] / area >= STROKE_IN) candidates.push(piece);
  candidates.sort((a, b) => ranks[a] - ranks[b]);
  const alone = { candidates, pair: null, pairAt: 0 };
  const parts = [];
  for (let piece = 0; piece < list.length; piece += 1) {
    const share = inside[piece] / area;
    if (share >= STROKE_IN || share < STROKE_PART) continue;
    const named = list[piece].kind === "name" && (list[piece].sure ?? 0) >= SURE;
    const backdrop = pixels > 0 && (sizes[piece] ?? 0) / pixels > BACKDROP;
    if (!named || backdrop) continue;
    if (wholes && wholes[piece] >= 0 && candidates.includes(wholes[piece])) continue;
    parts.push(piece);
  }
  if (parts.length < 2) return alone;
  // The fewest parts that hold most of the stroke, counted pixel by pixel
  // so two overlapping pieces are not counted twice.
  parts.sort((a, b) => inside[b] - inside[a] || ranks[a] - ranks[b]);
  const has = (piece, index) => planes[Math.floor(piece / PIECES_PER_PLANE)][index] & (1 << (piece % PIECES_PER_PLANE));
  const chosen = [];
  let held = 0;
  for (const piece of parts) {
    if (chosen.length >= PAIR_MOST || held / area >= STROKE_IN) break;
    let gained = 0;
    for (let index = 0; index < stroke.length; index += 1) {
      if (stroke[index] && has(piece, index) && !chosen.some((other) => has(other, index))) gained += 1;
    }
    if (!gained) continue;
    chosen.push(piece);
    held += gained;
  }
  if (chosen.length < 2 || held / area < STROKE_IN) return alone;
  let together = 0;
  for (let index = 0; index < stroke.length; index += 1) if (chosen.some((piece) => has(piece, index))) together += 1;
  const place = candidates.findIndex((piece) => (sizes[piece] ?? 0) > together);
  return { candidates, pair: chosen.sort((a, b) => ranks[a] - ranks[b]), pairAt: place < 0 ? candidates.length : place };
}

// A piece counts as already picked once nearly all of it is inside the
// picked area, and as untouched while almost none of it is.
const NEARLY = 0.03;

// Which piece a pointer at pixel `index` lights up: the first piece there,
// in the order they are offered (`ranks`; without it, smallest first), that
// would still change something. Adding, that is a piece not yet (nearly)
// all picked, so clicking the same spot again goes on from the glasses to
// the face to the person. Taking away, it is a piece that has some of the
// picked area in it. -1 when there is none.
export function pieceAt(planes, index, { sizes, inside, adding = true, ranks = null } = {}) {
  for (const piece of candidatesAt(planes, index, ranks)) {
    const size = sizes?.[piece] ?? 0;
    if (!size) continue;
    const picked = inside?.[piece] ?? 0;
    const slack = Math.max(4, size * NEARLY);
    if (adding ? size - picked > slack : picked > slack) return piece;
  }
  return -1;
}

// ---- drawing -------------------------------------------------------------

// Tint a mask onto RGBA pixels in place, as strong as the mask is at each
// pixel, with a line where the mask is half: a soft edge shows as the tint
// fading out on both sides of that line. `pixels` is cleared first.
export function paintTint(pixels, mask, width, height, { tint = TINT, outline = OUTLINE, strength = TINT_STRENGTH, line = 1, halo = HALO } = {}) {
  const count = width * height;
  const solid = new Uint8Array(count);
  let any = false;
  for (let index = 0; index < count; index += 1) {
    if (mask[index] >= 0.5) { solid[index] = 1; any = true; }
  }
  pixels.fill(0);
  if (!any && !mask.some?.((value) => value > 0)) return pixels;
  const reach = Math.max(1, Math.round(line));
  const inner = shrinkMask(solid, width, height, reach);
  const outer = halo ? growMask(solid, width, height, 1) : solid;
  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    if (solid[index] && !inner[index]) {
      pixels[at] = outline[0]; pixels[at + 1] = outline[1]; pixels[at + 2] = outline[2]; pixels[at + 3] = 255;
      continue;
    }
    const alpha = mask[index] * strength;
    if (outer[index] && !solid[index]) {
      pixels[at] = halo[0]; pixels[at + 1] = halo[1]; pixels[at + 2] = halo[2];
      pixels[at + 3] = Math.max(halo[3], Math.round(alpha * 255));
      continue;
    }
    if (alpha <= 0) continue;
    pixels[at] = tint[0]; pixels[at + 1] = tint[1]; pixels[at + 2] = tint[2];
    pixels[at + 3] = Math.round(alpha * 255);
  }
  return pixels;
}

// The other two ways to look at the picked area. "cut" keeps the picture
// where the mask is and covers the rest with a chequer; "mask" is the plain
// black and white mask. Both write a cover that goes over the picture.
// `colours` (RGBA bytes, optional) are the cut-out's own colours: with a
// fine edge the node cleans them, so a half see-through strand of hair
// carries no colour of the old background. Then the cut-out is drawn whole,
// over the chequer, and nothing of the picture shows through.
export function paintCover(pixels, mask, width, height, view, colours = null) {
  const count = width * height;
  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    const value = clamp(mask[index], 0, 1);
    if (view === "mask") {
      const level = Math.round(value * 255);
      pixels[at] = level; pixels[at + 1] = level; pixels[at + 2] = level; pixels[at + 3] = 255;
    } else {
      // A chequer where the area is not, the usual sign for see-through;
      // the picture shows through where it is.
      const x = index % width;
      const dark = (((x >> 3) + (((index - x) / width) >> 3)) & 1) === 1;
      const level = dark ? 30 : 44;
      if (colours) {
        pixels[at] = Math.round(colours[at] * value + level * (1 - value));
        pixels[at + 1] = Math.round(colours[at + 1] * value + (level + 4) * (1 - value));
        pixels[at + 2] = Math.round(colours[at + 2] * value + (level + 6) * (1 - value));
        pixels[at + 3] = 255;
        continue;
      }
      pixels[at] = level; pixels[at + 1] = level + 4; pixels[at + 2] = level + 6;
      pixels[at + 3] = Math.round((1 - value) * 255);
    }
  }
  return pixels;
}

// ---- fine edges -------------------------------------------------------------

// What the Fine edges input holds while it is off.
export const FINE_OFF = "off";

// The model file Fine edges is set to, or "" while it is off.
export function fineChoice(value) {
  const text = String(value ?? "").trim();
  return text === "" || text === FINE_OFF ? "" : text;
}

// The words for a Fine edges choice on the node's card: off, and on while
// there is one model file. With more files, each goes by its own name.
export function fineEdgeLabel(value, values = []) {
  if (fineChoice(value) === "") return "off";
  if (values.filter((other) => fineChoice(other) !== "").length <= 1) return "on";
  return String(value).split(/[\\/]/).pop().replace(/\.safetensors$/i, "");
}

// The settings a fine edge was made with, as one line. The node writes the
// same line (fine_made in nodes/node_mask_by_touch.py); the face shows a
// fine edge only while its own controls still give that line.
export function fineMade({ grow = 0, soften = 0, smooth = 0, fill = true, invert = false, fine = "" } = {}) {
  return [Math.round(grow), Math.max(0, Number(soften) || 0).toFixed(3), Math.round(smooth), fill ? 1 : 0, invert ? 1 : 0, fine].join("|");
}

// The mask in a fine edge's picture: its see-through channel, 0 to 1.
export function fineMask(rgba) {
  const mask = new Float32Array(rgba.length / 4);
  for (let index = 0, at = 3; index < mask.length; index += 1, at += 4) mask[index] = rgba[at] / 255;
  return mask;
}

// The words on the node's edge: what is picked, in plain words. `count` is
// how many touches there are, `share` how much of the picture is picked,
// and `only` says what a single touch turned out to be: "thing" (a click
// found it), "under" (a stroke found the thing under it) or "paint" (the
// stroke itself is used). `name` is the word a single named pick was found
// under.
export function readoutText({ count = 0, share = 0, only = null, name = "", waiting = false } = {}) {
  if (waiting) return "finding it";
  if (!count || !(share > 0)) return "nothing picked";
  const percent = share < 0.005 ? "under 1%" : `${Math.round(share * 100)}%`;
  if (count === 1 && name) return `${name} · ${percent} of the picture`;
  if (count === 1 && only === "thing") return `1 thing · ${percent} of the picture`;
  if (count === 1 && only === "under") return `the thing under your paint · ${percent}`;
  if (count === 1 && only === "paint") return `your paint, as it is · ${percent}`;
  return `${count} picks · ${percent} of the picture`;
}
