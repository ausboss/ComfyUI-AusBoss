import assert from "node:assert/strict";
import test from "node:test";

import {
  linkSlots,
  lookupLink,
  restoreOutputLinks,
  snapshotLinks,
} from "../js/shared/graph_links.mjs";

// A tiny stand-in for LiteGraph: nodes own slot objects, connectSlots records
// a link and replaces whatever the input held, like the real one.
function makeGraph() {
  const links = new Map();
  let nextId = 1;
  const nodes = new Map();
  const graph = {
    links,
    getNodeById: (id) => nodes.get(id) ?? null,
  };
  const makeNode = (id, inputs, outputs) => {
    const node = {
      id,
      graph,
      inputs: inputs.map((name) => ({ name, link: null })),
      outputs: outputs.map((name) => ({ name, links: [] })),
      connectSlots(output, target, input) {
        const originSlot = this.outputs.indexOf(output);
        const targetSlot = target.inputs.indexOf(input);
        if (originSlot < 0 || targetSlot < 0) return undefined;
        const previous = links.get(input.link);
        if (previous) {
          const holder = graph.getNodeById(previous.origin_id);
          const list = holder.outputs[previous.origin_slot].links;
          list.splice(list.indexOf(previous.id), 1);
          links.delete(previous.id);
        }
        const link = {
          id: nextId++,
          origin_id: this.id,
          origin_slot: originSlot,
          target_id: target.id,
          target_slot: targetSlot,
        };
        links.set(link.id, link);
        output.links.push(link.id);
        input.link = link.id;
        return link;
      },
    };
    nodes.set(id, node);
    return node;
  };
  return { graph, makeNode };
}

test("lookupLink reads Map and plain-object link tables", () => {
  const link = { id: 7 };
  assert.equal(lookupLink({ links: new Map([[7, link]]) }, 7), link);
  assert.equal(lookupLink({ links: { 7: link } }, 7), link);
  assert.equal(lookupLink({ links: new Map() }, null), null);
  assert.equal(lookupLink(null, 7), null);
});

test("linkSlots hands the resolved slot objects to connectSlots", () => {
  const { makeNode } = makeGraph();
  const source = makeNode(1, [], ["IMAGE", "MASK"]);
  const sink = makeNode(2, ["image", "mask"], []);
  const link = linkSlots(source, 1, sink, 1);
  assert.equal(link.origin_slot, 1);
  assert.equal(link.target_slot, 1);
  assert.equal(sink.inputs[1].link, link.id);
});

test("linkSlots refuses what the index-based connect refused", () => {
  const { makeNode } = makeGraph();
  const source = makeNode(1, ["in"], ["out"]);
  const sink = makeNode(2, ["in"], []);
  assert.equal(linkSlots(source, 5, sink, 0), null, "missing output slot");
  assert.equal(linkSlots(source, 0, sink, 3), null, "missing input slot");
  assert.equal(linkSlots(source, 0, source, 0), null, "a node never links to itself");
  assert.equal(linkSlots({ ...source, graph: null }, 0, sink, 0), null, "a node outside a graph");
  assert.equal(linkSlots(source, 0, null, 0), null, "no target");
  const noApi = { ...source, connectSlots: undefined };
  assert.equal(linkSlots(noApi, 0, sink, 0), null, "a frontend without connectSlots");
});

test("linkSlots honours the target's onBeforeConnectInput redirect", () => {
  const { makeNode } = makeGraph();
  const source = makeNode(1, [], ["out"]);
  const sink = makeNode(2, ["a", "b"], []);
  sink.onBeforeConnectInput = () => 1;
  assert.equal(linkSlots(source, 0, sink, 0).target_slot, 1);
  sink.onBeforeConnectInput = () => undefined;
  assert.equal(linkSlots(source, 0, sink, 0), null, "a refusal stops the link");
});

test("linkSlots returns null when connectSlots declines", () => {
  const { makeNode } = makeGraph();
  const source = makeNode(1, [], ["out"]);
  const sink = makeNode(2, ["in"], []);
  source.connectSlots = () => undefined;
  assert.equal(linkSlots(source, 0, sink, 0), null);
});

test("snapshotLinks records links by node id and slot position", () => {
  const { graph, makeNode } = makeGraph();
  const loader = makeNode(1, [], ["IMAGE"]);
  const middle = makeNode(2, ["image"], ["IMAGE", "MASK"]);
  const saver = makeNode(3, ["images"], []);
  const preview = makeNode(4, ["images"], []);
  linkSlots(loader, 0, middle, 0);
  linkSlots(middle, 0, saver, 0);
  linkSlots(middle, 0, preview, 0);
  assert.deepEqual(snapshotLinks(middle, graph), {
    inputs: [{ name: "image", originId: 1, originSlot: 0 }],
    outputs: [
      {
        name: "IMAGE",
        slot: 0,
        targets: [
          { nodeId: 3, slot: 0 },
          { nodeId: 4, slot: 0 },
        ],
      },
    ],
  });
});

test("restoreOutputLinks hands back only the links a replacement took", () => {
  const { graph, makeNode } = makeGraph();
  const original = makeNode(1, [], ["IMAGE"]);
  const saver = makeNode(2, ["images"], []);
  const preview = makeNode(3, ["images"], []);
  linkSlots(original, 0, saver, 0);
  linkSlots(original, 0, preview, 0);
  const { outputs } = snapshotLinks(original, graph);

  // A half-built replacement took the saver's input before failing.
  const fresh = makeNode(9, [], ["IMAGE"]);
  linkSlots(fresh, 0, saver, 0);
  const untouched = preview.inputs[0].link;

  restoreOutputLinks(original, outputs, graph);
  assert.equal(graph.links.get(saver.inputs[0].link).origin_id, 1);
  assert.equal(preview.inputs[0].link, untouched, "a link that was never taken stays as it is");
});

test("lookupLink keeps link id zero and tolerates absent tables and stale ids", () => {
  const link = { id: 0 };
  for (const links of [new Map([[0, link]]), { 0: link }]) {
    assert.equal(lookupLink({ links }, 0), link);
    assert.equal(lookupLink({ links }, 99), null);
    assert.equal(lookupLink({ links }, undefined), null);
  }
  assert.equal(lookupLink({}, 0), null);
});

test("snapshotLinks skips stale links in an older plain-object graph", () => {
  const graph = { links: {
    0: { origin_id: 1, origin_slot: 2, target_id: 5, target_slot: 0 },
    8: { origin_id: 5, origin_slot: 1, target_id: 9, target_slot: 3 },
  } };
  const node = {
    inputs: [{ name: "image", link: 0 }, { name: "empty", link: null }, { name: "stale", link: 99 }],
    outputs: [{ name: "unused" }, { name: "mask", links: [99, 8] }, { name: "stale", links: [77] }],
  };
  const snapshot = snapshotLinks(node, graph);
  assert.deepEqual(snapshot, {
    inputs: [{ name: "image", originId: 1, originSlot: 2 }],
    outputs: [{ name: "mask", slot: 1, targets: [{ nodeId: 9, slot: 3 }] }],
  });
  graph.links[0].origin_slot = 4;
  graph.links[8].target_slot = 0;
  node.inputs[0].name = "changed";
  assert.equal(snapshot.inputs[0].originSlot, 2, "the snapshot owns its slot values");
  assert.equal(snapshot.inputs[0].name, "image");
  assert.equal(snapshot.outputs[0].targets[0].slot, 3);
  assert.deepEqual(snapshotLinks({}, graph), { inputs: [], outputs: [] });
});

test("linkSlots refuses redirects outside the target's inputs before calling connectSlots", () => {
  const { makeNode } = makeGraph();
  const source = makeNode(1, [], ["out"]);
  const sink = makeNode(2, ["in"], []);
  source.connectSlots = () => assert.fail("a refused redirect must not connect");
  for (const redirect of [null, false, "0", -1, 4, NaN]) {
    sink.onBeforeConnectInput = function (slot, requested) {
      assert.equal(this, sink);
      assert.equal(slot, 0);
      assert.equal(requested, 0);
      return redirect;
    };
    assert.equal(linkSlots(source, 0, sink, 0), null, String(redirect));
  }
});

test("restoreOutputLinks skips missing targets and reconnects a disconnected input", () => {
  const { graph, makeNode } = makeGraph();
  const original = makeNode(1, [], ["image", "mask"]);
  const sink = makeNode(2, ["mask"], []);
  restoreOutputLinks(original, [{ slot: 1, targets: [
    { nodeId: 99, slot: 0 }, { nodeId: 2, slot: 0 }, { nodeId: 2, slot: 99 },
  ] }], graph);
  const link = lookupLink(graph, sink.inputs[0].link);
  assert.equal(link.origin_id, original.id);
  assert.equal(link.origin_slot, 1);
  assert.equal(graph.links.size, 1);
});

test("restoreOutputLinks restores the output slot even when the source node is unchanged", () => {
  const { graph, makeNode } = makeGraph();
  const original = makeNode(1, [], ["first image", "second image"]);
  const sink = makeNode(2, ["image"], []);
  linkSlots(original, 1, sink, 0);
  const { outputs } = snapshotLinks(original, graph);
  linkSlots(original, 0, sink, 0);

  restoreOutputLinks(original, outputs, graph);
  const restored = lookupLink(graph, sink.inputs[0].link);
  assert.equal(restored.origin_id, original.id);
  assert.equal(restored.origin_slot, 1);
  assert.deepEqual(original.outputs[0].links, []);
  assert.deepEqual(original.outputs[1].links, [restored.id]);
  assert.equal(graph.links.size, 1);
});
