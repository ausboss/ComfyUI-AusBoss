import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the unchanged-crop guarantee excludes resizing", () => {
  const help = read("js/docs/AUSBOSS_NODES_StitchInpaint.md");
  const guarantee = help.match(/- With the classic seam, feeding the crop[\s\S]*?(?=\n- )/)[0];
  assert.match(guarantee, /no resizing|never resized/);
});

test("Max zoom explains the extra allowance for padded reframing", () => {
  const help = read("js/docs/AUSBOSS_NODES_RealignToSource.md");
  const control = help.match(/- \*\*Max zoom\*\*:[\s\S]*?(?=\n\n)/)[0];
  assert.match(control, /padded[\s\S]*extra allowance/);
  assert.match(control, /Zooming out[\s\S]*stated limit/);
});

test("the technical starting Multiple agrees with the node default", () => {
  const help = read("js/docs/AUSBOSS_NODES_CropForInpaint.md");
  const source = read("nodes/node_inpaint_crop_stitch.py");
  const defaultMultiple = source.match(/"output_multiple"[\s\S]*?"default": (\d+)/)[1];
  const documented = help.match(/Starting values:[\s\S]*?Multiple `(\d+)`/)[1];
  assert.equal(documented, defaultMultiple);
});
