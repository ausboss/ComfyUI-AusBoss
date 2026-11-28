import assert from "node:assert/strict";
import test from "node:test";

import { castLines, castPieces, readLines, stripCaption, stripRows, wiredJobs } from "../js/shared/moment_strip_math.mjs";

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
test("a swap's plain reading says who each new person replaces, in sentences, and the words it leaves out", () => {
  const lines = readLines({
    people: [
      { slot: 1, goes: "the man in front", looks: "a game character with a blue suit", named: true },
      { slot: 2, goes: "the person on the right", looks: "", named: false },
    ],
    unused: ["make her smile"],
    keeps_clip_clothes: false,
  });
  assert.deepEqual(lines, [
    { text: "@1 replaces the man in front. Looks like a game character with a blue suit.", warn: false },
    { text: "@2 replaces the person on the right (no one named).", warn: false },
    { text: "Not used: “make her smile”. A swap keeps the clip's camera and moves; only spoken lines in quotes change.", warn: true },
  ]);
});

test("a swap's plain reading says when the clip keeps its clothes, and shows a refused line's reason", () => {
  assert.deepEqual(readLines({ people: [{ slot: 1, goes: "the woman", looks: "", named: true }], unused: [], keeps_clip_clothes: true }), [
    { text: "@1 replaces the woman. Keeps the clip's clothes.", warn: false },
  ]);
  assert.deepEqual(readLines({ people: [], unused: [], keeps_clip_clothes: false, problem: "Picture 3 is not connected." }), [
    { text: "Picture 3 is not connected.", warn: true },
  ]);
  assert.deepEqual(readLines(undefined), []);
});

test("the Ref2VA view lists the cast lines the writer sends, then words it leaves out", () => {
  const read = { people: [], cast: ["<Subject 1> the man in <Video 1> → removed"], unused: ["make her smile"], keeps_clip_clothes: false };
  assert.deepEqual(castLines(read), [
    { text: "<Subject 1> the man in <Video 1> → removed", warn: false },
    { text: "Not sent: “make her smile” (a swap keeps the clip's camera and moves)", warn: true },
  ]);
  assert.deepEqual(castLines({ problem: "Picture 2 is not connected." }), [{ text: "Picture 2 is not connected.", warn: true }]);
});

test("a cast line splits into coloured tags and plain words", () => {
  assert.deepEqual(castPieces("<Subject 2> = the person in <Picture 1>, takes <Subject 1>'s place"), [
    { kind: "subject", text: "<Subject 2>" },
    { kind: "", text: " = the person in " },
    { kind: "picture", text: "<Picture 1>" },
    { kind: "", text: ", takes " },
    { kind: "subject", text: "<Subject 1>" },
    { kind: "", text: "'s place" },
  ]);
  assert.deepEqual(castPieces("<Subject 1> the man in <Video 1> → removed").map((piece) => piece.kind), ["subject", "", "video", "", "removed"]);
  assert.deepEqual(castPieces("<Subject 4> says <d>Hi.</d>").map((piece) => piece.kind), ["subject", "", "speech", "", "speech"]);
});

test("plain words name every other picture and who speaks", () => {
  const lines = readLines({
    people: [{ slot: 1, goes: "the man", looks: "", named: true }], unused: [], keeps_clip_clothes: false,
    pictures: [
      { slot: 2, job: "place", worn_by: null }, { slot: 3, job: "outfit", worn_by: 1 },
      { slot: 4, job: "thing", worn_by: null }, { slot: 2, job: "style", worn_by: null },
    ],
    says: [{ slot: 1, words: "Hello there." }, { slot: null, words: "Hi." }],
  });
  assert.deepEqual(lines.map((line) => line.text), [
    "@1 replaces the man.",
    "@2 is the place.",
    "@3 is the outfit @1 wears.",
    "@4 is a thing in the shot.",
    "@2 sets the style.",
    "@1 says \u201cHello there.\u201d",
    "Someone in the clip says \u201cHi.\u201d",
  ]);
});
