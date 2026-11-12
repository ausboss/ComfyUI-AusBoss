import assert from "node:assert/strict";
import test from "node:test";

import { keepIndex, keepWords, stepIndex, stepperLabel } from "../js/shared/picture_steps.mjs";

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

test("held pictures map to their run and their place in it", async () => {
  const { heldPlaces } = await import("../js/shared/picture_steps.mjs");
  const a = "0123456789abcdef";
  const b = "fedcba9876543210";
  const name = (token, index) => ({ filename: `${token}_00${index}.png`, subfolder: "ausboss_held", type: "temp" });
  // One run of three pictures.
  assert.deepEqual(
    heldPlaces({ images: [name(a, 0), name(a, 1), name(a, 2)], ausboss_held: [a] }),
    [{ token: a, index: 0 }, { token: a, index: 1 }, { token: a, index: 2 }],
  );
  // A list run: one picture from each of two runs.
  assert.deepEqual(
    heldPlaces({ images: [name(a, 0), name(b, 0)], ausboss_held: [a, b] }),
    [{ token: a, index: 0 }, { token: b, index: 0 }],
  );
  // A saved run holds nothing, and a picture from another run is not trusted.
  assert.deepEqual(heldPlaces({ images: [{ filename: "shot_00001.png" }] }), []);
  assert.deepEqual(heldPlaces({ images: [name(a, 0), name(b, 0)], ausboss_held: [a] }), []);
  assert.deepEqual(heldPlaces(undefined), []);
});

test("the row over held pictures says what is saved and what a click does", () => {
  // One picture: not saved, then saved under its name.
  assert.deepEqual(keepWords({ held: 1 }), { note: "Not saved yet", button: "Save picture", quiet: false });
  assert.deepEqual(keepWords({ held: 1, saving: true }), { note: "Not saved yet", button: "Saving...", quiet: false });
  assert.deepEqual(
    keepWords({ held: 1, kept: 1, done: true, name: "sheet_00001.png" }),
    { note: "Saved as sheet_00001.png", button: "Saved", quiet: true },
  );
  assert.equal(keepWords({ held: 1, kept: 1, done: true }).note, "Saved");
  // Several, all showing: every one, then only the ones left.
  assert.deepEqual(keepWords({ held: 4 }), { note: "Not saved yet", button: "Save all 4", quiet: false });
  assert.deepEqual(keepWords({ held: 4, kept: 1 }), { note: "1 of 4 saved", button: "Save the rest", quiet: false });
  assert.deepEqual(keepWords({ held: 4, kept: 4, done: true }), { note: "All 4 saved", button: "Saved", quiet: true });
  // The arrows on one picture: that one alone.
  assert.deepEqual(keepWords({ held: 4, kept: 1, all: false }), { note: "1 of 4 saved", button: "Save this one", quiet: false });
  assert.deepEqual(keepWords({ held: 4, kept: 1, all: false, done: true }), { note: "1 of 4 saved", button: "Saved", quiet: true });
});
