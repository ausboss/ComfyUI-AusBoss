import assert from "node:assert/strict";
import test from "node:test";

import {
  TRIM_EPSILON,
  boundaryAtFraction,
  clampFrame,
  clipInfo,
  dragTrimBoundary,
  formatFps,
  fractionOfFrame,
  frameAtFraction,
  frameTime,
  frameWindow,
  fixedFrameWindow,
  keptEndFraction,
  keptFrames,
  keyboardStep,
  setTrimFrame,
  windowSeconds,
} from "../js/shared/timeline_math.mjs";

const PIER = { fps: 24, frame_count: 97, duration: 97 / 24 };
const NTSC = { fps: 30000 / 1001, frame_count: 3227, duration: 3227 * 1001 / 30000 };

// The backend's inclusion rule, transcribed from decode_video_range: a
// frame at time t is kept when start - EPS <= t <= end - EPS.
function backendWindow(info, start, end) {
  const kept = [];
  const stop = end > 0 ? end : Infinity;
  for (let index = 0; index < info.frame_count; index += 1) {
    const time = index / info.fps;
    if (time < start - TRIM_EPSILON) continue;
    if (time > stop - TRIM_EPSILON) break;
    kept.push(index);
  }
  return { first: kept[0], last: kept.at(-1) };
}

test("clip info estimates a missing frame count from duration", () => {
  assert.deepEqual(clipInfo(PIER), { fps: 24, duration: 97 / 24, count: 97 });
  assert.deepEqual(clipInfo({ fps: 25, duration: 2 }), { fps: 25, duration: 2, count: 50 });
  assert.deepEqual(clipInfo(null), { fps: 0, duration: 0, count: 0 });
});

test("frame window mirrors the backend for whole-clip and zero-end values", () => {
  const info = clipInfo(PIER);
  assert.deepEqual(frameWindow(info, 0, 0), { first: 0, last: 96 });
  assert.deepEqual(frameWindow(info, 1, 3), backendWindow(PIER, 1, 3));
  assert.deepEqual(frameWindow(info, 1, 3), { first: 24, last: 71 });
});

test("frame window matches the backend on every frame-aligned boundary", () => {
  for (const source of [PIER, NTSC]) {
    const info = clipInfo(source);
    for (let first = 0; first < Math.min(info.count, 120); first += 7) {
      for (let last = first; last < Math.min(info.count, first + 60); last += 5) {
        const seconds = windowSeconds(info, first, last);
        const expected = backendWindow(source, seconds.start_seconds, seconds.end_seconds);
        assert.deepEqual(expected, { first, last }, `${source.fps} fps ${first}-${last}`);
        assert.deepEqual(frameWindow(info, seconds.start_seconds, seconds.end_seconds), { first, last });
      }
    }
  }
});

test("typed seconds between frames resolve like the backend does", () => {
  const info = clipInfo(PIER);
  // 1.02 s: frame 24 (1.000) is before the start, frame 25 (1.0417) is in.
  // 3.017 s: frame 72 (3.000) is the last one before the exclusive end.
  assert.deepEqual(frameWindow(info, 1.02, 3.017), backendWindow(PIER, 1.02, 3.017));
  assert.deepEqual(frameWindow(info, 1.02, 3.017), { first: 25, last: 72 });
});

test("window seconds store zero for an end that reaches the source's tail", () => {
  const info = clipInfo(PIER);
  assert.deepEqual(windowSeconds(info, 24, 96), { start_seconds: 1, end_seconds: 0 });
  // Frame 71 ends at 3.0 s; the smallest hundredth that keeps it and drops
  // frame 72 is 2.96.
  assert.deepEqual(windowSeconds(info, 0, 71), { start_seconds: 0, end_seconds: 2.96 });
  assert.deepEqual(windowSeconds(clipInfo({}), 0, 5), { start_seconds: 0, end_seconds: 0 });
});

test("window seconds sit on the hundredth grid the widgets round to", () => {
  const info = clipInfo(PIER);
  // Frame 23 is 0.958333 s: a plain rounding to 0.96 would drop it.
  assert.deepEqual(windowSeconds(info, 23, 22 + 45), { start_seconds: 0.95, end_seconds: 2.8 });
  for (const source of [PIER, NTSC]) {
    const clip = clipInfo(source);
    for (let first = 0; first < Math.min(clip.count, 120); first += 1) {
      const seconds = windowSeconds(clip, first, first + 3);
      assert.equal(seconds.start_seconds, Math.round(seconds.start_seconds * 100) / 100);
      assert.equal(seconds.end_seconds, Math.round(seconds.end_seconds * 100) / 100);
    }
  }
});

test("rail fractions map to frame cells and boundaries", () => {
  const info = clipInfo({ fps: 10, frame_count: 10, duration: 1 });
  assert.equal(frameAtFraction(0, info), 0);
  assert.equal(frameAtFraction(0.35, info), 3);
  assert.equal(frameAtFraction(1, info), 9);
  assert.equal(boundaryAtFraction(0.35, info), 4);
  assert.equal(boundaryAtFraction(1, info), 10);
  assert.equal(fractionOfFrame(3, info), 0.3);
  assert.equal(fractionOfFrame(3, info, "end"), 0.4);
  assert.equal(fractionOfFrame(3, info, "center"), 0.35);
  assert.equal(frameAtFraction(0.5, clipInfo({})), 0);
});

test("a grabbed OUT handle stays where it is until the pointer moves", () => {
  const info = clipInfo(PIER);
  const window = { first: 10, last: 40 };
  // The OUT handle sits at the boundary after frame 40; grabbing it there
  // must not shift the window by one.
  const grabbed = boundaryAtFraction(fractionOfFrame(40, info, "end"), info);
  assert.deepEqual(dragTrimBoundary(window, "end", grabbed, info), window);
  const inGrab = boundaryAtFraction(fractionOfFrame(10, info, "start"), info);
  assert.deepEqual(dragTrimBoundary(window, "start", inGrab, info), window);
});

test("trim edges never cross and keep at least one frame", () => {
  const info = clipInfo(PIER);
  assert.deepEqual(dragTrimBoundary({ first: 10, last: 40 }, "start", 60, info), { first: 40, last: 40 });
  assert.deepEqual(dragTrimBoundary({ first: 10, last: 40 }, "end", 5, info), { first: 10, last: 10 });
  assert.deepEqual(dragTrimBoundary({ first: 10, last: 40 }, "end", 500, info), { first: 10, last: 96 });
  assert.deepEqual(setTrimFrame({ first: 10, last: 40 }, "start", -3, info), { first: 0, last: 40 });
  assert.deepEqual(setTrimFrame({ first: 10, last: 40 }, "end", 20, info), { first: 10, last: 20 });
  assert.deepEqual(setTrimFrame({ first: 10, last: 40 }, "start", 45, info), { first: 40, last: 40 });
});

test("kept frames follow thinning, the cap and the snap rule", () => {
  const window = { first: 24, last: 323 }; // 300 frames
  assert.deepEqual(keptFrames(window), { frames: 300, total: 300, nth: 1, lastKept: 323, cut: false });
  assert.deepEqual(keptFrames(window, 1, 97), { frames: 97, total: 300, nth: 1, lastKept: 120, cut: true });
  assert.deepEqual(keptFrames(window, 2, 0, "8n+1"), { frames: 145, total: 300, nth: 2, lastKept: 312, cut: true });
  assert.equal(keptFrames({ first: 0, last: 96 }, 1, 97, "8n+1").cut, false);
  const info = clipInfo({ fps: 10, frame_count: 400, duration: 40 });
  assert.equal(keptEndFraction(window, keptFrames(window, 1, 97), info), 121 / 400);
});

test("frame helpers clamp and format", () => {
  const info = clipInfo(PIER);
  assert.equal(clampFrame(200, info), 96);
  assert.equal(clampFrame(-4, info), 0);
  assert.equal(frameTime(48, info), 2);
  assert.equal(formatFps(30000 / 1001), "29.97");
  assert.equal(formatFps(24), "24");
  assert.equal(keyboardStep(info, false), 24);
  assert.equal(keyboardStep(info, true), 1);
  assert.equal(keyboardStep(clipInfo({}), false), 1);
});


test("fixed window translates and stops at both ends without shrinking", () => {
  const info = clipInfo({fps: 24, frame_count: 240, duration: 10});
  for (const [requested, first] of [[0, 0], [60, 60], [200, 120], [-20, 0]]) {
    const window = fixedFrameWindow(info, requested, 120, 24);
    assert.equal(window.first, first);
    assert.equal(window.last - window.first + 1, 120);
    assert.equal(window.seconds, 5);
  }
  assert.equal(fixedFrameWindow(info, 0, 0, 24), null);
  assert.equal(fixedFrameWindow(info, 0, 241, 24).tooLong, true);
  assert.equal(fixedFrameWindow(info, 0, null, 24).unresolved, true);
  assert.equal(fixedFrameWindow(info, 0, 120, null).unresolved, true);
});

test("fixed frame duration follows output fps while position follows source fps", () => {
  const info = clipInfo({fps: 30, frame_count: 300, duration: 10});
  for (const [frames, rate] of [[120, 24], [60, 12]]) {
    const window = fixedFrameWindow(info, 250, frames, rate);
    assert.equal(window.first, 150);
    assert.equal(window.last, 299);
    assert.equal(window.seconds, 5);
  }
  const fractional = fixedFrameWindow(info, 299, 97, 24);
  assert.equal(fractional.first, 178);
  assert.equal(fractional.last, 299);
  assert.equal(fractional.seconds, 97 / 24);
});

// --- One way to set the length -------------------------------------------------
import { clipLengthPlan, framesThrough, lastFrameFor, latestFirstFor, lengthMode, snapStep, snapToValid } from "../js/shared/timeline_math.mjs";

test("one mode sets the length: a wired input, an old fixed count, a Length, or OUT", () => {
  assert.equal(lengthMode({}), "free");
  assert.equal(lengthMode({ maxFrames: 97 }), "length");
  assert.equal(lengthMode({ maxFrames: 97, fixedFrames: 49 }), "fixed");
  assert.equal(lengthMode({ maxFrames: 97, fixedFrames: 49, wired: "frame_load_cap" }), "wired");
});

test("snap counts step from one valid count to the next", () => {
  assert.equal(snapStep("8n+1"), 8);
  assert.equal(snapStep("4n+1"), 4);
  assert.equal(snapStep("free"), 1);
  assert.equal(snapToValid(100, "8n+1"), 97);
  assert.equal(snapToValid(102, "8n+1"), 105);
  assert.equal(snapToValid(98, "8n+1", 1), 105);
  assert.equal(snapToValid(96, "8n+1", -1), 89);
  assert.equal(snapToValid(97, "8n+1", 1), 97);
  assert.equal(snapToValid(0, "4n+1"), 1);
  assert.equal(snapToValid(50, "free"), 50);
});

test("OUT lands on a frame the run keeps", () => {
  assert.equal(framesThrough(24, 54), 31);
  assert.equal(framesThrough(24, 54, 1, "8n+1"), 25);
  assert.equal(lastFrameFor(24, framesThrough(24, 54, 1, "8n+1")), 48);
  assert.equal(framesThrough(0, 9, 3), 4);
  assert.equal(lastFrameFor(0, 4, 3), 9);
  assert.equal(framesThrough(30, 10), 1);
  const info = clipInfo(PIER);
  assert.equal(latestFirstFor(info, 20), 77);
  assert.equal(latestFirstFor(info, 97), 0);
  assert.equal(latestFirstFor(info, 200), 0);
});

test("free trim: the handles are IN and the last frame the run keeps", () => {
  const info = clipInfo(PIER);
  const window = windowSeconds(info, 24, 54);
  const plan = clipLengthPlan(info, { start: window.start_seconds, end: window.end_seconds });
  assert.deepEqual([plan.mode, plan.first, plan.last, plan.frames], ["free", 24, 54, 31]);
  // 8n+1 keeps 25 of the 31: OUT sits on frame 48 and 49..54 show as dropped.
  const snapped = clipLengthPlan(info, { start: window.start_seconds, end: window.end_seconds, frameSnap: "8n+1" });
  assert.deepEqual([snapped.last, snapped.windowLast, snapped.frames], [48, 54, 25]);
});

test("a Length keeps OUT a fixed distance after IN and says when the source runs out", () => {
  const info = clipInfo(PIER);
  // The report's case: IN 24 with Limit 20 ended at frame 43, not at OUT 54.
  const window = windowSeconds(info, 24, 54);
  const limited = clipLengthPlan(info, { start: window.start_seconds, end: window.end_seconds, maxFrames: 20 });
  assert.deepEqual([limited.mode, limited.first, limited.last, limited.frames], ["length", 24, 43, 20]);
  // The LTX example: whole clip, Length 97 at 8n+1.
  const ltx = clipLengthPlan(info, { start: 0, end: 0, maxFrames: 97, frameSnap: "8n+1" });
  assert.deepEqual([ltx.last, ltx.frames, ltx.requested, ltx.truncated], [96, 97, 97, false]);
  const late = clipLengthPlan(info, { start: windowSeconds(info, 80, 96).start_seconds, end: 0, maxFrames: 97 });
  assert.deepEqual([late.last, late.frames, late.truncated], [96, 17, true]);
});

test("an old fixed count, a wired input and a connected rate", () => {
  const info = clipInfo({ fps: 24, frame_count: 240, duration: 10 });
  const fixed = clipLengthPlan(info, { start: 5, end: 0, fixedFrames: 120 });
  assert.deepEqual([fixed.mode, fixed.first, fixed.last, fixed.frames], ["fixed", 120, 239, 120]);
  const unknown = clipLengthPlan(info, { start: 0, end: 0, wired: "fixed_frames", wiredFrames: null });
  assert.deepEqual([unknown.mode, unknown.last, unknown.frames], ["wired", null, null]);
  const literal = clipLengthPlan(info, { start: 1, end: 0, wired: "fixed_frames", wiredFrames: 48 });
  assert.deepEqual([literal.first, literal.last, literal.frames], [24, 71, 48]);
  const cap = clipLengthPlan(info, { start: 0, end: 0, wired: "frame_load_cap", wiredFrames: 30, frameSnap: "4n+1" });
  assert.deepEqual([cap.last, cap.frames], [28, 29]);
  const resampled = clipLengthPlan(info, { start: 0, end: 5, resampled: true, outputFps: null });
  assert.deepEqual([resampled.last, resampled.frames], [119, null]);
  assert.equal(clipLengthPlan(info, { start: 0, end: 0, maxFrames: 50, resampled: true }).last, null);
});

// --- The rail always scrubs ------------------------------------------------------
import { lengthFillsClip, railZone, slideRange } from "../js/shared/timeline_math.mjs";

test("a press on the rail scrubs unless it lands on a handle or the grip", () => {
  // Length on (the LTX example): pressing between IN and OUT used to be a
  // hidden grip that could not move. It is the playhead now.
  assert.equal(railZone({ x: 200, inX: 0, outX: 400 }), "playhead");
  assert.equal(railZone({ x: 5, inX: 0, outX: 400 }), "start");
  assert.equal(railZone({ x: 395, inX: 0, outX: 400 }), "end");
  assert.equal(railZone({ x: 200, inX: 0, outX: 400, onGrip: true }), "grip");
  // Stacked handles split by side; no OUT handle leaves only IN.
  assert.equal(railZone({ x: 99, inX: 100, outX: 100 }), "start");
  assert.equal(railZone({ x: 101, inX: 100, outX: 100 }), "end");
  assert.equal(railZone({ x: 395, inX: 0, outX: 400, hasOut: false }), "playhead");
});

test("the grip slides the kept part as far as the clip allows", () => {
  const pier = clipInfo({ fps: 24, frame_count: 97, duration: 97 / 24 });
  const whole = clipLengthPlan(pier, { start: 0, end: 0, maxFrames: 97, frameSnap: "8n+1" });
  assert.deepEqual(slideRange(pier, whole), { min: 0, max: 0 });
  assert.equal(lengthFillsClip(pier, whole), true);
  const long = clipInfo({ fps: 24, frame_count: 288, duration: 12 });
  const length = clipLengthPlan(long, { start: 0, end: 0, maxFrames: 97, frameSnap: "8n+1" });
  assert.deepEqual(slideRange(long, length), { min: 0, max: 191 });
  assert.equal(lengthFillsClip(long, length), false);
  // A free window keeps its span.
  const window = windowSeconds(long, 24, 72);
  const free = clipLengthPlan(long, { start: window.start_seconds, end: window.end_seconds });
  assert.deepEqual(slideRange(long, free), { min: 0, max: 287 - 48 });
  assert.equal(lengthFillsClip(long, free), false);
});
