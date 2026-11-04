import assert from "node:assert/strict";
import test from "node:test";

import {
  linkSlots,
  linkSource,
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

test("linkSource follows compatible bypass chains and rejects mute, missing links and cycles", () => {
  const loader = { id: 1, mode: 0 };
  const processor = { id: 2, mode: 4, inputs: [{ type: "MASK", link: null }, { type: "IMAGE", link: 2 }], outputs: [{ type: "IMAGE" }] };
  const pass = { id: 3, mode: 4, inputs: [{ type: "IMAGE", link: 3 }], outputs: [{ type: "IMAGE" }] };
  const nodes = new Map([[1, loader], [2, processor], [3, pass]]);
  const graph = { links: new Map([[1, { origin_id: 3, origin_slot: 0 }], [2, { origin_id: 1, origin_slot: 0 }], [3, { origin_id: 2, origin_slot: 0 }]]), getNodeById: (id) => nodes.get(id) };
  const target = { graph, inputs: [{ name: "picture_1", type: "IMAGE", link: 1 }] };
  assert.equal(linkSource(target, "picture_1"), loader);
  loader.mode = 2;
  assert.equal(linkSource(target, "picture_1"), null);
  loader.mode = 0;
  processor.inputs[1].link = null;
  assert.equal(linkSource(target, "picture_1"), null);
  processor.inputs[1].link = 1;
  assert.equal(linkSource(target, "picture_1"), null);
  processor.inputs[1] = { type: "AUDIO", link: 2 };
  assert.equal(linkSource(target, "picture_1"), null);
  target.inputs[0].link = 99;
  assert.equal(linkSource(target, "picture_1"), null);
});

test("linkSource prefers the matching input at the output's index", () => {
  const first = { id: 1 }, second = { id: 2 };
  const bypass = { id: 3, mode: 4, inputs: [{ type: "IMAGE", link: 2 }, { type: "IMAGE", link: 3 }], outputs: [{ type: "IMAGE" }, { type: "IMAGE" }] };
  const graph = { _links: new Map([[1, { origin_id: 3, origin_slot: 1 }], [2, { origin_id: 1 }], [3, { origin_id: 2 }]]), getNodeById: (id) => [null, first, second, bypass][id] };
  assert.equal(linkSource({ graph, inputs: [{ name: "picture_1", type: "IMAGE", link: 1 }] }, "picture_1"), second);
  bypass.inputs[1].type = "MASK";
  assert.equal(linkSource({ graph, inputs: [{ name: "picture_1", type: "IMAGE", link: 1 }] }, "picture_1"), first);
  for (const type of ["*", ""]) {
    assert.equal(linkSource({ graph, inputs: [{ name: "value", type, link: 1 }] }, "value"), second);
  }
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
