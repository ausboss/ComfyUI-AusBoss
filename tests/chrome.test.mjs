import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceExecution,
  applyStatus,
  badgeFor,
  clearStatuses,
  composeTitle,
  createRunState,
  createStatusState,
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

test("applyStatus stores a normalized entry per node id", () => {
  const state = createStatusState();
  assert.equal(applyStatus(state, { node_id: 5, text: "frame 2/9", progress: 0.25 }), "5");
  assert.deepEqual(state.entries.get("5"), { text: "frame 2/9", progress: 0.25 });
});

test("applyStatus clamps progress and treats junk as no progress", () => {
  const state = createStatusState();
  applyStatus(state, { node_id: "1", text: "a", progress: 2 });
  assert.equal(state.entries.get("1").progress, 1);
  applyStatus(state, { node_id: "1", text: "a", progress: -0.5 });
  assert.equal(state.entries.get("1").progress, 0);
  for (const progress of [null, undefined, NaN, "soon"]) {
    applyStatus(state, { node_id: "1", text: "a", progress });
    assert.equal(state.entries.get("1").progress, null);
  }
});

test("applyStatus keeps badge text to one capped ASCII line", () => {
  const state = createStatusState();
  applyStatus(state, { node_id: "1", text: "  frame\n3/4 — ok  " });
  assert.equal(state.entries.get("1").text, "frame 3/4 ok");
  applyStatus(state, { node_id: "1", text: "x".repeat(40) });
  assert.equal(state.entries.get("1").text, "x".repeat(24));
});

test("applyStatus retracts a badge on empty text", () => {
  const state = createStatusState();
  applyStatus(state, { node_id: "1", text: "working" });
  assert.equal(applyStatus(state, { node_id: "1", text: "" }), "1");
  assert.equal(state.entries.has("1"), false);
  // Nothing to retract the second time around.
  assert.equal(applyStatus(state, { node_id: "1", text: "   " }), null);
});

test("applyStatus rejects payloads without a node id", () => {
  const state = createStatusState();
  for (const detail of [undefined, {}, { node_id: null, text: "a" }, { node_id: "", text: "a" }]) {
    assert.equal(applyStatus(state, detail), null);
  }
  assert.equal(state.entries.size, 0);
});

test("clearStatuses retires everything and reports what it cleared", () => {
  const state = createStatusState();
  applyStatus(state, { node_id: "1", text: "a" });
  applyStatus(state, { node_id: "2", text: "b" });
  assert.deepEqual(clearStatuses(state).sort(), ["1", "2"]);
  assert.equal(state.entries.size, 0);
  assert.deepEqual(clearStatuses(state), []);
});

test("clearStatuses keeps the node still executing", () => {
  const state = createStatusState();
  applyStatus(state, { node_id: "1", text: "a" });
  applyStatus(state, { node_id: "2", text: "b" });
  assert.deepEqual(clearStatuses(state, 2), ["1"]);
  assert.deepEqual([...state.entries.keys()], ["2"]);
});

test("badgeFor prefers a live status over the runtime badge", () => {
  const badge = badgeFor({ text: "frame 2/9", progress: 0.25 }, 12.5);
  assert.deepEqual(badge, { kind: "live", text: "frame 2/9", progress: 0.25 });
});

test("badgeFor falls back to the runtime badge once the status is gone", () => {
  assert.deepEqual(badgeFor(null, 1.5), { kind: "runtime", text: "1.50s", progress: null });
  assert.deepEqual(badgeFor(undefined, 0), { kind: "runtime", text: "0ms", progress: null });
  assert.deepEqual(badgeFor({ text: "" }, 1.5), {
    kind: "runtime",
    text: "1.50s",
    progress: null,
  });
});

test("badgeFor draws nothing without a status or a runtime", () => {
  assert.equal(badgeFor(null, undefined), null);
  assert.equal(badgeFor({ text: "  " }, null), null);
  assert.equal(badgeFor(null, "12"), null);
  assert.equal(badgeFor(null, -1), null);
});
