import assert from "node:assert/strict";
import test from "node:test";

import { moveMoment, retime, stripCaption, stripRows, wiredJobs } from "../js/shared/moment_strip_math.mjs";

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
  assert.deepEqual(stripCaption(null), { text: "Each line becomes a moment.", warn: false });
  assert.deepEqual(stripCaption({ moments: [] }), { text: "Each line becomes a moment.", warn: false });
});

test("the caption adds the script up", () => {
  assert.equal(stripCaption({ moments: [row(0, 2.5), row(2.5, 5)] }).text, "2 moments, 2.5 s each, one take.");
  assert.equal(stripCaption({ moments: [row(0, 8)] }).text, "1 moment, 8 s, one take.");
  assert.equal(stripCaption({ moments: [row(0, 3), row(3, 8)] }).text, "2 moments, one take.");
  assert.equal(stripCaption({ moments: [row(0, 3), row(3, 8, { cut: true })] }).text, "2 moments, 1 cut.");
});

test("only connected pictures send their job", () => {
  const values = { job_1: "person", job_2: "place", job_3: "thing", job_4: "style" };
  assert.deepEqual(wiredJobs(values, (name) => name === "picture_1" || name === "picture_4"), { 1: "person", 4: "style" });
});

test("a warning goes first", () => {
  assert.deepEqual(stripCaption({ warning: "Too many.", moments: [row(0, 5)] }), { text: "Too many.", warn: true });
});

test("retiming replaces every timestamp format the script accepts", () => {
  for (const prefix of ["0:03:", "0:03.500:", "3-6s:", "3s-6s:", "[at 3 seconds]", "at 3 secs,", "2.5s:", "3–6s:"]) {
    assert.equal(retime(`${prefix} She waves.`, 0, 5), "5s: She waves.", prefix);
  }
});

test("moving moments leaves clocks and time ranges in their original slots", () => {
  assert.equal(moveMoment("0:03: She waves.\n3-6s: She runs.", [0, 1], 1, 0), "0:03: She runs.\n3-6s: She waves.");
});
