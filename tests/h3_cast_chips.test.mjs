import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../js/shared/h3_cast_chips.mjs", import.meta.url), "utf-8");

test("a chip's job list stays open while an item is pressed", () => {
  // Pressing an item takes focus off the chip's button. A capturing blur
  // listener heard that and closed the list before the click could pick.
  const blur = source.match(/addEventListener\("blur",[^\n]*/)?.[0] ?? "";
  assert.match(blur, /event\.target === window/, "only the window losing focus closes the list");
  assert.doesNotMatch(blur, /\bon\)/, "the blur listener is not the capturing set");
  assert.match(source, /menu\.addEventListener\("mousedown", \(event\) => event\.preventDefault\(\)\)/, "a press keeps focus on the button");
});

// One CSS rule's declarations, by its selector as written in the module.
const rule = (selector) => source.split("\n").find((line) => line.startsWith(`${selector}{`))?.slice(selector.length + 1, -1) ?? "";

test("the chips stay on their one row and never drop onto the row below", () => {
  // The row is 30 px tall. Five chips with their pictures need more width
  // than the node opens with, and chips that wrapped drew the video chip over
  // the Length row, where a click could land on Length instead. They share
  // the one line: columns that take what their words need while there is
  // room, and give way widest first when there is not.
  assert.match(rule(".ausboss-chips"), /display:grid;grid-auto-flow:column;grid-auto-columns:minmax\(0,max-content\)/);
  assert.doesNotMatch(rule(".ausboss-chips"), /wrap/);
  assert.match(rule(".ausboss-chip"), /(^|;)min-width:0(;|$)/, "a chip may get narrower than its words");
  assert.match(rule(".ausboss-chip-pick"), /text-overflow:ellipsis/);
  assert.match(rule(".ausboss-chip-pick"), /(^|;)min-width:0(;|$)/);
});

test("a job cut short can still be read: the chip's hint starts with it", () => {
  const choice = source.slice(source.indexOf("function choice("), source.indexOf("// The jobs have no socket"));
  assert.match(choice, /button\.title = \[String\(value \?\? ""\), hint\]\.filter\(Boolean\)\.join\("\\n"\)/);
});
