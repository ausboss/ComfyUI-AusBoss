import assert from "node:assert/strict";
import { test } from "node:test";
import { browseMediaRows, visibleMediaRange } from "../js/shared/media_list.mjs";

test("folder browsing shows only direct children and preserves original filenames", () => {
  const values = ["root.png", "photos/cover.png", "photos/archive/old.png", "other/test.png"];
  assert.deepEqual(browseMediaRows(values, "", []).map(({ kind, value, label }) => [kind, value ?? label]), [
    ["folder", "photos"], ["folder", "other"], ["file", "root.png"],
  ]);
  assert.deepEqual(browseMediaRows(values, "", ["photos"]).map(({ kind, value, label }) => [kind, value ?? label]), [
    ["back", ".."], ["folder", "archive"], ["file", "photos/cover.png"],
  ]);
  assert.deepEqual(browseMediaRows(values, "", ["photos", "archive"]).map(({ kind, value }) => [kind, value]), [
    ["back", undefined], ["file", "photos/archive/old.png"],
  ]);
});

test("search finds files across all folders and returns full widget values", () => {
  const values = ["photos/archive/old.png", "other/oldest.png", "root.png"];
  assert.deepEqual(browseMediaRows(values, "old", ["other"]).map((item) => item.value), values.slice(0, 2));
  assert.deepEqual(browseMediaRows(values, "missing", []), []);
});

test("folder paths handle Windows separators and Output suffixes", () => {
  const values = ["renders\\set\\001.png [output]", "renders/set/002.png [output]"];
  const bare = (value) => value.replace(/ \[output\]$/, "");
  assert.deepEqual(browseMediaRows(values, "", [], bare).map((x) => x.label), ["renders"]);
  assert.deepEqual(browseMediaRows(values, "", ["renders", "set"], bare).filter((x) => x.kind === "file").map((x) => x.value), values);
});

test("virtualized list renders a bounded number of rows even far past item 400", () => {
  const total = 1200;
  const first = visibleMediaRange(total, 0, 320, 26, 8);
  const deep = visibleMediaRange(total, 900 * 26, 320, 26, 8);
  assert.deepEqual(first, { first: 0, last: 21 });
  assert.equal(deep.first, 892);
  assert.ok(deep.last - deep.first < 40);
  assert.equal(visibleMediaRange(0, 0, 320, 26, 8).last, 0);
  assert.equal(visibleMediaRange(1200, 1195 * 26, 320, 26, 8).last, 1200);
});