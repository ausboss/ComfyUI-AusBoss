import assert from "node:assert/strict";
import test from "node:test";

import { editedAsks, readAsks, writeAsks } from "../js/shared/h3_writer_gear_math.mjs";

test("an empty or broken model_asks reads as no wording of the node's own", () => {
  for (const value of ["", undefined, "nope", "[1]", '{"next": 3}']) assert.deepEqual(readAsks(value), {});
  assert.deepEqual(readAsks('{"next": "Write {count}.", "other": "x", "heard": "  "}'), { next: "Write {count}." });
});

test("saving a wording keeps the others, and an empty one goes back to built-in", () => {
  const one = writeAsks("", "next", "Write {count}.");
  assert.equal(one, '{"next":"Write {count}."}');
  const two = writeAsks(one, "tidy", "Be brief.");
  assert.deepEqual(JSON.parse(two), { next: "Write {count}.", tidy: "Be brief." });
  assert.deepEqual(JSON.parse(writeAsks(two, "next", "   ")), { tidy: "Be brief." });
  assert.equal(writeAsks(writeAsks(two, "next", ""), "tidy", ""), "");
});

test("the menu marks the wordings the node has changed", () => {
  assert.deepEqual([...editedAsks('{"describe": "x", "tidy": "y"}')].sort(), ["describe", "tidy"]);
  assert.equal(editedAsks("").size, 0);
});
