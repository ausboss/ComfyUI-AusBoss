import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureNodeMinHeight,
  fillNodeHeight,
  holdVueNodeMinWidth,
  measureLayoutWidthPadding,
} from "../js/shared/panel_layout.mjs";

test("fillNodeHeight drops computeSize and declares a floor with no ceiling", () => {
  const widget = { computeSize: () => [0, 200], options: {} };
  fillNodeHeight(widget, { minWidth: 200, minHeight: () => 140, minNodeSize: [200, 90] });
  assert.equal(widget.computeSize, undefined);
  assert.deepEqual(widget.computeLayoutSize(), { minWidth: 200, minHeight: 140 });
  assert.deepEqual(widget.options.minNodeSize, [200, 90]);
});

test("ensureNodeMinHeight grows a node that loaded shorter than its widgets need", () => {
  const node = { size: [300, 100], computeSize: () => [300, 180], setSize(size) { this.size = size; } };
  assert.equal(ensureNodeMinHeight(node), true);
  assert.deepEqual(node.size, [300, 180]);
  assert.equal(ensureNodeMinHeight(node), false, "already tall enough: untouched");
  node.size = [300, 400];
  assert.equal(ensureNodeMinHeight(node), false, "taller than the floor: never shrunk");
  assert.deepEqual(node.size, [300, 400]);
  assert.equal(ensureNodeMinHeight(null), false);
});

// LGraphNode.computeSize as the frontend (1.53) runs it for DOM widgets:
// each laid-out widget's computeLayoutSize minWidth, plus 104px of padding
// meant for a number widget's value box, can raise the node's width, and a
// corner drag stops at that width.
function frontendNode(widgets, { padding = 104, base = 210 } = {}) {
  return {
    widgets,
    computeSize() {
      let width = base;
      for (const widget of this.widgets) {
        if (widget.hidden || !widget.computeLayoutSize) continue;
        width = Math.max(width, widget.computeLayoutSize(this).minWidth + padding);
      }
      return [width, 300];
    },
  };
}

test("the frontend's width padding is measured, not assumed", () => {
  const widget = { computeLayoutSize: () => ({ minWidth: 320, minHeight: 0 }) };
  assert.equal(measureLayoutWidthPadding(frontendNode([widget]), widget), 104);
  assert.equal(measureLayoutWidthPadding(frontendNode([widget], { padding: 0 }), widget), 0);
  // The probe is removed again, whatever computeSize did.
  assert.equal(widget.computeLayoutSize().minWidth, 320);
  // Nothing to measure yet: a hidden panel, or no node.
  const hidden = { hidden: true, computeLayoutSize: () => ({ minWidth: 320, minHeight: 0 }) };
  assert.equal(measureLayoutWidthPadding(frontendNode([hidden]), hidden), null);
  assert.equal(measureLayoutWidthPadding(null, widget), null);
  assert.equal(measureLayoutWidthPadding({ size: [0, 0] }, widget), null);
});

test("exactMinWidth makes the declared width the node's real floor", () => {
  // Without it, a panel declaring 320 floors the node at 424.
  const padded = fillNodeHeight({ options: {} }, { minWidth: 320, minHeight: 100 });
  assert.equal(frontendNode([padded]).computeSize()[0], 424);
  // With it, the floor is the declared 320.
  const exact = fillNodeHeight({ options: {} }, {
    minWidth: () => 320, minHeight: 100, minNodeSize: [320, 100], exactMinWidth: true,
  });
  const node = frontendNode([exact]);
  assert.equal(node.computeSize()[0], 320);
  assert.equal(exact.computeLayoutSize(node).minWidth, 216);
  assert.equal(exact.computeLayoutSize(node).minHeight, 100);
  // Older frontends read minNodeSize, which is already the node's size.
  assert.deepEqual(exact.options.minNodeSize, [320, 100]);
  // A node wider than the floor for other reasons keeps that width.
  assert.equal(frontendNode([exact], { base: 500 }).computeSize()[0], 500);
});

test("a panel inside a Nodes 2.0 node lends that node its floor", () => {
  const host = { style: { minWidth: "" } };
  const panel = { closest: (selector) => (selector === "[data-node-id]" ? host : null) };
  assert.equal(holdVueNodeMinWidth(panel, 320), true);
  assert.equal(host.style.minWidth, "320px");
  assert.equal(holdVueNodeMinWidth(panel, 320), false, "unchanged: no write");
  assert.equal(holdVueNodeMinWidth(panel, 392), true, "the floor can move");
  assert.equal(host.style.minWidth, "392px");
  // The classic renderer: no node element around the panel.
  assert.equal(holdVueNodeMinWidth({ closest: () => null }, 320), false);
  assert.equal(holdVueNodeMinWidth(null, 320), false);
  assert.equal(holdVueNodeMinWidth(panel, NaN), false);
});
