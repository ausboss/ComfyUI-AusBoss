import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as trim from "../js/load_video/trim_preview.mjs";
import * as videoMath from "../js/shared/video_preview.mjs";
import * as timecode from "../js/shared/timecode.mjs";
import * as restore from "../js/shared/load_video_restore.mjs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\s*$/gm, "").replace(/^export /gm, "");
}

function functionSource(path, name) {
  const text = source(path);
  const start = text.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const rest = text.slice(start);
  const next = rest.slice(1).search(/\n(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

class Element extends EventTarget {
  constructor(tag = "div") {
    super();
    this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.attrs = {};
    this.duration = 10; this.readyState = 1; this.currentTime = 0; this.paused = true;
    this.classList = {
      values: new Set(), add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); },
      toggle(value, enabled) { if (enabled) this.values.add(value); else this.values.delete(value); },
    };
  }
  append(...items) { this.children.push(...items); }
  insertBefore(item) { this.children.push(item); }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name]; }
  removeAttribute(name) { delete this.attrs[name]; }
  load() { this.loadCalls = (this.loadCalls ?? 0) + 1; }
  pause() { this.paused = true; this.pauseCalls = (this.pauseCalls ?? 0) + 1; }
  getBoundingClientRect() { return {left: 0, width: 100}; }
  setPointerCapture() {}
  releasePointerCapture() { this.dispatchEvent(new Event("lostpointercapture")); }
}

function pointer(type, x, buttons = 1) {
  const event = new Event(type);
  Object.assign(event, {button: 0, buttons, clientX: x, pointerId: 1});
  return event;
}

for (const single of [false, true]) {
  test(`cancelled ${single ? "FRAME" : "trim"} gesture removes every listener`, () => {
    const rail = new Element();
    const state = {range: rail, video: {duration: 10}, start: 2, end: 8, node: {}};
    const context = vm.createContext({
      ...trim, AbortController, state, notifyAusbossChange() {},
      isSingleFrame: () => single, currentBounds: (s) => ({start: s.start, end: s.end}),
      writeTrim(s, bounds) { s.start = bounds.start; s.end = bounds.end; },
      writeFrameTime(s, time) { s.start = time; },
    });
    vm.runInContext(functionSource("js/load_video/index.js", "installTrimDrag"), context);
    vm.runInContext("installTrimDrag(state)", context);
    rail.dispatchEvent(pointer("pointerdown", 20));
    rail.dispatchEvent(pointer("pointermove", 25));
    rail.dispatchEvent(pointer("pointerup", 25, 0));
    rail.dispatchEvent(pointer("pointerdown", 25));
    rail.dispatchEvent(pointer("pointermove", 30));
    rail.dispatchEvent(pointer("pointercancel", 30, 0));
    const cancelled = state.start;
    rail.dispatchEvent(pointer("pointermove", 40));
    assert.equal(state.start, cancelled);
    assert.equal(state.dragging, false);
  });
}

for (const reason of ["superseded", "disposed", "failed", "adopted"]) {
  test(`preview object URL ownership after ${reason} image decode`, async () => {
    const images = [], revoked = [];
    const state = {node: {}, loadSerial: 1};
    const context = vm.createContext({
      state, AbortController, videoParams: () => "", syncTimelineRange() {}, setValue() {},
      URL: {createObjectURL: () => "blob:frame", revokeObjectURL: (url) => revoked.push(url)},
      Image: class { constructor() { images.push(this); } },
      api: {fetchApi: async () => ({ok: true, blob: async () => ({}), headers: {get: () => "0"}})},
    });
    vm.runInContext(functionSource("js/shared/transform_editor.mjs", "loadVideoFrame"), context);
    const pending = vm.runInContext("loadVideoFrame(state, 1, {syncWidgets: false})", context);
    await new Promise(setImmediate);
    if (reason === "superseded") state.loadSerial += 1;
    if (reason === "disposed") { state.disposed = true; state.frameController.abort(); }
    if (reason === "failed") {
      images[0].onerror();
      await assert.rejects(pending, /Could not display/);
    } else {
      images[0].onload();
      await pending;
    }
    assert.deepEqual(revoked, reason === "adopted" ? [] : ["blob:frame"]);
    assert.equal(state.frameObjectUrl, reason === "adopted" ? "blob:frame" : undefined);
  });
}

function previewContext(path) {
  const extensions = [];
  const context = vm.createContext({
    ...trim, ...videoMath, ...timecode, AbortController, Event, URLSearchParams,
    document: {createElement: (tag) => new Element(tag), activeElement: null},
    app: {registerExtension: (extension) => extensions.push(extension)}, api: {apiURL: (s) => s},
    chainCallback(object, name, callback) {
      const prior = object[name];
      object[name] = function (...args) { prior?.apply(this, args); callback.apply(this, args); };
    },
    ensureVideoCss() {}, suppressCoreVideoPreview() {}, hideCanvasWidget() {},
    keepDomWidgetWidthAuto() {}, fillNodeHeight() {}, VIDEO_MIN_WIDTH: 220, WIDGET_FRAME: 20,
    makeToolButton: () => new Element("button"), mountStepOverlay: () => ({root: new Element(), hide() {}}),
    stepRun: () => ({status: "idle"}), addStepConsumer: () => () => {}, watchSteps: () => () => {},
    notifyAusbossChange() {}, installNameTokens() {}, keepKeyInField() {},
    setTimeout() {}, queueMicrotask: (callback) => callback(), cancelAnimationFrame() {}, requestAnimationFrame() { return 1; },
  });
  vm.runInContext(source(path), context);
  return {context, extension: extensions[0]};
}

function makeNode() {
  return {
    widgets: [
      {name: "video", value: ""}, {name: "start_seconds", value: 0}, {name: "end_seconds", value: 0},
      {name: "single_frame", value: false}, {name: "every_nth", value: 1}, {name: "max_frames", value: 0},
      {name: "step_preview", value: false},
    ],
    properties: {}, size: [380, 450], setSize(size) { this.size = size; }, setDirtyCanvas() {},
    addDOMWidget(name, type, element) { const widget = {name, type, element}; this.widgets.push(widget); return widget; },
  };
}

test("Save Video configuration restores LOOP off on the existing player", () => {
  const {context, extension} = previewContext("js/save_video/index.js");
  function Node() {}
  extension.beforeRegisterNodeDef(Node, {name: "AUSBOSS_NODES_SaveVideo"});
  const node = Object.assign(new Node(), makeNode());
  node.onNodeCreated();
  node.properties.ausboss_save_video_loop = false;
  node.onConfigure();
  const state = node.__ausbossSaveVideo;
  assert.equal(state.video.loop, false);
  assert.equal(state.loopButton.classList.values.has("active"), false);
});

test("Load Video summary follows sampling widgets and linked inputs", () => {
  const {context, extension} = previewContext("js/load_video/index.js");
  function Node() {}
  extension.beforeRegisterNodeDef(Node, {name: "AUSBOSS_NODES_LoadVideo"});
  const node = Object.assign(new Node(), makeNode());
  node.onNodeCreated();
  const state = node.__ausbossLoadVideo;
  state.sourceFps = 24;
  state.video.dispatchEvent(new Event("loadedmetadata"));
  assert.match(state.durationLabel.textContent, /240 frames @ 24 fps/);
  state.everyNthWidget.value = 2; state.everyNthWidget.callback?.(2);
  assert.match(state.durationLabel.textContent, /120 frames @ 12 fps/);
  state.maxFramesWidget.value = 30; state.maxFramesWidget.callback?.(30);
  assert.match(state.durationLabel.textContent, /30 frames @ 12 fps/);
  node.inputs = [{widget: {name: "every_nth"}, link: 1}]; node.onConnectionsChange?.();
  assert.doesNotMatch(state.durationLabel.textContent, /frames/);
});

test("removing Load Video pauses and unloads the player", () => {
  const {extension} = previewContext("js/load_video/index.js");
  function Node() {}
  extension.beforeRegisterNodeDef(Node, {name: "AUSBOSS_NODES_LoadVideo"});
  const node = Object.assign(new Node(), makeNode()); node.onNodeCreated();
  const video = node.__ausbossLoadVideo.video;
  video.paused = false; video.setAttribute("src", "clip.mp4");
  node.onRemoved();
  assert.equal(video.paused, true);
  assert.equal(video.getAttribute("src"), undefined);
  assert.equal(video.loadCalls, 1);
});

test("dropping a rendered clip resets trim, resize and sampling before loading it", async () => {
  const node = makeNode();
  node.widgets.push({name: "custom_width", value: 640}, {name: "custom_height", value: 480});
  for (const widget of node.widgets) if (widget.name !== "video") widget.value = 5;
  const video = node.widgets.find((widget) => widget.name === "video");
  video.callback = () => {
    for (const [name, value] of Object.entries({
      start_seconds: 0, end_seconds: 0, custom_width: 0, custom_height: 0,
      every_nth: 1, max_frames: 0, single_frame: false,
    })) {
      assert.equal(node.widgets.find((widget) => widget.name === name).value, value);
    }
  };
  const errors = [];
  const context = vm.createContext({
    ...restore, node, notifyAusbossChange() {}, showToast: (error) => errors.push(error),
    uploadToInput: async () => "trimmed.mp4", isMp4File: () => true, looksLikeMp4: () => true,
    mp4WorkflowPayload: () => ({workflow: {nodes: [{type: "AUSBOSS_NODES_LoadVideo", widgets_values: ["source.mp4", 5, 8, 640, 480, 2, 10, true]}]}}),
  });
  vm.runInContext(functionSource("js/video_workflow_drop/index.js", "applyDropToLoadVideo"), context);
  vm.runInContext(functionSource("js/video_workflow_drop/index.js", "handleLoadVideoDrop"), context);
  await vm.runInContext('handleLoadVideoDrop(node, {name: "trimmed.mp4", arrayBuffer: async () => new ArrayBuffer(0)})', context);
  assert.deepEqual(errors, []);
  assert.equal(video.value, "trimmed.mp4");
});
