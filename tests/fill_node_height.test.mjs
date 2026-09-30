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

import { fillNodeHeight } from "../js/shared/panel_layout.mjs";
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
