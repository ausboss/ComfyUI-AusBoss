export const MIN_CROP_SIZE = 8;

export const IDENTITY_TRANSFORM = Object.freeze({
  rotation_degrees: 0,
  crop_aspect_ratio: "free",
  crop_x: 0,
  crop_y: 0,
  crop_width: 0,
  crop_height: 0,
  pad_left: 0,
  pad_top: 0,
  pad_right: 0,
  pad_bottom: 0,
  // Feather defaults on: with zero padding/rotation there is no generated
  // area, so it is a no-op until the mask has something to soften.
  feather: 24,
  canvas_multiple: 1,
  fill_color: "#808080",
});

export function resetTransformValues(includeTimeline = false) {
  return includeTimeline
    ? { ...IDENTITY_TRANSFORM, seek_mode: "frame index", frame_index: 0, frame_time: 0 }
    : { ...IDENTITY_TRANSFORM };
}

// What Reset returns to: the node's own declared defaults (the clip node
// ships a black fill and feather 0 for video outpaint, the image nodes grey
// and 24) laid over the shared identity for anything the definition lacks.
export function declaredTransformDefaults(nodeData, includeTimeline = false) {
  const base = resetTransformValues(includeTimeline);
  const groups = nodeData?.input;
  if (!groups || typeof groups !== "object") return base;
  for (const name of Object.keys(base)) {
    const spec = groups.required?.[name] ?? groups.optional?.[name];
    const declared = Array.isArray(spec) ? spec[1]?.default : undefined;
    if (declared !== undefined && declared !== null) base[name] = declared;
  }
  return base;
}

export function sourceChanged(previousKey, nextKey, ready = true) {
  return Boolean(ready && nextKey && previousKey !== nextKey);
}

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

// Matches Pillow's Image.rotate(expand=True) output size exactly, verified
// against PIL across 6776 size/angle combinations. Pillow transposes at the
// axis angles (no ceil/floor growth) and otherwise takes ceil(max)-floor(min)
// of the corner extents using cos/sin rounded to 15 decimals. Keep in sync
// with nodes/_transform_engine.py, which delegates to Pillow.
export function rotatedSize(width, height, degrees) {
  const normalized = ((Number(degrees) || 0) % 360 + 360) % 360;
  if (normalized === 0 || normalized === 180) return { width: Math.max(1, width), height: Math.max(1, height) };
  if (normalized === 90 || normalized === 270) return { width: Math.max(1, height), height: Math.max(1, width) };
  const radians = normalized * Math.PI / 180;
  const round15 = (value) => Math.round(value * 1e15) / 1e15;
  const cosine = round15(Math.cos(radians));
  const sine = round15(Math.sin(radians));
  const centerX = width / 2;
  const centerY = height / 2;
  const xs = [];
  const ys = [];
  for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) {
    xs.push(centerX + (x - centerX) * cosine - (y - centerY) * sine);
    ys.push(centerY + (x - centerX) * sine + (y - centerY) * cosine);
  }
  return {
    width: Math.max(1, Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs))),
    height: Math.max(1, Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys))),
  };
}

export function parseAspectRatio(value, source) {
  if (!value || value === "free") return null;
  if (value === "source") return source.width / source.height;
  const parts = String(value).split(":").map(Number);
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part) || part <= 0)) return null;
  return parts[0] / parts[1];
}

export function resolveCrop(values, source) {
  const x = Math.round(clamp(values.crop_x, 0, Math.max(0, source.width - 1)));
  const y = Math.round(clamp(values.crop_y, 0, Math.max(0, source.height - 1)));
  let width = Number(values.crop_width) > 0 ? Number(values.crop_width) : source.width - x;
  let height = Number(values.crop_height) > 0 ? Number(values.crop_height) : source.height - y;
  width = Math.max(1, Math.min(Math.round(width), source.width - x));
  height = Math.max(1, Math.min(Math.round(height), source.height - y));
  const ratio = parseAspectRatio(values.crop_aspect_ratio, source);
  if (ratio) {
    if (width / height > ratio) width = Math.max(1, Math.floor(height * ratio));
    else height = Math.max(1, Math.floor(width / ratio));
  }
  return { x, y, width, height };
}

export function resolvePadding(values, crop) {
  const left = Math.max(0, Math.round(Number(values.pad_left) || 0));
  const top = Math.max(0, Math.round(Number(values.pad_top) || 0));
  const right = Math.max(0, Math.round(Number(values.pad_right) || 0));
  const bottom = Math.max(0, Math.round(Number(values.pad_bottom) || 0));
  const multiple = Math.max(1, Math.round(Number(values.canvas_multiple) || 1));
  const requestedWidth = crop.width + left + right;
  const requestedHeight = crop.height + top + bottom;
  const outputWidth = Math.ceil(requestedWidth / multiple) * multiple;
  const outputHeight = Math.ceil(requestedHeight / multiple) * multiple;
  return {
    left,
    top,
    right: right + outputWidth - requestedWidth,
    bottom: bottom + outputHeight - requestedHeight,
    outputWidth,
    outputHeight,
  };
}

// Fit actions replace previous crop/padding, but retain rotation, fill and
// resize settings. Padding must unlock the INNER crop or the backend would
// trim the source before adding the new outer canvas.
export function fitSourceToAspect(source, aspect, mode = "crop") {
  const ratio = parseAspectRatio(aspect, source);
  const patch = {
    crop_aspect_ratio: mode === "pad" ? "free" : aspect,
    crop_x: 0, crop_y: 0, crop_width: source.width, crop_height: source.height,
    pad_left: 0, pad_top: 0, pad_right: 0, pad_bottom: 0,
  };
  if (!ratio || aspect === "source") return patch;
  if (mode === "pad") {
    const width = Math.max(source.width, Math.ceil(source.height * ratio));
    const height = Math.max(source.height, Math.ceil(source.width / ratio));
    patch.pad_left = Math.floor((width - source.width) / 2);
    patch.pad_right = width - source.width - patch.pad_left;
    patch.pad_top = Math.floor((height - source.height) / 2);
    patch.pad_bottom = height - source.height - patch.pad_top;
  } else {
    const crop = resolveCrop(patch, source);
    // Leave one dimension open so rounding is applied exactly once when
    // the backend resolves this centered crop.
    if (source.width / source.height > ratio) {
      patch.crop_x = Math.floor((source.width - crop.width) / 2);
      patch.crop_width = 0;
    } else {
      patch.crop_y = Math.floor((source.height - crop.height) / 2);
      patch.crop_height = 0;
    }
  }
  return patch;
}

export function canvasLocalPoint(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, canvas.clientWidth || bounds.width || 1);
  const height = Math.max(1, canvas.clientHeight || bounds.height || 1);
  return {
    x: ((event.clientX - bounds.left) / Math.max(1, bounds.width || width)) * width,
    y: ((event.clientY - bounds.top) / Math.max(1, bounds.height || height)) * height,
  };
}

export function cropHandleCenters(rect) {
  const middleX = rect.x + rect.width / 2;
  const middleY = rect.y + rect.height / 2;
  return [
    { name: "nw", x: rect.x, y: rect.y },
    { name: "n", x: middleX, y: rect.y },
    { name: "ne", x: rect.x + rect.width, y: rect.y },
    { name: "e", x: rect.x + rect.width, y: middleY },
    { name: "se", x: rect.x + rect.width, y: rect.y + rect.height },
    { name: "s", x: middleX, y: rect.y + rect.height },
    { name: "sw", x: rect.x, y: rect.y + rect.height },
    { name: "w", x: rect.x, y: middleY },
  ];
}

export function paddingHandleCenters(rect, offset = 38) {
  return [
    { name: "pad_top", x: rect.x + rect.width / 2, y: rect.y - offset },
    { name: "pad_right", x: rect.x + rect.width + offset, y: rect.y + rect.height / 2 },
    { name: "pad_bottom", x: rect.x + rect.width / 2, y: rect.y + rect.height + offset },
    { name: "pad_left", x: rect.x - offset, y: rect.y + rect.height / 2 },
  ];
}

export function nearestHandle(point, groups) {
  let selected = null;
  for (const group of groups) {
    for (const handle of group.handles) {
      const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
      if (distance > group.radius) continue;
      if (!selected || distance < selected.distance || (distance === selected.distance && group.priority < selected.priority)) {
        selected = { ...handle, kind: group.kind, distance, priority: group.priority };
      }
    }
  }
  return selected;
}

export function resizeCrop(start, handle, dx, dy, source, aspectRatio = null) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_CROP_SIZE);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_CROP_SIZE, source.width);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_CROP_SIZE);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_CROP_SIZE, source.height);
  if (aspectRatio) {
    let width = right - left;
    let height = bottom - top;
    if (Math.abs(dx) >= Math.abs(dy)) height = width / aspectRatio;
    else width = height * aspectRatio;
    if (handle.includes("w")) left = right - width; else right = left + width;
    if (handle.includes("n")) top = bottom - height; else bottom = top + height;
    if (left < 0) { right -= left; left = 0; }
    if (top < 0) { bottom -= top; top = 0; }
    if (right > source.width) { left -= right - source.width; right = source.width; }
    if (bottom > source.height) { top -= bottom - source.height; bottom = source.height; }
  }
  return {
    x: Math.round(clamp(left, 0, source.width - MIN_CROP_SIZE)),
    y: Math.round(clamp(top, 0, source.height - MIN_CROP_SIZE)),
    width: Math.round(Math.max(MIN_CROP_SIZE, Math.min(right - left, source.width))),
    height: Math.round(Math.max(MIN_CROP_SIZE, Math.min(bottom - top, source.height))),
  };
}

export function zoomAround(view, nextZoom, anchor) {
  const zoom = clamp(nextZoom, 0.2, 6);
  const ratio = zoom / view.zoom;
  return {
    zoom,
    panX: anchor.x - (anchor.x - view.panX) * ratio,
    panY: anchor.y - (anchor.y - view.panY) * ratio,
  };
}

// Compact-panel stage height for a node width: a wider node earns a taller
// stage, clamped so the panel neither collapses nor swallows the graph.
export function stageHeightForWidth(width) {
  return Math.round(clamp((Number(width) || 0) * 0.66, 200, 520));
}

// Stage-size-aware handle geometry shared by the editor stage and the
// compact node panel. Large stages keep the editor's classic offsets; small
// stages pull the outboard handles (padding diamonds, rotate knob) inward,
// and the fit margin never drops below the clearance those handles need to
// stay fully visible. Drawn handle sizes are constant CSS pixels on every
// surface; hit radii stay ~2-3x the drawn size.
export function stageHandleLayout(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const short = Math.min(safeWidth, safeHeight);
  const padOffset = Math.round(clamp(short * 0.09, 16, 38));
  const rotateArm = Math.round(clamp(short * 0.085, 14, 34));
  // Pad diamond half-diagonal is ~11px, the knob radius 13px plus stroke.
  const clearance = Math.max(padOffset + 12, rotateArm + 15);
  const margin = Math.max(clearance, Math.min(90, safeWidth * 0.1, safeHeight * 0.1));
  return { padOffset, rotateArm, margin };
}

// JS mirror of nodes/_transform_engine.py scale_to_megapixels, so the
// editor can show the exact size the backend will produce. Budget is
// megapixels * 1024 * 1024 (core Scale Image to Total Pixels semantics);
// each dimension rounds independently to a multiple of steps, never below
// one step. Keep the two in sync.
export function scaleToMegapixels(width, height, megapixels, steps = 1) {
  const sourceWidth = Math.max(1, Math.round(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 1));
  const total = Math.max(1, (Number(megapixels) || 1) * 1024 * 1024);
  const scale = Math.sqrt(total / (sourceWidth * sourceHeight));
  const step = Math.max(1, Math.round(Number(steps) || 1));
  return {
    width: Math.max(step, Math.round((sourceWidth * scale) / step) * step),
    height: Math.max(step, Math.round((sourceHeight * scale) / step) * step),
  };
}

// --- Aspect lock ------------------------------------------------------------
// A locked format chip keeps the output canvas (crop plus padding) at one
// ratio through every handle gesture. The axis a gesture moved is the
// driver; the other axis's padding follows, split over its two sides and
// never below zero. When the follower cannot give enough, the driver's own
// padding grows instead - a crop pulled inward gets fill back, so the canvas
// keeps its shape and the model paints what was cut - and when nothing can
// shrink, the smallest canvas that holds the crop at the ratio wins.

function nonNegative(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function paddingOf(values) {
  return {
    left: nonNegative(values.pad_left),
    top: nonNegative(values.pad_top),
    right: nonNegative(values.pad_right),
    bottom: nonNegative(values.pad_bottom),
  };
}

// Spread `delta` over an axis's two sides, half each, clamped at zero; null
// when the pair cannot absorb a shrink that large.
function splitDelta(delta, first, second) {
  if (first + second + delta < 0) return null;
  const half = Math.floor(delta / 2);
  let a = first + half;
  let b = second + (delta - half);
  if (a < 0) { b += a; a = 0; }
  if (b < 0) { a += b; b = 0; }
  return [a, b];
}

// A canvas already counts as on-ratio when either side is the rounded
// counterpart of the other, so a solved state - or the ceil-padded canvas a
// format chip produced - is a fixed point and never creeps by a pixel.
function onRatio(width, height, ratio) {
  return width === Math.round(height * ratio) || height === Math.round(width / ratio);
}

function solveAxis(axis, pads, crop, ratio) {
  const width = crop.width + pads.left + pads.right;
  const height = crop.height + pads.top + pads.bottom;
  if (onRatio(width, height, ratio)) return { ...pads };
  if (axis === "x") {
    const pair = splitDelta(Math.round(height * ratio) - width, pads.left, pads.right);
    return pair ? { ...pads, left: pair[0], right: pair[1] } : null;
  }
  const pair = splitDelta(Math.round(width / ratio) - height, pads.top, pads.bottom);
  return pair ? { ...pads, top: pair[0], bottom: pair[1] } : null;
}

function fitAround(crop, ratio) {
  const width = Math.max(crop.width, Math.ceil(crop.height * ratio));
  const height = Math.max(crop.height, Math.ceil(crop.width / ratio));
  const left = Math.floor((width - crop.width) / 2);
  const top = Math.floor((height - crop.height) / 2);
  return { left, top, right: width - crop.width - left, bottom: height - crop.height - top };
}

export function paddingAxis(name) {
  return name === "pad_left" || name === "pad_right" ? "x" : "y";
}

// Padding values that hold `ratio` (width / height) around the resolved
// `crop`, changing the follower of `driver` first. Null for no ratio.
export function lockPadding(values, crop, ratio, driver = "x") {
  if (!(ratio > 0) || !(crop?.width > 0) || !(crop?.height > 0)) return null;
  const pads = paddingOf(values);
  const follower = driver === "y" ? "x" : "y";
  let solved = solveAxis(follower, pads, crop, ratio) ?? solveAxis(driver, pads, crop, ratio);
  if (!solved) {
    const base = driver === "x" ? { ...pads, top: 0, bottom: 0 } : { ...pads, left: 0, right: 0 };
    solved = solveAxis(follower, base, crop, ratio) ?? solveAxis(driver, base, crop, ratio) ?? fitAround(crop, ratio);
  }
  return { pad_left: solved.left, pad_top: solved.top, pad_right: solved.right, pad_bottom: solved.bottom };
}

// The least a padding side can be dragged to under the lock: the other
// axis must still fit its crop with no padding at all. Below this the
// handle simply stops.
export function lockedPadMinimum(values, crop, ratio, name) {
  if (!(ratio > 0) || !(crop?.width > 0) || !(crop?.height > 0)) return 0;
  const pads = paddingOf(values);
  if (paddingAxis(name) === "y") {
    const other = name === "pad_top" ? pads.bottom : pads.top;
    return Math.max(0, Math.ceil(crop.width / ratio) - crop.height - other);
  }
  const other = name === "pad_left" ? pads.right : pads.left;
  return Math.max(0, Math.ceil(crop.height * ratio) - crop.width - other);
}

// --- Source changes -----------------------------------------------------------
// A new source keeps the canvas style (fill, feather, canvas multiple) and
// whatever a lit format chip asked for: those describe the job, not the old
// pixels. Only what was measured against the old source goes back to
// identity: rotation, crop, padding - and the playhead when asked.
export const SOURCE_GEOMETRY_KEYS = Object.freeze([
  "rotation_degrees", "crop_aspect_ratio", "crop_x", "crop_y", "crop_width", "crop_height",
  "pad_left", "pad_top", "pad_right", "pad_bottom",
]);

export function sourceResetValues(includeTimeline = false) {
  const defaults = resetTransformValues(includeTimeline);
  const keys = includeTimeline ? [...SOURCE_GEOMETRY_KEYS, "seek_mode", "frame_index", "frame_time"] : [...SOURCE_GEOMETRY_KEYS];
  return Object.fromEntries(keys.map((name) => [name, defaults[name]]));
}
