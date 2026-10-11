// Name tokens in a save node's file name: which ones the browser fills, which
// are left for the server, and what a preview shows before a run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { filledName, installNameTokens, previewName } from "../js/shared/name_tokens.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// What ComfyUI's own utility does with one token, enough to stand in for it.
const calls = [];
const core = (app, text) => {
  calls.push(text);
  if (text === "%date:yyyy-MM-dd%") return "2026-03-07";
  if (text === "%KSampler.seed%") return String(app.seed);
  if (text === "%boom.now%") throw new Error("no such node");
  return text;
};
const app = { seed: 1234 };

test("the browser fills the date and the settings of other nodes", () => {
  assert.equal(filledName("%date:yyyy-MM-dd%/img_%KSampler.seed%", app, core), "2026-03-07/img_1234");
  assert.equal(filledName("plain name", app, core), "plain name");
  assert.equal(filledName(undefined, app, core), "");
});

test("the size and time tokens are left for the server and never reach ComfyUI's utility", () => {
  calls.length = 0;
  const text = "%width%x%height%_%year%%month%%day%_%hour%%minute%%second%";
  assert.equal(filledName(text, app, core), text);
  assert.deepEqual(calls, []);
});

test("without ComfyUI's utility, or when it fails, the text goes through as typed", () => {
  assert.equal(filledName("%date:yyyy-MM-dd%", app, undefined), "%date:yyyy-MM-dd%");
  assert.equal(filledName("a_%boom.now%_%KSampler.seed%", app, core), "a_%boom.now%_1234");
});

test("a preview shows the time tokens as of now and leaves the size, which a run decides", () => {
  const now = new Date(2026, 2, 7, 9, 5, 2);
  assert.equal(previewName("%year%-%month%-%day%_%hour%%minute%%second%", app, { now, replace: core }), "2026-03-07_090502");
  assert.equal(previewName("%date:yyyy-MM-dd%_%width%x%height%", app, { now, replace: core }), "2026-03-07_%width%x%height%");
});

test("the tokens are filled when a run is sent and the widget keeps the text as typed", () => {
  const prefix = { name: "filename_prefix", value: "img_%KSampler.seed%" };
  const other = { name: "format", value: "png" };
  const node = { widgets: [prefix, other] };
  globalThis.comfyAPI = { utils: { applyTextReplacements: core } };
  try {
    installNameTokens(node, ["filename_prefix", "exact_name"], app);
    assert.equal(prefix.serializeValue(), "img_1234");
    assert.equal(prefix.value, "img_%KSampler.seed%");
    assert.equal(other.serializeValue, undefined);
    // A second install leaves the first in place.
    const first = prefix.serializeValue;
    installNameTokens(node, ["filename_prefix"], app);
    assert.equal(prefix.serializeValue, first);
  } finally {
    delete globalThis.comfyAPI;
  }
});

test("Save Image and Save Video both fill the tokens of their name fields", () => {
  const image = readFileSync(join(ROOT, "js", "save_image", "index.js"), "utf-8");
  const video = readFileSync(join(ROOT, "js", "save_video", "index.js"), "utf-8");
  assert.match(image, /installNameTokens\(this, \["filename_prefix", "exact_name"\], app\)/);
  assert.match(video, /installNameTokens\(this, \["filename_prefix"\], app\)/);
});
