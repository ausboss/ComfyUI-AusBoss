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
