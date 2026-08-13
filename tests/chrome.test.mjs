import test from "node:test";
import assert from "node:assert/strict";

import { composeTitle, stripQueuePrefix } from "../js/shared/chrome.mjs";

test("composeTitle prefixes the queue depth", () => {
  assert.equal(composeTitle("ComfyUI", 3), "(3) ComfyUI");
  assert.equal(composeTitle("ComfyUI", 1), "(1) ComfyUI");
  assert.equal(composeTitle("ComfyUI", "12"), "(12) ComfyUI");
});

test("composeTitle restores the bare title at zero", () => {
  assert.equal(composeTitle("ComfyUI", 0), "ComfyUI");
  assert.equal(composeTitle("(4) ComfyUI", 0), "ComfyUI");
});

test("composeTitle never double-prefixes an already-prefixed title", () => {
  assert.equal(composeTitle("(2) ComfyUI", 5), "(5) ComfyUI");
  assert.equal(composeTitle("(2) (3) ComfyUI", 1), "(1) (3) ComfyUI");
});

test("composeTitle treats junk queue depths as idle", () => {
  assert.equal(composeTitle("ComfyUI", -1), "ComfyUI");
  assert.equal(composeTitle("ComfyUI", NaN), "ComfyUI");
  assert.equal(composeTitle("ComfyUI", undefined), "ComfyUI");
  assert.equal(composeTitle("(7) ComfyUI", "junk"), "ComfyUI");
});

test("stripQueuePrefix only removes the exact prefix form", () => {
  assert.equal(stripQueuePrefix("(3) ComfyUI"), "ComfyUI");
  assert.equal(stripQueuePrefix("(3)ComfyUI"), "(3)ComfyUI");
  assert.equal(stripQueuePrefix("(three) ComfyUI"), "(three) ComfyUI");
  assert.equal(stripQueuePrefix("My (3) tabs"), "My (3) tabs");
  assert.equal(stripQueuePrefix("ComfyUI"), "ComfyUI");
  assert.equal(stripQueuePrefix(undefined), "");
});
