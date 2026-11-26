// Check layout's decisions (js/shared/layout_check_math.mjs): what counts as
// an overlap, a backwards or hidden wire, a node under one that grows, a node
// outside every group, and a saved zoom too small to read.

import assert from "node:assert/strict";
import test from "node:test";

import {
  GROW_ROOM,
  KINDS,
  MIN_ZOOM,
  boxInside,
  boxesOverlap,
  checkAll,
  checkLayout,
  countByKind,
  jumpViewport,
  nodeBox,
  wirePoints,
} from "../js/shared/layout_check_math.mjs";

const node = (id, x, y, w = 200, h = 100, extra = {}) => ({ id, title: `n${id}`, x, y, w, h, ...extra });
const group = (id, x, y, w, h) => ({ id, title: `g${id}`, x, y, w, h });
const kinds = (issues) => issues.map((issue) => issue.kind);
const wrapAll = (nodes) => [group(1, -1000, -1000, 4000, 4000)];

test("a node's box includes its title bar", () => {
  assert.deepEqual(nodeBox(node(1, 10, 50, 200, 100)), [10, 20, 210, 150]);
  assert.deepEqual(nodeBox(node(1, 10, 50, 200, 100), 40), [10, 10, 210, 150]);
});

test("a node without a title bar has none in its box", () => {
  assert.deepEqual(nodeBox({ ...node(1, 10, 50, 200, 100), titleHeight: 0 }), [10, 50, 210, 150]);
});

test("boxes that only touch do not overlap", () => {
  assert.equal(boxesOverlap([0, 0, 100, 100], [100, 0, 200, 100]), false);
  assert.equal(boxesOverlap([0, 0, 100, 100], [99.5, 0, 200, 100]), false);
  assert.equal(boxesOverlap([0, 0, 100, 100], [90, 90, 200, 200]), true);
  assert.equal(boxInside([10, 10, 20, 20], [0, 0, 100, 100]), true);
  assert.equal(boxInside([10, 10, 120, 20], [0, 0, 100, 100]), false);
});

test("a title bar that sits on the node above counts as an overlap", () => {
  // n2's body starts 20 under n1's bottom, so its 30-unit title bar overlaps.
  const issues = checkLayout({ nodes: [node(1, 0, 0), node(2, 0, 120)], groups: wrapAll() });
  assert.deepEqual(kinds(issues), ["overlap"]);
  assert.deepEqual(issues[0].nodes, [1, 2]);
  assert.deepEqual(issues[0].focus, [0, -30, 200, 220]);
  const clear = checkLayout({ nodes: [node(1, 0, 0), node(2, 0, 140)], groups: wrapAll() });
  assert.deepEqual(kinds(clear), []);
});

test("groups that cross each other overlap; a group inside another does not", () => {
  const crossing = checkLayout({ nodes: [], groups: [group(1, 0, 0, 300, 300), group(2, 200, 200, 300, 300)] });
  assert.deepEqual(kinds(crossing), ["group-overlap"]);
  assert.deepEqual(crossing[0].groups, [1, 2]);
  const nested = checkLayout({ nodes: [], groups: [group(1, 0, 0, 500, 500), group(2, 50, 50, 100, 100)] });
  assert.deepEqual(kinds(nested), []);
});

test("a node close under one that grows is flagged, one far below is not", () => {
  const grower = node(1, 0, 0, 300, 200, { grows: true });
  const near = checkLayout({ nodes: [grower, node(2, 50, 300)], groups: wrapAll() });
  assert.deepEqual(kinds(near), ["under-grower"]);
  assert.deepEqual(near[0].nodes, [2, 1]);
  assert.equal(near[0].gap, 70);
  const far = checkLayout({ nodes: [grower, node(2, 50, 200 + 30 + GROW_ROOM + 1)], groups: wrapAll() });
  assert.deepEqual(kinds(far), []);
  const beside = checkLayout({ nodes: [grower, node(2, 340, 300)], groups: wrapAll() });
  assert.deepEqual(kinds(beside), []);
  const plain = checkLayout({ nodes: [node(1, 0, 0, 300, 200), node(2, 50, 300)], groups: wrapAll() });
  assert.deepEqual(kinds(plain), []);
});

test("a node that already overlaps the grower is an overlap, not both", () => {
  const issues = checkLayout({ nodes: [node(1, 0, 0, 300, 200, { grows: true }), node(2, 0, 190)], groups: wrapAll() });
  assert.deepEqual(kinds(issues), ["overlap"]);
});

test("a wire that ends left of the node it starts from runs backwards", () => {
  const nodes = [node(1, 400, 0), node(2, 0, 300)];
  const issues = checkLayout({ nodes, groups: wrapAll(), links: [{ id: 7, from: 1, to: 2, points: [[600, 20], [0, 320]] }] });
  assert.deepEqual(kinds(issues), ["backward-wire"]);
  assert.equal(issues[0].link, 7);
  const forward = checkLayout({ nodes: [node(1, 0, 0), node(2, 400, 0)], groups: wrapAll(), links: [{ id: 7, from: 1, to: 2, points: [[200, 20], [400, 20]] }] });
  assert.deepEqual(kinds(forward), []);
  // Down to the next node in the same column reads fine, a few units off too.
  const column = checkLayout({ nodes: [node(1, 0, 0), node(2, 0, 300)], groups: wrapAll(), links: [{ id: 7, from: 1, to: 2, points: [[200, 20], [0, 320]] }] });
  assert.deepEqual(kinds(column), []);
  const nearly = checkLayout({ nodes: [node(1, 0, 0), node(2, -8, 300)], groups: wrapAll(), links: [{ id: 7, from: 1, to: 2, points: [[200, 20], [-8, 320]] }] });
  assert.deepEqual(kinds(nearly), []);
});

test("a reroute that sends the wire back left counts too", () => {
  const issues = checkLayout({
    nodes: [node(1, 0, 0), node(2, 600, 0)],
    groups: wrapAll(),
    links: [{ id: 3, from: 1, to: 2, points: [[200, 20], [-100, 400], [600, 20]] }],
  });
  assert.ok(kinds(issues).includes("backward-wire"));
});

test("a wire that passes under another node is hidden behind it", () => {
  const nodes = [node(1, 0, 0), node(2, 800, 0), node(3, 350, -50, 200, 200)];
  const issues = checkLayout({ nodes, groups: wrapAll(), links: [{ id: 9, from: 1, to: 2, points: [[200, 50], [800, 50]] }] });
  assert.deepEqual(kinds(issues), ["hidden-wire"]);
  assert.deepEqual(issues[0].behind, [3]);
  assert.deepEqual(issues[0].nodes, [1, 2, 3]);
  // Moved out of the way, nothing is hidden.
  nodes[2] = node(3, 350, 300, 200, 200);
  assert.deepEqual(kinds(checkLayout({ nodes, groups: wrapAll(), links: [{ id: 9, from: 1, to: 2, points: [[200, 50], [800, 50]] }] })), []);
});

test("the wire is traced as the canvas draws it, curving out to the right first", () => {
  const points = wirePoints([[0, 0], [400, 300]]);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [400, 300]);
  // The curve leaves flat: its first sample is further right than down.
  assert.ok(points[1][0] > points[1][1]);
  // A straight piece stays on the line.
  const straight = wirePoints([[0, 0], [400, 300]], "linear", 4);
  assert.deepEqual(straight[2], [200, 150]);
  assert.deepEqual(wirePoints([[1, 2]]), [[1, 2]]);
  assert.deepEqual(wirePoints(null), []);
});

test("a curve that swings under a neighbour is caught", () => {
  // A steep wire in a narrow gap swings out past its end (workflow-design.md, Wires 4).
  const nodes = [node(1, 0, 0), node(2, 260, 600), node(3, 240, 200, 200, 120)];
  const issues = checkLayout({ nodes, groups: wrapAll(), links: [{ id: 1, from: 1, to: 2, points: [[200, 20], [260, 620]] }] });
  assert.ok(kinds(issues).includes("hidden-wire"));
});

test("every node has to sit inside a group, title bar included", () => {
  const issues = checkLayout({ nodes: [node(1, 20, 40), node(2, 20, 300)], groups: [group(1, 0, 0, 260, 200)] });
  assert.deepEqual(kinds(issues), ["outside-group"]);
  assert.deepEqual(issues[0].nodes, [2]);
  const titleOut = checkLayout({ nodes: [node(1, 20, 20)], groups: [group(1, 0, 0, 260, 200)] });
  assert.deepEqual(kinds(titleOut), ["outside-group"]);
});

test("a Workflow Note, and a Callout in its column, may sit outside the groups", () => {
  const note = node(1, 0, 0, 400, 600, { kind: "note" });
  const callout = node(2, 10, 700, 380, 120, { kind: "callout" });
  const loose = node(3, 10, 900, 380, 120, { kind: "callout" });
  const issues = checkLayout({ nodes: [note, callout, { ...loose, x: 900 }, node(4, 520, 40)], groups: [group(1, 500, 0, 300, 300)] });
  assert.deepEqual(issues.map((issue) => [issue.kind, issue.nodes[0]]), [["outside-group", 3]]);
});

test("a graph with nodes and no groups gets one entry, not one per node", () => {
  const issues = checkLayout({ nodes: [node(1, 0, 0), node(2, 400, 0)] });
  assert.deepEqual(kinds(issues), ["no-groups"]);
  assert.deepEqual(kinds(checkLayout({ nodes: [] })), []);
});

test("a saved zoom below the readable limit is flagged", () => {
  assert.deepEqual(kinds(checkLayout({ nodes: [], scale: 0.45 })), ["zoom"]);
  assert.equal(checkLayout({ nodes: [], scale: 0.456 })[0].scale, 0.46);
  assert.deepEqual(kinds(checkLayout({ nodes: [], scale: MIN_ZOOM })), []);
  assert.deepEqual(kinds(checkLayout({ nodes: [] })), []);
});

test("the top level wants a Workflow Note with a title and instructions", () => {
  const groups = wrapAll();
  assert.deepEqual(kinds(checkLayout({ nodes: [node(1, 0, 0)], groups, topLevel: true, noteFilled: null })), ["no-note"]);
  const empty = checkLayout({ nodes: [node(1, 0, 0, 200, 100, { kind: "note" })], groups, topLevel: true, noteFilled: false });
  assert.deepEqual(kinds(empty), ["no-note"]);
  assert.equal(empty[0].empty, true);
  assert.deepEqual(empty[0].nodes, [1]);
  assert.deepEqual(kinds(checkLayout({ nodes: [node(1, 0, 0)], groups, topLevel: true, noteFilled: true })), []);
  // Inside a box nobody expects a note.
  assert.deepEqual(kinds(checkLayout({ nodes: [node(1, 0, 0)], groups })), []);
});

test("subgraphs are checked with their path, and only the top level wants a note", () => {
  const issues = checkAll([
    { path: [], graph: { nodes: [node(1, 0, 0)], groups: wrapAll(), noteFilled: true } },
    { path: ["Cut out the area"], graph: { nodes: [node(5, 0, 0), node(6, 0, 100)], groups: wrapAll() } },
  ]);
  assert.deepEqual(issues.map((issue) => [issue.kind, issue.path]), [["overlap", ["Cut out the area"]]]);
});

test("the list is in a fixed order and counts each kind", () => {
  const issues = checkLayout({
    nodes: [node(1, 0, 0), node(2, 0, 100), node(3, 2000, 2000)],
    groups: [group(1, -50, -50, 400, 400)],
    scale: 0.3,
  });
  assert.deepEqual(kinds(issues), ["overlap", "outside-group", "zoom"]);
  assert.deepEqual(countByKind([...issues, issues[0]]), [["overlap", 2], ["outside-group", 1], ["zoom", 1]]);
  assert.equal(new Set(KINDS).size, KINDS.length);
});

test("bad input gives no issues instead of throwing", () => {
  assert.deepEqual(checkLayout(null), []);
  assert.deepEqual(checkLayout({ nodes: [{ id: null }, null], groups: null, links: [{ id: 1, from: 1, to: 2, points: [] }] }), []);
  assert.deepEqual(checkAll(null), []);
});

test("two wires between the same nodes behind the same node are one entry", () => {
  const nodes = [node(1, 0, 0), node(2, 800, 0), node(3, 350, -50, 200, 200)];
  const links = [
    { id: 9, from: 1, to: 2, points: [[200, 50], [800, 50]] },
    { id: 10, from: 1, to: 2, points: [[200, 70], [800, 70]] },
  ];
  const issues = checkLayout({ nodes, groups: wrapAll(), links });
  assert.deepEqual(kinds(issues), ["hidden-wire"]);
  assert.equal(issues[0].wires, 2);
  assert.deepEqual(issues[0].links, [9, 10]);
  const back = checkLayout({ nodes: [node(1, 400, 0), node(2, 0, 300)], groups: wrapAll(), links: [
    { id: 1, from: 1, to: 2, points: [[600, 20], [0, 320]] },
    { id: 2, from: 1, to: 2, points: [[600, 40], [0, 340]] },
  ] });
  assert.deepEqual(back.map((issue) => [issue.kind, issue.wires]), [["backward-wire", 2]]);
});


test("a jump frames its target left of the panel, so the panel never covers it", () => {
  const view = { left: 0, top: 40, width: 1600, height: 900 };
  // The panel on the right: the jump uses the canvas left of it, less a margin.
  assert.deepEqual(jumpViewport(view, { left: 1220, top: 60, width: 360, height: 500 }), [0, 0, 1204, 900]);
  // A canvas that does not start at the screen's left edge.
  assert.deepEqual(jumpViewport({ ...view, left: 300 }, { left: 1520 }), [0, 0, 1204, 900]);
  // No panel, or too little room beside it: the whole canvas.
  assert.equal(jumpViewport(view, null), null);
  assert.equal(jumpViewport(view, { left: 200 }), null);
  assert.equal(jumpViewport(null, { left: 1220 }), null);
});
