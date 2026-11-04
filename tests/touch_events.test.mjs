import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { outputRecordQuery } from "../js/shared/input_preview.mjs";

const strip = (text) => text.replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["'];\s*/gm, "").replace(/^export /gm, "");

function entry() {
  const events = new Map();
  const timers = new Map();
  let now = 1000, next = 0, queue = { queue_pending: [], queue_running: [] };
  const checked = [];
  const context = vm.createContext({
    console, Map, Set, Promise, performance: { now: () => now },
    setTimeout(fn, delay) {
      const id = ++next;
      timers.set(id, { fn: () => { timers.delete(id); return fn(); }, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    api: { addEventListener: (name, fn) => events.set(name, fn), fetchApi: async () => ({ json: async () => queue }) },
    app: { graph: {}, registerExtension() {} },
    executionIdOf: (_graph, node) => String(node.id),
    isForeignRun(id) { checked.push(id); return id === "foreign"; },
  });
  vm.runInContext(strip(readFileSync(new URL("../js/mask_by_touch/index.js", import.meta.url), "utf8")), context);
  vm.runInContext(`
    globalThis.taken = [];
    globalThis.face = {alive:true,inFlight:true,askedAt:0,node:{id:7},settle(){this.inFlight=false;},takeNote(note){taken.push(note.key);}};
    faces.add(face);
  `, context);
  return { context, events, timers, checked, advance: (value) => { now = value; }, queue: (value) => { queue = value; } };
}

test("interim notes check their prompt's workflow before delivery", () => {
  const { context, events, checked } = entry();
  const look = events.get("ausboss.mask_by_touch.look");
  look({ detail: { node: "7", prompt_id: "foreign", note: { key: "wrong tab" } } });
  assert.equal(context.taken.length, 0);
  look({ detail: { node: "7", prompt_id: "current", note: { key: "this tab" } } });
  assert.deepEqual([...context.taken], ["this tab"]);
  assert.deepEqual(checked, ["foreign", "current"]);
});

test("an early empty status rechecks a deleted request without another event", async () => {
  const { context, events, timers, advance } = entry();
  events.get("status")({ detail: { exec_info: { queue_remaining: 0 } } });
  assert.equal(context.face.inFlight, true);
  assert.equal(timers.size, 1);
  const { fn, delay } = [...timers.values()][0];
  assert.ok(delay > 0 && delay <= 501);
  advance(1600);
  await fn();
  assert.equal(context.face.inFlight, false);
});

test("the delayed empty check leaves a running request waiting", async () => {
  const { context, events, timers, advance, queue } = entry();
  events.get("status")({ detail: { exec_info: { queue_remaining: 0 } } });
  assert.equal(timers.size, 1);
  queue({ queue_pending: [], queue_running: [[0, "current"]] });
  advance(1600);
  await [...timers.values()][0].fn();
  assert.equal(context.face.inFlight, true);
});

test("a newer queue status wins over a delayed empty response", async () => {
  const { context, events, timers, advance, queue } = entry();
  let finish;
  queue(new Promise((resolve) => { finish = resolve; }));
  const status = events.get("status");
  status({ detail: { exec_info: { queue_remaining: 0 } } });
  advance(1600);
  const checking = [...timers.values()][0].fn();
  status({ detail: { exec_info: { queue_remaining: 1 } } });
  finish({ queue_pending: [], queue_running: [] });
  await checking;
  assert.equal(context.face.inFlight, true);
  assert.equal(timers.size, 0);
});

test("a failed queue response never cancels a waiting request", async () => {
  const { context, events, timers, advance, queue } = entry();
  events.get("status")({ detail: { exec_info: { queue_remaining: 0 } } });
  queue({ error: "Unavailable" });
  advance(1600);
  await [...timers.values()][0].fn();
  assert.equal(context.face.inFlight, true);
});

test("a count-only result cannot make an obsolete preview current", () => {
  let extension;
  const context = vm.createContext({
    console, Map, Set, WeakMap, Promise, queueMicrotask() {}, setTimeout: () => 1, clearTimeout() {},
    api: { addEventListener() {}, apiURL: (path) => path },
    app: { graph: {}, nodeOutputs: {}, registerExtension(value) { extension = value; } },
    chainCallback(target, name, fn) {
      const prior = target[name];
      target[name] = function (...args) { const result = prior?.apply(this, args); fn.apply(this, args); return result; };
    },
    isForeignRun: () => false, hideInputsInDef() {}, outputLocatorId: () => "7", outputRecordQuery,
  });
  vm.runInContext(strip(readFileSync(new URL("../js/input_preview/index.js", import.meta.url), "utf8")), context);
  vm.runInContext("scheduleRefresh = () => {}; setNote = () => {}; setReadout = () => {};", context);
  class PreviewNode {}
  extension.beforeRegisterNodeDef(PreviewNode, { name: "AUSBOSS_NODES_MaskByName" });
  const node = new PreviewNode();
  const state = node.__ausbossInputPreview = { node, alive: true, stale: true, resultGone: true };
  node.onExecuted({ ausboss_mask_by_name: [{ found: 1, name: "new search", sure: [0.9] }] });
  assert.equal(state.stale, true);
  assert.equal(state.resultGone, true);
  node.onExecuted({ images: [{ filename: "new.png", type: "temp" }] });
  assert.equal(state.stale, false);
  assert.equal(state.resultGone, false);
});
