import assert from "node:assert/strict";
import test from "node:test";

import {
  findVideoMetadata,
  formatTime,
  mediaInfo,
  splitMediaName,
} from "../js/shared/video_preview.mjs";

test("media names split across Windows and POSIX separators", () => {
  assert.deepEqual(splitMediaName("clips/portrait.mp4"), {
    filename: "portrait.mp4",
    subfolder: "clips",
  });
  assert.deepEqual(splitMediaName("clips\\portrait.mp4 [input]"), {
    filename: "portrait.mp4",
    subfolder: "clips",
  });
});

test("video metadata is found inside ComfyUI execution payloads", () => {
  const meta = { filename: "render.mp4", subfolder: "AusBoss", type: "output" };
  assert.equal(findVideoMetadata({ images: [meta], animated: [true] }), meta);
  assert.equal(findVideoMetadata({ images: [{ filename: "still.png" }] }), null);
});

test("video metadata readout is compact and complete", () => {
  assert.equal(formatTime(63.25), "1:03.25");
  assert.equal(mediaInfo({
    width: 576,
    height: 1024,
    fps: 24,
    frame_count: 188,
    duration: 188 / 24,
  }), "576×1024 · 24 fps · 188 frames · 0:07.8");
});
