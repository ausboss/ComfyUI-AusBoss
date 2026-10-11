// What a number box is wired to decides its limits (js/shared/wired_limits.mjs).
// Plain objects stand in for the graph: nodes with inputs, widgets, outputs
// and links, the way LiteGraph holds them.
import assert from "node:assert/strict";
import test from "node:test";

import { limitsLabel, narrowedRange, valueToTake, widgetRange, wiredLimits } from "../js/shared/wired_limits.mjs";

function graphOf(nodes, links) {
  const graph = {
    getNodeById: (id) => nodes.find((node) => node.id === id) ?? null,
    getLink: (id) => links.find((link) => link.id === id) ?? null,
  };
  for (const node of nodes) node.graph = graph;
  return graph;
}

const sampler = (id, { denoise = null, steps = null } = {}) => ({
  id,
  type: "KSampler",
  inputs: [
    { name: "model", type: "MODEL", link: null },
    { name: "steps", type: "INT", widget: { name: "steps" }, link: steps },
    { name: "denoise", type: "FLOAT", widget: { name: "denoise" }, link: denoise },
  ],
  widgets: [
    { name: "steps", type: "number", value: 20, options: { min: 1, max: 10000, step: 10, step2: 1 } },
    { name: "denoise", type: "number", value: 1, options: { min: 0, max: 1, step: 0.1, step2: 0.01 } },
  ],
});
const box = (id, links) => ({ id, type: "Float", outputs: [{ name: "float", links }] });

test("a number box wired to a sampler's denoise stops at 1", () => {
  const float = box(1, [10]);
  graphOf([float, sampler(2, { denoise: 10 })], [{ id: 10, origin_id: 1, target_id: 2, target_slot: 2 }]);
  assert.deepEqual(wiredLimits(float), { min: 0, max: 1, step: 0.01, names: ["denoise"], values: [1] });
});

test("nothing wired, or wired to a plain socket, gives no limits", () => {
  const loose = box(1, []);
  graphOf([loose], []);
  assert.equal(wiredLimits(loose), null);
  const float = box(1, [10]);
  const math = { id: 2, type: "Math", inputs: [{ name: "a", type: "FLOAT,INT", link: 10 }], widgets: [] };
  graphOf([float, math], [{ id: 10, origin_id: 1, target_id: 2, target_slot: 0 }]);
  assert.equal(wiredLimits(float), null);
});

test("a Reroute hands the wire on", () => {
  const float = box(1, [10]);
  const reroute = { id: 3, type: "Reroute", inputs: [{ link: 10 }], outputs: [{ links: [11] }] };
  graphOf([float, reroute, sampler(2, { denoise: 11 })], [
    { id: 10, origin_id: 1, target_id: 3, target_slot: 0 },
    { id: 11, origin_id: 3, target_id: 2, target_slot: 2 },
  ]);
  assert.deepEqual(wiredLimits(float)?.max, 1);
});

test("the wire is followed into a box, through the Reroute inside it", () => {
  // The Krea 2 Inpaint Masked workflow: Float -> the Paint box's "denoise" input -> a Reroute -> KSampler.denoise.
  const inside = [{ id: 46, type: "Reroute", inputs: [{ link: 80 }], outputs: [{ links: [81] }] }, sampler(11, { denoise: 81 })];
  const subgraph = {
    getNodeById: (id) => inside.find((node) => node.id === id) ?? null,
    getLink: (id) => [{ id: 80, origin_id: -10, target_id: 46, target_slot: 0 }, { id: 81, origin_id: 46, target_id: 11, target_slot: 2 }].find((link) => link.id === id) ?? null,
    inputNode: { slots: [{ name: "seed", linkIds: [] }, { name: "denoise", linkIds: [80] }] },
  };
  const float = box(45, [79]);
  const paint = { id: 35, type: "46b7ce1c", subgraph, inputs: [{ name: "seed", type: "INT", link: null }, { name: "denoise", type: "FLOAT", link: 79 }], widgets: [] };
  graphOf([float, paint], [{ id: 79, origin_id: 45, target_id: 35, target_slot: 1 }]);
  assert.deepEqual(wiredLimits(float), { min: 0, max: 1, step: 0.01, names: ["denoise"], values: [1] });
});

test("wired to two inputs, the range is what both allow", () => {
  const float = box(1, [10, 11]);
  const cfg = {
    id: 3, type: "Other",
    inputs: [{ name: "strength", type: "FLOAT", widget: { name: "strength" }, link: 11 }],
    widgets: [{ name: "strength", type: "number", value: 0.5, options: { min: 0.2, max: 4, step: 1, step2: 0.1 } }],
  };
  graphOf([float, sampler(2, { denoise: 10 }), cfg], [
    { id: 10, origin_id: 1, target_id: 2, target_slot: 2 },
    { id: 11, origin_id: 1, target_id: 3, target_slot: 0 },
  ]);
  const limits = wiredLimits(float);
  assert.deepEqual([limits.min, limits.max, limits.step], [0.2, 1, null]);
  assert.deepEqual(limits.names, ["denoise", "strength"]);
  assert.deepEqual(limits.values, [1, 0.5]);
});

test("inputs that share no value give no limits", () => {
  const float = box(1, [10, 11]);
  const high = {
    id: 3, type: "Other",
    inputs: [{ name: "scale", type: "FLOAT", widget: { name: "scale" }, link: 11 }],
    widgets: [{ name: "scale", type: "number", value: 4, options: { min: 2, max: 8 } }],
  };
  graphOf([float, sampler(2, { denoise: 10 }), high], [
    { id: 10, origin_id: 1, target_id: 2, target_slot: 2 },
    { id: 11, origin_id: 1, target_id: 3, target_slot: 0 },
  ]);
  assert.equal(wiredLimits(float), null);
});

test("a ring of Reroutes ends", () => {
  const float = box(1, [10]);
  const a = { id: 2, type: "Reroute", outputs: [{ links: [11] }] };
  const b = { id: 3, type: "Reroute", outputs: [{ links: [10] }] };
  graphOf([float, a, b], [{ id: 10, origin_id: 1, target_id: 2, target_slot: 0 }, { id: 11, origin_id: 2, target_id: 3, target_slot: 0 }]);
  assert.equal(wiredLimits(float), null);
});

test("an Integer takes a whole-number range", () => {
  const integer = box(1, [10]);
  graphOf([integer, sampler(2, { steps: 10 })], [{ id: 10, origin_id: 1, target_id: 2, target_slot: 1 }]);
  assert.deepEqual(wiredLimits(integer), { min: 1, max: 10000, step: 1, names: ["steps"], values: [20] });
});

test("a widget's range reads the real step, and a widget with no bounds has none", () => {
  assert.deepEqual(widgetRange({ options: { min: 0, max: 1, step: 0.1 } }), { min: 0, max: 1, step: 0.01 });
  assert.deepEqual(widgetRange({ options: { min: 0 } }), { min: 0, max: Infinity, step: null });
  assert.equal(widgetRange({ options: {} }), null);
  assert.equal(widgetRange(null), null);
});

test("the box's own range is only ever narrowed", () => {
  assert.deepEqual(narrowedRange({ min: -1e15, max: 1e15 }, { min: 0, max: 1 }), { min: 0, max: 1 });
  assert.deepEqual(narrowedRange({ min: 0.5, max: 2 }, { min: 0, max: 1 }), { min: 0.5, max: 1 });
  assert.deepEqual(narrowedRange({ min: -1e15, max: 1e15 }, null), { min: -1e15, max: 1e15 });
  // A wired range that misses the box's own leaves the box as it was.
  assert.deepEqual(narrowedRange({ min: 5, max: 9 }, { min: 0, max: 1 }), { min: 5, max: 9 });
});

test("the short label beside the value", () => {
  assert.equal(limitsLabel({ min: 0, max: 1 }), "0–1");
  assert.equal(limitsLabel({ min: 1, max: 10000 }), "1–10000");
  assert.equal(limitsLabel({ min: 0.2, max: 1 }), "0.2–1");
  assert.equal(limitsLabel({ min: 0, max: Infinity }), "from 0");
  assert.equal(limitsLabel({ min: -Infinity, max: 8 }), "up to 8");
  // A seed's 0 to 2^64 says nothing to a person.
  assert.equal(limitsLabel({ min: 0, max: 18446744073709551615 }), "from 0");
  assert.equal(limitsLabel({ min: -1e15, max: 1e15 }), "");
  assert.equal(limitsLabel(null), "");
});

test("a new box takes the value of the first input it is wired to, and only then", () => {
  const wired = { min: 0, max: 1, step: 0.01, names: ["denoise"], values: [0.6] };
  assert.equal(valueToTake({ fresh: true, value: 0, initial: 0, wires: 1, wired }), 0.6);
  // a box someone has set keeps its value
  assert.equal(valueToTake({ fresh: true, value: 0.4, initial: 0, wires: 1, wired }), null);
  // a box that came with a workflow or a paste keeps its value, 0 included
  assert.equal(valueToTake({ fresh: false, value: 0, initial: 0, wires: 1, wired }), null);
  // a second wire changes nothing
  assert.equal(valueToTake({ fresh: true, value: 0, initial: 0, wires: 2, wired }), null);
  // nothing with a value at the other end
  assert.equal(valueToTake({ fresh: true, value: 0, initial: 0, wires: 1, wired: null }), null);
  assert.equal(valueToTake({ fresh: true, value: 0, initial: 0, wires: 1, wired: { ...wired, values: [] } }), null);
  // the same value: nothing to do
  assert.equal(valueToTake({ fresh: true, value: 0, initial: 0, wires: 1, wired: { ...wired, values: [0] } }), null);
});
