import test from "node:test";
import assert from "node:assert/strict";

import {
  FORMAT_TOGGLED_WIDGETS,
  FORMAT_WIDGET_SETS,
  formatWidgetVisibility,
} from "../js/shared/save_video_formats.mjs";

// The dropdown as the backend serves it. test_video_save_helpers.py checks
// the .mjs table against the real VIDEO_FORMATS dict; this copy pins the
// pure-JS side without importing Python.
const BACKEND_FORMATS = [
  "mp4 h264",
  "mp4 h265",
  "mp4 h264 nvenc",
  "mp4 h265 nvenc",
  "webm vp9",
  "webm av1",
  "mov prores",
  "mkv ffv1",
  "gif",
  "webp",
];

test("the table covers every backend format exactly", () => {
  assert.deepEqual(Object.keys(FORMAT_WIDGET_SETS).sort(), [...BACKEND_FORMATS].sort());
});

test("every relevant-widget entry names only toggled widgets", () => {
  for (const [format, names] of Object.entries(FORMAT_WIDGET_SETS)) {
    for (const name of names) {
      assert.ok(FORMAT_TOGGLED_WIDGETS.includes(name), `${format} lists unknown widget ${name}`);
    }
  }
});

test("crf shows only where the encoder reads a quality number", () => {
  const wantsCrf = (format) => formatWidgetVisibility(format).crf;
  for (const format of ["mp4 h264", "mp4 h265", "mp4 h264 nvenc", "mp4 h265 nvenc", "webm vp9", "webm av1", "webp"]) {
    assert.equal(wantsCrf(format), true, `${format} should show crf`);
  }
  for (const format of ["mov prores", "mkv ffv1", "gif"]) {
    assert.equal(wantsCrf(format), false, `${format} should hide crf`);
  }
});

test("save_metadata hides only for the Pillow formats that cannot carry it", () => {
  const wantsMetadata = (format) => formatWidgetVisibility(format).save_metadata;
  for (const format of BACKEND_FORMATS) {
    assert.equal(
      wantsMetadata(format),
      format !== "gif" && format !== "webp",
      `save_metadata visibility wrong for ${format}`,
    );
  }
});

test("an unknown format shows every toggled widget", () => {
  assert.deepEqual(formatWidgetVisibility("mp4 h266"), { crf: true, save_metadata: true });
  assert.deepEqual(formatWidgetVisibility(undefined), { crf: true, save_metadata: true });
});

test("the visibility map carries exactly the toggled widgets", () => {
  assert.deepEqual(Object.keys(formatWidgetVisibility("mp4 h264")).sort(), [...FORMAT_TOGGLED_WIDGETS].sort());
});
