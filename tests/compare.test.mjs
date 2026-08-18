import assert from "node:assert/strict";
import test from "node:test";

import {
  clipFraction,
  compareClip,
  compareSizeLabel,
  findCompareImages,
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

test("mode normalization", () => {
  assert.equal(normalizeCompareMode("slide"), "slide");
  assert.equal(normalizeCompareMode("toggle"), "toggle");
  assert.equal(normalizeCompareMode("wiggle"), "slide");
  assert.equal(normalizeCompareMode(undefined), "slide");
});

test("a workflow saved on the old hold mode lands on the toggle it became", () => {
  // Dropping it to slide instead would silently change how a saved node
  // behaves, which is exactly what someone reopening their graph notices.
  assert.equal(normalizeCompareMode("hold"), "toggle");
});

test("the caption names the compared resolution, once", () => {
  assert.equal(
    compareSizeLabel({ a: { width: 576, height: 1024 }, b: { width: 576, height: 1024 } }),
    "576×1024",
  );
  // One side only is the common case mid-load; A speaks for the pair.
  assert.equal(compareSizeLabel({ a: { width: 512, height: 512 } }), "512×512");
});

test("a size mismatch is stated rather than hidden behind A", () => {
  // Comparing images of different sizes is usually a wiring mistake, and the
  // panel stretches both to fit, so nothing else on screen would show it.
  assert.equal(
    compareSizeLabel({ a: { width: 512, height: 512 }, b: { width: 1024, height: 1024 } }),
    "A 512×512 · B 1024×1024",
  );
});

test("nothing loaded means no caption at all", () => {
  assert.equal(compareSizeLabel(null), "");
  assert.equal(compareSizeLabel({}), "");
  assert.equal(compareSizeLabel({ a: { width: 0, height: 0 } }), "");
  assert.equal(compareSizeLabel({ a: { filename: "x.png" } }), "");
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
