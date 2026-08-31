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
