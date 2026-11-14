import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function decorativeCss(titleHeight = 30) {
  const source = readFileSync(new URL("../js/shared/tile_face.mjs", import.meta.url), "utf8")
    .replace(/^import .*;\n/, "").replaceAll("export ", "");
  const context = vm.createContext({ LiteGraph: { NODE_TITLE_HEIGHT: titleHeight } });
  vm.runInContext(`${source}\n;globalThis.css = TILE_FACE_CSS;`, context);
  return context.css;
}

test("Vue tiles discard the hidden title reservation while keeping the saved height", () => {
  for (const titleHeight of [30, 42]) {
    const css = decorativeCss(titleHeight);
    const rule = css.match(/\.lg-node:has\(\.ausboss-tile-face\):not\(\[data-collapsed\]\)\{([^}]+)\}/)?.[1];
    assert.ok(rule.includes(`min-height:calc(var(--node-height) - ${titleHeight}px);`));
    assert.ok(rule.includes(`translate:0 ${titleHeight}px;`));
    // LGraphNode.vue sets --node-height to saved height + native title.
    // Both a small info tile and a tall decorative face keep that saved size.
    for (const saved of [78, 88, 520]) {
      const frontendHeight = saved + titleHeight;
      assert.equal(frontendHeight - titleHeight, saved);
    }
  }
});

test("only decorative Vue bodies release badge space, without hiding the last widget", () => {
  const css = decorativeCss();
  assert.ok(css.includes('.lg-node:has(.ausboss-tile-face,.ausboss-callout) [data-testid^="node-body-"]>.mt-auto{display:none;}'));
  assert.ok(!css.includes("div:last-child"), "badge-free tiles must not lose their widget body");
  assert.ok(!css.includes("font-size"), "fix the reserved space rather than reducing legible type");
});

// Exercise the real pointer/key handlers without a ComfyUI server. The mock
// supplies only the DOM and canvas methods used by the shared tile face.
function fixture({ size = [300, 80], floor = [210, 94], scale = 1 } = {}) {
  class Element extends EventTarget {
    classList = { toggle() {} };
    children = [];
    append(child) { this.children.push(child); }
    querySelector() { return this; }
    setAttribute() {}
    setPointerCapture() {}
    closest() { return null; }
    remove() { this.removed = true; }
  }
  const root = new Element();
  let starts = 0, ends = 0;
  const app = { canvas: { ds: { scale }, selectNode() {} } };
  const node = {
    size, pos: [20, 30], flags: {},
    computeSize: () => floor,
    setSize(next) { this.size = [...next]; },
    graph: { beforeChange() { starts++; }, afterChange() { ends++; } },
  };
  const source = readFileSync(new URL("../js/shared/tile_face.mjs", import.meta.url), "utf8")
    .replace(/^import .*;\n/, "").replaceAll("export ", "");
  const context = vm.createContext({ app, AbortController, CustomEvent, document: { createElement: () => new Element() } });
  vm.runInContext(source, context);
  context.setTileFace(node, root, true);
  const grip = root.children[0];
  const send = (type, values = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, clientX: 0, clientY: 0, ...values });
    grip.dispatchEvent(event);
  };
  return { node, root, grip, send, app, disable: () => context.setTileFace(node, root, false), changes: () => [starts, ends] };
}

test("the visible tile grip resizes at canvas zoom without moving the tile", () => {
  const f = fixture({ scale: 2 });
  f.send("pointerdown", { clientX: 100, clientY: 100 });
  f.send("pointermove", { clientX: 220, clientY: 140 });
  f.send("pointerup");
  assert.deepEqual(f.node.size, [360, 100]);
  assert.deepEqual(f.node.pos, [20, 30]);
  assert.deepEqual(f.changes(), [1, 1]);
});

test("resizing keeps a small saved tile steady and clamps at its native floor", () => {
  const f = fixture();
  f.send("pointerdown");
  f.send("pointermove");
  assert.deepEqual(f.node.size, [300, 80], "a saved tile below the current native floor must not jump");
  f.send("pointermove", { clientX: -1000, clientY: -1000 });
  assert.deepEqual(f.node.size, [210, 80]);
  f.send("pointercancel");
  assert.deepEqual(f.changes(), [1, 1]);
});

test("keyboard resize supports fine steps, respects pinning and removes its handle on plain cards", () => {
  const f = fixture();
  f.send("keydown", { key: "ArrowRight", shiftKey: true });
  assert.deepEqual(f.node.size, [301, 80]);
  f.node.pinned = true;
  f.send("keydown", { key: "ArrowRight" });
  f.send("pointerdown");
  f.send("pointermove", { clientX: 100 });
  f.send("pointerup");
  assert.deepEqual(f.node.size, [301, 80]);
  assert.deepEqual(f.changes(), [1, 1]);
  f.disable();
  assert.equal(f.grip.removed, true);
});

test("a tile drag names its card for snapping and reports each move once placed", () => {
  const f = fixture();
  assert.equal(f.node.ausbossOutlineElement, f.root, "Snap into line measures the card, not the transparent node");
  let stopped = 0;
  const reports = [];
  f.root.addEventListener("ausboss-tile-move", (event) => reports.push([...f.node.pos, event.detail.clientX]));
  const send = (type, values = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, isPrimary: true, clientX: 0, clientY: 0, ...values });
    if (type === "pointermove") event.stopPropagation = () => stopped++;
    f.root.dispatchEvent(event);
  };
  send("pointerdown", { clientX: 10, clientY: 10 });
  send("pointermove", { clientX: 60, clientY: 30 });
  assert.deepEqual([...f.node.pos], [70, 50]);
  assert.equal(stopped, 1, "the move stays with the tile, or Nodes 2.0 pans the canvas with it");
  assert.deepEqual(reports, [[70, 50, 60]], "Snap into line hears the move after the tile is placed");
  send("pointerup");
  f.disable();
  assert.equal(f.node.ausbossOutlineElement, undefined);
});
