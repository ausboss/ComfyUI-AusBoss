import assert from "node:assert/strict";
import test from "node:test";

import { grabZone, outputWindow, pickWrites, typedPick, wavePeaks } from "../js/load_audio/audio_window.mjs";

test("the face shows what the node hands on", () => {
  // Mirrors audio_window in nodes/_audio_trim_helpers.py.
  assert.deepEqual(outputWindow(40, 8, 30, 15), { start: 8, end: 30, keepEnd: 23, length: 15, cut: 7 });
  assert.deepEqual(outputWindow(40, 8, 12, 15), { start: 8, end: 12, keepEnd: 12, length: 4, cut: 0 });
  assert.equal(outputWindow(40, 5, 0, 0).end, 40, "OUT 0 means the end of the file");
  assert.equal(outputWindow(40, 30, 0, 20).keepEnd, 40, "a max past the end stops at the end");
  assert.equal(outputWindow(10, 50, 0).start, 10, "a start past the end is held at the end");
  assert.equal(outputWindow(10, "x", null, NaN).length, 10);
});

test("a pick is stored as a Start and a Duration", () => {
  // 2 s to 5 s of a 12 s file: Start 2, Duration 3, no end.
  assert.deepEqual(pickWrites(12, 2, 5), { start: 2, end: 0, max: 3 });
  // To the end of the file: no Duration, so a longer file later still runs to its end.
  assert.deepEqual(pickWrites(12, 2, 12), { start: 2, end: 0, max: 0 });
  // Hundredths, as the boxes show them; the Duration is the difference of the two.
  assert.deepEqual(pickWrites(12, 1.234, 3.606), { start: 1.23, end: 0, max: 2.38 });
  // A linked Duration cannot be written: the pick is a start and an end.
  assert.deepEqual(pickWrites(12, 2, 5, { maxLinked: true }), { start: 2, end: 5 });
  // A linked end leaves only the start to write.
  assert.deepEqual(pickWrites(12, 2, 5, { endLinked: true }), { start: 2 });
  // What it stores comes out as the same pick.
  const stored = pickWrites(12, 2, 5);
  assert.equal(outputWindow(12, stored.start, stored.end, stored.max).keepEnd, 5);
});

test("typing in a box: Start keeps the Duration, the other two keep the start", () => {
  const window = outputWindow(12, 2, 0, 3); // 2 s to 5 s
  assert.deepEqual(typedPick("start", 4, window, 12), { start: 4, end: 7 });
  assert.deepEqual(typedPick("start", 11, window, 12), { start: 11, end: 12 }, "less of it is left near the end");
  assert.deepEqual(typedPick("duration", 6, window, 12), { start: 2, end: 8 });
  assert.deepEqual(typedPick("end", 9, window, 12), { start: 2, end: 9 });
  assert.deepEqual(typedPick("end", 1, window, 12), { start: 2, end: 2.1 }, "an end before the start is held just after it");
  // 0 or an empty Duration, and an empty Ends at, run to the end of the file.
  assert.deepEqual(typedPick("duration", 0, window, 12), { start: 2, end: 12 });
  assert.deepEqual(typedPick("duration", null, window, 12), { start: 2, end: 12 });
  assert.deepEqual(typedPick("end", null, window, 12), { start: 2, end: 12 });
  assert.deepEqual(typedPick("start", null, window, 12), { start: 0, end: 3 }, "an empty Start is the beginning");
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
