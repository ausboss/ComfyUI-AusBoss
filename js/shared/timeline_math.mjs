// Frame arithmetic for the video timeline (playhead, IN/OUT, kept frames).
//
// The backend keeps a frame when its presentation time t satisfies
// start - EPS <= t <= end - EPS (nodes/_video_load_helpers.decode_video_range,
// end 0 meaning the source's end), then thins by every_nth, caps at
// max_frames and snaps the count. Everything here mirrors those rules, so
// the frame the timeline shows for IN is the first frame a run keeps, the
// frame it shows for OUT is the last one, and a drag writes seconds that
// round-trip to the same frames. No DOM, no ComfyUI imports: tested in
// tests/timeline_math.test.mjs.

import { snapFrameCount } from "../load_video/trim_preview.mjs";

// nodes/_video_load_helpers._TIME_EPSILON
export const TRIM_EPSILON = 1e-4;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// The counts the rail works in. A source that declares no frame count is
// estimated from its duration, matching nodes/_media_helpers.video_metadata.
export function clipInfo(metadata) {
  const fps = finite(metadata?.fps) > 0 ? finite(metadata.fps) : 0;
  const duration = finite(metadata?.duration) > 0 ? finite(metadata.duration) : 0;
  let count = Math.floor(finite(metadata?.frame_count));
  if (count <= 0 && fps > 0 && duration > 0) count = Math.max(1, Math.round(duration * fps));
  return { fps, duration, count: Math.max(0, count) };
}

export function clampFrame(index, info) {
  if (!info?.count) return 0;
  return clamp(Math.round(finite(index)), 0, info.count - 1);
}

export function frameTime(index, info) {
  return info?.fps > 0 ? clampFrame(index, info) / info.fps : 0;
}

// First and last kept frame for a start/end pair in seconds - the frames
// the backend's inclusion rule selects.
export function frameWindow(info, startSeconds, endSeconds) {
  const { fps, count } = info;
  if (!count || !fps) return { first: 0, last: Math.max(0, count - 1) };
  const start = Math.max(0, finite(startSeconds));
  const end = finite(endSeconds) > 0 ? finite(endSeconds) : 0;
  const first = clamp(Math.ceil((start - TRIM_EPSILON) * fps), 0, count - 1);
  const last = end > 0 ? clamp(Math.floor((end - TRIM_EPSILON) * fps), first, count - 1) : count - 1;
  return { first, last };
}

// The seconds to store for a first/last frame pair. The frontend rounds
// these FLOAT widgets to hundredths (their step), so the values are chosen
// on that grid: IN is the largest hundredth that still keeps `first`, OUT
// the smallest that still keeps `last` and drops the frame after it. Both
// resolve back to the same frames under the backend's rule, and a window
// that reaches the source's end stores 0 so the whole tail always stays in.
export const SECONDS_GRID = 0.01;

function gridFloor(value) { return Math.round(Math.floor(value / SECONDS_GRID + 1e-9) * SECONDS_GRID * 1e6) / 1e6; }
function gridCeil(value) { return Math.round(Math.ceil(value / SECONDS_GRID - 1e-9) * SECONDS_GRID * 1e6) / 1e6; }

export function windowSeconds(info, first, last) {
  const { fps, count } = info;
  if (!fps || !count) return { start_seconds: 0, end_seconds: 0 };
  const head = clamp(Math.round(finite(first)), 0, count - 1);
  const tail = clamp(Math.round(finite(last)), head, count - 1);
  return {
    start_seconds: head === 0 ? 0 : Math.max(0, gridFloor(head / fps + TRIM_EPSILON)),
    end_seconds: tail >= count - 1 ? 0 : gridCeil(tail / fps + TRIM_EPSILON),
  };
}

// The rail spans frames 0..count-1 as equal cells. A frame's cell starts at
// index/count; the boundary after the last frame is at 1.
export function frameAtFraction(fraction, info) {
  if (!info?.count) return 0;
  return clamp(Math.floor(clamp(finite(fraction), 0, 1) * info.count), 0, info.count - 1);
}

// Boundaries sit between cells (0..count): what IN/OUT handles snap to.
export function boundaryAtFraction(fraction, info) {
  if (!info?.count) return 0;
  return clamp(Math.round(clamp(finite(fraction), 0, 1) * info.count), 0, info.count);
}

export function fractionOfFrame(index, info, edge = "start") {
  if (!info?.count) return 0;
  const offset = edge === "end" ? 1 : edge === "center" ? 0.5 : 0;
  return clamp((clampFrame(index, info) + offset) / info.count, 0, 1);
}

// Move one trim edge to a boundary. IN can climb to OUT's frame and OUT can
// drop to IN's, so a one-frame window is the floor.
export function dragTrimBoundary(window, edge, boundary, info) {
  if (!info?.count) return { first: 0, last: 0 };
  const point = clamp(Math.round(finite(boundary)), 0, info.count);
  let { first, last } = window;
  if (edge === "start") first = clamp(point, 0, last);
  else last = clamp(point - 1, first, info.count - 1);
  return { first, last };
}

// Move one trim edge to a frame (typed or stepped values).
export function setTrimFrame(window, edge, index, info) {
  if (!info?.count) return { first: 0, last: 0 };
  const frame = clampFrame(index, info);
  let { first, last } = window;
  if (edge === "start") first = Math.min(frame, last);
  else last = Math.max(frame, first);
  return { first, last };
}

// Fixed length is measured at OUTPUT fps, but the handles sit on source frames.
// Keep the requested count exact: an oversized request is invalid, not truncated.
export function fixedFrameWindow(info, first, frames, outputFps) {
  if (frames === null) return { unresolved: true };
  const count = Math.max(0, Math.trunc(finite(frames)));
  if (!count) return null;
  if (!(outputFps > 0) || !(info?.fps > 0) || !info.count) return { frames: count, unresolved: true };
  const seconds = count / outputFps;
  const duration = info.duration || info.count / info.fps;
  const tooLong = seconds > duration + 1e-7;
  const span = Math.max(1, Math.ceil(seconds * info.fps - 1e-7));
  const latest = Math.max(0, Math.floor((duration - seconds) * info.fps + 1e-7));
  const head = clamp(Math.round(finite(first)), 0, Math.min(latest, Math.max(0, info.count - span)));
  return { first: head, last: Math.min(info.count - 1, head + span - 1), frames: count, seconds, tooLong };
}

// What a run keeps out of the window after thinning, the cap and the snap
// rule (the backend's decode_video_range + snap_frame_count), and the index
// of the last frame that actually reaches the output.
export function keptFrames(window, everyNth = 1, maxFrames = 0, frameSnap = "free") {
  const nth = Math.max(1, Math.floor(finite(everyNth, 1)) || 1);
  const cap = Math.max(0, Math.floor(finite(maxFrames)));
  const span = Math.max(0, window.last - window.first + 1);
  let frames = Math.ceil(span / nth);
  if (cap > 0) frames = Math.min(frames, cap);
  frames = snapFrameCount(frames, frameSnap);
  return {
    frames,
    total: span,
    nth,
    lastKept: frames > 0 ? window.first + (frames - 1) * nth : window.first,
    cut: frames < span,
  };
}

// Where the frame after the last kept one begins, as a rail fraction: the
// end of the bright part of the span.
export function keptEndFraction(window, kept, info) {
  return fractionOfFrame(kept.lastKept, info, "end");
}

// Playback rate for a label, trimmed of float noise: 24 -> "24",
// 23.976023... -> "23.976".
export function formatFps(value) {
  const fps = finite(value);
  return fps > 0 ? String(Number(fps.toFixed(3))) : "0";
}

// The keyboard step for a trim handle: one second of frames, or a single
// frame with Shift held (the fine step, as everywhere in the pack).
export function keyboardStep(info, fine) {
  if (fine || !(info?.fps > 0)) return 1;
  return Math.max(1, Math.round(info.fps));
}
