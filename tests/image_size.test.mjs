// Image Size shows what it measured beside its outputs, and saves none of it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { savedLabel, sizeLabel, sizesFromExecuted } from "../js/shared/image_size.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the numbers of one measured batch are read from the run's message", () => {
  assert.deepEqual(sizesFromExecuted({ ausboss_size: [832, 480, 832, 480, 2] }), [832, 480, 832, 480, 2]);
  assert.equal(sizeLabel("width", 832), "width: 832");
  assert.equal(sizeLabel("count", 2), "count: 2");
});

test("anything else shows nothing", () => {
  assert.equal(sizesFromExecuted(undefined), null);
  assert.equal(sizesFromExecuted({}), null);
  assert.equal(sizesFromExecuted({ ausboss_size: "832" }), null);
  assert.equal(sizesFromExecuted({ ausboss_size: [832, 480] }), null);
  assert.equal(sizesFromExecuted({ ausboss_size: [832, 480, 832, 480, "2"] }), null);
  // Two batches measured in one go (a list): no one number is true for both.
  assert.equal(sizesFromExecuted({ ausboss_size: [832, 480, 832, 480, 2, 640, 640, 640, 640, 1] }), null);
});

test("a shown number is never saved: the output keeps the label its user gave it, or none", () => {
  assert.equal(savedLabel({ shown: true, own: undefined }, "width: 832"), undefined);
  assert.equal(savedLabel({ shown: true, own: "W" }, "W: 832"), "W");
  // An output that never showed a size is saved as it is.
  assert.equal(savedLabel({ shown: false, own: undefined }, "my width"), "my width");
  assert.equal(savedLabel({ shown: false, own: undefined }, undefined), undefined);
});

test("the backend sends the numbers in the order of the outputs, and the outputs are unchanged", () => {
  const backend = readFileSync(join(ROOT, "nodes", "node_image_size.py"), "utf-8");
  assert.match(backend, /RETURN_NAMES = \("width", "height", "longest_edge", "shortest_edge", "count"\)/);
  assert.match(backend, /sizes = \(width, height, max\(width, height\), min\(width, height\), int\(image\.shape\[0\]\)\)/);
  assert.match(backend, /return \{"ui": \{"ausboss_size": list\(sizes\)\}, "result": sizes\}/);
});
