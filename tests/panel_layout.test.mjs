import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureNodeMinHeight,
  fillNodeHeight,
  holdNodeMinWidth,
  holdNodeMinHeight,
  holdVueNodeMinWidth,
  measureLayoutWidthPadding,
  nodeHeightAfterCardChange,
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

test("holdNodeMinHeight lifts computeSize to the measured floor, never lowers it", () => {
  let floor;
  const node = {
    size: [440, 810],
    computeSize() { return [404, 218]; },
    setSize(size) { this.size = size; },
  };
  holdNodeMinHeight(node, () => floor);
  assert.deepEqual(node.computeSize(), [404, 218], "no floor yet: the frontend's own size");
  floor = 816.125;
  assert.deepEqual(node.computeSize(), [404, 816.125], "the floor is read on every call");
  floor = 120;
  assert.deepEqual(node.computeSize(), [404, 218], "a floor under the frontend's height changes nothing");
  floor = NaN;
  assert.deepEqual(node.computeSize(), [404, 218]);
  // ensureNodeMinHeight and a corner drag both go through computeSize.
  floor = 816.125;
  assert.equal(ensureNodeMinHeight(node), true);
  assert.deepEqual(node.size, [440, 816.125]);
  node.size = [440, 1000];
  assert.equal(ensureNodeMinHeight(node), false, "a taller node is never shrunk");
});

test("holdNodeMinHeight chains the node's own computeSize and tolerates bad input", () => {
  const node = {
    extra: 30,
    computeSize(out) {
      const size = out ?? [0, 0];
      size[0] = 300;
      size[1] = 100 + this.extra;
      return size;
    },
  };
  holdNodeMinHeight(node, () => 200);
  const out = [0, 0];
  assert.equal(node.computeSize(out), out, "an out array is filled in place");
  assert.deepEqual(out, [300, 200]);
  node.extra = 300;
  assert.deepEqual(node.computeSize(), [300, 400], "`this` still reaches the node");
  assert.equal(holdNodeMinHeight(null, () => 1), null);
  const bare = {};
  assert.equal(holdNodeMinHeight(bare, () => 1), bare);
  assert.equal(bare.computeSize, undefined);
});

// LGraphNode.computeSize as the frontend (1.53) runs it for DOM widgets:
// each laid-out widget's computeLayoutSize minWidth, plus 104px of padding
// meant for a number widget's value box, can raise the node's width, and a
// corner drag stops at that width.
function frontendNode(widgets, { padding = 104, base = 210 } = {}) {
  const node = {
    widgets,
    computeSize() {
      let width = base;
      for (const widget of this.widgets) {
        if (widget.hidden || !widget.computeLayoutSize) continue;
        // A widget that pins its own computeSize is sized by that alone:
        // its computeLayoutSize width is never read.
        if (widget.computeSize) continue;
        width = Math.max(width, widget.computeLayoutSize(this).minWidth + padding);
      }
      return [width, 300];
    },
  };
  for (const widget of widgets) widget.node ??= node;
  return node;
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

test("a widget that pins its own computeSize never had a width floor", () => {
  // The fixed-height cards (Seed, Save Image, the widget cards) declare a
  // minWidth in computeLayoutSize, but the frontend skips it once
  // computeSize exists: the node falls to the frontend's default width.
  const card = { computeSize: () => [300, 120], computeLayoutSize: () => ({ minWidth: 300, minHeight: 120 }), options: {} };
  const node = frontendNode([card]);
  assert.equal(node.computeSize()[0], 210);
  holdNodeMinWidth(card, 300);
  assert.equal(node.computeSize()[0], 300, "the card's number is now the floor");
  assert.equal(node.computeSize()[1], 300, "the height is left to the frontend");
});

test("holdNodeMinWidth only ever raises a node's width", () => {
  const card = { computeSize: () => [300, 120], options: {} };
  const wide = frontendNode([card], { base: 500 });
  holdNodeMinWidth(card, 300);
  assert.equal(wide.computeSize()[0], 500, "a node already wider for other reasons keeps that width");
});

test("a node with several panels floors at the widest, and a floor can follow state", () => {
  // The frontend gives a widget its node at construction, before any of the
  // panel code runs: the node comes first here too.
  const node = frontendNode([]);
  const card = { node, computeSize: () => [320, 120], options: {} };
  const viewer = fillNodeHeight({ node, options: {} }, { minWidth: 220, minHeight: 100, exactMinWidth: true });
  let strength = 0;
  const stack = fillNodeHeight({ node, options: {} }, { minWidth: () => 260 + strength, minHeight: 100, exactMinWidth: true });
  node.widgets.push(card, viewer, stack);
  holdNodeMinWidth(card, 320);
  assert.equal(node.computeSize()[0], 320);
  strength = 100;
  assert.equal(node.computeSize()[0], 360, "the stack's floor moved, the node's floor moves with it");
  // Registering the same widget again replaces its number instead of adding one.
  holdNodeMinWidth(card, 280);
  assert.equal(node.computeSize()[0], 360);
  strength = 0;
  assert.equal(node.computeSize()[0], 280);
});

test("holdNodeMinWidth leaves a widget with no node alone", () => {
  const widget = { options: {} };
  assert.equal(holdNodeMinWidth(widget, 300), widget);
  assert.equal(holdNodeMinWidth(null, 300), null);
});

test("every panel on a node feeds one Nodes 2.0 minimum: the widest", () => {
  const observers = [];
  const saved = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
  };
  try {
    const host = { style: { minWidth: "" } };
    const inside = { closest: (selector) => (selector === "[data-node-id]" ? host : null) };
    const node = frontendNode([]);
    const card = { node, computeSize: () => [320, 120], options: {}, element: { ...inside } };
    const viewer = fillNodeHeight({ node, options: {}, element: { ...inside } }, { minWidth: 220, minHeight: 100, exactMinWidth: true });
    node.widgets.push(card, viewer);
    holdNodeMinWidth(card, 320);
    assert.equal(observers.length, 2, "one observer per panel: the viewer's from fillNodeHeight, the card's from the hold");
    // Each panel reports its first size in turn; the node keeps the widest,
    // whichever speaks last, so the two never fight over the value.
    for (const observer of observers) observer.callback();
    assert.equal(host.style.minWidth, "320px");
    for (const observer of [...observers].reverse()) observer.callback();
    assert.equal(host.style.minWidth, "320px");
    // The classic renderer: no node element around the panels, nothing written.
    const outside = { closest: () => null };
    const otherNode = frontendNode([]);
    const other = { node: otherNode, computeSize: () => [300, 120], options: {}, element: outside };
    otherNode.widgets.push(other);
    holdNodeMinWidth(other, 300);
    observers.at(-1).callback();
    assert.equal(host.style.minWidth, "320px");
  } finally {
    globalThis.ResizeObserver = saved;
  }
});

test("a node keeps its extra height when the person opens or closes a group", () => {
  // A tall node with a picture under the card: More opens (the card gains 93)
  // and the node gains the same, so the picture keeps its size.
  assert.equal(nodeHeightAfterCardChange({ floor: 562, current: 800, change: 93, byHand: true }), 893);
  // More closes again: back to what the person gave it.
  assert.equal(nodeHeightAfterCardChange({ floor: 469, current: 893, change: -93, byHand: true }), 800);
  // Never shorter than the floor, also when the card shrank by more than the spare.
  assert.equal(nodeHeightAfterCardChange({ floor: 500, current: 603, change: -193, byHand: true }), 500);
});

test("a node that sat at its floor hugs the new floor, however the card changed", () => {
  for (const byHand of [true, false]) {
    assert.equal(nodeHeightAfterCardChange({ floor: 562, current: 469, change: 93, byHand }), 562);
    assert.equal(nodeHeightAfterCardChange({ floor: 469, current: 562, change: -93, byHand }), 469);
  }
});

test("a card that changes by itself leaves a tall node's height alone", () => {
  // A row that settles after a load: the saved height already holds it.
  assert.equal(nodeHeightAfterCardChange({ floor: 539, current: 539, change: 31 }), 539);
  // A value written from outside brings a row in or takes one out.
  assert.equal(nodeHeightAfterCardChange({ floor: 500, current: 800, change: 31 }), 800);
  assert.equal(nodeHeightAfterCardChange({ floor: 469, current: 800, change: -31 }), 800);
  // Still lifted to the floor when the row no longer fits.
  assert.equal(nodeHeightAfterCardChange({ floor: 560, current: 540, change: 31 }), 560);
});

test("a new node hugs its floor and a loading workflow keeps its saved height", () => {
  // New: whatever height the classic widgets gave the node is dropped.
  assert.equal(nodeHeightAfterCardChange({ floor: 469, current: 610, first: true }), 469);
  // Loading: the saved height already holds the rows the saved values show.
  assert.equal(nodeHeightAfterCardChange({ floor: 562, current: 893, change: 93, restoring: true }), 893);
  assert.equal(nodeHeightAfterCardChange({ floor: 508, current: 539, change: -31, restoring: true }), 539);
  // Loading a node saved shorter than it now needs: lifted to the floor.
  assert.equal(nodeHeightAfterCardChange({ floor: 562, current: 300, change: 93, restoring: true }), 562);
  // The frontend grew the node to fit the card of a new node (570) before
  // the saved values took a row out: the saved height wins, not that one.
  assert.equal(nodeHeightAfterCardChange({ floor: 539, current: 570, saved: 539, change: -31, restoring: true }), 539);
  assert.equal(nodeHeightAfterCardChange({ floor: 539, current: 800, saved: 800, change: -31, restoring: true }), 800);
  assert.equal(nodeHeightAfterCardChange({ floor: 539, current: 570, saved: NaN, change: -31, restoring: true }), 570);
  // Bad input never produces NaN.
  assert.equal(nodeHeightAfterCardChange({ floor: 469, current: undefined, change: 93 }), 469);
  assert.equal(nodeHeightAfterCardChange({ floor: undefined, current: 700, change: 93 }), 700);
  assert.equal(nodeHeightAfterCardChange({ floor: 469, current: 700, change: "x" }), 700);
  assert.equal(nodeHeightAfterCardChange(), 0);
});
