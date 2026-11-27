// A linked setting on the Crop + Rotate + Pad nodes runs with the wired value
// (js/shared/transform_wired.mjs). A Float of 24 wired into Megapixels
// resized to 24 MP while the card summary, the MP field and the size readout
// all said 16.00 MP, the widget's own value, and read as a 16 MP cap.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { wiredFieldText, wiredNumber, wiredResize, wiredSummaryParts, wiredSwitch } from "../js/shared/transform_wired.mjs";

const WIDGETS = { feather: 24, canvas_multiple: 1, resize_to_megapixels: true, megapixels: 16, resolution_steps: 1 };

// A crop node whose inputs named in `wires` are linked to the given source
// nodes, as plain objects.
function cropNode(values = {}, wires = {}) {
  const nodes = new Map();
  const links = {};
  const graph = { links, getNodeById: (id) => nodes.get(id) ?? null };
  const merged = { ...WIDGETS, ...values };
  const node = {
    id: 1, graph,
    widgets: Object.entries(merged).map(([name, value]) => ({ name, value })),
    inputs: Object.keys(merged).map((name) => ({ name, widget: { name }, link: null })),
  };
  nodes.set(1, node);
  let next = 10;
  for (const [name, source] of Object.entries(wires)) {
    const id = next++;
    source.id = id;
    source.mode ??= 0;
    source.inputs ??= [];
    nodes.set(id, source);
    links[id] = { id, origin_id: id, origin_slot: 0, target_id: 1 };
    node.inputs.find((input) => input.name === name).link = id;
  }
  return node;
}

const float = (value) => ({ type: "PrimitiveFloat", widgets: [{ name: "value", value }] });
const int = (value) => ({ type: "PrimitiveInt", widgets: [{ name: "value", value }] });
const math = () => ({ type: "AUSBOSS_NODES_MathExpression", widgets: [{ name: "expression", value: "a*2" }] });

test("unlinked settings read the widgets, as before", () => {
  const node = cropNode();
  assert.deepEqual(wiredNumber(node, "megapixels", 1), { value: 16, linked: false, known: true });
  assert.deepEqual(wiredSummaryParts(node), ["feather 24 px", "16.00 MP"]);
  assert.deepEqual(wiredResize(node), { megapixels: 16, steps: 1 });
  assert.equal(wiredFieldText(wiredNumber(node, "megapixels", 1), (v) => `${v} MP`), null);
});

test("a typed number wired into Megapixels shows that number, past the 16 MP range", () => {
  const node = cropNode({}, { megapixels: float(24) });
  assert.deepEqual(wiredNumber(node, "megapixels", 1), { value: 24, linked: true, known: true });
  assert.deepEqual(wiredSummaryParts(node), ["feather 24 px", "24.00 MP"]);
  assert.deepEqual(wiredResize(node), { megapixels: 24, steps: 1 });
  assert.equal(wiredFieldText(wiredNumber(node, "megapixels", 1), (v) => `${v.toFixed(2)} MP`), "24.00 MP");
});

test("a calculated value says it comes from a link instead of showing the widget's", () => {
  const node = cropNode({}, { megapixels: math() });
  assert.deepEqual(wiredNumber(node, "megapixels", 1), { value: null, linked: true, known: false });
  assert.deepEqual(wiredSummaryParts(node), ["feather 24 px", "MP from a link"]);
  assert.deepEqual(wiredResize(node), { unknown: true });
  assert.equal(wiredFieldText(wiredNumber(node, "megapixels", 1), String), "from a link");
});

test("the other summary values follow their links too", () => {
  const node = cropNode({ resolution_steps: 1 }, { feather: int(8), canvas_multiple: math(), resolution_steps: int(32) });
  assert.deepEqual(wiredSummaryParts(node), ["feather 8 px", "align from a link", "16.00 MP"]);
  const steps = cropNode({}, { resolution_steps: int(32) });
  assert.deepEqual(wiredSummaryParts(steps), ["feather 24 px", "16.00 MP", "÷32"]);
  assert.deepEqual(wiredSummaryParts(cropNode({}, { feather: math() })), ["feather from a link", "16.00 MP"]);
  assert.deepEqual(wiredSummaryParts(cropNode({}, { resolution_steps: math() })), ["feather 24 px", "16.00 MP", "step from a link"]);
});

test("a wired resize switch decides whether the resize shows", () => {
  const off = cropNode({}, { resize_to_megapixels: { type: "PrimitiveBoolean", widgets: [{ name: "value", value: false }] } });
  assert.deepEqual(wiredSwitch(off, "resize_to_megapixels", false), { value: false, linked: true, known: true });
  assert.deepEqual(wiredSummaryParts(off), ["feather 24 px"]);
  assert.equal(wiredResize(off), null);
  const typedOn = cropNode({ resize_to_megapixels: false }, { resize_to_megapixels: { type: "PrimitiveBoolean", widgets: [{ name: "value", value: true }] } });
  assert.deepEqual(wiredResize(typedOn), { megapixels: 16, steps: 1 });
  const unknown = cropNode({ resize_to_megapixels: false }, { resize_to_megapixels: math() });
  assert.deepEqual(wiredSummaryParts(unknown), ["feather 24 px", "resize from a link", "16.00 MP"]);
  assert.deepEqual(wiredResize(unknown), { unknown: true });
});

test("a muted source is unknown, not the widget's value", () => {
  const source = float(24);
  source.mode = 2;
  const node = cropNode({}, { megapixels: source });
  assert.deepEqual(wiredSummaryParts(node), ["feather 24 px", "MP from a link"]);
});

test("a node without the resize inputs (video) only gets feather and Align", () => {
  const node = cropNode();
  node.widgets = node.widgets.filter((item) => !["resize_to_megapixels", "megapixels", "resolution_steps"].includes(item.name));
  assert.deepEqual(wiredSummaryParts(node), ["feather 24 px"]);
  assert.equal(wiredResize(node), null);
});

test("the transform face reads the summary, the fields and the size readout through the wire", () => {
  const source = fs.readFileSync(new URL("../js/shared/transform_editor.mjs", import.meta.url), "utf8");
  const summary = source.slice(source.indexOf("export function transformGroupSummary"), source.indexOf("function buildTransformGroup"));
  assert.match(summary, /wiredSummaryParts\(node\)/);
  assert.doesNotMatch(summary, /value\(node, "megapixels"/);
  const request = source.slice(source.indexOf("function resizeRequest"), source.indexOf("function resizeFromLink"));
  assert.match(request, /wiredResize\(node\)/);
  for (const name of ["feather", "canvas_multiple", "megapixels", "resolution_steps"]) {
    assert.match(source, new RegExp(`wiredStandIn\\(node, "${name}"`), `${name} has no stand-in on the face`);
  }
});
