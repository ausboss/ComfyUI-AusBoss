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
  const latestStart = Math.min(latest, Math.max(0, info.count - span));
  const head = clamp(Math.round(finite(first)), 0, latestStart);
  return { first: head, last: Math.min(info.count - 1, head + span - 1), frames: count, seconds, tooLong, latestStart };
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

// --- One way to set the length ---------------------------------------------
// The clip node's face sets how long the output is in exactly one of these
// ways, and the rail only offers the one in charge:
//   "free"   IN -> OUT: the OUT handle ends the clip.
//   "length" Length on: a frame count from IN, stored as max_frames with an
//            open end, so OUT follows IN and the count survives a new source.
//   "fixed"  a fixed_frames value saved by an older face: an exact window.
//            The first edit turns it into a Length.
//   "wired"  a connected fixed_frames, frame_load_cap or max_frames input
//            decides the length; only IN is left to set.
export function lengthMode({ maxFrames = 0, fixedFrames = 0, wired = null } = {}) {
  if (wired) return "wired";
  if (Math.trunc(finite(fixedFrames)) > 0) return "fixed";
  if (Math.trunc(finite(maxFrames)) > 0) return "length";
  return "free";
}

// The n in a "<n>n+1" snap rule (8 for LTX, 4 for Wan); 1 for free.
export function snapStep(rule) {
  const match = /^\s*(\d+)\s*n\s*\+\s*1\s*$/i.exec(String(rule ?? ""));
  const step = match ? Number(match[1]) : 1;
  return step > 0 ? step : 1;
}

// A count the snap rule keeps (step * n + 1, at least 1). Direction 0 takes
// the nearest, 1 the next at or above, -1 the next at or below - so a stepper
// arrow always moves to a new valid count instead of rounding back.
export function snapToValid(count, rule, direction = 0) {
  const step = snapStep(rule);
  const value = Math.max(1, Math.round(finite(count, 1)));
  if (step <= 1) return value;
  const below = Math.floor((value - 1) / step) * step + 1;
  const above = below === value ? value : below + step;
  if (direction > 0) return above;
  if (direction < 0) return below;
  return value - below <= above - value ? below : above;
}

// How many frames a run outputs from `first` through source frame `target`:
// one in every nth, then the snap rule (never below one frame).
export function framesThrough(first, target, everyNth = 1, frameSnap = "free") {
  const nth = Math.max(1, Math.floor(finite(everyNth, 1)) || 1);
  const span = Math.max(1, Math.round(finite(target)) - Math.round(finite(first)) + 1);
  return Math.max(1, snapFrameCount(Math.ceil(span / nth), frameSnap));
}

// The source frame the last of `frames` output frames from `first` sits on.
export function lastFrameFor(first, frames, everyNth = 1) {
  const nth = Math.max(1, Math.floor(finite(everyNth, 1)) || 1);
  return Math.round(finite(first)) + (Math.max(1, Math.trunc(finite(frames, 1))) - 1) * nth;
}

// The latest IN that still fits a Length of `frames` inside the source, so
// dragging a locked window to the end stops there instead of shortening it.
export function latestFirstFor(info, frames, everyNth = 1) {
  if (!info?.count) return 0;
  return Math.max(0, info.count - 1 - (lastFrameFor(0, frames, everyNth)));
}

// How far a drag can move IN while a Length is on. A Length that fits stops
// IN where OUT meets the source's end, so the count stays whole. A Length
// as long as the clip or longer cannot keep its count anywhere: it only caps
// the clip, the source's end is OUT, and IN moves over the whole clip.
export function latestInFor(info, frames, everyNth = 1) {
  if (!info?.count) return 0;
  const latest = latestFirstFor(info, frames, everyNth);
  return latest > 0 ? latest : info.count - 1;
}

// Everything the rail draws for the clip node, from the stored values:
//   mode        which way sets the length (lengthMode)
//   first       IN, the first source frame the run keeps
//   last        the source frame OUT sits on - the last one the run keeps -
//               or null when only the run can tell (a computed input)
//   windowLast  the stored window's end; frames between last and it are
//               kept by the window but dropped (every nth, the snap rule)
//   frames      output frames, or null when unknown
//   requested   the Length (or the wired count) asked for
//   truncated   the source ends before the Length is reached
//   tooLong     a fixed window longer than the source (the run refuses it)
// `values`: start and end seconds (linked frame bounds already converted),
// everyNth, frameSnap, maxFrames, fixedFrames, wired (the name of a length
// input that is connected, or null), wiredFrames (its value when it can be
// read), outputFps (the output rate, null when only the run knows it) and
// resampled (a connected force_rate: source frames no longer count output
// frames one for one, so only an exact window can still be placed).
export function clipLengthPlan(info, values = {}) {
  const nth = Math.max(1, Math.floor(finite(values.everyNth, 1)) || 1);
  const snap = values.frameSnap ?? "free";
  const window = frameWindow(info, values.start, values.end);
  const mode = lengthMode(values);
  const base = { mode, first: window.first, last: null, windowLast: window.last, frames: null, requested: null, truncated: false, tooLong: false };
  if (!info?.count) return { ...base, last: 0, windowLast: 0 };
  const exact = (frames) => {
    const fixed = fixedFrameWindow(info, window.first, frames, values.outputFps === undefined ? info.fps / nth : values.outputFps);
    if (!fixed || fixed.unresolved) return { ...base, requested: frames };
    return { ...base, first: fixed.first, last: fixed.last, windowLast: fixed.last, frames: fixed.frames, requested: frames, latestStart: fixed.latestStart, tooLong: fixed.tooLong };
  };
  const capped = (cap) => {
    const requested = cap > 0 ? snapFrameCount(cap, snap) : null;
    // Limit edits to IN, never the stored start. A shared workflow may
    // intentionally open with a shorter tail. The whole locked count must
    // fit before the source end or an earlier saved/wired OUT.
    const endFrame = frameWindow(info, 0, values.end).last;
    let latestStart = null;
    if (requested != null) {
      if (!values.resampled) {
        latestStart = Math.max(0, endFrame - lastFrameFor(0, requested, nth));
      } else if (values.outputFps > 0) {
        const duration = info.duration || info.count / info.fps;
        const end = values.end > 0 ? Math.min(values.end, duration) : duration;
        const lastTick = (requested - 1) / values.outputFps;
        latestStart = clamp(Math.floor((end - lastTick - TRIM_EPSILON) * info.fps), 0, endFrame);
      }
    }
    if (values.resampled) {
      // A known output rate places every output frame: the backend samples
      // and holds on ticks at start + k / rate (decode_video_range), so the
      // count, the last source frame shown and the end are all known here.
      if (!(values.outputFps > 0) || !(info.fps > 0)) return { ...base, last: cap > 0 ? null : window.last, requested, latestStart };
      const resampled = resampledFrames(info, values, nth, requested, snap);
      return { ...base, ...resampled, requested, latestStart, truncated: requested != null && resampled.frames < requested };
    }
    const kept = keptFrames(window, nth, cap, snap);
    return { ...base, last: kept.lastKept, frames: kept.frames, requested, latestStart, truncated: requested != null && kept.frames < requested };
  };
  const stored = Math.max(0, Math.trunc(finite(values.maxFrames)));
  if (mode === "fixed") return exact(Math.trunc(finite(values.fixedFrames)));
  if (mode === "wired") {
    if (values.wiredFrames == null) return base;
    const frames = Math.max(0, Math.trunc(finite(values.wiredFrames)));
    if (values.wired === "fixed_frames") return frames > 0 ? exact(frames) : capped(stored);
    return capped(frames);
  }
  return capped(mode === "length" ? stored : 0);
}

// Output frames of a run that resamples to a known rate: ticks at
// start + k / tickRate while before the end, thinned by every nth, capped,
// then snapped. `last` is the source frame the final tick holds.
export function resampledFrames(info, values, everyNth = 1, cap = null, snap = "free") {
  const nth = Math.max(1, Math.floor(finite(everyNth, 1)) || 1);
  const tickRate = finite(values.outputFps) * nth;
  const duration = info.duration || info.count / info.fps;
  const start = Math.max(0, finite(values.start));
  const end = finite(values.end) > 0 ? Math.min(finite(values.end), duration) : duration;
  const ticks = Math.max(0, Math.ceil((end - start) * tickRate - TRIM_EPSILON));
  let frames = Math.ceil(ticks / nth);
  if (cap != null && cap > 0) frames = Math.min(frames, cap);
  frames = snapFrameCount(frames, snap);
  const first = frameWindow(info, start, values.end).first;
  const lastTime = start + Math.max(0, frames - 1) * nth / tickRate;
  const last = clamp(Math.floor(lastTime * info.fps + TRIM_EPSILON), first, info.count - 1);
  const windowLast = frameWindow(info, start, values.end).last;
  // The last frame is held for one output frame, but never past the video.
  return { first, last, windowLast, frames, endSeconds: Math.min(end, start + frames / finite(values.outputFps)) };
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

// --- What a press on the rail does -----------------------------------------
// The rail always scrubs: a press anywhere moves the playhead, whatever the
// Length says, as in every video editor. Only three things take a press
// instead: the IN and OUT handles within `hitPx` screen pixels (the nearer
// one; handles stacked on one spot split by side, left of them is IN) and
// the grip on the kept part, which slides the clip.
export function railZone({ x, inX, outX, hasOut = true, hitPx = 9, onGrip = false } = {}) {
  if (onGrip) return "grip";
  const toIn = Math.abs(finite(x) - finite(inX));
  const toOut = hasOut ? Math.abs(finite(x) - finite(outX)) : Infinity;
  if (Math.min(toIn, toOut) > hitPx) return "playhead";
  return toIn < toOut || (toIn === toOut && finite(x) <= finite(inX)) ? "start" : "end";
}

// The first frame a slide can move the kept part to, and the last one:
// a Length keeps its count and stops where OUT meets the source's end; a
// free window keeps its span.
export function slideRange(info, plan, everyNth = 1) {
  if (!info?.count || !plan) return { min: 0, max: 0 };
  if (plan.mode === "free") {
    const span = Math.max(0, finite(plan.windowLast) - finite(plan.first));
    return { min: 0, max: Math.max(0, info.count - 1 - span) };
  }
  if (plan.mode === "length" || plan.mode === "fixed") {
    const frames = plan.requested ?? plan.frames ?? 1;
    const latest = plan.mode === "fixed" ? Math.max(0, info.count - 1 - (finite(plan.last) - finite(plan.first))) : latestFirstFor(info, frames, everyNth);
    return { min: 0, max: Math.max(0, latest) };
  }
  return { min: finite(plan.first), max: finite(plan.first) };
}

// True when a Length already takes the whole clip: IN sits on the first
// frame and has nowhere to go. The face then says so instead of freezing.
export function lengthFillsClip(info, plan, everyNth = 1) {
  if (!info?.count || !plan || (plan.mode !== "length" && plan.mode !== "fixed")) return false;
  return plan.first === 0 && slideRange(info, plan, everyNth).max === 0;
}

// --- Length limits ------------------------------------------------------------
// min_seconds / max_seconds keep the clip's length inside a range (0 = no
// limit). The backend applies them after the window is resolved
// (nodes/_video_load_helpers.limit_clip_length); limitClipSeconds mirrors
// that rule, so the rail and the App-mode clip window show what a run uses.

// The two limits, cleaned: negative or broken values are 0, and a max below
// the min counts as the min.
export function lengthLimits(minSeconds = 0, maxSeconds = 0) {
  const min = Math.max(0, finite(minSeconds));
  let max = Math.max(0, finite(maxSeconds));
  if (max > 0 && max < min) max = min;
  return { min, max, active: min > 0 || max > 0 };
}

// The window a run uses under the limits, in seconds. `end` 0 is the
// video's end; `cap` output frames of `frameSeconds` each can cut it short.
// Returns the stored-value shape { start, end, cap } plus `whole` (a video
// shorter than the min, used whole) and `changed`.
export function limitClipSeconds({ start = 0, end = 0, cap = 0, duration = 0, frameSeconds = 0 } = {}, limits = {}) {
  const { min, max, active } = lengthLimits(limits.min, limits.max);
  let first = finite(start);
  const stored = { start: first, end: finite(end), cap: Math.max(0, Math.trunc(finite(cap))) };
  const same = { ...stored, whole: false, changed: false };
  if (!active) return same;
  const length0 = finite(duration);
  const known = length0 > 0;
  if (known && min > 0 && length0 <= min + TRIM_EPSILON) return { start: 0, end: 0, cap: 0, whole: true, changed: true };
  let stop = stored.end > 0 ? stored.end : known ? length0 : Infinity;
  if (known) stop = Math.min(stop, length0);
  let length = stop - first;
  if (!(length > 0)) return same;
  const step = finite(frameSeconds);
  const capped = stored.cap > 0 && step > 0;
  if (capped) length = Math.min(length, stored.cap * step);
  let target = length;
  if (max > 0) target = Math.min(target, max);
  if (min > 0) target = Math.max(target, min);
  if (Math.abs(target - length) <= TRIM_EPSILON) return same;
  let last = first + target;
  if (known && last > length0) {
    last = length0;
    first = Math.max(0, length0 - target);
  }
  const keepCap = capped && !(stored.cap * step < target - TRIM_EPSILON);
  return { start: first, end: last, cap: keepCap ? stored.cap : 0, whole: false, changed: true };
}

// The output-frame counts a Duration may take at `rate` frames a second:
// at least one frame, and inside the limits when they are set.
export function limitFrameRange(limits = {}, rate = 0) {
  const { min, max } = lengthLimits(limits.min, limits.max);
  const fps = finite(rate);
  if (!(fps > 0)) return { min: 1, max: Infinity };
  const low = min > 0 ? Math.max(1, Math.ceil(min * fps - 1e-6)) : 1;
  const high = max > 0 ? Math.max(low, Math.floor(max * fps + 1e-6)) : Infinity;
  return { min: low, max: high };
}

// A Duration in output frames held inside the limits; under a snap rule it
// steps inward to a count the rule keeps.
export function limitFrames(frames, limits = {}, rate = 0, rule = "free") {
  const range = limitFrameRange(limits, rate);
  const count = Math.max(1, Math.round(finite(frames, 1)));
  const held = clamp(count, range.min, range.max);
  if (snapStep(rule) <= 1) return held;
  const snapped = snapToValid(held, rule);
  if (snapped > range.max) return snapToValid(held, rule, -1);
  if (snapped < range.min) return snapToValid(held, rule, 1);
  return snapped;
}

// --- The App-mode clip window ---------------------------------------------------
// One box on the video: drag it to pick where the clip starts, drag an edge
// to change its length. The window is { start, frames }: start in seconds on
// the source's frame grid, length in output frames at `rate` (what the node
// stores as start_seconds and max_frames).

function sourceGrid(seconds, info) {
  return info?.fps > 0 ? Math.round(finite(seconds) * info.fps) / info.fps : finite(seconds);
}

function videoLength(info) {
  return info?.duration > 0 ? info.duration : info?.fps > 0 ? info.count / info.fps : 0;
}

// Output frames that fit between `start` and the video's end.
function roomAt(start, info, rate) {
  return Math.max(1, Math.floor((videoLength(info) - finite(start)) * rate + 1e-6));
}

// The latest start that still fits `frames`.
function latestStart(frames, info, rate) {
  if (!(info?.fps > 0)) return 0;
  const latest = Math.floor((videoLength(info) - frames / rate) * info.fps + 1e-6) / info.fps;
  return Math.max(0, latest);
}

// The window a run uses, from the stored values: the limits applied
// (limitClipSeconds) and the length counted in output frames.
// `whole` - the video is shorter than the min and is used whole;
// `fills` - the window already covers the whole video, so only an edge moves.
export function clipWindowOf(info, { start = 0, end = 0, cap = 0, rate = 0 } = {}, limits = {}) {
  const fps = finite(rate);
  const duration = videoLength(info);
  if (!(fps > 0) || !(duration > 0)) return null;
  const limited = limitClipSeconds({ start, end, cap, duration, frameSeconds: 1 / fps }, limits);
  const first = clamp(sourceGrid(limited.start, info), 0, duration);
  let stop = limited.end > 0 ? Math.min(limited.end, duration) : duration;
  let frames = Math.max(1, Math.round((stop - first) * fps));
  if (limited.cap > 0) frames = Math.min(frames, limited.cap);
  frames = Math.min(frames, roomAt(first, info, fps));
  const window = { start: first, frames, rate: fps, whole: limited.whole };
  window.seconds = frames / fps;
  window.fills = first <= 0 && frames >= roomAt(0, info, fps);
  return window;
}

// Move the window by one gesture. zone "start" or "end" drags that edge to
// `seconds` (the other edge stays); "move" slides the whole box so its start
// lands at `seconds`. The length stays inside the limits and the video.
export function dragClipWindow(window, zone, seconds, info, limits = {}) {
  if (!window || window.whole) return window;
  const rate = window.rate;
  const range = limitFrameRange(limits, rate);
  const at = finite(seconds);
  if (zone === "move") {
    const start = clamp(sourceGrid(at, info), 0, latestStart(window.frames, info, rate));
    return { ...window, start, seconds: window.frames / rate };
  }
  if (zone === "end") {
    const most = Math.min(range.max, roomAt(window.start, info, rate));
    const frames = clamp(Math.round((at - window.start) * rate), Math.min(range.min, most), most);
    return { ...window, frames, seconds: frames / rate };
  }
  const end = window.start + window.frames / rate;
  const most = Math.min(range.max, Math.max(1, Math.floor(end * rate + 1e-6)));
  const frames = clamp(Math.round((end - at) * rate), Math.min(range.min, most), most);
  const start = clamp(sourceGrid(end - frames / rate, info), 0, latestStart(frames, info, rate));
  return { ...window, start, frames, seconds: frames / rate };
}

// What the node stores for a window: the start on the hundredths grid that
// keeps its first frame (windowSeconds), the length as max_frames, and an
// open end.
export function clipWindowValues(window, info) {
  const first = info?.fps > 0 ? clampFrame(Math.round(window.start * info.fps), info) : 0;
  return {
    start_seconds: windowSeconds(info, first, first).start_seconds,
    end_seconds: 0,
    max_frames: Math.max(1, Math.round(window.frames)),
  };
}

// --- The "Clip length limits" fold on the node face -------------------------
const limitText = (value) => String(Number(Math.max(0, finite(value)).toFixed(2)));

// The closed header's words: "5 – 8 s", "from 5 s", "up to 8 s", or "off".
export function limitsSummary(minSeconds = 0, maxSeconds = 0) {
  const { min, max } = lengthLimits(minSeconds, maxSeconds);
  if (min > 0 && max > 0) return min === max ? `${limitText(min)} s` : `${limitText(min)} – ${limitText(max)} s`;
  if (min > 0) return `from ${limitText(min)} s`;
  if (max > 0) return `up to ${limitText(max)} s`;
  return "off";
}

// Type one limit; the other one moves with it so the shortest never ends up
// above the longest. 0 is off and never pushes the other.
export function setLengthLimit(edge, value, { min = 0, max = 0 } = {}) {
  const next = Math.max(0, finite(value));
  let low = Math.max(0, finite(min));
  let high = Math.max(0, finite(max));
  if (edge === "min") {
    low = next;
    if (high > 0 && low > high) high = low;
  } else {
    high = next;
    if (high > 0 && low > high) low = high;
  }
  return { min: low, max: high };
}

// Where the clip window's player belongs: inside the picked part, going
// back to its start once it reaches the end (or when it sits before it).
export function loopPlayhead(time, start, seconds, slack = 0.04) {
  const from = Math.max(0, Number(start) || 0);
  const length = Math.max(0, Number(seconds) || 0);
  const now = Number(time);
  if (!Number.isFinite(now) || now < from - slack || now >= from + length) return from;
  return now;
}
