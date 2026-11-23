import assert from "node:assert/strict";
import test from "node:test";

import { showSecondCopyNotices } from "../web_second_copy/notice.mjs";

test("an old copy loading shows a toast that stays until closed", () => {
  const added = [];
  const shown = showSecondCopyNotices(
    [{ summary: "AusBoss: an old copy is loading", detail: "Delete custom_nodes/ComfyUI-AusBoss", older: true }],
    { add: (message) => added.push(message) },
  );
  assert.equal(added.length, 1);
  assert.equal(added[0].severity, "error");
  assert.equal(added[0].life, undefined);
  assert.match(added[0].detail, /ComfyUI-AusBoss/);
  assert.deepEqual(shown, added);
});

test("a newer copy loading is a warning", () => {
  const added = [];
  showSecondCopyNotices([{ detail: "Delete one", older: false }], { add: (m) => added.push(m) });
  assert.equal(added[0].severity, "warn");
  assert.equal(added[0].summary, "AusBoss is installed twice");
});

test("no toast store falls back to the console, and junk is ignored", () => {
  const warned = [];
  const original = console.warn;
  console.warn = (line) => warned.push(line);
  try {
    const shown = showSecondCopyNotices([null, {}, { detail: "Delete one" }], undefined);
    assert.equal(shown.length, 1);
    assert.equal(warned.length, 1);
    assert.equal(showSecondCopyNotices({ not: "a list" }, undefined).length, 0);
  } finally {
    console.warn = original;
  }
});
