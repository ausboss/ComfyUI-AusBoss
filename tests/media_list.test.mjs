import assert from "node:assert/strict";
import { test } from "node:test";

import { filterMedia, mediaLabel, mediaViewQuery, moveHighlight } from "../js/shared/media_list.mjs";

test("mediaViewQuery names the file, its subfolder and its folder type", () => {
  assert.equal(mediaViewQuery("photo.png"), "filename=photo.png&subfolder=&type=input");
  assert.equal(mediaViewQuery("pasted/image (2).png"), "filename=image+%282%29.png&subfolder=pasted&type=input");
  assert.equal(mediaViewQuery("clip.mp4 [output]"), "filename=clip.mp4&subfolder=&type=output");
  assert.equal(mediaViewQuery("a\\b\\c.webp"), "filename=c.webp&subfolder=a%2Fb&type=input");
  assert.equal(mediaViewQuery(""), "");
  assert.equal(mediaViewQuery(null), "");
});

test("filterMedia keeps values holding every term, ignoring case", () => {
  const values = ["pasted/ausboss_night_bridge.png", "ausboss_day_sky_square.mp4", "Night_Alley.PNG"];
  assert.deepEqual(filterMedia(values, ""), values);
  assert.deepEqual(filterMedia(values, "  "), values);
  assert.deepEqual(filterMedia(values, "night"), ["pasted/ausboss_night_bridge.png", "Night_Alley.PNG"]);
  assert.deepEqual(filterMedia(values, "night png pasted"), ["pasted/ausboss_night_bridge.png"]);
  assert.deepEqual(filterMedia(values, "mp4 sky"), ["ausboss_day_sky_square.mp4"]);
  assert.deepEqual(filterMedia(values, "missing"), []);
  assert.deepEqual(filterMedia(undefined, "x"), []);
  assert.deepEqual(filterMedia([1, 22], "2"), ["22"]);
});

test("mediaLabel splits the dim folder from the name and marks non-input folders", () => {
  assert.deepEqual(mediaLabel("pasted/image.png"), { folder: "pasted/", name: "image.png" });
  assert.deepEqual(mediaLabel("image.png"), { folder: "", name: "image.png" });
  assert.deepEqual(mediaLabel("renders/out.mp4 [output]"), { folder: "renders/", name: "out.mp4 [output]" });
  assert.deepEqual(mediaLabel(""), { folder: "", name: "" });
});

test("moveHighlight stops at the ends and starts from the right end", () => {
  assert.equal(moveHighlight(-1, 1, 5), 0);
  assert.equal(moveHighlight(-1, -1, 5), 4);
  assert.equal(moveHighlight(0, -1, 5), 0);
  assert.equal(moveHighlight(4, 1, 5), 4);
  assert.equal(moveHighlight(2, 8, 5), 4);
  assert.equal(moveHighlight(3, -8, 5), 0);
  assert.equal(moveHighlight(9, 1, 5), 0);
  assert.equal(moveHighlight(0, 1, 0), -1);
});
