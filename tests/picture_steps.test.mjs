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
