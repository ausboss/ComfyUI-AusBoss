import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the real extension entry with a fake page in place of ComfyUI.
function page({ settings = {}, answer = { ok: true, status: 200 } } = {}) {
  const requests = [];
  const toasts = [];
  const app = {
    ui: { settings: { getSettingValue: (id) => settings[id] } },
    registerExtension(extension) { this.extension = extension; },
  };
  const api = {
    async fetchApi(path, options) {
      requests.push({ path, ...options });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const context = vm.createContext({ app, api, showToast: (toast) => toasts.push(toast), JSON });
  const source = readFileSync(new URL("../js/clear_vram/index.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\s*/gm, "");
  vm.runInContext(source, context);
  return { extension: app.extension, requests, toasts };
}

async function click(p) {
  const [item] = p.extension.getCanvasMenuItems();
  await item.callback();
}

test("the setting follows the pack's id and category rule and is on by default", () => {
  const [setting] = page().extension.settings;
  assert.equal(setting.id, "AusBoss.Memory.ClearVramMenu");
  assert.equal(setting.type, "boolean");
  assert.equal(setting.defaultValue, true);
  assert.deepEqual([...setting.category], ["🆎 AusBoss", "Memory", "Clear VRAM menu"]);
});

test("the canvas menu shows Clear VRAM unless the setting is off", () => {
  assert.deepEqual([...page().extension.getCanvasMenuItems().map((item) => item.content)], ["Clear VRAM 🆎"]);
  const off = page({ settings: { "AusBoss.Memory.ClearVramMenu": false } });
  assert.equal(off.extension.getCanvasMenuItems().length, 0);
});

test("a ComfyUI that forbids manual unloading gets no entry", () => {
  const p = page({ settings: { "Comfy.Memory.AllowManualUnload": false } });
  assert.equal(p.extension.getCanvasMenuItems().length, 0);
});

test("a click sends ComfyUI's own free request and confirms it", async () => {
  const p = page();
  await click(p);
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].path, "/free");
  assert.equal(p.requests[0].method, "POST");
  assert.deepEqual(JSON.parse(p.requests[0].body), { unload_models: true, free_memory: true });
  assert.equal(p.toasts.length, 1);
  assert.equal(p.toasts[0].severity, "success");
});

test("a refused or failed request shows the error", async () => {
  for (const answer of [{ ok: false, status: 500 }, new Error("Failed to fetch")]) {
    const p = page({ answer });
    await click(p);
    assert.equal(p.toasts.length, 1);
    assert.equal(p.toasts[0].severity, "error");
    assert.match(p.toasts[0].detail, answer instanceof Error ? /Failed to fetch/ : /500/);
  }
});
