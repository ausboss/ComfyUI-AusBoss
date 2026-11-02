// Snap into line: the geometry behind lining a dragged node or group up with
// the ones around it. No LiteGraph here; js/snap_lines/index.js measures the
// canvas, moves the nodes and draws the lines.
//
// A rect is { x, y, w, h } in graph units. Along each axis it offers three
// lines: its start edge, its middle and its end edge. A dragged rect catches
// the nearest target line within reach on each axis, and every line it then
// shares with a target is drawn as a guide.

export const SNAP_SCREEN_PX = 8; // how near, on screen, a line must come to catch

const SAME_LINE = 0.5; // graph units: two lines this close are one line
const TIE = 1e-6;

const SPAN = { x: ["x", "w"], y: ["y", "h"] };
const ACROSS = { x: "y", y: "x" };

export function linesOf(rect, axis) {
  const [start, size] = SPAN[axis];
  return [rect[start], rect[start] + rect[size] / 2, rect[start] + rect[size]];
}

// How far apart two rects are across `axis` (0 where they overlap there).
// A target in the same row or column as the dragged rect wins a tie.
function gapAcross(a, b, axis) {
  const [start, size] = SPAN[ACROSS[axis]];
  return Math.max(0, b[start] - (a[start] + a[size]), a[start] - (b[start] + b[size]));
}

// The shortest shift along `axis` that lands one of `lines` on a line of a
// target, or null when no target line is within `reach`.
export function nearestCatch(lines, rect, targets, axis, reach) {
  let best = null;
  for (const target of targets) {
    const gap = gapAcross(rect, target, axis);
    for (const to of linesOf(target, axis)) {
      for (const from of lines) {
        const shift = to - from;
        const size = Math.abs(shift);
        if (size > reach) continue;
        const better = !best || size < best.size - TIE || (size <= best.size + TIE && gap < best.gap);
        if (better) best = { shift, size, gap };
      }
    }
  }
  return best ? best.shift : null;
}

// Where a dragged rect lands: the shift to add on each axis (0 when that axis
// caught nothing).
export function snapMove(rect, targets, reach) {
  const dx = nearestCatch(linesOf(rect, "x"), rect, targets, "x", reach);
  const dy = nearestCatch(linesOf(rect, "y"), rect, targets, "y", reach);
  return { dx: dx ?? 0, dy: dy ?? 0 };
}

// A resize moves some edges and holds the others. Each moving edge catches
// on its own; a catch that would take the rect under `min` is let go.
export function snapEdges(rect, edges, targets, reach, min = {}) {
  let { x, y, w, h } = rect;
  const minW = min.w ?? 0;
  const minH = min.h ?? 0;
  const near = (value, axis) => nearestCatch([value], rect, targets, axis, reach);
  if (edges.right) {
    const shift = near(x + w, "x");
    if (shift != null && w + shift >= minW) w += shift;
  } else if (edges.left) {
    const shift = near(x, "x");
    if (shift != null && w - shift >= minW) {
      x += shift;
      w -= shift;
    }
  }
  if (edges.bottom) {
    const shift = near(y + h, "y");
    if (shift != null && h + shift >= minH) h += shift;
  } else if (edges.top) {
    const shift = near(y, "y");
    if (shift != null && h - shift >= minH) {
      y += shift;
      h -= shift;
    }
  }
  return { x, y, w, h };
}

// The lines of a moved rect, as { axis, at, middle } for guidesFor. A resize
// passes only the edges it moved, so the edges it held draw nothing.
export function rectLines(rect, edges = null) {
  const lines = [];
  for (const axis of ["x", "y"]) {
    const [start, middle, end] = linesOf(rect, axis);
    const first = axis === "x" ? "left" : "top";
    const last = axis === "x" ? "right" : "bottom";
    if (!edges || edges[first]) lines.push({ axis, at: start, middle: false });
    if (!edges) lines.push({ axis, at: middle, middle: true });
    if (!edges || edges[last]) lines.push({ axis, at: end, middle: false });
  }
  return lines;
}

// One guide for each of `lines` that a target shares. It runs across the rect
// and every target on that line, and `marks` are where each of them meets it.
export function guidesFor(rect, targets, lines) {
  const guides = [];
  for (const { axis, at, middle } of lines) {
    if (guides.some((guide) => guide.axis === axis && Math.abs(guide.at - at) <= SAME_LINE)) continue;
    const on = targets.filter((target) => linesOf(target, axis).some((line) => Math.abs(line - at) <= SAME_LINE));
    if (!on.length) continue;
    const [start, size] = SPAN[ACROSS[axis]];
    const marks = [];
    for (const box of [rect, ...on]) marks.push(box[start], box[start] + box[size]);
    guides.push({ axis, at, middle, from: Math.min(...marks), to: Math.max(...marks), marks });
  }
  return guides;
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// A node counts as inside a group when its middle is.
export function insideAny(rect, groups) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return groups.some((group) => cx >= group.x && cx <= group.x + group.w && cy >= group.y && cy <= group.y + group.h);
}

export function unionOf(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}
