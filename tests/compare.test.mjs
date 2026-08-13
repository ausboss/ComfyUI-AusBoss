import assert from "node:assert/strict";
import test from "node:test";

import {
  clipFraction,
  compareClip,
  findCompareImages,
  nextCompareMode,
  normalizeCompareMode,
} from "../js/shared/compare.mjs";

test("clip fraction follows the pointer and clamps to the panel", () => {
  assert.equal(clipFraction(150, 100, 200), 0.25);
  assert.equal(clipFraction(100, 100, 200), 0);
  assert.equal(clipFraction(40, 100, 200), 0);
  assert.equal(clipFraction(900, 100, 200), 1);
});

test("degenerate panels and junk input resolve to all-A", () => {
  assert.equal(clipFraction(150, 100, 0), 0);
  assert.equal(clipFraction(150, 100, -5), 0);
  assert.equal(clipFraction(NaN, 100, 200), 0);
  assert.equal(clipFraction(150, 100, "wide"), 0);
});

test("mode normalization and cycling", () => {
  assert.equal(normalizeCompareMode("slide"), "slide");
  assert.equal(normalizeCompareMode("hold"), "hold");
  assert.equal(normalizeCompareMode("wiggle"), "slide");
  assert.equal(normalizeCompareMode(undefined), "slide");
  assert.equal(nextCompareMode("slide"), "hold");
  assert.equal(nextCompareMode("hold"), "slide");
  assert.equal(nextCompareMode("junk"), "hold");
});

test("clip CSS keeps B left of the seam and hides the seam at the edges", () => {
  assert.deepEqual(compareClip(0.25), {
    clipPath: "inset(0 75.00% 0 0)",
    seamLeft: "25.00%",
    seamVisible: true,
  });
  assert.equal(compareClip(0).seamVisible, false);
  assert.equal(compareClip(1).seamVisible, false);
  assert.equal(compareClip(2).clipPath, "inset(0 0.00% 0 0)");
  assert.equal(compareClip("junk").clipPath, "inset(0 100.00% 0 0)");
});

test("compare previews are pulled from the execution payload as a pair", () => {
  const a = { filename: "a.png", subfolder: "", type: "temp" };
  const b = { filename: "b.png", subfolder: "", type: "temp" };
  assert.deepEqual(findCompareImages({ a_images: [a], b_images: [b] }), { a, b });
  assert.equal(findCompareImages({ a_images: [a] }), null);
  assert.equal(findCompareImages({ a_images: [{}], b_images: [b] }), null);
  assert.equal(findCompareImages(null), null);
});
