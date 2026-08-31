// The shared scrub control's pure gesture math: dead zone, step travel,
// fine steps, clamping, and precision.

import assert from "node:assert/strict";
import test from "node:test";

import {
  SCRUB_DEAD_ZONE,
  SCRUB_PIXELS_PER_STEP,
  isScrubGesture,
  quantizeScrubValue,
  scrubbedValue,
} from "../js/shared/scrub_input.mjs";

const MP = { min: 0.01, max: 16, step: 0.05, fineStep: 0.01, decimals: 2 };

test("inside the dead zone nothing changes, so a click stays a click", () => {
  assert.equal(scrubbedValue(1, SCRUB_DEAD_ZONE, false, MP), 1);
  assert.equal(scrubbedValue(1, -SCRUB_DEAD_ZONE, false, MP), 1);
});

test("travel past the dead zone steps by the coarse step", () => {
  // 43px right: (43-3)/4 = 10 steps of 0.05.
  assert.equal(scrubbedValue(1, 43, false, MP), 1.5);
  assert.equal(scrubbedValue(1, -43, false, MP), 0.5);
});

test("shift scrubs by the fine step", () => {
  assert.equal(scrubbedValue(1, 43, true, MP), 1.1);
});

test("scrubs clamp at the range edges", () => {
  assert.equal(scrubbedValue(15.9, 400, false, MP), 16);
  assert.equal(scrubbedValue(0.1, -400, false, MP), 0.01);
});

test("values come back rounded to the control's precision", () => {
  assert.equal(quantizeScrubValue(0.1 + 0.2, MP), 0.3);
  assert.equal(quantizeScrubValue(7.777, { decimals: 0, min: 1, max: 256 }), 8);
});

test("junk quantizes to the range floor, not NaN", () => {
  assert.equal(quantizeScrubValue("wide", MP), 0.01);
});

test("a mostly-vertical drag is not a scrub", () => {
  assert.equal(isScrubGesture(10, 4), true);
  assert.equal(isScrubGesture(6, 30), false);
  assert.equal(isScrubGesture(2, 0), false);
});

test("integer controls step whole numbers", () => {
  const STEPS = { min: 1, max: 256, step: 1, decimals: 0 };
  assert.equal(scrubbedValue(64, 3 + SCRUB_PIXELS_PER_STEP * 4, false, STEPS), 68);
  assert.equal(scrubbedValue(1, -400, false, STEPS), 1);
});
