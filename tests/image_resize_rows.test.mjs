// Image Resize's card shows Fit and Fill only where the node reads them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readsFill, readsFit } from "../js/shared/image_resize_rows.mjs";

const MODES = ["width+height", "longest_edge", "shortest_edge", "megapixels", "scale_factor"];
const FITS = ["stretch", "fit", "cover_crop", "pad"];

test("Fit shows only for a width × height box, the one target the node fits", () => {
  for (const mode of MODES) {
    assert.equal(readsFit({ target_mode: mode }), mode === "width+height", mode);
  }
});

test("Fill shows only where pad is read", () => {
  for (const mode of MODES) {
    for (const fit of FITS) {
      const expected = mode === "width+height" && fit === "pad";
      assert.equal(readsFill({ target_mode: mode, keep_proportion: fit }), expected, `${mode} ${fit}`);
    }
  }
});
