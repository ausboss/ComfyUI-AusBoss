import assert from "node:assert/strict";
import test from "node:test";

import { executionIdOf, isSwitchedOff, nodeByExecutionId } from "../js/shared/graph_ids.mjs";

// A graph whose ids repeat inside a subgraph, which is the normal case: node
// ids are small integers numbered independently per graph.
function makeGraph() {
  const inner3 = { id: 3, title: "inner chooser" };
  const inner1 = { id: 1, title: "inner loader" };
  const subgraph = {
    getNodeById: (id) => [inner1, inner3].find((node) => node.id === id) ?? null,
  };
  const root3 = { id: 3, title: "root chooser" };
  const holder12 = { id: 12, title: "subgraph node", subgraph };
  const deeper = {
    id: 5,
    title: "nested holder",
    subgraph: {
      getNodeById: (id) => (id === 3 ? { id: 3, title: "deep chooser" } : null),
    },
  };
  const rootGraph = {
    getNodeById: (id) =>
      [root3, holder12, deeper].find((node) => node.id === id) ?? null,
  };
  return { rootGraph, root3, inner3 };
}

test("a top-level id resolves on the root graph", () => {
  const { rootGraph, root3 } = makeGraph();
  assert.equal(nodeByExecutionId(rootGraph, "3"), root3);
  assert.equal(nodeByExecutionId(rootGraph, 3), root3);
});

test("a subgraph id resolves inside its own graph, not the root", () => {
  // The bug this replaces: stripping the prefix and looking "3" up on the
  // root returned the unrelated top-level node with the same number, so one
  // node's panel rendered on another's face and its writeback landed there.
  const { rootGraph, root3, inner3 } = makeGraph();
  const found = nodeByExecutionId(rootGraph, "12:3");
  assert.equal(found, inner3);
  assert.notEqual(found, root3);
  assert.equal(found.title, "inner chooser");
});

test("nesting walks the whole chain", () => {
  const { rootGraph } = makeGraph();
  assert.equal(nodeByExecutionId(rootGraph, "5:3").title, "deep chooser");
});

test("an id that does not resolve returns null rather than a guess", () => {
  const { rootGraph } = makeGraph();
  assert.equal(nodeByExecutionId(rootGraph, "99:3"), null); // no such holder
  assert.equal(nodeByExecutionId(rootGraph, "12:99"), null); // no such inner id
  assert.equal(nodeByExecutionId(rootGraph, "3:3"), null); // holder has no subgraph
  assert.equal(nodeByExecutionId(rootGraph, ""), null);
  assert.equal(nodeByExecutionId(rootGraph, null), null);
  assert.equal(nodeByExecutionId(null, "3"), null);
  assert.equal(nodeByExecutionId({}, "3"), null);
});

test("string-keyed graphs still resolve", () => {
  // Some frontends key nodes by string; both spellings are tried.
  const rootGraph = { getNodeById: (id) => (id === "7" ? { id: "7" } : null) };
  assert.equal(nodeByExecutionId(rootGraph, "7").id, "7");
});

test("a node's execution id is the chain of boxes that holds it", () => {
  const deepNode = { id: 3 };
  const innerNode = { id: 3 };
  const innerLoader = { id: 1 };
  const nested = { id: 5, subgraph: { nodes: [deepNode] } };
  const holder = { id: 12, subgraph: { nodes: [innerLoader, innerNode, nested] } };
  const rootNode = { id: 3 };
  const root = { nodes: [rootNode, holder] };
  assert.equal(executionIdOf(root, rootNode), "3");
  assert.equal(executionIdOf(root, innerNode), "12:3");
  assert.equal(executionIdOf(root, deepNode), "12:5:3");
  // Same number, different node: the walk goes by the node itself.
  assert.notEqual(executionIdOf(root, innerNode), executionIdOf(root, rootNode));
  // And back again.
  const byId = (nodes) => ({ nodes, getNodeById: (id) => nodes.find((node) => node.id === id) ?? null });
  const live = byId([rootNode, { id: 12, subgraph: byId([innerLoader, innerNode]) }]);
  assert.equal(nodeByExecutionId(live, executionIdOf(live, innerNode)), innerNode);
});

test("a node that is on no graph has no execution id", () => {
  const root = { nodes: [{ id: 1 }], _nodes: [] };
  assert.equal(executionIdOf(root, { id: 9 }), null);
  assert.equal(executionIdOf(null, { id: 1 }), null);
  assert.equal(executionIdOf(root, null), null);
  // An older frontend keeps its nodes in _nodes.
  const old = { id: 4 };
  assert.equal(executionIdOf({ _nodes: [old] }, old), "4");
});

// Switched off: bypassed (4) or muted (2), the node itself or a box on the
// way to it. A run of such a node alone has nothing to run.
function switchGraph() {
  const inner = { id: 7, mode: 0 };
  const box = { id: 20, mode: 0, subgraph: { nodes: [inner] } };
  const top = { id: 3, mode: 0 };
  const rootGraph = { nodes: [top, box] };
  return { rootGraph, inner, box, top };
}

test("a node that is on is not switched off", () => {
  const { rootGraph, top, inner } = switchGraph();
  assert.equal(isSwitchedOff(rootGraph, top), false);
  assert.equal(isSwitchedOff(rootGraph, inner), false);
});

test("a bypassed or muted node is switched off", () => {
  const { rootGraph, top } = switchGraph();
  top.mode = 4;
  assert.equal(isSwitchedOff(rootGraph, top), true);
  top.mode = 2;
  assert.equal(isSwitchedOff(rootGraph, top), true);
});

test("a node inside a bypassed or muted box is switched off", () => {
  const { rootGraph, box, inner } = switchGraph();
  box.mode = 4;
  assert.equal(isSwitchedOff(rootGraph, inner), true);
  box.mode = 2;
  assert.equal(isSwitchedOff(rootGraph, inner), true);
  box.mode = 0;
  assert.equal(isSwitchedOff(rootGraph, inner), false);
});

test("a node on no graph counts only its own mode", () => {
  assert.equal(isSwitchedOff({ nodes: [] }, { id: 1, mode: 0 }), false);
  assert.equal(isSwitchedOff(null, { id: 1, mode: 4 }), true);
  assert.equal(isSwitchedOff(null, null), false);
});
