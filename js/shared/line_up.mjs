// Line up, same size and even spacing for a selection of nodes and groups.
// No LiteGraph here; js/line_up/index.js reads the selection and moves it.
//
// A rect is { x, y, w, h } in graph units: the outline people see, title bar
// included. Each function returns one result per rect, in the order given.

import { unionOf } from "./snap_lines.mjs";

export const LINE_UP = ["left", "middleX", "right", "top", "middleY", "bottom"];
export const SAME_SIZE = ["widest", "narrowest", "tallest", "shortest"];
export const SPACING = ["across", "down"];

// Where each rect goes, as { x, y }, so they all share one edge or middle.
// Edges line up on the outermost edge of the selection, middles on its middle.
export function lineUp(rects, how) {
  const bounds = unionOf(rects);
  if (!bounds) return [];
  return rects.map((rect) => {
    switch (how) {
      case "left":
        return { x: bounds.x, y: rect.y };
      case "middleX":
        return { x: bounds.x + bounds.w / 2 - rect.w / 2, y: rect.y };
      case "right":
        return { x: bounds.x + bounds.w - rect.w, y: rect.y };
      case "top":
        return { x: rect.x, y: bounds.y };
      case "middleY":
        return { x: rect.x, y: bounds.y + bounds.h / 2 - rect.h / 2 };
      case "bottom":
        return { x: rect.x, y: bounds.y + bounds.h - rect.h };
      default:
        return { x: rect.x, y: rect.y };
    }
  });
}

// The size each rect takes, as { w, h }, so they share the width or height of
// the widest, narrowest, tallest or shortest one.
export function sameSize(rects, how) {
  if (!rects.length) return [];
  const widths = rects.map((rect) => rect.w);
  const heights = rects.map((rect) => rect.h);
  const w = how === "widest" ? Math.max(...widths) : how === "narrowest" ? Math.min(...widths) : null;
  const h = how === "tallest" ? Math.max(...heights) : how === "shortest" ? Math.min(...heights) : null;
  return rects.map((rect) => ({ w: w ?? rect.w, h: h ?? rect.h }));
}

// Nodes never end up on top of each other: a gap under this, overlaps
// included, becomes this, and the selection grows from its first edge.
export const MIN_GAP = 20;

// Equal gaps between the rects along one axis, as { x, y } per rect. They keep
// their order (by middle) and the selection keeps its outer edges, unless the
// gaps would come out under MIN_GAP. Fewer than three rects stay put.
export function spreadEvenly(rects, axis) {
  const [start, size] = axis === "across" ? ["x", "w"] : ["y", "h"];
  const out = rects.map((rect) => ({ x: rect.x, y: rect.y }));
  if (rects.length < 3) return out;
  const order = rects.map((rect, index) => index).sort((a, b) => {
    const middle = (rect) => rect[start] + rect[size] / 2;
    return middle(rects[a]) - middle(rects[b]) || rects[a][start] - rects[b][start];
  });
  const first = Math.min(...rects.map((rect) => rect[start]));
  const last = Math.max(...rects.map((rect) => rect[start] + rect[size]));
  const filled = rects.reduce((sum, rect) => sum + rect[size], 0);
  const gap = Math.max(MIN_GAP, (last - first - filled) / (rects.length - 1));
  let at = first;
  for (const index of order) {
    out[index][start] = at;
    at += rects[index][size] + gap;
  }
  return out;
}

// How many rects each kind of tool needs before it can do anything.
export function enoughFor(kind, count) {
  return kind === "spacing" ? count >= 3 : count >= 2;
}

// One node of a selection is being resized: every other one takes its width.
// `starts` are where the others were when the button went down, as
// { x, w, least } (least is the narrowest that node can be). A pull on the
// left edge keeps each right edge where it was; any other pull keeps each
// left edge. Returns { x, w } per start, in the order given.
export function matchWidth(width, starts, { fromLeft = false } = {}) {
  return starts.map(({ x, w, least = 0 }) => {
    const next = Math.max(width, least);
    return { x: fromLeft ? x + w - next : x, w: next };
  });
}

// Which sizes a selection shares when one of it is resized, read from how it
// is laid out: nodes stacked in a column share a width, nodes side by side in
// a row share a height, and a grid shares both. A loose scatter shares a
// width, the way a column does.
export function sharedSides(rects) {
  const span = (a, b, start, size) => a[start] < b[start] + b[size] && b[start] < a[start] + a[size];
  let column = false;
  let row = false;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const sameX = span(rects[i], rects[j], "x", "w");
      const sameY = span(rects[i], rects[j], "y", "h");
      if (sameX && !sameY) column = true;
      if (sameY && !sameX) row = true;
    }
  }
  return { width: column || !row, height: row };
}
