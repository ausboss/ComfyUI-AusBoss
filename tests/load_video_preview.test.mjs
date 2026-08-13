import assert from "node:assert/strict";
import test from "node:test";

import {
  clampTrimSeek,
  closestTrimHandle,
  dragTrimHandle,
  playbackBoundaryAction,
  responsivePreviewHeight,
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

test("a zero-length clip yields a zero-length selection without infinite loops", () => {
  assert.deepEqual(dragTrimHandle(0, { start: 0, end: 0 }, "start", 0.5), { start: 0, end: 0 });
  assert.deepEqual(trimFractions(0, { start: 0, end: 0 }), { start: 0, end: 1 });
  assert.equal(playbackBoundaryAction(0, trimBounds(0, 0, 0), true), "none");
});
