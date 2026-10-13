import test from "node:test";
import assert from "node:assert/strict";

import {
  INPUT_FOLDER_MODE,
  LOCAL_PATH_MODE,
  mediaSourceState,
  normalizeVideoOptions,
  normalizeVideoSourceMode,
  videoSourceState,
} from "../js/shared/video_source_card.mjs";

test("unknown source modes fall back to the input folder", () => {
  assert.equal(normalizeVideoSourceMode("mystery"), INPUT_FOLDER_MODE);
  assert.equal(normalizeVideoSourceMode(LOCAL_PATH_MODE), LOCAL_PATH_MODE);
});

test("video options are unique and retain a restored selection", () => {
  assert.deepEqual(
    normalizeVideoOptions(["a.mp4", "a.mp4", "b.mov"], "restored.webm"),
    ["a.mp4", "b.mov", "restored.webm"],
  );
});

test("source state uses only the field belonging to the active mode", () => {
  assert.deepEqual(videoSourceState(INPUT_FOLDER_MODE, "clip.mp4", "temp/wrong.mov"), {
    mode: INPUT_FOLDER_MODE,
    selection: "clip.mp4",
    key: "input:clip.mp4",
    hint: "Choose an uploaded video or add one to ComfyUI's input folder.",
  });
  assert.equal(videoSourceState(LOCAL_PATH_MODE, "wrong.mp4", "output/clip.mov").key, "local:output/clip.mov");
  assert.match(videoSourceState(LOCAL_PATH_MODE, "", "").hint, /^Folder and name, such as output\/clip\.mp4/);
  assert.match(videoSourceState(LOCAL_PATH_MODE, "", "output/clip.mov").hint, /^Folder and name/);
  // A whole path, as a workflow saved by an earlier release may hold: the hint says what to type.
  for (const whole of ["/home/me/ComfyUI/output/clip.mp4", "C:\\ComfyUI\\output\\clip.mp4", "~/clip.mp4", "\\\\host\\share\\clip.mp4", '"/data/clip.mp4"']) {
    assert.match(videoSourceState(LOCAL_PATH_MODE, "", whole).hint, /^Not a whole path\. Type folder and name: output\/clip\.mp4$/, whole);
  }
  assert.equal(videoSourceState(LOCAL_PATH_MODE, "wrong.mp4", "  ").key, "");
});

test("image source cards use the existing image input, never a local-path mode", () => {
  assert.deepEqual(mediaSourceState("image", LOCAL_PATH_MODE, "portraits/face 01.png", "/tmp/unused.jpg"), {
    mode: INPUT_FOLDER_MODE,
    selection: "portraits/face 01.png",
    key: "portraits/face 01.png",
    hint: "Choose an uploaded image or drop one onto this node.",
  });
});

test("image picker retains restored and newly uploaded filenames", () => {
  assert.deepEqual(normalizeVideoOptions(["a.png", "a.png", "猫.webp"], "subfolder/new image.png"),
    ["a.png", "猫.webp", "subfolder/new image.png"]);
  assert.equal(mediaSourceState("image", INPUT_FOLDER_MODE, null).key, "");
  assert.equal(mediaSourceState("image", INPUT_FOLDER_MODE, " leading space.png").key, " leading space.png");
});

test("the shared media card keeps both video source modes unchanged", () => {
  for (const mode of [INPUT_FOLDER_MODE, LOCAL_PATH_MODE]) {
    assert.deepEqual(mediaSourceState("video", mode, "clip.mp4", "output/clip.mp4"),
      videoSourceState(mode, "clip.mp4", "output/clip.mp4"));
  }
});
