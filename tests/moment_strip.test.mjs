import assert from "node:assert/strict";
import test from "node:test";

import { readLines, stripCaption, stripRows, wiredJobs } from "../js/shared/moment_strip_math.mjs";

const row = (start, end, extra = {}) => ({ start, end, text: "She runs", cut: false, speech: false, ...extra });

test("a row says its second and its words, and its bar sits where it plays", () => {
  const rows = stripRows({ seconds: 10, moments: [row(0, 2.5), row(2.5, 10)] });
  assert.deepEqual(rows.map((moment) => moment.second), ["0", "2.5"]);
  assert.equal(rows[1].words, "She runs");
  assert.deepEqual(rows.map((moment) => [moment.from, moment.to]), [[0, 25], [25, 100]]);
});

test("a moment with no time left still shows a sliver", () => {
  const [moment] = stripRows({ seconds: 8, moments: [row(4, 4)] });
  assert.ok(moment.to > moment.from);
});

test("cuts and speech are marked", () => {
  const rows = stripRows({ seconds: 8, moments: [row(0, 3, { cut: true }), row(3, 6, { speech: true })] });
  assert.deepEqual(rows.map((moment) => [moment.cut, moment.speech]), [[true, false], [false, true]]);
});

test("no report and an empty script draw nothing and say what to do", () => {
  assert.deepEqual(stripRows(null), []);
  assert.deepEqual(stripCaption(null), { text: "Each line becomes a moment. A blank line between lines is a cut.", warn: false });
  assert.deepEqual(stripCaption({ moments: [] }), { text: "Each line becomes a moment. A blank line between lines is a cut.", warn: false });
});

test("the caption adds the script up", () => {
  assert.equal(stripCaption({ moments: [row(0, 2.5), row(2.5, 5)] }).text, "2 moments, 2.5 s each, one take. Click between two moments to cut there.");
  assert.equal(stripCaption({ moments: [row(0, 8)] }).text, "1 moment, 8 s, one take. Add a line for the next moment, a blank line to cut.");
  assert.equal(stripCaption({ moments: [row(0, 3), row(3, 8)] }).text, "2 moments, one take. Click between two moments to cut there.");
  assert.equal(stripCaption({ moments: [row(0, 3), row(3, 8, { cut: true })] }).text, "2 moments, 1 cut. Click a cut on the bar to join the shots.");
});

test("only connected pictures send their job", () => {
  const values = { job_1: "person", job_2: "place", job_3: "thing", job_4: "style" };
  assert.deepEqual(wiredJobs(values, (name) => name === "picture_1" || name === "picture_4"), { 1: "person", 4: "style" });
});

test("a warning goes first", () => {
  assert.deepEqual(stripCaption({ warning: "Too many.", moments: [row(0, 5)] }), { text: "Too many.", warn: true });
});

test("a swap's reading lists who each new person replaces and the words it leaves out", () => {
  const lines = readLines({
    people: [
      { slot: 1, goes: "the man in front", looks: "a game character with a blue suit", named: true },
      { slot: 2, goes: "the person on the right", looks: "", named: false },
    ],
    unused: ["make her smile"],
    keeps_clip_clothes: false,
  });
  assert.deepEqual(lines, [
    { text: "@1 replaces the man in front · looks like a game character with a blue suit", warn: false },
    { text: "@2 replaces the person on the right (no one named)", warn: false },
    { text: "Not used: “make her smile”. A swap keeps the clip's camera and moves; only spoken lines in quotes change.", warn: true },
  ]);
});

test("a swap's reading says when the clip keeps its clothes, and shows a refused line's reason", () => {
  assert.deepEqual(readLines({ people: [{ slot: 1, goes: "the woman", looks: "", named: true }], unused: [], keeps_clip_clothes: true }), [
    { text: "@1 replaces the woman · keeps the clip's clothes", warn: false },
  ]);
  assert.deepEqual(readLines({ people: [], unused: [], keeps_clip_clothes: false, problem: "Picture 3 is not connected." }), [
    { text: "Picture 3 is not connected.", warn: true },
  ]);
  assert.deepEqual(readLines(undefined), []);
});
