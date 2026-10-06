// What fillNodeHeight promises the frontend, checked on our own code.
//
// The frontend lays out a node's widgets in one pass. A widget that reports
// its own size (computeSize) gets exactly that height and takes no part in
// sharing out the rest. A widget without it, that instead describes a
// minimum (computeLayoutSize), shares the height left over, and with no
// maximum given it may take all of it. So a panel that should follow the
// node's height must end up with no computeSize and a floor with no ceiling,
// whatever it had before. The live proof is on the canvas (see
// docs/live_testing.md); these tests hold the helper to that contract.

import assert from "node:assert/strict";
import test from "node:test";

import { WIDGET_FRAME, fillNodeHeight } from "../js/shared/panel_layout.mjs";
import { hideWidget, showWidget } from "../js/shared/widget_visibility.mjs";

const pinned = () => ({
  computeSize: () => [400, 200],
  computeLayoutSize: () => ({ minWidth: 320, minHeight: 144 }),
});

test("a panel that sized itself stops doing so", () => {
  const panel = fillNodeHeight(pinned(), { minWidth: 320, minHeight: 144 });
  assert.equal(Object.hasOwn(panel, "computeSize"), false, "deleted, not replaced with another size");
  assert.equal(panel.computeSize, undefined);
});

test("the panel declares a floor and never a ceiling", () => {
  const panel = fillNodeHeight(pinned(), { minWidth: 320, minHeight: 144 });
  const layout = panel.computeLayoutSize({});
  assert.deepEqual(layout, { minWidth: 320, minHeight: 144 });
  assert.equal("maxHeight" in layout, false, "a maximum would stop it filling a taller node");
  assert.equal("maxWidth" in layout, false);
});

test("a floor given as a function is read every time the layout asks", () => {
  const state = { populated: false };
  const panel = fillNodeHeight({}, { minWidth: 300, minHeight: () => (state.populated ? 420 : 132) });
  assert.equal(panel.computeLayoutSize({}).minHeight, 132);
  state.populated = true;
  assert.equal(panel.computeLayoutSize({}).minHeight, 420);
  assert.equal(panel.computeLayoutSize({}).minWidth, 300);
});

test("a floor that is not a usable number becomes zero", () => {
  assert.deepEqual(fillNodeHeight({}, { minWidth: "wide", minHeight: () => undefined }).computeLayoutSize({}), { minWidth: 0, minHeight: 0 });
  assert.equal(fillNodeHeight({}, { minHeight: -50 }).computeLayoutSize({}).minHeight, 0);
  assert.equal(fillNodeHeight({}, { minHeight: Number.NaN }).computeLayoutSize({}).minHeight, 0);
  assert.deepEqual(fillNodeHeight({}).computeLayoutSize({}), { minWidth: 0, minHeight: 0 });
});

test("minNodeSize is handed on, and the widget's other options survive", () => {
  assert.deepEqual(fillNodeHeight({}, { minHeight: 144, minNodeSize: [320, 220] }).options.minNodeSize, [320, 220]);
  assert.equal(fillNodeHeight({}, { minHeight: 144 }).options.minNodeSize, undefined);
  const kept = fillNodeHeight({ options: { minNodeSize: [1, 2], hideOnZoom: true } }, {});
  assert.equal(kept.options.hideOnZoom, true);
  assert.deepEqual(kept.options.minNodeSize, [1, 2], "no new size given: the old one stays");
});

test("no widget, no work", () => {
  assert.equal(fillNodeHeight(null, { minHeight: 10 }), null);
  assert.equal(fillNodeHeight(undefined), undefined);
});

test("hiding a filled panel folds it away, and showing it fills again", () => {
  const panel = fillNodeHeight(pinned(), { minWidth: 320, minHeight: 144 });
  hideWidget(panel);
  assert.equal(typeof panel.computeSize, "function", "hidden: a fixed size of nothing");
  assert.deepEqual(panel.computeLayoutSize({}), { minWidth: 0, minHeight: 0 });
  showWidget(panel);
  assert.equal(panel.computeSize, undefined, "shown: no fixed size comes back with it");
  assert.deepEqual(panel.computeLayoutSize({}), { minWidth: 320, minHeight: 144 });
});

// Nodes 2.0 does not size a node by computeLayoutSize: it lays a node out
// by its content, and a corner drag stops where the content cannot get any
// shorter. So the same floor also has to reach the panel's element as CSS,
// or a panel whose content has no height of its own is dragged flat.

// A panel's element, as the helper sees it: inside a Nodes 2.0 node when
// `host` is an element, in the classic renderer's own layer when it is null.
function panelElement(host) {
  return { style: { minHeight: "" }, closest: (selector) => (selector === "[data-node-id]" ? host : null) };
}

test("inside a Nodes 2.0 node the element carries the floor, less the frame", () => {
  const element = panelElement({});
  const panel = fillNodeHeight({ element }, { minWidth: 200, minHeight: 180 });
  assert.equal(panel.computeLayoutSize({}).minHeight, 180, "what the classic layout is told has not moved");
  assert.equal(element.style.minHeight, `${180 - WIDGET_FRAME}px`);
});

test("the CSS floor follows a floor that changes with state", () => {
  // The preview panel: its stage is gone while the preview is off, so the
  // floor drops to the bar and the node can shrink to it.
  const state = { preview: true };
  const element = panelElement({});
  const panel = fillNodeHeight({ element }, { minHeight: () => (state.preview ? 180 : 36) });
  panel.computeLayoutSize({});
  assert.equal(element.style.minHeight, "160px");
  state.preview = false;
  panel.computeLayoutSize({});
  assert.equal(element.style.minHeight, "16px");
  state.preview = true;
  panel.computeLayoutSize({});
  assert.equal(element.style.minHeight, "160px");
});

test("a floor no taller than the frame leaves the element without one", () => {
  const element = panelElement({});
  const panel = fillNodeHeight({ element }, { minHeight: WIDGET_FRAME });
  panel.computeLayoutSize({});
  assert.equal(element.style.minHeight, "");
});

test("in the classic renderer the element carries no CSS floor", () => {
  const element = panelElement(null);
  const panel = fillNodeHeight({ element }, { minHeight: 180 });
  assert.equal(panel.computeLayoutSize({}).minHeight, 180);
  assert.equal(element.style.minHeight, "");
  // Switched from Nodes 2.0 to classic with the page open: the same element
  // moves out of the node, and the next layout pass takes the floor off.
  element.style.minHeight = "160px";
  panel.computeLayoutSize({});
  assert.equal(element.style.minHeight, "");
});

test("the floor is set when the panel is first laid out, before anything asks", () => {
  const observers = [];
  const saved = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
  };
  try {
    // Built before the node is on screen: no node element around it yet.
    let host = null;
    const element = { style: { minHeight: "" }, closest: () => host };
    fillNodeHeight({ element }, { minHeight: () => 180 });
    assert.equal(element.style.minHeight, "");
    assert.equal(observers.length, 1);
    assert.equal(observers[0].target, element);
    // Nodes 2.0 mounts the element into its node: its first size arrives.
    host = {};
    observers[0].callback();
    assert.equal(element.style.minHeight, "160px");
  } finally {
    globalThis.ResizeObserver = saved;
  }
});

test("a hidden panel asks for nothing and gets its floor back when shown", () => {
  const element = panelElement({});
  const panel = fillNodeHeight({ element }, { minHeight: 180 });
  panel.computeLayoutSize({});
  hideWidget(panel);
  assert.deepEqual(panel.computeLayoutSize({}), { minWidth: 0, minHeight: 0 });
  showWidget(panel);
  element.style.minHeight = "";
  assert.equal(panel.computeLayoutSize({}).minHeight, 180);
  assert.equal(element.style.minHeight, "160px");
});
