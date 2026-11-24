// The viewer's photo backdrop uses the same cameras and turns as Pause for
// Shot's run (nodes/_stage_helpers.py), so the two must agree on the maths.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKGROUNDS, backgroundChoice, eulerZXY, photoUv, stageFrame } from "../js/shared/photo_stage.mjs";

const PHOTO = { position: { x: 0, y: 0, z: 2 }, target: { x: 0, y: 0, z: 0 }, fov: 50 };

test("the photo's own camera looks at the middle of the photo", () => {
  const frame = stageFrame(PHOTO);
  const [u, v] = photoUv(frame, [0, 0, -1], 0.7);
  assert.ok(Math.abs(u - 0.5) < 1e-12 && Math.abs(v - 0.5) < 1e-12);
});

test("the photo's top edge is at half its vertical view", () => {
  const frame = stageFrame(PHOTO);
  const up = Math.tan((25 * Math.PI) / 180);
  const [, v] = photoUv(frame, [0, up, -1], 1);
  assert.ok(Math.abs(v - 1) < 1e-9);
});

test("zoom narrows the view", () => {
  assert.ok(Math.abs(stageFrame({ ...PHOTO, zoom: 2 }).tan * 2 - stageFrame(PHOTO).tan) < 1e-12);
});

test("behind the photo's camera is nowhere in the photo", () => {
  assert.equal(photoUv(stageFrame(PHOTO), [0, 0, 1], 1), null);
});

test("no camera, no stage", () => {
  assert.equal(stageFrame(null), null);
  assert.equal(stageFrame({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }), null);
});

test("Turn 90 matches the run's ZXY rotation", () => {
  // euler_zxy_matrix(0, pi/2, 0) in nodes/_backdrop_helpers.py
  const m = eulerZXY(0, Math.PI / 2, 0).map((v) => Math.round(v * 1e9) / 1e9 + 0);
  assert.deepEqual(m, [0, 0, 1, 0, 1, 0, -1, 0, 0]);
});

test("your photo is the default when there is one", () => {
  assert.deepEqual([...BACKGROUNDS], ["photo", "360", "360 floor"]);
  assert.equal(backgroundChoice(undefined, true), "photo");
  assert.equal(backgroundChoice(undefined, false), "360");
  assert.equal(backgroundChoice("360", true), "360");
  assert.equal(backgroundChoice("bogus", true), "photo");
});

test("Size reads in camera heights, as the run reads it", async () => {
  const { domeRadius, SIZE_MIN } = await import("../js/shared/photo_stage.mjs");
  assert.equal(domeRadius(8, 0, -0.5), 4);
  assert.equal(domeRadius(0.2, 0, -0.5), SIZE_MIN * 0.5);
  for (const endless of [null, undefined, 0, -3, true, "8", NaN]) assert.equal(domeRadius(endless, 0, -0.5), 0);
  assert.equal(domeRadius(8, 0, undefined), 0);
  assert.equal(domeRadius(8, -1, -0.5), 0);
});

test("the shader keeps the floor inside the dome and the rest on its wall", () => {
  const source = readFileSync(new URL("../js/shared/photo_stage.mjs", import.meta.url), "utf8");
  assert.match(source, /uniform float abRadius;/);
  assert.match(source, /dot\(hit, hit\) <= abRadius \* abRadius/);
  assert.match(source, /u\.abRadius\.value = domeRadius\(sky\.size, photo\.eye\[1\], floorY\)/);
});

