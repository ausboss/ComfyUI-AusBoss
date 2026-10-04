// What the update guard (js/cache_guard/index.js) tells the user, and when.
//
// The entry imports ComfyUI's own api and app, which only exist in the
// browser. It is loaded here from a copy with stand-ins for those two and for
// the shared module it reads the running version from.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "js", "cache_guard", "index.js");
const API_IMPORT = 'import { api } from "/scripts/api.js";';
const APP_IMPORT = 'import { app } from "/scripts/app.js";';

const PAGE = `
export const page = { installed: null, down: false, toasts: [], listeners: {}, extension: null };
export const api = {
  async fetchApi(path) {
    if (page.down) throw new Error("server is down");
    const body = path === "/ausboss/pack_version" ? { version: page.installed } : { modules: ["shared/index.mjs"] };
    return { json: async () => body };
  },
  addEventListener(name, listener) { (page.listeners[name] ||= []).push(listener); },
};
export const app = {
  extensionManager: { toast: { add: (message) => page.toasts.push(message) } },
  registerExtension(extension) { page.extension = extension; },
};
`;

// A page that loaded the pack's scripts at version `running` while the
// server has `installed`. Every call gets its own folder, so its own modules.
async function openPage(t, { running, installed }) {
  const source = readFileSync(ENTRY, "utf-8");
  assert.ok(source.includes(API_IMPORT) && source.includes(APP_IMPORT), "the entry's imports changed; update this test");
  const folder = mkdtempSync(join(tmpdir(), "ausboss-guard-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, "shared"));
  mkdirSync(join(folder, "cache_guard"));
  writeFileSync(join(folder, "shared", "index.mjs"), `export const AUSBOSS_JS_VERSION = ${JSON.stringify(running)};\n`);
  writeFileSync(join(folder, "page.mjs"), PAGE);
  writeFileSync(
    join(folder, "cache_guard", "index.mjs"),
    source.replace(API_IMPORT, 'import { api, app } from "../page.mjs";').replace(APP_IMPORT, ""),
  );
  const refreshed = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    refreshed.push({ url: String(url), cache: options?.cache });
    return new Response("");
  });
  const { page } = await import(pathToFileURL(join(folder, "page.mjs")).href);
  page.installed = installed;
  page.refreshed = refreshed;
  page.serverComesBack = async (version) => {
    page.installed = version;
    await Promise.all((page.listeners.reconnected || []).map((listener) => listener()));
  };
  await import(pathToFileURL(join(folder, "cache_guard", "index.mjs")).href);
  await page.extension.setup();
  return page;
}

test("a page on the installed version is left alone", async (t) => {
  const page = await openPage(t, { running: "2.6.1", installed: "2.6.1" });
  await page.serverComesBack("2.6.1");
  assert.deepEqual(page.toasts, []);
  assert.deepEqual(page.refreshed, []);
});

test("a page that loaded old files is asked to reload, and the message stays", async (t) => {
  const page = await openPage(t, { running: "2.5.0", installed: "2.6.1" });
  assert.equal(page.toasts.length, 1);
  assert.equal(page.toasts[0].summary, "AusBoss was updated");
  assert.match(page.toasts[0].detail, /v2\.6\.1 is installed.*Press F5/);
  assert.equal(page.toasts[0].life, undefined, "no life: the message stays until it is closed");
  assert.equal(page.refreshed.length, 1, "the stored copies are replaced before the reload");
  assert.ok(page.refreshed[0].url.endsWith("/shared/index.mjs"));
  assert.equal(page.refreshed[0].cache, "reload");
});

test("a tab left open through an update is asked when the server comes back", async (t) => {
  const page = await openPage(t, { running: "2.6.1", installed: "2.6.1" });
  assert.deepEqual(page.toasts, []);
  await page.serverComesBack("2.7.0");
  assert.equal(page.toasts.length, 1);
  assert.match(page.toasts[0].detail, /v2\.7\.0 is installed/);
  await page.serverComesBack("2.7.0");
  assert.equal(page.toasts.length, 1, "one message per update, however often the server drops");
  await page.serverComesBack("2.7.1");
  assert.equal(page.toasts.length, 2, "a second update asks again");
});

test("a server that does not answer keeps the page quiet", async (t) => {
  const page = await openPage(t, { running: "2.6.1", installed: "2.6.1" });
  page.down = true;
  await page.serverComesBack("2.7.0");
  assert.deepEqual(page.toasts, []);
  page.down = false;
  await page.serverComesBack("2.7.0");
  assert.equal(page.toasts.length, 1);
});
