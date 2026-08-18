import assert from "node:assert/strict";
import test from "node:test";

import {
  CORE_IMAGE_PREVIEW_WIDGET,
  CORE_VIDEO_PREVIEW_WIDGET,
  hideCanvasWidget,
  suppressCoreImagePreview,
  suppressCoreVideoPreview,
} from "../js/shared/core_preview.mjs";

function fakeNode() {
  const node = {
    widgets: [],
    addCustomWidget(widget) {
      this.widgets.push(widget);
      return widget;
    },
    addDOMWidget(name, type, element) {
      const widget = { name, type, element };
      this.widgets.push(widget);
      return widget;
    },
  };
  return node;
}

const isHidden = (widget) =>
  widget.hidden === true && widget.computeSize()[1] === -4 &&
  widget.computeLayoutSize().minHeight === 0;

test("a widget the frontend adds later is hidden on arrival", () => {
  const node = fakeNode();
  suppressCoreImagePreview(node);
  const widget = node.addCustomWidget({ name: CORE_IMAGE_PREVIEW_WIDGET });
  assert.ok(isHidden(widget));
});

test("a widget already on the node when we arrive is swept up", () => {
  const node = fakeNode();
  const widget = { name: CORE_IMAGE_PREVIEW_WIDGET };
  node.widgets.push(widget);
  suppressCoreImagePreview(node);
  assert.ok(isHidden(widget));
});

test("only the core preview widget is touched", () => {
  const node = fakeNode();
  suppressCoreImagePreview(node);
  const mine = node.addCustomWidget({ name: "ausboss_input_preview" });
  assert.equal(mine.hidden, undefined);
  assert.equal(typeof mine.computeSize, "undefined");
});

test("the image and video suppressors do not stand in for each other", () => {
  // They wrap different methods and are flagged separately, so a node that
  // draws both kinds can ask for both.
  const node = fakeNode();
  suppressCoreImagePreview(node);
  const video = node.addDOMWidget(CORE_VIDEO_PREVIEW_WIDGET, "video", {
    style: {},
  });
  assert.equal(video.hidden, undefined, "image suppression must not hide the video widget");

  suppressCoreVideoPreview(node);
  const second = node.addDOMWidget(CORE_VIDEO_PREVIEW_WIDGET, "video", { style: {} });
  assert.ok(isHidden(second));
  // ...and the one added before suppression is swept on the way in.
  assert.ok(isHidden(video));
});

test("suppressing twice keeps one wrapper, not a growing chain", () => {
  const node = fakeNode();
  const original = node.addCustomWidget;
  suppressCoreImagePreview(node);
  const wrapped = node.addCustomWidget;
  suppressCoreImagePreview(node);
  assert.notEqual(wrapped, original);
  assert.equal(node.addCustomWidget, wrapped);
});

test("hiding is idempotent and never re-stashes a live method", () => {
  const widget = { name: CORE_IMAGE_PREVIEW_WIDGET };
  hideCanvasWidget(widget);
  const hiddenDraw = widget.draw;
  hideCanvasWidget(widget);
  assert.equal(widget.draw, hiddenDraw);
});

test("the DOM widget's element is hidden along with it", () => {
  const node = fakeNode();
  suppressCoreVideoPreview(node);
  const element = { style: {} };
  node.addDOMWidget(CORE_VIDEO_PREVIEW_WIDGET, "video", element);
  assert.equal(element.style.display, "none");
});
