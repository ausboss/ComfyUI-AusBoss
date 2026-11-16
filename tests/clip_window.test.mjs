// Length limits (min_seconds / max_seconds) and the App-mode clip window.
// limitClipSeconds mirrors nodes/_video_load_helpers.limit_clip_length; the
// rows below are the ones tests/test_clip_length_limits.py holds it to.
import assert from "node:assert/strict";
import test from "node:test";

import {
  clipInfo,
  clipWindowOf,
  clipWindowValues,
  dragClipWindow,
  frameWindow,
  lengthLimits,
  limitClipSeconds,
  limitFrameRange,
  limitFrames,
} from "../js/shared/timeline_math.mjs";

const DURATION = 15.4;
const FRAME = 1 / 24;
const LIMITS = { min: 5, max: 8 };
// The test video of the Person Swap App: 23.976 fps, 370 frames.
const VIDEO = clipInfo({ fps: 24000 / 1001, frame_count: 370, duration: 15.432083 });

const limit = ({ start = 0, end = 0, cap = 0, duration = DURATION, step = FRAME, min = 5, max = 8 } = {}) =>
  limitClipSeconds({ start, end, cap, duration, frameSeconds: step }, { min, max });

function window(got, start, end, cap) {
  assert.ok(Math.abs(got.start - start) < 1e-6, `start ${got.start} != ${start}`);
  assert.ok(Math.abs(got.end - end) < 1e-6, `end ${got.end} != ${end}`);
  assert.equal(got.cap, cap);
}

test("limits: 0 is no limit and a max below the min counts as the min", () => {
  assert.deepEqual(lengthLimits(0, 0), { min: 0, max: 0, active: false });
  assert.deepEqual(lengthLimits(6, 2), { min: 6, max: 6, active: true });
  assert.deepEqual(lengthLimits(-1, Number.NaN), { min: 0, max: 0, active: false });
  const same = limitClipSeconds({ start: 1, end: 0, cap: 30, duration: DURATION, frameSeconds: FRAME }, { min: 0, max: 0 });
  assert.equal(same.changed, false);
  window(same, 1, 0, 30);
});

test("limits: the same rows as the backend", () => {
  window(limit(), 0, 8, 0);
  window(limit({ start: 3, cap: 192 }), 3, 0, 192);
  window(limit({ start: 2, end: 8.5 }), 2, 8.5, 0);
  window(limit({ start: 2, end: 4 }), 2, 7, 0);
  window(limit({ start: 2, cap: 48 }), 2, 7, 0);
  window(limit({ start: 1, cap: 300 }), 1, 9, 300);
  window(limit({ start: 13 }), DURATION - 5, DURATION, 0);
  const whole = limit({ start: 1, end: 2, duration: 4.2 });
  assert.equal(whole.whole, true);
  window(whole, 0, 0, 0);
  window(limit({ min: 6, max: 2 }), 0, 6, 0);
  window(limit({ start: 1, min: 0 }), 1, 9, 0);
  window(limit({ start: 1, end: 3, min: 0 }), 1, 3, 0);
  window(limit({ start: 1, duration: 0, min: 0 }), 1, 9, 0);
  window(limit({ start: 4, end: 2 }), 4, 2, 0);
});

test("a Duration stays inside the limits, and inward under a snap rule", () => {
  assert.deepEqual(limitFrameRange(LIMITS, 24), { min: 120, max: 192 });
  assert.deepEqual(limitFrameRange({}, 24), { min: 1, max: Infinity });
  assert.equal(limitFrames(300, LIMITS, 24), 192);
  assert.equal(limitFrames(10, LIMITS, 24), 120);
  assert.equal(limitFrames(150, LIMITS, 24), 150);
  assert.equal(limitFrames(300, {}, 24), 300);
  // 8n+1 inside 120..192: 121 and 185.
  assert.equal(limitFrames(10, LIMITS, 24, "8n+1"), 121);
  assert.equal(limitFrames(300, LIMITS, 24, "8n+1"), 185);
});

test("the clip window shows what a run uses: the first 8 s of a 15.4 s video", () => {
  const box = clipWindowOf(VIDEO, { rate: 24 }, LIMITS);
  assert.equal(box.start, 0);
  assert.equal(box.frames, 192);
  assert.equal(box.seconds, 8);
  assert.equal(box.fills, false);
  // A saved Duration of 192 frames from 3 s is kept as it is.
  const saved = clipWindowOf(VIDEO, { start: 3, cap: 192, rate: 24 }, LIMITS);
  assert.equal(saved.frames, 192);
  assert.ok(Math.abs(saved.start - 3.003) < 1e-3);
});

test("dragging an edge stops at 5 s and at 8 s", () => {
  const box = clipWindowOf(VIDEO, { rate: 24 }, LIMITS);
  assert.equal(dragClipWindow(box, "end", 20, VIDEO, LIMITS).seconds, 8);
  assert.equal(dragClipWindow(box, "end", 1, VIDEO, LIMITS).seconds, 5);
  assert.equal(dragClipWindow(box, "end", 6.5, VIDEO, LIMITS).seconds, 6.5);
  const later = dragClipWindow(box, "start", 6, VIDEO, LIMITS);
  assert.equal(later.seconds, 5);
  assert.ok(Math.abs(later.start + later.seconds - 8) < 1 / 24);
  const earlier = dragClipWindow(later, "start", -4, VIDEO, LIMITS);
  assert.equal(earlier.seconds, 8);
  assert.equal(earlier.start, 0);
});

test("dragging the box keeps its length and stops at the video's ends", () => {
  const box = clipWindowOf(VIDEO, { rate: 24 }, LIMITS);
  assert.equal(dragClipWindow(box, "move", -2, VIDEO, LIMITS).start, 0);
  const end = dragClipWindow(box, "move", 12, VIDEO, LIMITS);
  assert.equal(end.frames, 192);
  assert.ok(end.start + end.seconds <= VIDEO.duration + 1e-9);
  assert.ok(end.start + end.seconds > VIDEO.duration - 2 / 24);
  // The edge at the video's end cannot grow past it.
  assert.ok(dragClipWindow({ ...end, frames: 120, seconds: 5 }, "end", 99, VIDEO, LIMITS).seconds <= VIDEO.duration - end.start);
});

test("what the window stores runs the same frames", () => {
  const box = dragClipWindow(clipWindowOf(VIDEO, { rate: 24 }, LIMITS), "move", 3, VIDEO, LIMITS);
  const stored = clipWindowValues(box, VIDEO);
  assert.deepEqual(stored, { start_seconds: 3, end_seconds: 0, max_frames: 192 });
  assert.equal(frameWindow(VIDEO, stored.start_seconds, 0).first, Math.round(box.start * VIDEO.fps));
  const again = clipWindowOf(VIDEO, { start: stored.start_seconds, cap: stored.max_frames, rate: 24 }, LIMITS);
  assert.equal(again.frames, box.frames);
  assert.ok(Math.abs(again.start - box.start) < 1e-9);
});

test("a video shorter than the min is used whole and cannot be dragged", () => {
  const short = clipInfo({ fps: 24, frame_count: 100, duration: 100 / 24 });
  const box = clipWindowOf(short, { start: 1, rate: 24 }, LIMITS);
  assert.equal(box.whole, true);
  assert.equal(box.start, 0);
  assert.equal(box.frames, 100);
  assert.equal(dragClipWindow(box, "move", 2, short, LIMITS), box);
});

test("without limits the box can be as short as a frame and as long as the video", () => {
  const box = clipWindowOf(VIDEO, { rate: 24 }, {});
  assert.equal(box.fills, true);
  assert.equal(dragClipWindow(box, "end", 0, VIDEO, {}).frames, 1);
});
