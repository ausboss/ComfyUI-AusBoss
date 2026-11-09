import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as logic from "../js/shared/workflow_switches.mjs";
import { cardHeight } from "../js/shared/widget_card_math.mjs";

class Element extends EventTarget {
  constructor(tag = "div") {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.className = "";
    this.style = { setProperty(key, value) { this[key] = value; } };
  }
  get classList() {
    const classes = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (name) => classes().includes(name),
      add: (...names) => { this.className = [...new Set([...classes(), ...names])].join(" "); },
      remove: (...names) => { this.className = classes().filter((name) => !names.includes(name)).join(" "); },
      toggle: (name, force) => {
        const on = force ?? !classes().includes(name);
        this.className = [...classes().filter((value) => value !== name), ...(on ? [name] : [])].join(" ");
        return on;
      },
    };
  }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, cursor) {
    node.remove();
    node.parentElement = this;
    this.children.splice(cursor ? this.children.indexOf(cursor) : this.children.length, 0, node);
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes) {
    for (const node of [...this.children]) node.remove();
    this.append(...nodes);
  }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  setAttribute(name, value) { this[name] = value; }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith(".") && child.classList.contains(selector.slice(1))) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
  getContext() { return { measureText: (text) => ({ width: String(text).length * 6 }) }; }
}

function page() {
  class Node {
    constructor() {
      this.type = "AUSBOSS_NODES_WorkflowSwitches";
      this.properties = {};
      this.widgets = [];
      this.size = [320, 100];
      this.pos = [0, 0];
    }
    addDOMWidget(name, type, element, options) {
      const widget = { name, type, element, options };
      this.widgets.push(widget);
      return widget;
    }
    computeSize() { return [320, 100]; }
    setSize(size) { this.size = size; }
  }
  class Group {}
  const timers = new Map();
  const microtasks = [];
  let nextTimer = 0;
  const app = {
    canvas: { graph: { nodes: [], groups: [] } },
    registerExtension(extension) { this.extension = extension; },
  };
  const document = {
    head: new Element(), body: new Element(), activeElement: null,
    createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag),
    getElementById: () => null,
  };
  const context = vm.createContext({
    ...logic, app, document, performance, console, cardHeight,
    LiteGraph: { LGraphNode: Node, LGraphGroup: Group }, BRAND: "#00b4aa",
    chainCallback(proto, name, callback) {
      const previous = proto[name];
      proto[name] = function (...args) { const result = previous?.apply(this, args); callback.apply(this, args); return result; };
    },
    keepDomWidgetWidthAuto() {}, holdNodeMinWidth() {}, holdVueNodeMinWidth() {}, pinVuePanelHeight() {},
    ensureCardCss() {}, keepKeyInField() {}, notifyAusbossChange() {}, showToast() {}, commitWidgetValue() {}, onPaste() {},
    queueMicrotask: (callback) => microtasks.push(callback),
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const source = readFileSync(new URL("../js/workflow_switches/index.js", import.meta.url), "utf8");
  vm.runInContext(source.replace(/^import\s[\s\S]*?from\s+"[^"]+";\n/gm, "")
    + "\nglobalThis.hooks = { live, refresh, scheduleCheck, choiceSnapshots };", context);
  app.extension.beforeRegisterNodeDef(Node, { name: "AUSBOSS_NODES_WorkflowSwitches" });
  const flush = () => { for (const callback of microtasks.splice(0)) callback(); };
  const makeCard = () => {
    const node = new Node();
    node.onNodeCreated();
    node.graph = app.canvas.graph;
    node.graph.nodes.push(node);
    node.onAdded();
    flush();
    return node;
  };
  return { app, Node, Group, timers, flush, makeCard, ...context.hooks };
}

test("copy serialization clones do not retain live states or schedule redraw timers", () => {
  const p = page();
  const real = p.makeCard();
  const clones = Array.from({ length: 5 }, () => {
    const clone = new p.Node();
    clone.onNodeCreated();
    clone.onConfigure();
    return clone;
  });
  p.flush();
  assert.equal(p.live.size, 1);
  real.onRemoved();
  p.app.canvas.onDrawForeground();
  for (const clone of clones) p.scheduleCheck(clone.__ausbossWorkflowSwitches);
  assert.equal(p.live.size, 0);
  assert.equal(p.timers.size, 0);
  real.onAdded();
  p.flush();
  assert.equal(p.live.size, 1, "undoing removal registers the card again");
});

test("selection-free choice capture preserves text node ids", () => {
  const p = page();
  const card = p.makeCard();
  const target = { id: "node-value", widgets: [{ name: "value", value: 20 }] };
  card.properties.ausboss_workflow_switches = { switches: [{ id: 1, choice: true, on: { "node-value": { value: 8 } } }] };
  card.graph.getNodeById = (id) => id === target.id ? target : null;
  const snapshots = p.choiceSnapshots(card.__ausbossWorkflowSwitches, []);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].id, "node-value");
  assert.equal(snapshots[0].values.value, 20);
});

test("selecting a node after one group reveals the choice button without another graph change", () => {
  const p = page();
  const card = p.makeCard();
  card.properties.ausboss_workflow_switches.groups = "none";
  const group = new p.Group();
  group.id = 9;
  p.app.canvas.selectedItems = new Set([group]);
  p.refresh(card.__ausbossWorkflowSwitches);
  assert.equal(card.__ausbossWorkflowSwitches.choose.classList.contains("hidden"), true);
  const target = new p.Node();
  target.type = "Integer";
  target.id = 4;
  target.widgets = [{ name: "value", value: 8 }];
  p.app.canvas.selectedItems = new Set([target]);
  p.refresh(card.__ausbossWorkflowSwitches);
  assert.equal(card.__ausbossWorkflowSwitches.choose.classList.contains("hidden"), false);
});
