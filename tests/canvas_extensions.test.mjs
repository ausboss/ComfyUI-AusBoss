import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import * as appearance from "../js/shared/appearance.mjs";
import * as help from "../js/shared/help_badge.mjs";
import * as line from "../js/shared/line_up.mjs";
import * as snap from "../js/shared/snap_lines.mjs";
import { boundsOf } from "../js/shared/outline.mjs";

// Run the real extension entry with a small page and graph in place of ComfyUI.
function page(name, nodes, { vue = false, hooks = [] } = {}) {
  const graph = { _nodes: nodes, _groups: [], setDirtyCanvas() {} };
  const canvas = {
    graph, selectedItems: new Set(nodes), setDirty() {},
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    ds: { scale: 1, offset: [0, 0] },
  };
  const app = { graph, canvas, registerExtension(extension) { this.extension = extension; } };
  const frames = new Map();
  let frameId = 0;
  const cards = [];
  const context = vm.createContext({
    ...appearance, ...help, ...line, ...snap, boundsOf,
    outlineOf: boundsOf, nodeElements: () => new Map(),
    app, LiteGraph: { vueNodesMode: vue },
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1000 },
    document: { querySelector: () => null },
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    chainCallback(object, key, fn) {
      const prior = object[key];
      object[key] = function (...args) {
        const result = prior?.apply(this, args);
        fn.apply(this, args);
        return result;
      };
    },
    chainHandler(object, key, fn) {
      const prior = object[key];
      object[key] = function (...args) {
        const result = prior?.apply(this, args);
        const handled = fn.apply(this, args);
        return result || handled;
      };
    },
    isAusbossNode: (node) => node.comfyClass?.startsWith("AUSBOSS_NODES_"),
    openInfoCard: (card) => cards.push(card),
    BRAND: "#00b4aa", notifyAusbossChange() {}, showToast() {},
  });
  const source = readFileSync(new URL(`../js/${name}/index.js`, import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\s*/gm, "");
  vm.runInContext(`${source}\nglobalThis.hooks = {${hooks.join(",")}};`, context);
  return {
    app, extension: app.extension, hooks: context.hooks, cards,
    flush() { for (const [id, fn] of frames) { frames.delete(id); fn(); } },
  };
}

function node(id, x = 0, y = 0, w = 200, h = 100) {
  return {
    id, pos: [x, y], size: [w, h], properties: {}, flags: {},
    comfyClass: "AUSBOSS_NODES_Seed", title: "Seed", constructor: {},
    get boundingRect() { return [this.pos[0], this.pos[1] - 30, this.size[0], this.size[1] + 30]; },
    computeSize: () => [100, 50],
    setSize(size) { this.size = size; },
  };
}

function pointer(node, corner = "SE", extra = {}) {
  const face = { dataset: { nodeId: String(node.id) } };
  const handle = { dataset: { corner }, closest: () => face };
  return {
    button: 0, buttons: 1, clientX: 0, clientY: 0,
    target: { closest: () => handle }, ...extra,
  };
}

function pick(page, node, name) {
  page.extension.getNodeMenuItems(node).find((item) => item.content === "AusBoss color")
    .submenu.options.find((item) => item.content === name).callback();
}

function setting(page, suffix, value) {
  page.extension.settings.find((item) => item.id.endsWith(suffix)).onChange(value);
}

function restore(page, saved) {
  const copy = node(99);
  page.extension.nodeCreated(copy); // construction precedes saved field restoration
  Object.assign(copy, JSON.parse(JSON.stringify(saved)));
  copy.onConfigure?.(saved);
  return copy;
}

test("pressing and releasing a resize handle leaves the other selected nodes alone", () => {
  for (const vue of [false, true]) {
    const a = node(1), b = node(2, 0, 300, 400);
    const p = page("line_up", [a, b], { vue, hooks: ["onTogetherDown", "onTogetherMove", "onTogetherUp"] });
    p.hooks.onTogetherDown(pointer(a));
    if (!vue) p.app.canvas.resizing_node = a;
    p.hooks.onTogetherMove(pointer(a));
    p.flush();
    p.hooks.onTogetherUp();
    assert.equal(b.size[0], 400);
  }
});

test("resize together still propagates a drag and its return to the starting size", () => {
  const a = node(1), b = node(2, 0, 300, 400);
  const p = page("line_up", [a, b], { hooks: ["onTogetherDown", "onTogetherMove", "onTogetherUp"] });
  p.hooks.onTogetherDown(pointer(a));
  a.size[0] = 240;
  p.hooks.onTogetherMove(pointer(a));
  p.flush();
  assert.equal(b.size[0], 240);
  a.size[0] = 200;
  p.hooks.onTogetherUp();
  assert.equal(b.size[0], 200);
});

test("per-node Theme default survives serialization, reload and paste", () => {
  const a = node(1);
  const p = page("appearance", [a]);
  p.extension.nodeCreated(a);
  pick(p, a, "Theme default");
  const saved = JSON.parse(JSON.stringify({ properties: a.properties, color: a.color, bgcolor: a.bgcolor }));
  for (let i = 0; i < 2; i++) {
    const copy = restore(p, saved);
    assert.equal(copy.color, undefined);
    assert.equal(copy.bgcolor, undefined);
  }
});

test("explicit color choices keep following the node instead of the global scheme", () => {
  for (const name of ["AusBoss", "Theme default", "Custom"]) {
    const a = node(1);
    const p = page("appearance", [a]);
    p.extension.nodeCreated(a);
    pick(p, a, name);
    const chosen = { color: a.color, bgcolor: a.bgcolor };
    setting(p, "NodeColor", "Slate");
    assert.deepEqual({ color: a.color, bgcolor: a.bgcolor }, chosen, name);
    const copy = restore(p, { properties: a.properties, ...chosen });
    assert.deepEqual({ color: copy.color, bgcolor: copy.bgcolor }, chosen, name);
  }
});

for (const corner of ["SE", "NE", "SW", "NW"]) {
  test(`Nodes 2.0 ${corner} resize snaps only the moving edges`, () => {
    const a = node(1, 0, 0, 280, 100);
    const west = corner.includes("W"), north = corner.includes("N");
    const b = node(2, west ? -20 : 300, north ? -200 : 400, 100, 100);
    const p = page("snap_lines", [a, b], { vue: true, hooks: ["onPointerDown", "onPointerMove", "end"] });
    p.hooks.onPointerDown(pointer(a, corner));
    if (west) { a.pos[0] = -16; a.size[0] = 296; }
    else a.size[0] = 296;
    if (north) { a.pos[1] = -66; a.size[1] = 166; }
    p.hooks.onPointerMove(pointer(a, corner));
    p.flush();
    assert.equal(a.size[0], 300);
    assert.equal(a.pos[0], west ? -20 : 0);
    assert.equal(a.pos[0] + a.size[0], west ? 280 : 300);
    if (north) {
      assert.equal(a.pos[1], -70);
      assert.equal(a.pos[1] + a.size[1], 100);
    }
    p.hooks.end();
    a.size[0] = 296;
    p.hooks.onPointerMove(pointer(a, corner));
    p.flush();
    assert.equal(a.size[0], 296, "release clears the captured handle");
  });
}

test("Nodes 2.0 resize lets Shift bypass snapping", () => {
  const a = node(1, 0, 0, 280), b = node(2, 300, 400, 100);
  const p = page("snap_lines", [a, b], { vue: true, hooks: ["onPointerDown", "onPointerMove"] });
  p.hooks.onPointerDown(pointer(a));
  a.size[0] = 296;
  p.hooks.onPointerMove(pointer(a, "SE", { shiftKey: true }));
  p.flush();
  assert.equal(a.size[0], 296);
});

test("titled Nodes 2.0 nodes offer an About card in the context menu", () => {
  const a = node(1);
  const p = page("appearance", [a], { vue: true });
  p.extension.nodeCreated(a);
  const about = p.extension.getNodeMenuItems(a).find((item) => item.content === "About this node");
  assert.ok(about);
  about.callback();
  assert.equal(p.cards[0].title, "Seed");
});

test("an invalid Custom edit preserves the last valid color for later sweeps", () => {
  const a = node(1);
  const p = page("appearance", [a]);
  p.extension.nodeCreated(a);
  setting(p, "NodeColor", "Custom");
  const before = a.color;
  setting(p, "CustomColor", "bad");
  assert.equal(a.color, before);
  setting(p, "CustomColor", "ff0000");
  assert.equal(a.color, "#ff0000");
  setting(p, "NodeColor", "Slate");
  assert.equal(a.color, appearance.schemeColors("Slate").title);
});

test("saved legacy colors migrate after configuration, including Theme default", () => {
  for (const name of ["AusBoss", "Slate", "Theme default"]) {
    const p = page("appearance", []);
    setting(p, "NodeColor", name);
    const old = appearance.LEGACY_SCHEME_PAIRS[0];
    const copy = restore(p, { color: old.title, bgcolor: old.body, properties: {} });
    assert.equal(copy.color, appearance.schemeColors(name)?.title);
    assert.equal(copy.bgcolor, appearance.schemeColors(name)?.body);
  }
});

test("restoration preserves manual colors and chains the existing configure callback", () => {
  const a = node(1);
  const p = page("appearance", [a]);
  let calls = 0;
  a.onConfigure = function () { assert.equal(this, a); calls++; return 42; };
  p.extension.nodeCreated(a);
  Object.assign(a, { color: "#123456", bgcolor: "#654321" });
  assert.equal(a.onConfigure({}), 42);
  assert.equal(calls, 1);
  assert.equal(a.color, "#123456");
  assert.equal(a.bgcolor, "#654321");
});

test("a later manual color edit wins over an earlier menu choice on reload", () => {
  const a = node(1);
  const p = page("appearance", [a]);
  p.extension.nodeCreated(a);
  pick(p, a, "Theme default");
  const copy = restore(p, { properties: a.properties, color: "#123456", bgcolor: "#654321" });
  assert.equal(copy.color, "#123456");
  assert.equal(copy.bgcolor, "#654321");
});
