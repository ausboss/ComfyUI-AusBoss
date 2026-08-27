import assert from "node:assert/strict";
import test from "node:test";

import {
  clampTrimSeek,
  closestTrimHandle,
  dragTrimHandle,
  formatFps,
  loadSummary,
  playbackBoundaryAction,
  responsivePreviewHeight,
  singleFrameFraction,
  singleFrameTime,
  slideTrimWindow,
  shouldLoopTrim,
  trimBounds,
  trimFractions,
} from "../js/load_video/trim_preview.mjs";

test("trim bounds preserve an explicit start and end", () => {
  assert.deepEqual(trimBounds(20, 3.86, 10.11), { start: 3.86, end: 10.11 });
});

test("zero end means the source duration", () => {
  assert.deepEqual(trimBounds(20, 3.86, 0), { start: 3.86, end: 20 });
});

test("seeking is constrained to the selected window", () => {
  const bounds = trimBounds(20, 3.86, 10.11);
  assert.equal(clampTrimSeek(1, bounds), 3.86);
  assert.equal(clampTrimSeek(7, bounds), 7);
  assert.ok(clampTrimSeek(15, bounds) < 10.11);
  assert.ok(clampTrimSeek(15, bounds) >= 3.86);
});

test("playback loops at the selected end only", () => {
  const bounds = trimBounds(20, 3.86, 10.11);
  assert.equal(shouldLoopTrim(10.0, bounds), false);
  assert.equal(shouldLoopTrim(10.08, bounds), true);
});

test("playback can stop at the selected end when loop is off", () => {
  const bounds = trimBounds(20, 3.86, 10.11);
  assert.equal(playbackBoundaryAction(9, bounds, false), "none");
  assert.equal(playbackBoundaryAction(10.1, bounds, false), "stop");
  assert.equal(playbackBoundaryAction(10.1, bounds, true), "loop");
});

test("trim handles remain ordered and keep a usable hit window", () => {
  assert.deepEqual(dragTrimHandle(20, { start: 4, end: 10 }, "start", 0.6), {
    start: 9.9,
    end: 10,
  });
  assert.deepEqual(dragTrimHandle(20, { start: 4, end: 10 }, "end", 0.1), {
    start: 4,
    end: 4.1,
  });
});

test("overlapping handle hit zones choose the nearest thumb", () => {
  assert.equal(closestTrimHandle(0.32, 0.35, 0.349, 225), "end");
  assert.equal(closestTrimHandle(0.32, 0.35, 0.321, 225), "start");
  assert.equal(closestTrimHandle(0.32, 0.35, 0.8, 225), null);
});

test("selected trim can slide without changing its duration", () => {
  assert.deepEqual(slideTrimWindow(20, { start: 4, end: 10 }, 20), { start: 14, end: 20 });
  assert.deepEqual(slideTrimWindow(20, { start: 4, end: 10 }, -20), { start: 0, end: 6 });
});

test("trim fractions map selected seconds onto the full rail", () => {
  assert.deepEqual(trimFractions(20, { start: 4, end: 10 }), { start: 0.2, end: 0.5 });
});

test("preview height scales down and remains bounded", () => {
  assert.equal(responsivePreviewHeight(100), 112);
  assert.equal(responsivePreviewHeight(252), 135);
  assert.equal(responsivePreviewHeight(1000), 420);
});

test("preview height never escapes the responsive bounds at any width", () => {
  // Exhaustive sweep: the rendered player height must stay inside [112, 420].
  for (let width = 0; width <= 4096; width += 7) {
    const h = responsivePreviewHeight(width);
    assert.ok(h >= 112, `height ${h} below min at width ${width}`);
    assert.ok(h <= 420, `height ${h} above max at width ${width}`);
  }
});

test("trim bounds never emit a reversed window", () => {
  const bounds = trimBounds(20, 12, 5);
  assert.ok(bounds.end >= bounds.start);
  // start may not exceed the source duration.
  assert.ok(bounds.start <= 20);
});

test("dragging either handle keeps at least the minimum window", () => {
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  // Drag the start handle far past its limit: it must clamp so the window
  // never undershoots the minimum.
  const a = dragTrimHandle(20, { start: 9.95, end: 10 }, "start", 0.6, 0.1);
  assert.ok(close(a.end, 10));
  assert.ok(close(a.end - a.start, 0.1));
  // Dragging the end handle past its limit clamps it to start + min window.
  const b = dragTrimHandle(20, { start: 9.95, end: 10 }, "end", 0.4, 0.1);
  assert.ok(b.end > b.start);
  assert.ok(close(b.end - b.start, 0.1));
});

test("single-frame time stays inside the source", () => {
  assert.equal(singleFrameTime(20, 5.25), 5.25);
  assert.equal(singleFrameTime(20, -3), 0);
  // Past the end clamps just inside, so the decoder still finds a frame.
  assert.equal(singleFrameTime(20, 25), 19.9);
});

test("single-frame time survives an unknown duration", () => {
  // Metadata not loaded yet: the typed value must pass through unclamped.
  assert.equal(singleFrameTime(0, 7), 7);
});

test("single-frame fraction maps the chosen instant onto the rail", () => {
  assert.equal(singleFrameFraction(20, 5), 0.25);
  // Past-the-end picks land just inside 1 (19.9/20), never at or beyond it.
  assert.ok(Math.abs(singleFrameFraction(20, 40) - 0.995) < 1e-9);
  assert.equal(singleFrameFraction(0, 5), 0);
});

test("a zero-length clip yields a zero-length selection without infinite loops", () => {
  assert.deepEqual(dragTrimHandle(0, { start: 0, end: 0 }, "start", 0.5), { start: 0, end: 0 });
  assert.deepEqual(trimFractions(0, { start: 0, end: 0 }), { start: 0, end: 1 });
  assert.equal(playbackBoundaryAction(0, trimBounds(0, 0, 0), true), "none");
});

test("the load summary reports the full trim at the source rate", () => {
  assert.equal(loadSummary(10, { start: 0, end: 2 }, 24), "48 frames @ 24 fps");
  // A fractional window rounds up, exactly as the decoder estimates it.
  assert.equal(loadSummary(30, { start: 0, end: 25 }, 12.5), "313 frames @ 12.5 fps");
});

test("every_nth divides both the frame count and the reported fps", () => {
  assert.equal(loadSummary(10, { start: 0, end: 2 }, 24, 2), "24 frames @ 12 fps");
  // ceil(ceil(2s x 25fps) / 3) = 17 kept frames.
  assert.equal(loadSummary(10, { start: 0, end: 2 }, 25, 3), "17 frames @ 8.333 fps");
});

test("max_frames caps the count without changing the playback rate", () => {
  assert.equal(loadSummary(10, { start: 0, end: 2 }, 24, 2, 10), "10 frames @ 12 fps");
  // A cap larger than the window changes nothing.
  assert.equal(loadSummary(10, { start: 0, end: 2 }, 24, 1, 500), "48 frames @ 24 fps");
});

test("single-frame mode always reports exactly one frame", () => {
  assert.equal(loadSummary(10, { start: 0, end: 10 }, 24, 4, 100, true), "1 frame");
  // A trim that computes to one frame reads the same, singular.
  assert.equal(loadSummary(10, { start: 0, end: 2 }, 24, 1, 1), "1 frame");
});

test("the summary stays silent rather than guessing", () => {
  // Unknown fps or duration: no number is better than a wrong one.
  assert.equal(loadSummary(10, { start: 0, end: 2 }, 0), "");
  assert.equal(loadSummary(0, { start: 0, end: 2 }, 24), "");
  // An empty or inverted window loads nothing worth labelling.
  assert.equal(loadSummary(10, { start: 5, end: 5 }, 24), "");
  assert.equal(loadSummary(10, { start: 8, end: 2 }, 24), "");
});

test("an open end and an overshooting end both clamp to the source", () => {
  assert.equal(loadSummary(2, { start: 0, end: Number.POSITIVE_INFINITY }, 24), "48 frames @ 24 fps");
  assert.equal(loadSummary(2, { start: 0, end: 99 }, 24), "48 frames @ 24 fps");
});

test("fps formatting trims float noise but keeps real fractions", () => {
  assert.equal(formatFps(24), "24");
  assert.equal(formatFps(12.5), "12.5");
  assert.equal(formatFps(24000 / 1001), "23.976");
  assert.equal(formatFps(0), "0");
});
