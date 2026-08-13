import assert from "node:assert/strict";
import test from "node:test";

import {
  captureWidgetDefaults,
  isPersistedWidget,
  planWidgetRestore,
  widgetValueVerdict,
  widgetsToDict,
} from "../js/shared/widget_kv.mjs";

// --- Fixtures -------------------------------------------------------------
// Widget order is the workflow-compatibility contract for legacy positional
// arrays. Each fixture mirrors the exact INPUT_TYPES order of the Python
// node file at the time this format shipped — if these tests break because
// a widget moved, the migration mapping below must learn the old order, not
// the tests the new one.

function widget(name, type, value, options = {}) {
  return { name, type, value, options };
}

const number = (name, value, min, max) => widget(name, "number", value, { min, max });
const combo = (name, value, values) => widget(name, "combo", value, values ? { values } : {});
const text = (name, value) => widget(name, "text", value);

// nodes/_transform_inputs.py transform_inputs()
const ASPECT_RATIOS = ["free", "source", "1:1", "9:16", "16:9", "2:3", "3:2", "3:4", "4:3", "9:21", "21:9"];
const transformWidgets = () => [
  number("rotation_degrees", 0.0, -180.0, 180.0),
  combo("crop_aspect_ratio", "free", ASPECT_RATIOS),
  number("crop_x", 0, 0, 65536),
  number("crop_y", 0, 0, 65536),
  number("crop_width", 0, 0, 65536),
  number("crop_height", 0, 0, 65536),
  number("pad_left", 0, 0, 32768),
  number("pad_top", 0, 0, 32768),
  number("pad_right", 0, 0, 32768),
  number("pad_bottom", 0, 0, 32768),
  number("feather", 24, 0, 4096),
  number("canvas_multiple", 1, 1, 4096),
  text("fill_color", "#808080"),
];

// nodes/node_load_video.py — video, start_seconds, end_seconds,
// custom_width, custom_height. The video combo is a dynamic file list.
const loadVideoWidgets = (files = []) => [
  combo("video", files[0] ?? "", files),
  number("start_seconds", 0.0, 0.0, 86400.0),
  number("end_seconds", 0.0, 0.0, 86400.0),
  number("custom_width", 0, 0, 16384),
  number("custom_height", 0, 0, 16384),
];

// nodes/node_save_video.py — fps, filename_prefix, crf (frames and audio
// are connections, prompt/extra_pnginfo hidden).
const saveVideoWidgets = () => [
  number("fps", 16.0, 0.01, 240.0),
  text("filename_prefix", "AusBoss/video"),
  number("crf", 19, 0, 51),
];

// nodes/node_image_crop_rotate_pad.py — image, then the transform block.
const imageCropWidgets = (files = []) => [
  combo("image", files[0] ?? "", files),
  ...transformWidgets(),
];

// nodes/node_video_crop_rotate_pad.py — video, source_mode, local_path,
// seek_mode, frame_index, frame_time, then the transform block.
const videoCropWidgets = (files = []) => [
  combo("video", files[0] ?? "", files),
  combo("source_mode", "input folder", ["input folder", "local path"]),
  text("local_path", ""),
  combo("seek_mode", "frame index", ["frame index", "time seconds"]),
  number("frame_index", 0, 0, 100000000),
  number("frame_time", 0.0, 0.0, 86400.0),
  ...transformWidgets(),
];

const names = (widgets) => widgets.map((item) => item.name);

// --- Widget order contracts ----------------------------------------------

test("fixtures capture the exact INPUT_TYPES widget order of each node", () => {
  assert.deepEqual(names(loadVideoWidgets()), [
    "video", "start_seconds", "end_seconds", "custom_width", "custom_height",
  ]);
  assert.deepEqual(names(saveVideoWidgets()), ["fps", "filename_prefix", "crf"]);
  assert.deepEqual(names(imageCropWidgets()), [
    "image", "rotation_degrees", "crop_aspect_ratio", "crop_x", "crop_y",
    "crop_width", "crop_height", "pad_left", "pad_top", "pad_right",
    "pad_bottom", "feather", "canvas_multiple", "fill_color",
  ]);
  assert.deepEqual(names(videoCropWidgets()), [
    "video", "source_mode", "local_path", "seek_mode", "frame_index",
    "frame_time", "rotation_degrees", "crop_aspect_ratio", "crop_x", "crop_y",
    "crop_width", "crop_height", "pad_left", "pad_top", "pad_right",
    "pad_bottom", "feather", "canvas_multiple", "fill_color",
  ]);
});

// --- Dict serialization ---------------------------------------------------

test("widgets serialize to a name-keyed object and round-trip by name", () => {
  const widgets = saveVideoWidgets();
  widgets[0].value = 24.0;
  widgets[1].value = "AusBoss/render";
  widgets[2].value = 15;
  const dict = widgetsToDict(widgets);
  assert.deepEqual(dict, { fps: 24.0, filename_prefix: "AusBoss/render", crf: 15 });

  const restored = saveVideoWidgets();
  const plan = planWidgetRestore(restored, dict, captureWidgetDefaults(restored));
  assert.equal(plan.mode, "dict");
  assert.deepEqual(plan.assignments, [
    { name: "fps", value: 24.0 },
    { name: "filename_prefix", value: "AusBoss/render" },
    { name: "crf", value: 15 },
  ]);
});

test("dict restore survives widget reordering", () => {
  const widgets = loadVideoWidgets(["clip.mp4"]);
  widgets[1].value = 3.86;
  widgets[2].value = 10.11;
  const dict = widgetsToDict(widgets);
  const reordered = loadVideoWidgets(["clip.mp4"]).reverse();
  const plan = planWidgetRestore(reordered, dict, captureWidgetDefaults(reordered));
  const byName = Object.fromEntries(plan.assignments.map((item) => [item.name, item.value]));
  assert.equal(byName.start_seconds, 3.86);
  assert.equal(byName.end_seconds, 10.11);
  assert.equal(byName.video, "clip.mp4");
});

test("buttons, opt-outs, and unnamed widgets never enter the dict", () => {
  const widgets = [
    ...saveVideoWidgets(),
    widget("upload", "button", "image"),
    { ...widget("ausboss_viewer", "custom", ""), options: { serialize: false } },
    { ...widget("hidden_flag", "toggle", true), serialize: false },
    widget("", "text", "nameless"),
  ];
  assert.deepEqual(Object.keys(widgetsToDict(widgets)), ["fps", "filename_prefix", "crf"]);
  assert.equal(isPersistedWidget(widgets[3]), false);
  assert.equal(isPersistedWidget(widgets[4]), false);
});

test("a dict missing a widget repairs it to the captured default", () => {
  // Base configure() leaves such widgets holding undefined; the plan must
  // put the creation default back.
  const widgets = saveVideoWidgets();
  const defaults = captureWidgetDefaults(widgets);
  const plan = planWidgetRestore(widgets, { fps: 30.0 }, defaults);
  assert.deepEqual(plan.assignments, [
    { name: "fps", value: 30.0 },
    { name: "filename_prefix", value: "AusBoss/video" },
    { name: "crf", value: 19 },
  ]);
});

test("a dict value that cannot fit its widget falls back to the default", () => {
  const widgets = saveVideoWidgets();
  const defaults = captureWidgetDefaults(widgets);
  const plan = planWidgetRestore(
    widgets,
    { fps: "fast", filename_prefix: "kept", crf: 999 },
    defaults,
  );
  assert.deepEqual(plan.assignments, [
    { name: "fps", value: 16.0 },
    { name: "filename_prefix", value: "kept" },
    { name: "crf", value: 19 },
  ]);
});

test("a combo string absent from a dynamic file list still restores by name", () => {
  // File lists are point-in-time snapshots; a name match outranks them.
  const widgets = loadVideoWidgets(["other.mp4"]);
  const plan = planWidgetRestore(widgets, { video: "missing.mp4" }, captureWidgetDefaults(widgets));
  assert.deepEqual(plan.assignments[0], { name: "video", value: "missing.mp4" });
});

// --- Legacy positional arrays --------------------------------------------

test("the shipped Load Video example array migrates by widget order", () => {
  // example_workflows/simple_video_watermark_remover.json — the trailing
  // "image" and "" belong to frontend-added upload/preview widgets and must
  // be ignored, not force-fed into anything.
  const widgets = loadVideoWidgets(["input.mp4"]);
  const plan = planWidgetRestore(
    widgets,
    ["input.mp4", 0.0, 0.0, 0, 0, "image", ""],
    captureWidgetDefaults(widgets),
  );
  assert.equal(plan.mode, "legacy");
  assert.deepEqual(plan.assignments, [
    { name: "video", value: "input.mp4" },
    { name: "start_seconds", value: 0.0 },
    { name: "end_seconds", value: 0.0 },
    { name: "custom_width", value: 0 },
    { name: "custom_height", value: 0 },
  ]);
});

test("the shipped Video Crop example array migrates every widget", () => {
  // example_workflows/video_crop_rotate_pad.json
  const stored = ["", "input folder", "", "frame index", 0, 0, 0, "free", 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, "#808080"];
  const widgets = videoCropWidgets([""]);
  const plan = planWidgetRestore(widgets, stored, captureWidgetDefaults(widgets));
  assert.equal(plan.mode, "legacy");
  assert.equal(plan.assignments.length, widgets.length);
  assert.deepEqual(
    plan.assignments.map((item) => item.value),
    stored,
  );
});

test("legacy values that do not fit are skipped back to defaults", () => {
  const widgets = saveVideoWidgets();
  widgets[0].value = 999; // base configure already applied the bad array
  const plan = planWidgetRestore(
    widgets,
    ["not-a-rate", "AusBoss/render", 500],
    captureWidgetDefaults(saveVideoWidgets()),
  );
  assert.deepEqual(plan.assignments, [
    { name: "fps", value: 16.0 }, // string in a number slot
    { name: "filename_prefix", value: "AusBoss/render" },
    { name: "crf", value: 19 }, // 500 is outside 0..51
  ]);
});

test("a legacy combo string missing from the file list is left in place", () => {
  // Today's positional load keeps a stale filename visible (shown invalid);
  // the migration must not silently erase it.
  const widgets = loadVideoWidgets(["other.mp4"]);
  const plan = planWidgetRestore(
    widgets,
    ["missing.mp4", 1.0, 2.0, 0, 0],
    captureWidgetDefaults(widgets),
  );
  assert.equal(plan.assignments.some((item) => item.name === "video"), false);
  assert.equal(plan.assignments.length, 4);
});

test("a short legacy array leaves later widgets on their defaults", () => {
  const widgets = imageCropWidgets(["photo.png"]);
  const plan = planWidgetRestore(widgets, ["photo.png", 45.0], captureWidgetDefaults(widgets));
  assert.deepEqual(plan.assignments, [
    { name: "image", value: "photo.png" },
    { name: "rotation_degrees", value: 45.0 },
  ]);
});

test("legacy nulls left by unserialized widget slots repair to defaults", () => {
  const widgets = saveVideoWidgets();
  const plan = planWidgetRestore(widgets, [24.0, null, 15], captureWidgetDefaults(widgets));
  assert.deepEqual(plan.assignments, [
    { name: "fps", value: 24.0 },
    { name: "filename_prefix", value: "AusBoss/video" },
    { name: "crf", value: 15 },
  ]);
});

// --- Verdicts and failure paths ------------------------------------------

test("verdicts enforce number ranges, combo membership, and booleans", () => {
  assert.equal(widgetValueVerdict(number("crf", 19, 0, 51), 19), "apply");
  assert.equal(widgetValueVerdict(number("crf", 19, 0, 51), -1), "reject");
  assert.equal(widgetValueVerdict(number("crf", 19, 0, 51), Number.NaN), "reject");
  assert.equal(widgetValueVerdict(combo("mode", "a", ["a", "b"]), "b"), "apply");
  assert.equal(widgetValueVerdict(combo("mode", "a", ["a", "b"]), "c"), "keep");
  assert.equal(widgetValueVerdict(combo("mode", "a", ["a", "b"]), 3), "reject");
  assert.equal(widgetValueVerdict(widget("flag", "toggle", true), false), "apply");
  assert.equal(widgetValueVerdict(widget("flag", "toggle", true), "true"), "reject");
  assert.equal(widgetValueVerdict(text("label", ""), "hello"), "apply");
  assert.equal(widgetValueVerdict(text("label", ""), 5), "reject");
});

test("an unreadable payload degrades to a defaults-only plan, never a throw", () => {
  const widgets = saveVideoWidgets();
  const defaults = captureWidgetDefaults(widgets);
  for (const garbage of ["oops", 42, true]) {
    const plan = planWidgetRestore(widgets, garbage, defaults);
    assert.equal(plan.mode, "invalid");
    assert.deepEqual(plan.assignments, [
      { name: "fps", value: 16.0 },
      { name: "filename_prefix", value: "AusBoss/video" },
      { name: "crf", value: 19 },
    ]);
  }
});

test("absent widgets_values plans nothing", () => {
  const widgets = saveVideoWidgets();
  for (const stored of [undefined, null]) {
    assert.deepEqual(planWidgetRestore(widgets, stored, captureWidgetDefaults(widgets)), {
      mode: "none",
      assignments: [],
    });
  }
});
