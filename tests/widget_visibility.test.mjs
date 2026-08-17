import test from "node:test";
import assert from "node:assert/strict";

import {
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
