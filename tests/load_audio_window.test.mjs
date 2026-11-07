import assert from "node:assert/strict";
import test from "node:test";

import { grabZone, outputSummary, outputWindow, wavePeaks } from "../js/load_audio/audio_window.mjs";

test("the face shows what the node hands on", () => {
  // Mirrors audio_window in nodes/_audio_trim_helpers.py.
  assert.deepEqual(outputWindow(40, 8, 30, 15), { start: 8, end: 30, keepEnd: 23, length: 15, cut: 7 });
  assert.deepEqual(outputWindow(40, 8, 12, 15), { start: 8, end: 12, keepEnd: 12, length: 4, cut: 0 });
  assert.equal(outputWindow(40, 5, 0, 0).end, 40, "OUT 0 means the end of the file");
  assert.equal(outputWindow(40, 30, 0, 20).keepEnd, 40, "a max past the end stops at the end");
  assert.equal(outputWindow(10, 50, 0).start, 10, "a start past the end is held at the end");
  assert.equal(outputWindow(10, "x", null, NaN).length, 10);
});

test("the line between IN and OUT says how long and what is cut", () => {
  assert.equal(outputSummary(outputWindow(40, 8, 30, 15)), "15.0 s · cut 7.0 s");
  assert.equal(outputSummary(outputWindow(200, 0, 0, 0)), "3:20.0");
  assert.equal(outputSummary(outputWindow(40, 8, 30, 0), { maxFromLink: true }), "22.0 s · max wired");
  assert.equal(outputSummary(outputWindow(0, 0, 0)), "");
});

test("a press grabs the nearest handle, the middle, or jumps", () => {
  const win = outputWindow(40, 10, 30);
  assert.equal(grabZone(win, 40, 0.25, 400), "start");
  assert.equal(grabZone(win, 40, 0.75, 400), "end");
  assert.equal(grabZone(win, 40, 0.5, 400), "move");
  assert.equal(grabZone(win, 40, 0.05, 400), "jump");
  assert.equal(grabZone(win, 0, 0.5, 400), "none");
});

test("peaks keep the loudest sample of each slice, channels mixed", () => {
  const left = Float32Array.from([0, 0.5, -0.5, 0, 1, -1]);
  const right = Float32Array.from([0, 0.5, -0.5, 0, 1, -1]);
  const peaks = wavePeaks([left, right], 2);
  assert.deepEqual(Array.from(peaks), [-0.5, 0.5, -1, 1]);
  assert.equal(wavePeaks([], 3).length, 6);
});
