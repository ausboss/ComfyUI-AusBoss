import assert from "node:assert/strict";
import test from "node:test";

import {
  LOAD_VIDEO_WIDGET_ORDER,
  isVideoFileName,
  loadVideoRestoreValues,
} from "../js/shared/load_video_restore.mjs";

function workflowWith(widgetsValues, type = "AUSBOSS_NODES_LoadVideo") {
  return { nodes: [{ id: 1, type, widgets_values: widgetsValues }] };
}

test("a full positional widgets_values restores everything but the source", () => {
  const values = loadVideoRestoreValues(
    workflowWith(["clip.mp4", 1.5, 4.25, 640, 0, 2, 10, true]),
  );
  assert.deepEqual(values, {
    start_seconds: 1.5,
    end_seconds: 4.25,
    custom_width: 640,
    custom_height: 0,
    every_nth: 2,
    max_frames: 10,
    single_frame: true,
  });
});

test("a save from before the single_frame widget restores as a trim", () => {
  const values = loadVideoRestoreValues(
    workflowWith(["clip.mp4", 0.5, 3, 0, 0, 1, 0]),
  );
  assert.equal(values.single_frame, false);
  assert.equal(values.start_seconds, 0.5);
});

test("object-form widgets_values restores by name", () => {
  const values = loadVideoRestoreValues(
    workflowWith({ video: "clip.mp4", start_seconds: 2, end_seconds: 6, every_nth: 3 }),
  );
  assert.equal(values.start_seconds, 2);
  assert.equal(values.end_seconds, 6);
  assert.equal(values.every_nth, 3);
  assert.equal(values.single_frame, false);
  assert.ok(!("video" in values));
});

test("values from the file are clamped into the widget ranges", () => {
  const values = loadVideoRestoreValues(
    workflowWith(["clip.mp4", -5, 999999, 99999, 3.7, 0, -1, 1]),
  );
  assert.equal(values.start_seconds, 0);
  assert.equal(values.end_seconds, 86400);
  assert.equal(values.custom_width, 16384);
  assert.equal(values.custom_height, 4); // rounded to an int
  assert.equal(values.every_nth, 1); // floor of the range, never 0
  assert.equal(values.max_frames, 0);
  assert.equal(values.single_frame, true); // 1 counts as on
});

test("garbage values drop out instead of poisoning the node", () => {
  const values = loadVideoRestoreValues(
    workflowWith(["clip.mp4", 1, "nonsense", 0, 0, "2", Infinity]),
  );
  assert.equal(values.start_seconds, 1);
  assert.ok(!("end_seconds" in values));
  assert.equal(values.every_nth, 2); // numeric strings convert
  assert.ok(!("max_frames" in values));
});

test("no Load Video node, or nothing usable on it, yields null", () => {
  assert.equal(loadVideoRestoreValues(null), null);
  assert.equal(loadVideoRestoreValues({}), null);
  assert.equal(loadVideoRestoreValues({ nodes: [] }), null);
  assert.equal(loadVideoRestoreValues(workflowWith(["x"], "OtherNode")), null);
  // Only a source name, no IN point: nothing to restore.
  assert.equal(loadVideoRestoreValues(workflowWith(["clip.mp4"])), null);
  assert.equal(loadVideoRestoreValues(workflowWith(["clip.mp4", "bad"])), null);
});

test("the first usable Load Video node wins", () => {
  const workflow = {
    nodes: [
      { type: "AUSBOSS_NODES_LoadVideo", widgets_values: ["a.mp4"] },
      { type: "AUSBOSS_NODES_LoadVideo", widgets_values: ["b.mp4", 7, 9] },
      { type: "AUSBOSS_NODES_LoadVideo", widgets_values: ["c.mp4", 1, 2] },
    ],
  };
  assert.equal(loadVideoRestoreValues(workflow).start_seconds, 7);
});

test("the widget order stays append-only ahead of the preview widget", () => {
  // Position is the compatibility contract: these first eight names must
  // never reorder, and new widgets only ever append.
  assert.deepEqual(LOAD_VIDEO_WIDGET_ORDER.slice(0, 8), [
    "video",
    "start_seconds",
    "end_seconds",
    "custom_width",
    "custom_height",
    "every_nth",
    "max_frames",
    "single_frame",
  ]);
});

test("the drop gate takes exactly the extensions the node lists", () => {
  for (const name of ["a.mp4", "b.MOV", "c.webm", "d.mkv", "e.m2ts", "f.avi"]) {
    assert.equal(isVideoFileName(name), true, name);
  }
  for (const name of ["a.png", "b.json", "c.gif", "d.webp", "", null, "mp4"]) {
    assert.equal(isVideoFileName(name), false, String(name));
  }
});
