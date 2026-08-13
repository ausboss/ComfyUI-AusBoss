import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceExecution,
  composeTitle,
  createRunState,
  formatDuration,
  stripQueuePrefix,
} from "../js/shared/chrome.mjs";

test("composeTitle prefixes the queue depth", () => {
  assert.equal(composeTitle("ComfyUI", 3), "(3) ComfyUI");
  assert.equal(composeTitle("ComfyUI", 1), "(1) ComfyUI");
  assert.equal(composeTitle("ComfyUI", "12"), "(12) ComfyUI");
});

test("composeTitle restores the bare title at zero", () => {
  assert.equal(composeTitle("ComfyUI", 0), "ComfyUI");
  assert.equal(composeTitle("(4) ComfyUI", 0), "ComfyUI");
});

test("composeTitle never double-prefixes an already-prefixed title", () => {
  assert.equal(composeTitle("(2) ComfyUI", 5), "(5) ComfyUI");
  assert.equal(composeTitle("(2) (3) ComfyUI", 1), "(1) (3) ComfyUI");
});

test("composeTitle treats junk queue depths as idle", () => {
  assert.equal(composeTitle("ComfyUI", -1), "ComfyUI");
  assert.equal(composeTitle("ComfyUI", NaN), "ComfyUI");
  assert.equal(composeTitle("ComfyUI", undefined), "ComfyUI");
  assert.equal(composeTitle("(7) ComfyUI", "junk"), "ComfyUI");
});

test("stripQueuePrefix only removes the exact prefix form", () => {
  assert.equal(stripQueuePrefix("(3) ComfyUI"), "ComfyUI");
  assert.equal(stripQueuePrefix("(3)ComfyUI"), "(3)ComfyUI");
  assert.equal(stripQueuePrefix("(three) ComfyUI"), "(three) ComfyUI");
  assert.equal(stripQueuePrefix("My (3) tabs"), "My (3) tabs");
  assert.equal(stripQueuePrefix("ComfyUI"), "ComfyUI");
  assert.equal(stripQueuePrefix(undefined), "");
});

test("formatDuration picks the unit for the magnitude", () => {
  assert.equal(formatDuration(0.049), "49ms");
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(0.9994), "999ms");
  assert.equal(formatDuration(1.5), "1.50s");
  assert.equal(formatDuration(59.99), "59.99s");
  assert.equal(formatDuration(95), "1m35s");
  assert.equal(formatDuration(60), "1m0s");
  assert.equal(formatDuration(3599), "59m59s");
});

test("formatDuration carries rounded-up boundaries into the next unit", () => {
  assert.equal(formatDuration(0.9996), "1.00s");
  assert.equal(formatDuration(59.999), "1m0s");
});

test("formatDuration rejects junk", () => {
  assert.equal(formatDuration(-1), "");
  assert.equal(formatDuration(NaN), "");
  assert.equal(formatDuration(Infinity), "");
  assert.equal(formatDuration("soon"), "");
});

test("advanceExecution closes out the previous node", () => {
  const state = createRunState();
  assert.deepEqual(advanceExecution(state, "5", 1000), []);
  assert.equal(state.runningId, "5");
  const updates = advanceExecution(state, "7", 3500);
  assert.deepEqual(updates, [{ id: "5", seconds: 2.5 }]);
  assert.equal(state.totals.get("5"), 2.5);
  assert.equal(state.runningId, "7");
});

test("advanceExecution accumulates revisits so batched loops sum", () => {
  const state = createRunState();
  advanceExecution(state, "5", 0);
  advanceExecution(state, "7", 1000);
  advanceExecution(state, "5", 1500);
  const updates = advanceExecution(state, null, 3500);
  assert.deepEqual(updates, [{ id: "5", seconds: 3 }]);
  assert.equal(state.totals.get("5"), 3);
  assert.equal(state.totals.get("7"), 0.5);
  assert.equal(state.runningId, null);
});

test("advanceExecution is a no-op while idle", () => {
  const state = createRunState();
  assert.deepEqual(advanceExecution(state, null, 100), []);
  assert.equal(state.runningId, null);
  assert.equal(state.totals.size, 0);
});

test("advanceExecution normalizes ids and clamps a backwards clock", () => {
  const state = createRunState();
  advanceExecution(state, 5, 2000);
  assert.equal(state.runningId, "5");
  const updates = advanceExecution(state, null, 1000);
  assert.deepEqual(updates, [{ id: "5", seconds: 0 }]);
});
