import assert from "node:assert/strict";
import test from "node:test";

import { autoMaskValues } from "../js/shared/mask_auto.mjs";

test("the ladder is anchored on the hand-tuned watermark value", () => {
  // 8 px of expand and 4 of blur on a 576x1024 clip is the setting the video
  // watermark workflow was tuned to by hand; Auto has to agree with it or the
  // button argues with the example it ships beside.
  assert.deepEqual(autoMaskValues(576, 1024), { expand: 8, blur: 4 });
  assert.deepEqual(autoMaskValues(1024, 576), { expand: 8, blur: 4 });
});

test("values scale with the short edge, not the long one", () => {
  // A tall clip and a square one of the same width get the same feather: what
  // matters is how many pixels across the subject is, not the frame's area.
  assert.deepEqual(autoMaskValues(512, 512), autoMaskValues(512, 4096));
  assert.ok(autoMaskValues(1080, 1920).expand > autoMaskValues(576, 1024).expand);
  assert.ok(autoMaskValues(256, 256).expand < autoMaskValues(576, 1024).expand);
});

test("blur is half the expand and stays on one decimal", () => {
  for (const [w, h] of [[128, 128], [576, 1024], [1080, 1920], [2160, 3840]]) {
    const { expand, blur } = autoMaskValues(w, h);
    assert.equal(blur, Math.round(expand * 5) / 10);
    // A widget value with a long float tail reads as a bug, not a suggestion.
    const decimals = String(blur).split(".")[1]?.length ?? 0;
    assert.ok(decimals <= 1, `${blur} has ${decimals} decimals`);
  }
});

test("tiny pictures still get a usable grow, huge ones stay sane", () => {
  // Rounding alone would hand a 32 px thumbnail an expand of 0, which is a
  // button that appears to do nothing.
  assert.equal(autoMaskValues(32, 32).expand, 1);
  assert.ok(autoMaskValues(16000, 16000).expand <= 64);
});

test("a size that cannot be measured yields nothing to apply", () => {
  for (const args of [[0, 0], [512, 0], [NaN, 512], [undefined, undefined], [-4, 8]]) {
    assert.equal(autoMaskValues(...args), null);
  }
});
