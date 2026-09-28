import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  HISTORY_LIMIT,
  cachedLayer,
  createTimer,
  formatElapsed,
  historyLine,
  layerScale,
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

function fakeCanvasFactory() {
  const made = [];
  const create = () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ canvas }) };
    made.push(canvas);
    return canvas;
  };
  return { made, create };
}

test("cachedLayer paints once while the key holds and repaints when it changes", () => {
  const { made, create } = fakeCanvasFactory();
  const cache = {};
  let paints = 0;
  const paint = () => paints++;
  let layer;
  for (let frame = 0; frame < 60; frame++) layer = cachedLayer(cache, "12|.3", 200.4, 60, paint, create);
  assert.equal(paints, 1);
  assert.equal(made.length, 1);
  assert.equal(layer.width, 201);
  assert.equal(layer.height, 60);
  const next = cachedLayer(cache, "12|.4", 90, 0, paint, create);
  assert.equal(paints, 2);
  assert.equal(next, layer, "the same canvas is reused, not reallocated");
  assert.deepEqual([next.width, next.height], [90, 1]);
});

test("layerScale rounds up to a quarter octave and caps the bitmap", () => {
  assert.equal(layerScale(1, 176), 1);
  assert.equal(layerScale(0.5, 176), 0.5);
  assert.equal(layerScale(1.1, 176), 2 ** 0.25);
  assert.ok(layerScale(1.25, 176) >= 1.25);
  assert.equal(layerScale(NaN, 176), 1);
  assert.equal(layerScale(0, 176), 1);
  assert.equal(layerScale(40, 400), 2048 / 400);
});

// Issue #77: a canvas filter on the graph canvas costs a full-canvas
// offscreen pass per draw in Chrome, every frame, for the whole graph.
test("the per-frame paint never blurs on the graph canvas itself", () => {
  const source = readFileSync(new URL("../js/run_timer/index.js", import.meta.url), "utf-8");
  const body = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `js/run_timer/index.js has no ${name}()`);
    return source.slice(start, source.indexOf("\n}\n", start));
  };
  for (const name of ["drawReadout", "drawGlow"]) {
    assert.doesNotMatch(body(name), /\.filter\b/, `${name}() sets a canvas filter on the graph canvas`);
    assert.doesNotMatch(body(name), /glowText\(/, `${name}() blurs text on the graph canvas`);
  }
  assert.match(body("drawGlow"), /cachedLayer\([\s\S]*paintGlow\(/, "the blurred passes must go through cachedLayer");
});
