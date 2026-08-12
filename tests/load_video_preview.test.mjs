import assert from "node:assert/strict";
import test from "node:test";

import {
  clampTrimSeek,
  responsivePreviewHeight,
  shouldLoopTrim,
  trimBounds,
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

test("preview height scales down and remains bounded", () => {
  assert.equal(responsivePreviewHeight(100), 96);
  assert.equal(responsivePreviewHeight(252), 135);
  assert.equal(responsivePreviewHeight(1000), 220);
});
