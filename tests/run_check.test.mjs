import assert from "node:assert/strict";
import test from "node:test";

import {
  collapseRepeatedErrors,
  emptySourceMessage,
  findEmptySources,
  nodeLacksSource,
  nodesThatRun,
} from "../js/shared/run_check.mjs";

// Node definitions as the frontend holds them: only output_node and the
// lazy flag matter to the check.
const DEFINITIONS = {
  SaveImage: { output_node: true, input: { required: { images: ["IMAGE"] } } },
  PreviewImage: { output_node: true, input: { required: { images: ["IMAGE"] } } },
  AUSBOSS_NODES_SaveVideo: { output_node: true, input: { optional: { frames: ["IMAGE"] } } },
  PickOne: { input: { required: { first: ["IMAGE", { lazy: true }], second: ["IMAGE"] } } },
};
const definitionOf = (classType) => DEFINITIONS[classType] ?? null;

const node = (class_type, inputs = {}, title = class_type) => ({ class_type, inputs, _meta: { title } });

test("a blank Load Image that feeds a save is found, by its own title", () => {
  const prompt = {
    1: node("LoadImage", { image: "" }, "Your image"),
    2: node("SaveImage", { images: ["1", 0] }),
  };
  assert.deepEqual(findEmptySources(prompt, definitionOf), [{ id: "1", title: "Your image", input: "image", kind: "picture" }]);
  assert.equal(emptySourceMessage(findEmptySources(prompt, definitionOf)), "Load a picture first: Your image");
});

test("a picked picture, a wired name or a missing widget value are told apart", () => {
  const run = (image) => findEmptySources({ 1: node("LoadImage", { image }), 2: node("SaveImage", { images: ["1", 0] }) }, definitionOf);
  assert.deepEqual(run("pier.png"), []);
  assert.deepEqual(run(["7", 0]), [], "a name fed by another node is set at run time");
  assert.equal(run(undefined).length, 1);
  assert.equal(run("   ").length, 1);
});

test("a loader no output needs never blocks the run", () => {
  const prompt = {
    1: node("LoadImage", { image: "" }),
    2: node("LoadImage", { image: "pier.png" }),
    3: node("SaveImage", { images: ["2", 0] }),
  };
  assert.deepEqual(findEmptySources(prompt, definitionOf), []);
});

test("bypassed and muted loaders are not in the prompt, so they are never found", () => {
  // The frontend leaves them out of the prompt and reroutes a bypassed one.
  const prompt = { 2: node("LoadImage", { image: "pier.png" }), 3: node("SaveImage", { images: ["2", 0] }) };
  assert.deepEqual(findEmptySources(prompt, definitionOf), []);
});

test("a loader only behind a lazy input may never be read, so it is not found", () => {
  const prompt = {
    1: node("LoadImage", { image: "" }),
    2: node("LoadImage", { image: "pier.png" }),
    3: node("PickOne", { first: ["1", 0], second: ["2", 0] }),
    4: node("SaveImage", { images: ["3", 0] }),
  };
  assert.deepEqual(findEmptySources(prompt, definitionOf), []);
  prompt[3].inputs = { first: ["2", 0], second: ["1", 0] };
  assert.deepEqual(findEmptySources(prompt, definitionOf).map((found) => found.id), ["1"]);
});

test("queueing selected outputs only checks what those outputs read", () => {
  const prompt = {
    1: node("LoadImage", { image: "" }),
    2: node("SaveImage", { images: ["1", 0] }),
    3: node("LoadImage", { image: "pier.png" }),
    4: node("PreviewImage", { images: ["3", 0] }),
  };
  assert.deepEqual(findEmptySources(prompt, definitionOf, ["4"]), []);
  assert.deepEqual(findEmptySources(prompt, definitionOf, ["2"]).map((found) => found.id), ["1"]);
  assert.deepEqual([...nodesThatRun(prompt, definitionOf, [])].sort(), ["1", "2", "3", "4"], "no targets: every output");
});

test("nodes inside subgraphs keep their execution ids", () => {
  const prompt = {
    "12:5": node("LoadImage", { image: "" }, "Inner image"),
    "12:6": node("SaveImage", { images: ["12:5", 0] }),
  };
  assert.deepEqual(findEmptySources(prompt, definitionOf).map((found) => found.id), ["12:5"]);
});

test("Load Image + Pad needs no file while a picture is wired in", () => {
  const run = (inputs) => findEmptySources({ 1: node("AUSBOSS_NODES_LoadImagePad", inputs), 2: node("SaveImage", { images: ["1", 0] }) }, definitionOf);
  assert.equal(run({ image: "" }).length, 1);
  assert.deepEqual(run({ image: "", source_image: ["9", 0] }), []);
});

test("the video nodes check the file or the local path, whichever the mode reads", () => {
  const run = (class_type, inputs) =>
    findEmptySources({ 1: node(class_type, inputs, "Clip"), 2: node("AUSBOSS_NODES_SaveVideo", { frames: ["1", 0] }) }, definitionOf);
  for (const class_type of ["AUSBOSS_NODES_VideoCropRotatePad", "AUSBOSS_NODES_VideoCropRotatePadClip"]) {
    assert.deepEqual(run(class_type, { video: "", source_mode: "input folder", local_path: "" }).map((f) => f.input), ["video"]);
    assert.deepEqual(run(class_type, { video: "pier.mp4", source_mode: "input folder", local_path: "" }), []);
    assert.deepEqual(run(class_type, { video: "", source_mode: "local path", local_path: "" }).map((f) => f.input), ["local_path"]);
    assert.deepEqual(run(class_type, { video: "", source_mode: "local path", local_path: "/comfy/output/a.mp4" }), []);
    assert.deepEqual(run(class_type, { video: "", source_mode: ["4", 0], local_path: "" }), [], "a wired mode is known at run time");
  }
  const found = run("AUSBOSS_NODES_LoadVideo", { video: "" });
  assert.equal(emptySourceMessage(found), "Load a video first: Clip");
  assert.deepEqual(run("LoadVideo", { file: "" }).map((f) => f.input), ["file"]);
});

test("the message names the first loader and counts the rest", () => {
  const found = [
    { id: "1", title: "Your image", kind: "picture" },
    { id: "2", title: "Load Video 🆎", kind: "video" },
    { id: "3", title: "Mask", kind: "picture" },
  ];
  assert.equal(emptySourceMessage(found.slice(0, 2)), "Load a picture first: Your image (and 1 more node)");
  assert.equal(emptySourceMessage(found), "Load a picture first: Your image (and 2 more nodes)");
  assert.equal(emptySourceMessage([]), "");
});

test("the widget scan reads the live node the same way", () => {
  const widget = (name, value) => ({ name, value });
  assert.equal(nodeLacksSource({ comfyClass: "LoadImage", widgets: [widget("image", "")] }), true);
  assert.equal(nodeLacksSource({ comfyClass: "LoadImage", widgets: [widget("image", "pier.png")] }), false);
  assert.equal(
    nodeLacksSource({ comfyClass: "LoadImage", widgets: [widget("image", "")], inputs: [{ name: "image", widget: { name: "image" }, link: 4 }] }),
    false,
    "a widget fed by a link is set",
  );
  assert.equal(
    nodeLacksSource({ comfyClass: "AUSBOSS_NODES_LoadImagePad", widgets: [widget("image", "")], inputs: [{ name: "source_image", link: 9 }] }),
    false,
  );
  assert.equal(nodeLacksSource({ type: "KSampler", widgets: [widget("seed", 0)] }), false);
  assert.equal(nodeLacksSource(null), false);
});

// ---------------------------------------------------------------- collapse

const failed = (input_name, message) => ({
  type: "custom_validation_failed",
  message: "Custom validation failed for node",
  details: `${input_name} - ${message}`,
  extra_info: { input_name },
});

test("a failed check repeated on every input it read comes back once", () => {
  const message = "Video Crop + Rotate + Pad: Select or upload a source file first.";
  const errors = {
    7: {
      class_type: "AUSBOSS_NODES_VideoCropRotatePadClip",
      errors: [failed("video", message), failed("source_mode", message), failed("local_path", message)],
      dependent_outputs: ["9"],
    },
  };
  collapseRepeatedErrors(errors);
  assert.deepEqual(errors[7].errors.map((error) => error.extra_info.input_name), ["video"]);
  assert.deepEqual(errors[7].dependent_outputs, ["9"]);
});

test("the error stays on the input its message is about", () => {
  const nameMessage = "Save Image: exact_name may not contain '..'.";
  const pathMessage = "Video Crop + Rotate + Pad: Local path mode requires a video path.";
  const errors = {
    1: { class_type: "AUSBOSS_NODES_SaveImage", errors: ["filename_prefix", "exact_name", "output_dir"].map((name) => failed(name, nameMessage)) },
    2: { class_type: "AUSBOSS_NODES_VideoCropRotatePad", errors: ["video", "source_mode", "local_path"].map((name) => failed(name, pathMessage)) },
  };
  collapseRepeatedErrors(errors);
  assert.deepEqual(errors[1].errors.map((error) => error.extra_info.input_name), ["exact_name"]);
  assert.deepEqual(errors[2].errors.map((error) => error.extra_info.input_name), ["local_path"]);
});

test("different problems, other kinds of error and other packs' nodes are left alone", () => {
  const range = { type: "value_smaller_than_min", message: "Value -5 smaller than min of 0", details: "crop_x", extra_info: { input_name: "crop_x" } };
  const errors = {
    1: { class_type: "AUSBOSS_NODES_LoraLoader", errors: [failed("loras", "LoRA Loader: a"), failed("on_missing", "LoRA Loader: a"), failed("loras", "LoRA Loader: b"), range] },
    2: { class_type: "SomePackLoader", errors: [failed("x", "same"), failed("y", "same")] },
  };
  collapseRepeatedErrors(errors);
  assert.deepEqual(errors[1].errors.map((error) => [error.extra_info.input_name, error.details]), [
    ["loras", "loras - LoRA Loader: a"],
    ["loras", "loras - LoRA Loader: b"],
    ["crop_x", "crop_x"],
  ]);
  assert.equal(errors[2].errors.length, 2);
  assert.equal(collapseRepeatedErrors(null), null);
});
