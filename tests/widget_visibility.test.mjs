import test from "node:test";
import assert from "node:assert/strict";

import {
  hideInputsInDef,
  hideWidget,
  setWidgetVisible,
  showWidget,
} from "../js/shared/widget_visibility.mjs";

function makeWidget() {
  return { name: "crop_position", value: "center", hidden: false };
}

test("hide collapses the widget and reports the change", () => {
  const widget = makeWidget();
  assert.equal(hideWidget(widget), true);
  assert.equal(widget.hidden, true);
  assert.deepEqual(widget.computeSize(), [0, -4]);
  assert.deepEqual(widget.computeLayoutSize(), { minWidth: 0, minHeight: 0 });
  assert.equal(typeof widget.draw, "function");
});

test("hide also sets the Nodes 2.0 flag and show clears it again", () => {
  // The Vue renderer filters widgets on options.hidden and ignores the
  // canvas-side collapse; both switches have to move together.
  const widget = makeWidget();
  hideWidget(widget);
  assert.equal(widget.options.hidden, true);
  showWidget(widget);
  assert.equal("hidden" in widget.options, false);
  const preset = { ...makeWidget(), options: { hidden: false, step: 8 } };
  hideWidget(preset);
  assert.equal(preset.options.hidden, true);
  showWidget(preset);
  assert.deepEqual(preset.options, { hidden: false, step: 8 });
});

test("the Nodes 2.0 flag survives the frontend swapping the options object", () => {
  const widget = { ...makeWidget(), options: { step: 1 } };
  hideWidget(widget);
  widget.options = { step: 1, precision: 0 }; // what the after-generate control does
  assert.equal(widget.options.hidden, true);
  assert.equal(widget.options.precision, 0);
  showWidget(widget);
  widget.options = { step: 2 };
  assert.equal(widget.options.hidden, undefined);
});

test("hide is idempotent", () => {
  const widget = makeWidget();
  assert.equal(hideWidget(widget), true);
  assert.equal(hideWidget(widget), false);
});

test("show restores exactly what hide stashed", () => {
  const widget = makeWidget();
  const originalCompute = () => [120, 20];
  widget.computeSize = originalCompute;
  hideWidget(widget);
  assert.equal(showWidget(widget), true);
  assert.equal(widget.hidden, false);
  assert.equal(widget.computeSize, originalCompute);
});

test("show without a prior hide is a no-op", () => {
  const widget = makeWidget();
  assert.equal(showWidget(widget), false);
  assert.equal(widget.hidden, false);
});

test("setWidgetVisible only reports real transitions", () => {
  const widget = makeWidget();
  assert.equal(setWidgetVisible(widget, false), true);
  assert.equal(setWidgetVisible(widget, false), false);
  assert.equal(setWidgetVisible(widget, true), true);
  assert.equal(setWidgetVisible(widget, true), false);
});

test("hide tolerates missing widgets", () => {
  assert.equal(hideWidget(null), false);
  assert.equal(showWidget(undefined), false);
});

test("a repeated hide re-asserts the renderer flag on a rebuilt options object", () => {
  const widget = makeWidget();
  hideWidget(widget);
  Object.defineProperty(widget, "options", { value: { step: 1 }, writable: true, configurable: true });
  assert.equal(hideWidget(widget), false);
  assert.equal(widget.options.hidden, true);
});

test("hideInputsInDef flags spec entries in either group and tolerates gaps", () => {
  const nodeData = { input: { required: { seed: ["INT", { default: 0 }], clip: ["CLIP"] }, optional: { note: ["STRING"] } } };
  assert.equal(hideInputsInDef(nodeData, ["seed", "note", "missing"]), 2);
  assert.equal(nodeData.input.required.seed[1].hidden, true);
  assert.deepEqual(nodeData.input.optional.note[1], { hidden: true });
  assert.equal(nodeData.input.required.clip.length, 1);
  assert.equal(hideInputsInDef({}, ["x"]), 0);
});

test("hideInputsInDef never throws on frozen definitions", () => {
  const frozenOptions = { input: { required: { seed: ["INT", Object.freeze({ default: 0 })] } } };
  assert.equal(hideInputsInDef(frozenOptions, ["seed"]), 1);
  assert.equal(frozenOptions.input.required.seed[1].hidden, true);
  const frozenAll = Object.freeze({ input: Object.freeze({ required: Object.freeze({ seed: Object.freeze(["INT", Object.freeze({})]) }) }) });
  assert.equal(hideInputsInDef(frozenAll, ["seed"]), 0);
});
