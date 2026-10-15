import assert from "node:assert/strict";
import test from "node:test";

import {
  SUBGRAPH_INPUT_ID, boxRowInputs, boxRowsWidget, boxesOf, hostBox, rowsInputName, workflowNodes,
} from "../js/shared/lora_box.mjs";

// A small stand-in for the frontend's graph: a subgraph with inputs whose
// links start at its input node (-10) and end at inner nodes.
function makeSubgraph() {
  const links = new Map();
  const nodes = [];
  const subgraph = {
    inputs: [],
    nodes,
    isRootGraph: false,
    getLink: (id) => links.get(id) ?? null,
    getNodeById: (id) => nodes.find((node) => String(node.id) === String(id)) ?? null,
  };
  let nextLink = 1;
  subgraph.add = (node) => {
    node.graph = subgraph;
    node.getInputLink = (index) => {
      const link = [...links.values()].find((item) => String(item.target_id) === String(node.id) && item.target_slot === index);
      return link ?? null;
    };
    nodes.push(node);
    return node;
  };
  subgraph.addInput = (name) => {
    const input = { name, linkIds: [] };
    subgraph.inputs.push(input);
    return input;
  };
  subgraph.link = (input, node, slotName) => {
    const id = nextLink++;
    links.set(id, { id, origin_id: SUBGRAPH_INPUT_ID, origin_slot: subgraph.inputs.indexOf(input), target_id: node.id, target_slot: node.inputs.findIndex((slot) => slot.name === slotName) });
    input.linkIds.push(id);
  };
  return subgraph;
}

const loader = (id) => ({ id, type: "AUSBOSS_NODES_LoraLoader", inputs: [{ name: "model" }, { name: "clip" }, { name: "loras" }, { name: "trigger_separator" }] });
const isLoader = (node) => node.type === "AUSBOSS_NODES_LoraLoader";
const box = (id, subgraph, widgets = []) => ({ id, subgraph, widgets, isSubgraphNode: () => true });

test("a box lists the inputs that carry a loader's rows, and only those", () => {
  const subgraph = makeSubgraph();
  const first = subgraph.add(loader("52"));
  const second = subgraph.add(loader("53"));
  const other = subgraph.add({ id: "60", type: "KSampler", inputs: [{ name: "loras" }] });
  subgraph.link(subgraph.addInput("model"), first, "model");
  subgraph.link(subgraph.addInput("loras"), first, "loras");
  subgraph.link(subgraph.addInput("loras_1"), second, "loras");
  subgraph.link(subgraph.addInput("separator"), first, "trigger_separator");
  subgraph.link(subgraph.addInput("text"), other, "loras");
  subgraph.addInput("unlinked");
  const found = boxRowInputs(box("54", subgraph), isLoader);
  assert.deepEqual(found.map((item) => [item.name, item.loader.id]), [["loras", "52"], ["loras_1", "53"]]);
  assert.deepEqual(boxRowInputs({ widgets: [] }, isLoader), []);
});

test("the box's copy of the rows is its text widget of that input's name", () => {
  const copy = { name: "loras", value: "[]" };
  const holder = box("54", makeSubgraph(), [{ name: "ausboss_lora_rows:loras", value: undefined }, copy, { name: "loras_1", value: 3 }]);
  assert.equal(boxRowsWidget(holder, "loras"), copy);
  assert.equal(boxRowsWidget(holder, "loras_1"), null);
  assert.equal(boxRowsWidget(holder, "missing"), null);
});

test("a loader knows when its rows come in from the box, and through which input", () => {
  const subgraph = makeSubgraph();
  const fed = subgraph.add(loader("52"));
  const own = subgraph.add(loader("53"));
  subgraph.addInput("model");
  subgraph.link(subgraph.addInput("loras"), fed, "loras");
  subgraph.link(subgraph.inputs[0], own, "model");
  assert.equal(rowsInputName(fed), "loras");
  assert.equal(rowsInputName(own), null);
  // At the top of the workflow there is no box to come from.
  assert.equal(rowsInputName({ ...loader("1"), graph: { getLink: () => null }, getInputLink: () => ({ origin_id: "4", origin_slot: 0 }) }), null);
  assert.equal(rowsInputName({ id: "2", inputs: [] }), null);
});

test("every node of a workflow, at the top and inside each subgraph", () => {
  const inner = { nodes: [{ id: "52" }] };
  const root = { nodes: [{ id: "1" }, { id: "54" }], subgraphs: new Map([["a", inner]]) };
  assert.deepEqual(workflowNodes(root).map((node) => node.id), ["1", "54", "52"]);
  assert.deepEqual(workflowNodes({ nodes: [{ id: "1" }] }).map((node) => node.id), ["1"]);
});

test("an inner loader follows the box the user came in through, or the only box", () => {
  const subgraph = makeSubgraph();
  const other = makeSubgraph();
  const a = box("54", subgraph);
  const b = box("55", subgraph);
  const elsewhere = box("56", other);
  const boxes = boxesOf(subgraph, [a, { id: "3", isSubgraphNode: () => false }, b, elsewhere]);
  assert.deepEqual(boxes, [a, b]);
  assert.equal(hostBox(subgraph, boxes, b), b);
  // Several boxes and no way in known: none, each box keeps its own rows.
  assert.equal(hostBox(subgraph, boxes, null), null);
  assert.equal(hostBox(subgraph, boxes, elsewhere), null);
  assert.equal(hostBox(subgraph, [a], null), a);
  // A box that was removed is not followed.
  assert.equal(hostBox(subgraph, [a], b), a);
});
