import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as math from "../js/shared/moment_strip_math.mjs";
import * as links from "../js/shared/graph_links.mjs";
import { commitWidgetValue, comboValues } from "../js/shared/widget_card_math.mjs";

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.className = "";
    this.value = "";
    this.classList = {
      add: (name) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      remove: (name) => { this.className = this.className.split(" ").filter((part) => part !== name).join(" "); },
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name),
    };
  }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  set textContent(text) { this.text = text; this.children = []; }
  get textContent() { return (this.text ?? "") + this.children.map((child) => child.textContent).join(""); }
  get childElementCount() { return this.children.length; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] ?? []).filter((entry) => entry !== fn); }
  dispatch(name, event = {}) {
    for (const fn of [...(this.listeners[name] ?? [])]) fn({ button: 0, clientX: 0, preventDefault() {}, stopPropagation() {}, ...event });
  }
  getBoundingClientRect() { return { left: 0, width: 100 }; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
}

function page() {
  let now = 0, next = 0, captures = 0;
  const timers = new Map(), intervals = new Map(), pending = [];
  const document = { head: new Element("head"), createElement: (tag) => new Element(tag), getElementById: () => null };
  const app = { canvas: {}, extensionManager: { workflow: { activeWorkflow: { changeTracker: { captureCanvasState() { captures++; } } } } } };
  const globals = {
    document, app, console, ...math, ...links, commitWidgetValue, comboValues,
    api: { fetchApi: (url, options) => new Promise((resolve) => pending.push({ body: JSON.parse(options.body), resolve })) },
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => { const id = ++next; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    queueMicrotask: (fn) => fn(),
    liftSocket() {},
    attachScriptColours: () => ({ sync() {}, dispose() {} }),
    attachScriptAssist: () => ({ dispose() {} }),
  };
  // Only browser imports are replaced; the controls and history notifier run as shipped.
  const load = (file, names) => {
    const source = readFileSync(new URL(`../js/shared/${file}`, import.meta.url), "utf8")
      .replace(/^import .*;\n/gm, "").replace(/\bexport (?=(?:function|const)\b)/g, "");
    return vm.runInNewContext(`${source}\n;({${names.join(",")}})`, { ...globals }, { filename: file });
  };
  Object.assign(globals, load("index.mjs", ["BRAND", "chainCallback", "notifyAusbossChange"]));
  return {
    ...load("h3_cast_chips.mjs", ["castChips"]), ...load("moment_strip.mjs", ["momentStrip"]),
    pending, intervals, timers, get captures() { return captures; },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
  };
}

const find = (element, predicate) => predicate(element) ? element : element.children.map((child) => find(child, predicate)).find(Boolean);
const named = (name) => (element) => element.classList.contains(name);
const makeNode = (script = "She walks.\nShe stops.") => ({ widgets: [{ name: "script", value: script }], inputs: [], graph: {}, setDirtyCanvas() {} });
const values = (node) => ({ script: node.widgets[0].value, seconds: 8, job_1: "person" });
const report = (text = "line", moments = [0, 1]) => ({ ok: true, json: async () => ({ seconds: 8, moments: moments.map((line, index) => ({ start: index * 4, end: (index + 1) * 4, text: `${text}${index}`, line })) }) });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function pictureGraph(bypass = false) {
  const loader = { id: 10, mode: 0, imgs: [{ src: "test.png" }], outputs: [{ type: "IMAGE" }] };
  const processor = { id: 11, mode: 4, inputs: [{ type: "IMAGE", link: 2 }], outputs: [{ type: "IMAGE" }] };
  const graph = { links: { 1: { origin_id: bypass ? 11 : 10, origin_slot: 0 }, 2: { origin_id: 10, origin_slot: 0 } }, getNodeById: (id) => id === 10 ? loader : id === 11 ? processor : null };
  return { graph, loader, processor };
}

test("a chip job change captures history once, after the widget write", () => {
  const p = page(), { graph } = pictureGraph();
  const widget = { name: "job_1", value: "person", options: { values: ["person", "place"] } };
  const node = { graph, widgets: [widget], inputs: [{ name: "picture_1", link: 1 }] };
  const panel = p.castChips(node);
  panel.sync({ job_1: "person" });
  p.advance(120);
  assert.equal(p.captures, 0, "sync does not dirty the workflow");
  const select = find(panel.element, (element) => element.tagName === "SELECT");
  select.value = "place"; select.dispatch("change");
  assert.equal(widget.value, "place");
  assert.equal(p.captures, 0, "capture waits for the completed write");
  p.advance(120);
  assert.equal(p.captures, 1);
  select.dispatch("change"); p.advance(120);
  assert.equal(p.captures, 1, "an unchanged job stays clean");
  node.onRemoved();
});

test("a completed timeline cut captures history once", async () => {
  const p = page(), node = makeNode(), panel = p.momentStrip(node);
  panel.sync(values(node)); p.advance(200);
  p.pending[0].resolve(report()); await flush();
  const handle = find(panel.element, named("ausboss-strip-handle"));
  handle.dispatch("pointerdown"); handle.dispatch("pointerup");
  assert.equal(node.widgets[0].value, "She walks.\n\nShe stops.");
  p.advance(120);
  assert.equal(p.captures, 1);
  node.onRemoved();
});

test("editing invalidates an old report before the next debounce fires", async () => {
  const p = page(), node = makeNode(), panel = p.momentStrip(node);
  panel.sync(values(node)); p.advance(200);
  node.widgets[0].value = "new"; panel.sync(values(node));
  p.pending[0].resolve(report("OLD")); await flush();
  assert.doesNotMatch(panel.element.textContent, /OLD/);
  p.advance(200);
  p.pending[1].resolve(report("NEW", [0])); await flush();
  assert.match(panel.element.textContent, /NEW/);
  node.onRemoved();
});

test("removal cancels debounce, polling, and in-flight repaint", async () => {
  const p = page(), node = makeNode(), panel = p.momentStrip(node);
  panel.sync(values(node)); node.onRemoved(); p.advance(200);
  assert.equal(p.pending.length, 0, "no request starts after removal");
  assert.equal(p.intervals.size, 0);
  const other = makeNode(), otherPanel = p.momentStrip(other);
  otherPanel.sync(values(other)); p.advance(200); other.onRemoved();
  p.pending.at(-1).resolve(report("REMOVED")); await flush();
  assert.doesNotMatch(otherPanel.element.textContent, /REMOVED/);
  otherPanel.sync({ script: "later", seconds: 8 }); p.advance(200);
  assert.equal(p.pending.length, 1, "a detached panel stays stopped");
});

test("replacing a loader image refreshes the timeline thumbnail", async () => {
  const p = page(), node = makeNode("@1 runs."), { graph, loader } = pictureGraph();
  node.graph = graph; node.inputs = [{ name: "picture_1", link: 1 }];
  const panel = p.momentStrip(node);
  panel.sync(values(node)); p.advance(200);
  p.pending.at(-1).resolve(report("@1 runs", [0])); await flush();
  assert.equal(find(panel.element, (element) => element.tagName === "IMG").src, "test.png");
  loader.imgs[0].src = "replacement.png";
  panel.sync(values(node)); p.advance(200);
  p.pending.at(-1).resolve(report("@1 runs", [0])); await flush();
  assert.equal(find(panel.element, (element) => element.tagName === "IMG").src, "replacement.png");
  node.onRemoved();
});

test("bypassed image processors forward pictures to chips and timeline", async () => {
  const p = page(), node = makeNode("@1 runs."), { graph, processor } = pictureGraph(true);
  node.graph = graph; node.inputs = [{ name: "picture_1", link: 1 }];
  node.widgets.push({ name: "job_1", value: "person", options: { values: ["person"] } });
  const chips = p.castChips(node), strip = p.momentStrip(node);
  chips.sync(values(node)); strip.sync(values(node)); p.advance(200);
  assert.equal(find(chips.element, (element) => element.tagName === "IMG")?.src, "test.png");
  assert.deepEqual(p.pending.at(-1).body.jobs, { 1: "person" });
  p.pending.at(-1).resolve(report("@1 runs", [0])); await flush();
  assert.equal(find(strip.element, (element) => element.tagName === "IMG")?.src, "test.png");
  processor.mode = 2; chips.sync(values(node)); strip.sync(values(node)); p.advance(200);
  assert.match(chips.element.textContent, /\+ @1/);
  assert.deepEqual(p.pending.at(-1).body.jobs, {});
  node.onRemoved();
  assert.equal(p.intervals.size, 0);
});

test("the chips row reserves room for three wrapped rows at minimum width", () => {
  const cards = readFileSync(new URL("../js/widget_cards/index.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../js/shared/h3_cast_chips.mjs", import.meta.url), "utf8");
  const height = Number(cards.match(/panel: castChips, height: (\d+)/)[1]);
  const chipHeight = Number(css.match(/\.ausboss-chip\{[^}]*height:(\d+)px/)[1]);
  const gap = Number(css.match(/\.ausboss-chips\{[^}]*gap:(\d+)px/)[1]);
  assert.ok(height >= 3 * chipHeight + 2 * gap, `${height}px cannot hold three chip rows`);
});
