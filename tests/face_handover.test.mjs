import assert from "node:assert/strict";
import test from "node:test";

import { createFaceHandover, faceIdOf } from "../js/shared/face_handover.mjs";

// Just enough DOM for the hand-over: a tree with a connected root, and the
// three things it asks of an element.
class El {
  constructor(label, attrs = {}) {
    this.label = label;
    this.attrs = attrs;
    this.parent = null;
    this.children = [];
    this.isRoot = false;
  }
  get isConnected() {
    for (let e = this; e; e = e.parent) if (e.isRoot) return true;
    return false;
  }
  append(child) {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceWith(other) {
    const parent = this.parent;
    if (!parent) return;
    other.remove();
    parent.children[parent.children.indexOf(this)] = other;
    other.parent = parent;
    this.parent = null;
  }
  closest(selector) {
    assert.equal(selector, "[data-node-id]");
    for (let e = this; e; e = e.parent) if (e.attrs["data-node-id"] !== undefined) return e;
    return null;
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
}

function page() {
  const root = new El("document");
  root.isRoot = true;
  return root;
}

// What Nodes 2.0 (frontend 1.53) does: one face per node id, and in it one
// slot per DOM widget that mounts the widget's element when the slot is made
// and never again. A rebuild that keeps the id keeps the face and the slot.
function nodes2Face(root, id) {
  const face = root.append(new El(`face ${id}`, { "data-node-id": String(id) }));
  const slot = face.append(new El(`slot ${id}`));
  return { face, slot };
}

let made = 0;
function makeNode(id, { graph = "root", widgets = ["ausboss_seed_panel"] } = {}) {
  return {
    id,
    graph: { id: graph },
    widgets: [
      { name: "seed", value: 0 },
      ...widgets.map((name) => ({ name, element: new El(`${name} #${++made}`) })),
    ],
  };
}
const panel = (node, name = "ausboss_seed_panel") => node.widgets.find((w) => w.name === name).element;

// The frontend's undo: the old node goes, a new one with the same id is
// configured. The deferred clean-up runs when the test says so.
function manualDefer() {
  const queue = [];
  return { defer: (fn) => queue.push(fn), flush: () => { while (queue.length) queue.shift()(); } };
}

test("after undo in Nodes 2.0 the face shows the live node's panel, not the removed node's", () => {
  const root = page();
  const { slot } = nodes2Face(root, 7);
  const before = makeNode(7);
  slot.append(panel(before));
  const handover = createFaceHandover({ defer: manualDefer().defer });

  handover.remember(before);
  const after = makeNode(7);
  assert.equal(panel(after).isConnected, false, "the frontend never mounts the rebuilt node's panel");

  assert.deepEqual(handover.handOver(after), ["ausboss_seed_panel"]);
  assert.equal(slot.children[0], panel(after));
  assert.equal(panel(after).isConnected, true);
  assert.equal(panel(before).isConnected, false, "the removed node's panel is off the page");
});

test("redo, and a further undo after that, each hand the face on", () => {
  const root = page();
  const { slot } = nodes2Face(root, 3);
  const timer = manualDefer();
  const handover = createFaceHandover({ defer: timer.defer });
  let live = makeNode(3);
  slot.append(panel(live));
  for (const step of ["undo", "redo", "undo again"]) {
    handover.remember(live);
    const next = makeNode(3);
    assert.deepEqual(handover.handOver(next), ["ausboss_seed_panel"], step);
    assert.equal(slot.children.length, 1, step);
    assert.equal(slot.children[0], panel(next), step);
    live = next;
    timer.flush();
  }
  assert.equal(handover.size, 0, "nothing is held once the rebuilds are over");
});

test("every panel of a node moves to its own slot", () => {
  const root = page();
  const face = root.append(new El("face 16", { "data-node-id": "16" }));
  const names = ["ausboss_save_image_card", "ausboss_input_preview"];
  const before = makeNode(16, { widgets: names });
  const slots = names.map((name) => face.append(new El(`slot ${name}`)).append(panel(before, name)).parent);
  const handover = createFaceHandover({ defer: manualDefer().defer });
  handover.remember(before);
  const after = makeNode(16, { widgets: names });
  assert.deepEqual(handover.handOver(after), names);
  names.forEach((name, i) => assert.equal(slots[i].children[0], panel(after, name)));
});

test("classic: panels sit in the overlay, not on a node face, and nothing moves", () => {
  const root = page();
  const overlay = root.append(new El("dom widgets overlay"));
  const before = makeNode(7);
  overlay.append(new El("wrapper")).append(panel(before));
  const handover = createFaceHandover({ defer: manualDefer().defer });
  handover.remember(before);
  const after = makeNode(7);
  assert.deepEqual(handover.handOver(after), []);
  assert.equal(panel(before).isConnected, true, "left for the overlay to take down");
  assert.equal(panel(after).isConnected, false, "left for the overlay to mount");
});

test("a frontend that mounts the rebuilt panel itself: nothing moves", () => {
  const root = page();
  const { slot } = nodes2Face(root, 7);
  const before = makeNode(7);
  slot.append(panel(before));
  const handover = createFaceHandover({ defer: manualDefer().defer });
  handover.remember(before);
  const after = makeNode(7);
  const fresh = nodes2Face(root, 7);
  fresh.slot.append(panel(after));
  assert.deepEqual(handover.handOver(after), []);
  assert.equal(fresh.slot.children[0], panel(after));
});

test("a face already taken down, another node's face, or another widget: nothing moves", () => {
  const root = page();
  const handover = createFaceHandover({ defer: manualDefer().defer });

  // Deleted node, then undo: its face was unmounted with it.
  const gone = makeNode(9);
  nodes2Face(root, 9).slot.append(panel(gone));
  handover.remember(gone);
  panel(gone).parent.parent.remove();
  assert.deepEqual(handover.handOver(makeNode(9)), []);

  // The remembered panel sits on node 8's face; node 7 must not take it.
  const eight = makeNode(8);
  nodes2Face(root, 8).slot.append(panel(eight));
  handover.remember({ ...eight, id: 7 });
  assert.deepEqual(handover.handOver(makeNode(7)), []);
  assert.equal(panel(eight).isConnected, true);

  // Same id, different widget.
  const card = makeNode(4, { widgets: ["ausboss_widget_card"] });
  nodes2Face(root, 4).slot.append(panel(card, "ausboss_widget_card"));
  handover.remember(card);
  assert.deepEqual(handover.handOver(makeNode(4, { widgets: ["ausboss_lora_rows"] })), []);
});

test("a pasted or new node has no removed twin: nothing moves", () => {
  const handover = createFaceHandover({ defer: manualDefer().defer });
  assert.deepEqual(handover.handOver(makeNode(41)), []);
  assert.deepEqual(handover.handOver({ id: 42 }), []);
  assert.deepEqual(handover.handOver(null), []);
  handover.remember(null);
  handover.remember({ id: 5, widgets: [{ name: "plain" }] });
  assert.equal(handover.size, 0);
});

test("a subgraph node with the same id keeps its own face", () => {
  const root = page();
  // Inside the subgraph, its node 5 is on screen; the root's node 5 is not.
  const rootFive = makeNode(5, { graph: "root" });
  const innerFive = makeNode(5, { graph: "sub-1" });
  const { slot } = nodes2Face(root, 5);
  slot.append(panel(innerFive));
  const handover = createFaceHandover({ defer: manualDefer().defer });
  handover.remember(rootFive);
  handover.remember(innerFive);
  const rootAfter = makeNode(5, { graph: "root" });
  const innerAfter = makeNode(5, { graph: "sub-1" });
  assert.deepEqual(handover.handOver(rootAfter), [], "the root node never takes the subgraph node's face");
  assert.deepEqual(handover.handOver(innerAfter), ["ausboss_seed_panel"]);
  assert.equal(slot.children[0], panel(innerAfter));
});

test("remembered panels are let go once the rebuild is over", () => {
  const root = page();
  const timer = manualDefer();
  const handover = createFaceHandover({ defer: timer.defer });
  const node = makeNode(12);
  nodes2Face(root, 12).slot.append(panel(node));
  handover.remember(node);
  assert.equal(handover.size, 1);
  // Deleted for good: the frontend takes the face down, nothing is rebuilt.
  panel(node).parent.parent.remove();
  timer.flush();
  assert.equal(handover.size, 0);
});

test("faceIdOf reads the Nodes 2.0 face an element sits on", () => {
  const root = page();
  const { slot } = nodes2Face(root, 23);
  const inner = slot.append(new El("panel")).append(new El("button"));
  assert.equal(faceIdOf(inner), "23");
  assert.equal(faceIdOf(root.append(new El("loose"))), null);
  assert.equal(faceIdOf(null), null);
  assert.equal(faceIdOf({}), null);
});
