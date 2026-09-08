import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_LIMIT,
  createTimer,
  formatElapsed,
  historyLine,
  startTimer,
  stopTimer,
  tickTimer,
} from "../js/shared/run_timer.mjs";

test("a run starts, ticks and stops into the history", () => {
  let state = createTimer();
  state = startTimer(state, 1000);
  assert.equal(state.running, true);
  state = tickTimer(state, 3500);
  assert.equal(state.elapsed, 2.5);
  state = stopTimer(state, 5000, "done");
  assert.equal(state.running, false);
  assert.equal(state.elapsed, 4);
  assert.deepEqual(state.history, [4]);
  assert.equal(state.outcome, "done");
});

test("only completed runs join the history, which is capped and newest first", () => {
  let state = createTimer([1, 2, 3, 4, 5, 6]);
  assert.deepEqual(state.history, [1, 2, 3, 4, 5]);
  state = stopTimer(startTimer(state, 0), 10000, "error");
  assert.deepEqual(state.history, [1, 2, 3, 4, 5]);
  assert.equal(state.outcome, "error");
  state = stopTimer(startTimer(state, 0), 7000, "done");
  assert.deepEqual(state.history, [7, 1, 2, 3, 4]);
  assert.equal(state.history.length, HISTORY_LIMIT);
});

test("ticking or stopping an idle timer leaves the elapsed value alone", () => {
  const state = createTimer();
  assert.equal(tickTimer(state, 99).elapsed, 0);
  assert.equal(stopTimer(state, 99, "interrupted").outcome, "interrupted");
});

test("createTimer ignores a corrupt saved history", () => {
  assert.deepEqual(createTimer(["x", -1, 2.5, null]).history, [2.5]);
  assert.deepEqual(createTimer("nope").history, []);
});

test("formatElapsed picks seconds, m:ss.t, or h:mm:ss", () => {
  assert.equal(formatElapsed(0), "0.0 s");
  assert.equal(formatElapsed(12.34), "12.3 s");
  assert.equal(formatElapsed(65.37), "1:05.3");
  assert.equal(formatElapsed(3723.9), "1:02:03");
  assert.equal(formatElapsed(NaN), "—");
});

test("historyLine joins the previous runs", () => {
  assert.equal(historyLine([]), "");
  assert.equal(historyLine([4, 65.4]), "4.0 s · 1:05.4");
});
