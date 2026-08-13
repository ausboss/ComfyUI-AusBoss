import assert from "node:assert/strict";
import test from "node:test";

import {
  allFrames,
  cancelPayload,
  continuePayload,
  countdownText,
  noFrames,
  selectionSummary,
  sortedFrames,
  toggleFrame,
  validFrames,
} from "../js/shared/frame_chooser.mjs";

test("toggling flips membership without mutating the input set", () => {
  const original = new Set([2, 5]);
  const added = toggleFrame(original, 3);
  const removed = toggleFrame(added, 5);
  assert.deepEqual(sortedFrames(added), [2, 3, 5]);
  assert.deepEqual(sortedFrames(removed), [2, 3]);
  assert.deepEqual(sortedFrames(original), [2, 5]);
});

test("select all and none produce the full and empty sets", () => {
  assert.deepEqual(sortedFrames(allFrames(4)), [1, 2, 3, 4]);
  assert.equal(allFrames(0).size, 0);
  assert.equal(noFrames().size, 0);
});

test("remembered selections are filtered to the current batch", () => {
  assert.deepEqual(sortedFrames(validFrames([2, 5, 40, 0, 1.5, "3"], 10)), [2, 5]);
  assert.equal(validFrames(undefined, 10).size, 0);
  assert.equal(validFrames("2,5", 10).size, 0);
});

test("continue payloads are one-based, sorted, and keep-all posts an empty list", () => {
  assert.deepEqual(continuePayload("7", new Set([9, 1, 4])), {
    node_id: "7",
    action: "continue",
    selected: [1, 4, 9],
  });
  assert.deepEqual(continuePayload("7", noFrames()).selected, []);
  assert.deepEqual(cancelPayload("7"), { node_id: "7", action: "cancel" });
});

test("the header summary counts the selection against the batch", () => {
  assert.equal(selectionSummary(new Set([1, 2, 3]), 24), "3 of 24 selected");
  assert.equal(selectionSummary(noFrames(), 24), "0 of 24 selected");
});

test("the countdown names the seconds left and the timeout policy", () => {
  assert.equal(countdownText(42, "keep all"), "42s to keep all");
  assert.equal(countdownText(4.2, "cancel"), "5s to cancel");
  assert.equal(countdownText(3, ""), "3s to keep all");
});

test("no countdown renders while the timer is off or expired", () => {
  assert.equal(countdownText(0, "keep all"), "");
  assert.equal(countdownText(-2, "cancel"), "");
  assert.equal(countdownText(undefined, "keep all"), "");
  assert.equal(countdownText("soon", "keep all"), "");
});
