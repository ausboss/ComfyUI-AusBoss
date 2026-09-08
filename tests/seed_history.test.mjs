import assert from "node:assert/strict";
import test from "node:test";
import { SEED_HISTORY_LIMIT, formatSeed, pushSeed, seedFromExecuted } from "../js/shared/seed_history.mjs";

test("seedFromExecuted reads the ui payload in its shapes", () => {
  assert.equal(seedFromExecuted({ seed: [42] }), 42);
  assert.equal(seedFromExecuted({ seed: ["977"] }), 977);
  assert.equal(seedFromExecuted({ seed: 7 }), 7);
  assert.equal(seedFromExecuted({ seed: [-1] }), null);
  assert.equal(seedFromExecuted({}), null);
  assert.equal(seedFromExecuted(null), null);
});

test("pushSeed keeps newest first, dedups, and caps", () => {
  assert.deepEqual(pushSeed([1, 2, 3], 2), [2, 1, 3]);
  assert.deepEqual(pushSeed(null, 5), [5]);
  assert.deepEqual(pushSeed([1, "x", -2], 9), [9, 1]);
  const many = pushSeed([1, 2, 3, 4, 5, 6, 7, 8], 9);
  assert.equal(many.length, SEED_HISTORY_LIMIT);
  assert.equal(many[0], 9);
  assert.deepEqual(pushSeed([3, 4], NaN), [3, 4]);
});

test("formatSeed", () => {
  assert.equal(formatSeed(976771647159643), "976771647159643");
  assert.equal(formatSeed(undefined), "—");
});
