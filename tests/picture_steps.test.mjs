import assert from "node:assert/strict";
import test from "node:test";

import { keepIndex, stepIndex, stepperLabel } from "../js/shared/picture_steps.mjs";

test("a new run keeps the picture that was showing, if it still has one", () => {
  assert.equal(keepIndex(1, 3), 1);
  assert.equal(keepIndex(4, 3), 2);
  assert.equal(keepIndex(-2, 3), 0);
  assert.equal(keepIndex(Number.NaN, 3), 0);
  assert.equal(keepIndex(2, 0), 0);
});

test("the arrows step one picture and go round at the ends", () => {
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(1, 3, 0), 1);
  assert.equal(stepIndex(0, 1, 1), 0);
  assert.equal(stepIndex(0, 0, 1), 0);
});

test("the label counts from one and is empty for a single picture", () => {
  assert.equal(stepperLabel(0, 3), "1 / 3");
  assert.equal(stepperLabel(5, 3), "3 / 3");
  assert.equal(stepperLabel(0, 1), "");
  assert.equal(stepperLabel(0, 0), "");
});

test("all the pictures are one more stop before the first", async () => {
  const { ALL, allLabel, stepWithAll } = await import("../js/shared/picture_steps.mjs");
  assert.equal(stepWithAll(ALL, 3, 1), 0);
  assert.equal(stepWithAll(0, 3, 1), 1);
  assert.equal(stepWithAll(2, 3, 1), ALL);
  assert.equal(stepWithAll(ALL, 3, -1), 2);
  assert.equal(stepWithAll(0, 3, -1), ALL);
  assert.equal(stepWithAll(1, 3, 0), 1);
  assert.equal(stepWithAll(0, 0, 1), ALL);
  assert.equal(allLabel(5), "all 5");
  assert.equal(allLabel(1), "");
});

test("the grid gives each picture the most room its shape allows", async () => {
  const { gridShape } = await import("../js/shared/picture_steps.mjs");
  // Five portraits in a tall stage: two across beats one row or one column.
  assert.deepEqual(gridShape(5, 440, 1100, 3 / 4), { columns: 2, rows: 3 });
  // The same five in a wide stage go in one row.
  assert.deepEqual(gridShape(5, 1600, 440, 3 / 4), { columns: 5, rows: 1 });
  // Wide pictures in a tall stage stack.
  assert.deepEqual(gridShape(3, 400, 900, 16 / 9), { columns: 1, rows: 3 });
  assert.deepEqual(gridShape(1, 400, 400, 1), { columns: 1, rows: 1 });
  // A stage that has no size yet still gets a whole grid.
  assert.deepEqual(gridShape(5, 0, 0, 1), { columns: 3, rows: 2 });
  assert.deepEqual(gridShape(4, 400, 400, Number.NaN), { columns: 2, rows: 2 });
});
