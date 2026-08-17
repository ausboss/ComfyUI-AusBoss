// Pure geometry and decision logic for the on-node padding canvases
// (Load Image + Pad, Pad Image). No DOM in here — the drawing and pointer
// wiring live in js/shared/pad_panel.mjs and the per-node entries, so this
// module stays testable under node:test.

import { clamp, resolvePadding } from "./transform_geometry.mjs";

// The whole final-rect edge is the handle; this is the grab tolerance on
// either side of it, in CSS pixels (hit zones stay larger than the drawn
// 1.5px dashed line).
export const EDGE_HIT_BAND = 16;

// A pad band thinner than this cannot host its own "+N px" label; the label
// hops inside the image onto a contrast pill instead.
export const THIN_BAND_PX = 24;

export const PAD_SIDES = ["left", "top", "right", "bottom"];

// "sub/dir\\name.png [temp]" -> { filename, subfolder, type } for a /view
// query. Handles Windows backslashes, subfolders, and the "name [type]"
// annotation ComfyUI appends outside the input folder.
export function parseImageReference(value) {
  let text = String(value ?? "").trim();
  if (!text) return null;
  let type = "input";
  const annotated = /^(.*)\s+\[(input|output|temp)\]$/i.exec(text);
  if (annotated) {
    text = annotated[1].trim();
    type = annotated[2].toLowerCase();
  }
  const normalized = text.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const filename = slash < 0 ? normalized : normalized.slice(slash + 1);
  if (!filename) return null;
  return { filename, subfolder: slash < 0 ? "" : normalized.slice(0, slash), type };
}

// Effective per-side padding and canvas size at source scale — the rect the
// canvas draws. Delegates to resolvePadding so the remainder-to-right/bottom
// rule has exactly one implementation.
export function padGeometry(sourceW, sourceH, values) {
  return resolvePadding(values, { width: Math.max(1, sourceW), height: Math.max(1, sourceH) });
}

// Final output size after the multiple AND megapixel math — what the badge
// shows ("the badge is the truth"). Mirror of plan_pad_canvas in
// nodes/_pad_helpers.py — keep the two in sync.
export function finalOutputSize(sourceW, sourceH, values) {
  const base = padGeometry(sourceW, sourceH, values);
  const target = Number(values.target_megapixels) || 0;
  if (target <= 0 || base.outputWidth <= 0 || base.outputHeight <= 0) {
    return { width: base.outputWidth, height: base.outputHeight, scale: 1 };
  }
  const scale = Math.sqrt((target * 1e6) / (base.outputWidth * base.outputHeight));
  const pad = (name) => Math.round(Math.max(0, Number(values[name]) || 0) * scale);
  const final = padGeometry(
    Math.max(1, Math.round(sourceW * scale)),
    Math.max(1, Math.round(sourceH * scale)),
    {
      ...values,
      pad_left: pad("pad_left"),
      pad_top: pad("pad_top"),
      pad_right: pad("pad_right"),
      pad_bottom: pad("pad_bottom"),
      target_megapixels: 0,
    },
  );
  return { width: final.outputWidth, height: final.outputHeight, scale };
}

// Which edge of the final rect (CSS-pixel {x, y, width, height}) the point
// grabs: the whole edge is the handle, corners resolve to the nearer edge,
// anywhere else is null so the click falls through and the node drags.
export function hitPadEdge(point, rect, band = EDGE_HIT_BAND) {
  if (!rect || !point) return null;
  const inside =
    point.x >= rect.x - band &&
    point.x <= rect.x + rect.width + band &&
    point.y >= rect.y - band &&
    point.y <= rect.y + rect.height + band;
  if (!inside) return null;
  const distances = {
    left: Math.abs(point.x - rect.x),
    right: Math.abs(point.x - (rect.x + rect.width)),
    top: Math.abs(point.y - rect.y),
    bottom: Math.abs(point.y - (rect.y + rect.height)),
  };
  let best = null;
  for (const side of PAD_SIDES) {
    if (distances[side] > band) continue;
    if (!best || distances[side] < distances[best]) best = side;
  }
  return best;
}

// New raw pad value for a drag: left/top edges move outward with negative
// deltas, right/bottom with positive. Deltas are in world (source) pixels.
export function padDragValue(side, startPads, worldDx, worldDy) {
  const start = Math.max(0, Number(startPads?.[side]) || 0);
  const delta =
    side === "left" ? -worldDx : side === "right" ? worldDx : side === "top" ? -worldDy : worldDy;
  return Math.max(0, Math.round(start + delta));
}

export function edgeCursor(side) {
  if (side === "left" || side === "right") return "ew-resize";
  if (side === "top" || side === "bottom") return "ns-resize";
  return "";
}

// Where a side's "+N px" label lives: on the band when it is thick enough to
// read, hopped onto a contrast pill inside the image when it is thin.
export function labelMode(bandCssPx, threshold = THIN_BAND_PX) {
  return (Number(bandCssPx) || 0) >= threshold ? "band" : "pill";
}

// Panel height coupled to node width: wide node, taller stage, within reason.
export function canvasHeightForWidth(width) {
  return Math.round(clamp((Number(width) || 0) * 0.66, 180, 520));
}

// Aspect-fit a world rect into a view with a uniform margin; returns the
// scale and the view-space origin of the world rect.
export function fitRect(worldW, worldH, viewW, viewH, margin = 26) {
  const availW = Math.max(1, viewW - margin * 2);
  const availH = Math.max(1, viewH - margin * 2);
  const scale = Math.max(0.001, Math.min(availW / Math.max(1, worldW), availH / Math.max(1, worldH)));
  return { scale, x: (viewW - worldW * scale) / 2, y: (viewH - worldH * scale) / 2 };
}

// Two-state empty-state copy for the execution-fed panel.
export function padEmptyStateText(wired) {
  return wired ? "Run once to preview" : "Connect an image";
}

// Pull the input-frame preview out of a Pad Image onExecuted payload:
// { filename, subfolder, type, width, height } or null. width/height are
// the TRUE source dimensions (the temp preview may be a thumbnail).
export function findPadPreview(message) {
  const ref = message?.ausboss_pad_preview?.[0] ?? null;
  const size = message?.ausboss_pad_source?.[0] ?? null;
  if (!ref?.filename || !Array.isArray(size) || size.length < 2) return null;
  const width = Math.round(Number(size[0]) || 0);
  const height = Math.round(Number(size[1]) || 0);
  if (width < 1 || height < 1) return null;
  return {
    filename: String(ref.filename),
    subfolder: String(ref.subfolder || ""),
    type: String(ref.type || "temp"),
    width,
    height,
  };
}
