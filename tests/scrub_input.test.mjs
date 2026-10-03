// The shared scrub control's pure gesture math: dead zone, step travel,
// fine steps, snapped steps, clamping, and precision.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCRUB_DEAD_ZONE,
  SCRUB_PIXELS_PER_STEP,
  isScrubGesture,
  quantizeScrubValue,
  scrubbedValue,
  steppedValue,
  SCRUB_SLOW_FACTOR,
} from "../js/shared/scrub_input.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

test("Shift slows a whole-number box that has no finer step", () => {
  // Feather: 1 px steps, no fine step. Shift used to change nothing.
  const FEATHER = { step: 1, decimals: 0, min: 0, max: 4096 };
  assert.equal(scrubbedValue(24, 40, false, FEATHER), 33);
  const slow = scrubbedValue(24, 40, true, FEATHER);
  assert.ok(slow > 24 && slow < 33, String(slow));
  assert.equal(scrubbedValue(24, 3 + SCRUB_PIXELS_PER_STEP * SCRUB_SLOW_FACTOR * 2, true, FEATHER), 26);
  // A box with a finer step still uses it at the normal speed.
  assert.equal(scrubbedValue(1, 43, true, { step: 0.05, fineStep: 0.01, decimals: 2 }), 1.1);
});

// Divisible by (canvas_multiple): 1 is off, and the sizes people want are
// multiples of 8. Stepping used to add 8 to 1 and land on 9, 17, 25.
const DIVISIBLE = { min: 1, max: 4096, step: 8, fineStep: 1, decimals: 0, snap: true };
// What one chevron click or arrow key commits (the DOM factory's path).
const click = (value, direction, fine = false) => {
  const size = fine ? DIVISIBLE.fineStep : DIVISIBLE.step;
  return quantizeScrubValue(steppedValue(value, direction, size, !fine), DIVISIBLE);
};

test("a snap box steps from 1 to 8, 16, 24 and back down to 1", () => {
  const up = [];
  for (let value = 1; up.length < 4;) up.push(value = click(value, 1));
  assert.deepEqual(up, [8, 16, 24, 32]);
  const down = [];
  for (let value = 32; down.length < 5;) down.push(value = click(value, -1));
  assert.deepEqual(down, [24, 16, 8, 1, 1]);
});

test("a snap box off the grid steps to the nearest multiple that way", () => {
  assert.equal(click(9, 1), 16);
  assert.equal(click(9, -1), 8);
  assert.equal(click(12, 1), 16);
  assert.equal(click(12, -1), 8);
  assert.equal(click(4095, 1), 4096);
});

test("Shift steps a snap box by 1, off the grid", () => {
  assert.equal(click(8, 1, true), 9);
  assert.equal(click(8, -1, true), 7);
  // ... and the next plain step goes back onto it.
  assert.equal(click(click(8, 1, true), 1), 16);
});

test("dragging a snap box passes only multiples of the step", () => {
  const passed = new Set();
  for (let dx = 0; dx <= 64; dx++) passed.add(scrubbedValue(1, dx, false, DIVISIBLE));
  assert.deepEqual([...passed], [1, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120]);
  assert.equal(scrubbedValue(24, -43, false, DIVISIBLE), 1);
  // A Shift drag moves by 1 from wherever it is.
  assert.equal(scrubbedValue(8, 3 + SCRUB_PIXELS_PER_STEP * 3, true, DIVISIBLE), 11);
});

test("without snap a step still adds the step to the value", () => {
  assert.equal(steppedValue(1, 1, 8), 9);
  assert.equal(scrubbedValue(1, 3 + SCRUB_PIXELS_PER_STEP, false, { ...DIVISIBLE, snap: false }), 9);
});

test("a value on a fractional grid counts as on it", () => {
  // 0.3 / 0.1 is 2.9999999999999996 in floating point.
  assert.equal(quantizeScrubValue(steppedValue(0.3, 1, 0.1, true), { decimals: 2 }), 0.4);
  assert.equal(quantizeScrubValue(steppedValue(0.3, -1, 0.1, true), { decimals: 2 }), 0.2);
});

test("every divisible-by box on the transform nodes and Load Image + Pad snaps", () => {
  // Divisible by and the resize Step, on the node face and in the editor.
  const editor = readFileSync(join(ROOT, "js", "shared", "transform_editor.mjs"), "utf-8");
  const boxes = editor.split("makeScrubInput(").slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("onChange")))
    .filter((options) => /"(canvas_multiple|resolution_steps)"/.test(options));
  assert.equal(boxes.length, 4);
  for (const options of boxes) assert.match(options, /\bsnap: true\b/);
  const cards = readFileSync(join(ROOT, "js", "widget_cards", "index.js"), "utf-8");
  assert.match(cards, /\{ widget: "canvas_multiple", [^}]*\bsnap: true\b/);
});
