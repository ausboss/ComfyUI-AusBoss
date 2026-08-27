import assert from "node:assert/strict";
import test from "node:test";

import { queueRemaining, shouldChime } from "../js/shared/notify.mjs";

test("queue remaining reads both status event shapes", () => {
  assert.equal(queueRemaining({ exec_info: { queue_remaining: 3 } }), 3);
  assert.equal(queueRemaining({ status: { exec_info: { queue_remaining: 0 } } }), 0);
});

test("unknown shapes resolve to null, never to an empty queue", () => {
  assert.equal(queueRemaining(null), null);
  assert.equal(queueRemaining(undefined), null);
  assert.equal(queueRemaining({}), null);
  assert.equal(queueRemaining({ exec_info: {} }), null);
  assert.equal(queueRemaining({ exec_info: { queue_remaining: "soon" } }), null);
});

test("the chime marks the busy-to-idle transition only", () => {
  assert.equal(shouldChime(true, 1, 0), true);
  assert.equal(shouldChime(true, 5, 0), true);
  // Page opened onto an idle queue: no transition, no chime.
  assert.equal(shouldChime(true, 0, 0), false);
  // Mid-run ticks stay silent.
  assert.equal(shouldChime(true, 3, 2), false);
  // Queue refilling is not completion.
  assert.equal(shouldChime(true, 0, 2), false);
});

test("the setting gates the chime entirely", () => {
  assert.equal(shouldChime(false, 1, 0), false);
  assert.equal(shouldChime(undefined, 1, 0), false);
});
