import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FORMAT_WIDGET_SETS } from "../js/shared/save_video_formats.mjs";
import {
  findVideoMetadata,
  formatTime,
  isStillImage,
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

test("a saved gif or webp is found, and goes to the picture tag", () => {
  // Save Video sends the same result whatever the format; only the file's
  // ending differs. These two were never found, so the node said "Execution
  // finished without video metadata" over a file it had just saved.
  for (const ending of ["gif", "webp"]) {
    const meta = { filename: `clip_00001_.${ending}`, subfolder: "clips", type: "output" };
    assert.equal(findVideoMetadata({ images: [meta], animated: [true] }), meta);
    assert.equal(isStillImage(meta.filename), true);
  }
  assert.equal(isStillImage("CLIP_00001_.WEBP"), true);
  assert.equal(isStillImage("render.mp4"), false);
  assert.equal(isStillImage("webp"), false);
  assert.equal(isStillImage(undefined), false);
});

test("the node can show every format Save Video writes", () => {
  // How those two went missing: the backend gained formats and the list the
  // result is searched with did not follow. Each row of the backend's
  // VIDEO_FORMATS is read from its source here. The file it writes has to
  // be found, and a row with no video codec (written as a picture through
  // Pillow) has to go to the <img>, since a <video> cannot play it.
  const source = readFileSync(new URL("../nodes/_video_save_helpers.py", import.meta.url), "utf-8");
  const rows = [...source.matchAll(/^\s*"([^"]+)":\s*VideoFormat\(\s*"([^"]*)",\s*"([^"]*)"/gm)];
  assert.deepEqual(
    rows.map(([, format]) => format).sort(),
    Object.keys(FORMAT_WIDGET_SETS).sort(),
    "VIDEO_FORMATS was not read whole from the backend's source",
  );
  for (const [, format, ending, codec] of rows) {
    const meta = { filename: `clip_00001_.${ending}`, subfolder: "", type: "output" };
    assert.equal(
      findVideoMetadata({ images: [meta], animated: [true] }),
      meta,
      `${format}: a saved .${ending} is not found, so the node would show nothing`,
    );
    assert.equal(
      isStillImage(meta.filename),
      codec === "",
      `${format}: a saved .${ending} goes to the wrong tag`,
    );
  }
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
