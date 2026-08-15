import assert from "node:assert/strict";
import test from "node:test";

import { nodeByExecutionId } from "../js/shared/graph_ids.mjs";

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
