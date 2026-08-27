// The Show Text panel's decision logic: how an executed message becomes the
// one string the panel renders, and where the display (not the wire) cuts a
// runaway string off.

import assert from "node:assert/strict";
import test from "node:test";
import { DISPLAY_LIMIT, displayText, textFromExecuted } from "../js/shared/show_text.mjs";

test("a plain ui payload comes back as its string", () => {
  assert.equal(textFromExecuted({ text: ["hello"] }), "hello");
});

test("multiple entries join on newlines", () => {
  assert.equal(textFromExecuted({ text: ["a", "b"] }), "a\nb");
});

test("nested arrays flatten in order", () => {
  assert.equal(textFromExecuted({ text: [["a", ["b"]], "c"] }), "a\nb\nc");
});

test("non-string entries are stringified rather than dropped", () => {
  assert.equal(textFromExecuted({ text: [7] }), "7");
});

test("an empty string is a real result, not a missing one", () => {
  // "" means "the run delivered empty text" and the panel says so; null
  // means "nothing arrived" and the panel keeps its placeholder.
  assert.equal(textFromExecuted({ text: [""] }), "");
});

test("nothing arriving is null, so the placeholder survives", () => {
  assert.equal(textFromExecuted(undefined), null);
  assert.equal(textFromExecuted({}), null);
  assert.equal(textFromExecuted({ text: [] }), null);
  assert.equal(textFromExecuted({ text: null }), null);
  assert.equal(textFromExecuted({ images: [{}] }), null);
});

test("short text displays whole", () => {
  assert.deepEqual(displayText("short"), { text: "short", truncated: false });
});

test("text at the limit is not truncated", () => {
  const exact = "x".repeat(DISPLAY_LIMIT);
  assert.deepEqual(displayText(exact), { text: exact, truncated: false });
});

test("text over the limit truncates at the limit", () => {
  const long = "x".repeat(DISPLAY_LIMIT + 5);
  const shown = displayText(long);
  assert.equal(shown.truncated, true);
  assert.equal(shown.text.length, DISPLAY_LIMIT);
});

test("a custom limit is honored", () => {
  assert.deepEqual(displayText("abcdef", 3), { text: "abc", truncated: true });
});

test("non-strings display as nothing", () => {
  assert.deepEqual(displayText(undefined), { text: "", truncated: false });
  assert.deepEqual(displayText(42), { text: "", truncated: false });
});
