import test from "node:test";
import assert from "node:assert/strict";

import {
  INPUT_FOLDER_MODE,
  LOCAL_PATH_MODE,
  isWholePath,
  mediaSourceState,
  normalizeVideoOptions,
  normalizeVideoSourceMode,
  pickedOutput,
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
  assert.deepEqual(videoSourceState(INPUT_FOLDER_MODE, "clip.mp4", "/tmp/wrong.mov"), {
    mode: INPUT_FOLDER_MODE,
    selection: "clip.mp4",
    key: "input:clip.mp4",
    hint: "Choose an uploaded video or add one to ComfyUI's input folder.",
  });
  assert.equal(videoSourceState(LOCAL_PATH_MODE, "wrong.mp4", "takes/clip.mov [output]").key, "local:takes/clip.mov [output]");
  assert.equal(videoSourceState(LOCAL_PATH_MODE, "wrong.mp4", "  ").key, "");
});

test("the Outputs list holds a name, and a typed path from an older workflow counts as nothing picked", () => {
  const picked = videoSourceState(LOCAL_PATH_MODE, "", "takes/clip.mov [output]");
  assert.equal(picked.selection, "takes/clip.mov [output]");
  assert.match(picked.hint, /^The videos in ComfyUI's output folder, newest first/);
  assert.match(videoSourceState(LOCAL_PATH_MODE, "", "").hint, /^The videos in ComfyUI's output folder, newest first/);
  for (const whole of ["/home/me/ComfyUI/output/clip.mp4", "C:\\ComfyUI\\output\\clip.mp4", "~/clip.mp4", "\\\\host\\share\\clip.mp4", '"/data/clip.mp4"']) {
    assert.equal(isWholePath(whole), true, whole);
    assert.equal(pickedOutput(whole), "", whole);
    const state = videoSourceState(LOCAL_PATH_MODE, "", whole);
    // Nothing is asked of the server for it, and the hint says what to do.
    assert.deepEqual([state.selection, state.key], ["", ""], whole);
    assert.match(state.hint, /^Pick the video again/, whole);
  }
  for (const name of ["clip.mp4", "takes/clip.mp4 [output]", "c.mp4 [temp]", ""]) {
    assert.equal(isWholePath(name), false, name);
    assert.equal(pickedOutput(name), name);
  }
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
    assert.deepEqual(mediaSourceState("video", mode, "clip.mp4", "/data/clip.mp4"),
      videoSourceState(mode, "clip.mp4", "/data/clip.mp4"));
  }
});
