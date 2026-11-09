import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import * as preview from "../js/shared/input_preview.mjs";
import { saveRequest, savedMessage } from "../js/shared/compare_erase.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const COMPARE = "js/compare/index.js";
const ERASE = "js/shared/compare_erase_stage.mjs";
const PREVIEW = "js/input_preview/index.js";
const SAVER = "js/save_image/index.js";

function part(file, start, end) {
  const source = read(file);
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing function boundary in ${file}`);
  return source.slice(first, last);
}

function chainCallback(target, name, callback) {
  const prior = target[name];
  target[name] = function (...args) {
    const result = prior?.apply(this, args);
    callback.apply(this, args);
    return result;
  };
}

function pendingRequest() {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  return {
    api: { fetchApi: () => pending },
    reply: (answer, ok = true) => resolve({ ok, status: ok ? 200 : 400, json: async () => answer }),
  };
}

function eraseContext(request) {
  const toasts = [];
  const context = vm.createContext({
    api: request.api, ALIGN_ROUTE: "/align", SAVE_ROUTE: "/save",
    LAYERS_PROPERTY: "layers", NAME_PROPERTY: "name", saveRequest, savedMessage,
    syncTools() {}, topOf: () => "A", showToast: (message) => toasts.push(message),
  });
  vm.runInContext(part(ERASE, "async function save(er)", "// The mix as a PNG"), context);
  return { context, toasts };
}

const pair = (index) => ({ a: { filename: `a${index}.png` }, b: { filename: `b${index}.png` }, pair: `pair${index}` });
const aligned = { aligned: true, b: { filename: "aligned-b1.png" }, pair: "aligned1" };

test("Align ignores a reply after changing pairs or removing its panel", async () => {
  for (const change of ["pair", "removed", "reload"]) {
    const request = pendingRequest();
    const { context, toasts } = eraseContext(request);
    const abort = new AbortController();
    const received = [];
    const er = { refs: pair(1), picturesVersion: 1, signal: abort.signal, onAligned: (refs) => received.push(refs) };
    const pending = context.align(er);
    if (change === "pair") er.refs = pair(2);
    if (change === "removed") abort.abort();
    if (change === "reload") er.picturesVersion += 1;
    request.reply(aligned);
    await pending;
    assert.equal(received.length, 0, change);
    assert.equal(toasts.length, 0, change);
    assert.equal(er.aligning, false);
  }
});

test("Align keeps the requested A and original pair on a current reply", async () => {
  const request = pendingRequest();
  const { context, toasts } = eraseContext(request);
  const original = pair(1);
  let received;
  const er = { refs: original, picturesVersion: 1, signal: new AbortController().signal, onAligned: (refs) => { received = refs; } };
  const pending = context.align(er);
  request.reply(aligned);
  await pending;
  assert.equal(received.a, original.a);
  assert.equal(received.b, aligned.b);
  assert.equal(received.original, original);
  assert.equal(received.pair, aligned.pair);
  assert.equal(toasts[0].severity, "success");
});

test("Save ignores UI callbacks after removal, for successful and failed replies", async () => {
  for (const ok of [true, false]) {
    const request = pendingRequest();
    const { context, toasts } = eraseContext(request);
    const abort = new AbortController();
    let callbacks = 0;
    const er = {
      refs: pair(1), node: { properties: {} }, strokes: [], signal: abort.signal,
      onSaved() { callbacks += 1; throw new Error("Removed panel"); },
    };
    const pending = context.save(er);
    abort.abort();
    request.reply({ files: [{ filename: "mix.png" }], error: "save failed" }, ok);
    await pending;
    assert.equal(callbacks, 0);
    assert.equal(toasts.length, 0);
    assert.equal(er.saving, false);
  }
});

test("Save still reports success and delivers files while its panel is alive", async () => {
  const request = pendingRequest();
  const { context, toasts } = eraseContext(request);
  const files = [{ filename: "mix.png" }];
  let received;
  const er = { refs: pair(1), node: {}, strokes: [], signal: new AbortController().signal, onSaved: (value) => { received = value; } };
  const pending = context.save(er);
  request.reply({ files });
  await pending;
  assert.equal(received, files);
  assert.deepEqual(toasts.map((toast) => toast.severity), ["success"]);
});

function previewContext(extra = {}) {
  const context = vm.createContext({
    ...preview, BRAND: "#00b4aa", chainCallback,
    api: { addEventListener() {}, apiURL: (url) => url },
    app: { registerExtension(extension) { this.extension = extension; } },
    setTimeout, clearTimeout, queueMicrotask, stepRun: () => ({}), ...extra,
  });
  const source = read(PREVIEW).replace(/^import\s[\s\S]*?from\s+"[^"]+";\s*/gm, "");
  vm.runInContext(source, context);
  return context;
}

test("shared source watchers unsubscribe in either order without retaining callbacks", () => {
  const refreshed = [];
  const context = previewContext();
  context.scheduleRefresh = (state) => refreshed.push(state);
  let calls = 0;
  const receiver = {};
  const original = function (value) { assert.equal(this, receiver); calls += 1; return value; };
  const widget = { name: "image", callback: original };
  const source = { widgets: [widget] };
  for (const order of [[0, 1], [1, 0]]) {
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const states = [{ alive: true }, { alive: true }];
      states.forEach((state) => context.rewatchSource(state, source));
      refreshed.length = 0;
      assert.equal(widget.callback.call(receiver, 17), 17);
      assert.deepEqual(refreshed, states);
      context.unwatchSource(states[order[0]]);
      refreshed.length = 0;
      widget.callback.call(receiver, 18);
      assert.deepEqual(refreshed, [states[order[1]]]);
      context.unwatchSource(states[order[1]]);
      assert.equal(widget.callback, original);
    }
  }
  assert.equal(calls, 400);
});

function media() {
  return {
    attributes: new Map(), assigned: [], pauses: 0,
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    removeAttribute(name) { this.attributes.delete(name); },
    set src(url) { this.attributes.set("src", url); this.assigned.push(url); },
    pause() { this.pauses += 1; }, load() {},
  };
}
const classes = () => ({ remove() {}, toggle() {} });

test("disabled previews clear images and videos and refresh never fetches them", () => {
  const context = previewContext({
    keepIndex: () => 0, growToNodeFloor() {},
    app: { nodeOutputs: { 7: { images: [{ filename: "saved.png", type: "output" }] } }, registerExtension() {} },
  });
  const graph = { getNodeById() { return null; } };
  graph.rootGraph = graph;
  const state = {
    alive: true, node: { id: 7, graph, inputs: [], imgs: [] }, inputName: "images", index: 0,
    previewWidget: { value: false }, root: { classList: classes() }, stage: { classList: classes() },
    img: media(), video: media(), stepper: { root: { hidden: true }, set() {} }, hint: {},
  };
  state.img.src = "old.png";
  state.video.src = "old.mp4";
  context.syncPreviewMode(state, false);
  assert.equal(state.img.getAttribute("src"), null);
  assert.equal(state.video.getAttribute("src"), null);
  context.refresh(state);
  assert.equal(state.img.getAttribute("src"), null);
  assert.equal(state.video.getAttribute("src"), null);
  assert.equal(state.img.assigned.length, 1);
  assert.equal(state.video.assigned.length, 1);
  assert.ok(state.video.pauses > 0);
  state.previewWidget.value = true;
  context.refresh(state);
  assert.match(state.img.getAttribute("src"), /saved\.png/);
});

test("deferred configuration cannot recreate removed or replaced panels", () => {
  for (const kind of ["compare", "preview"]) {
    for (const replace of [false, true]) {
      const queued = [];
      let rebuilt = 0;
      const context = vm.createContext({
        app: { registerExtension(extension) { this.extension = extension; } },
        chainCallback, queueMicrotask: (fn) => queued.push(fn), clearTimeout,
        hideInputsInDef() {}, livePanels: new Set(), unwatchSource() {}, clearMedia() {},
        buildPanel() { rebuilt += 1; return { eraser: {}, alive: true }; },
        syncErase() {}, syncAdvanced() {}, scheduleRefresh() {}, getMode: () => "slide", updateModeButtons() {},
      });
      const file = kind === "compare" ? COMPARE : PREVIEW;
      vm.runInContext('const NODE_NAME="Compare"; const REST_SETTING="test"; const NODE_CONFIG={Preview:{}}; const INPUT_SIDE=1;'
        + read(file).slice(read(file).indexOf("app.registerExtension({")), context);
      function Node() {}
      context.app.extension.beforeRegisterNodeDef(Node, { name: kind === "compare" ? "Compare" : "Preview" });
      const node = new Node();
      const key = kind === "compare" ? "__ausbossCompare" : "__ausbossInputPreview";
      const abort = new AbortController();
      const state = { abort, alive: true };
      node[key] = state;
      node.onConfigure();
      node.onRemoved();
      const replacement = replace ? { abort: new AbortController(), alive: true } : null;
      node[key] = replacement;
      queued.forEach((fn) => fn());
      assert.equal(rebuilt, 0, kind);
      assert.equal(node[key], replacement);
    }
  }
});

test("Browse invalidates the old saved path when changing destination", async () => {
  const elements = [];
  function el(tag, className = "", textContent = "") {
    return {
      tag, className, textContent, style: {}, children: [], events: {},
      append(...items) { this.children.push(...items); },
      addEventListener(name, fn) { this.events[name] = fn; }, remove() {}, contains() { return false; },
    };
  }
  const state = { node: {}, savedPath: "old/shot_00001.png", refresh() {} };
  let folder = "old";
  const context = vm.createContext({
    el, document: { body: { append: (element) => elements.push(element) } },
    window: { innerWidth: 1000, addEventListener() {} }, AbortController,
    value: () => folder, setValue: (_node, _name, next) => { folder = next; }, notifyAusbossChange() {},
    api: { fetchApi: async () => ({ ok: true, json: async () => ({ path: "new", folders: [] }) }) },
  });
  vm.runInContext(part(SAVER, "let openPopup = null;", "// ---------- the card"), context);
  await context.openBrowse(state, { getBoundingClientRect: () => ({ left: 0, bottom: 40 }) });
  elements[0].children.find((child) => child.className === "use").events.click();
  assert.equal(folder, "new");
  assert.equal(state.savedPath, null);
});

test("an execution with no saved file clears the old path", () => {
  const state = { savedPath: "old.png", refreshes: 0, refresh() { this.refreshes += 1; } };
  const node = {};
  const context = vm.createContext({ node, state, chainCallback, isForeignRun: () => false });
  vm.runInContext(part(SAVER, 'chainCallback(node, "onExecuted",', 'chainCallback(node, "onRemoved",'), context);
  node.onExecuted({ ausboss_saved_path: [] });
  assert.equal(state.savedPath, null);
  assert.equal(state.refreshes, 1);
  node.onExecuted({ ausboss_saved_path: ["new.png"] });
  assert.equal(state.savedPath, "new.png");
  node.onExecuted({});
  assert.equal(state.savedPath, null);
});
