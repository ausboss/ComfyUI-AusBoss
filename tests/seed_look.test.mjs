import assert from "node:assert/strict";
import test from "node:test";

import { SEED_LOOK_PROPERTY, controlChip, nextControl, seedLook, setSeedLook } from "../js/shared/seed_look.mjs";

test("the look lives on the node, and full leaves nothing behind", () => {
  const node = { properties: {} };
  assert.equal(seedLook(node), "full");
  assert.equal(setSeedLook(node, "compact"), "compact");
  assert.equal(node.properties[SEED_LOOK_PROPERTY], "compact");
  assert.equal(setSeedLook(node, "full"), "full");
  assert.deepEqual(node.properties, {});
  assert.equal(seedLook(null), "full");
  assert.equal(seedLook({ properties: { [SEED_LOOK_PROPERTY]: "huge" } }), "full");
});

test("the chip walks Random, Fixed, +1, -1 and back", () => {
  assert.equal(nextControl("randomize"), "fixed");
  assert.equal(nextControl("fixed"), "increment");
  assert.equal(nextControl("increment"), "decrement");
  assert.equal(nextControl("decrement"), "randomize");
  assert.equal(nextControl("something else"), "randomize");
  assert.equal(controlChip("randomize").text, "Random");
  assert.equal(controlChip("fixed").text, "Fixed");
  assert.equal(controlChip(undefined).text, "Fixed");
});
