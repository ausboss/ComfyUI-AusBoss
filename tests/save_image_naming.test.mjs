import assert from "node:assert/strict";
import test from "node:test";

import {
  namingMode, previewFolder, previewName, stripImageExtension, tagsEnabled,
} from "../js/shared/save_image_naming.mjs";

const now = new Date(2026, 8, 3, 14, 5, 9);

test("namingMode: linked beats exact beats local", () => {
  assert.equal(namingMode({ filenameLinked: true, exactName: "x" }), "linked");
  assert.equal(namingMode({ filenameLinked: false, exactName: " photo " }), "exact");
  assert.equal(namingMode({ filenameLinked: false, exactName: "" }), "local");
});

test("previewName composes prefix and tags in the backend's order", () => {
  const base = { filename_prefix: "sets/shot", format: "png", exact_name: "", name_counter: true };
  assert.equal(previewName(base, { now }), "shot_#####.png");
  assert.equal(previewName({ ...base, name_date: true, name_time: true, name_size: true, name_batch: true }, { now }), "shot_2026-09-03_14-05-09_WxH_#####_b###.png");
  assert.equal(previewName({ ...base, name_size: true, name_counter: false }, { now, size: { width: 1024, height: 1536 } }), "shot_1024x1536.png");
  assert.equal(previewName({ ...base, format: "webp lossless" }, { now }), "shot_#####.webp");
  assert.equal(previewName({ ...base, filename_prefix: "" }, { now }), "image_#####.png");
});

test("previewName in exact and linked modes", () => {
  assert.equal(previewName({ filename_prefix: "x", format: "jxl lossless", exact_name: "photo123.jpg" }), "photo123.jxl");
  assert.equal(previewName({ filename_prefix: "x", format: "png", exact_name: "", filenameLinked: true, name_counter: true }), "{{filename}}.png");
});

test("previewFolder joins the output folder, the folder field and the prefix's subfolders", () => {
  assert.equal(previewFolder({ output_dir: "", filename_prefix: "shot" }), "ComfyUI/output/");
  assert.equal(previewFolder({ output_dir: "datasets/portraits", filename_prefix: "sets/shot" }), "ComfyUI/output/datasets/portraits/sets/");
  for (const outside of ["/mnt/data/", "C:\\Pictures", "~/Pictures", "sets/../..", "\\\\host\\share"]) {
    assert.equal(previewFolder({ output_dir: outside, filename_prefix: "shot" }), "Not saved: use a subfolder of ComfyUI/output");
  }
  assert.equal(previewFolder({ output_dir: "", filename_prefix: "sets/shot", filenameLinked: true }), "ComfyUI/output/");
});

test("tags only decorate a local name; extensions strip like the backend", () => {
  assert.equal(tagsEnabled({ exact_name: "", filenameLinked: false }), true);
  assert.equal(tagsEnabled({ exact_name: "photo" }), false);
  assert.equal(tagsEnabled({ exact_name: "", filenameLinked: true }), false);
  assert.equal(stripImageExtension("photo.JPG"), "photo");
  assert.equal(stripImageExtension("photo.v2"), "photo.v2");
});
