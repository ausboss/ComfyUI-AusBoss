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
