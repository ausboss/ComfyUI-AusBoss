// fillNodeHeight is the one place that knows how the frontend splits a
// node's leftover height between its widgets. The rule it encodes, from
// LGraphNode._arrangeWidgets:
//
//   if (w.computeSize)            -> fixed height, kept OUT of the split
//   else if (w.computeLayoutSize) -> joins distributeSpace(freeSpace, ...)
//
// It is an else-if. A panel declaring both is pinned by computeSize and its
// computeLayoutSize is never consulted - the bug where dragging a node
// taller only added dead space under a width-sized stage.

import assert from "node:assert/strict";
import test from "node:test";

import { fillNodeHeight } from "../js/shared/panel_layout.mjs";

// distributeSpace, transcribed from the frontend bundle. maxSize ?? Infinity
// is the line that makes "a minimum with no maximum" mean "take the rest".
function distributeSpace(available, specs) {
  if (specs.length === 0) return [];
  const floor = specs.reduce((sum, spec) => sum + spec.minSize, 0);
  if (available < floor) return specs.map((spec) => spec.minSize);
  let rows = specs.map((spec) => ({
    computedSize: spec.minSize,
    remaining: (spec.maxSize ?? Infinity) - spec.minSize,
  }));
  let left = available - floor;
  while (left > 0 && rows.some((row) => row.remaining > 0)) {
    const hungry = rows.filter((row) => row.remaining > 0).length;
    if (hungry === 0) break;
    const share = left / hungry;
    let handed = 0;
    rows = rows.map((row) => {
      if (row.remaining <= 0) return row;
      const take = Math.min(share, row.remaining);
      handed += take;
      return { computedSize: row.computedSize + take, remaining: row.remaining - take };
    });
    left -= handed;
    if (handed === 0) break;
  }
  return rows.map((row) => row.computedSize);
}

// The widget walk from _arrangeWidgets. Returns each widget's computed height.
function arrangeWidgets(widgets, freeHeight) {
  let fixed = 0;
  const flexible = [];
  const heights = new Map();
  for (const widget of widgets) {
    if (widget.computeSize) {
      const height = widget.computeSize()[1] + 4;
      heights.set(widget, height);
      fixed += height;
    } else if (widget.computeLayoutSize) {
      const { minHeight, maxHeight } = widget.computeLayoutSize({ size: [0, 0] });
      flexible.push({ widget, minHeight, maxHeight });
    } else {
      heights.set(widget, 24);
      fixed += 24;
    }
  }
  const sizes = distributeSpace(
    Math.max(0, freeHeight - fixed),
    flexible.map((entry) => ({ minSize: entry.minHeight, maxSize: entry.maxHeight })),
  );
  flexible.forEach((entry, index) => heights.set(entry.widget, sizes[index]));
  return heights;
}

test("a panel with computeSize is pinned - the bug this helper exists to stop", () => {
  const pinned = {
    computeSize: () => [400, 200],
    computeLayoutSize: () => ({ minWidth: 320, minHeight: 144 }),
  };
  const short = arrangeWidgets([pinned], 400).get(pinned);
  const tall = arrangeWidgets([pinned], 900).get(pinned);
  assert.equal(short, tall, "computeSize should win, proving the else-if ordering");
  assert.equal(tall, 204);
});

test("fillNodeHeight makes the same panel absorb the node's leftover height", () => {
  const panel = {
    computeSize: () => [400, 200],
    computeLayoutSize: () => ({ minWidth: 320, minHeight: 144 }),
  };
  fillNodeHeight(panel, { minWidth: 320, minHeight: 144 });
  assert.equal(panel.computeSize, undefined, "computeSize must be gone, not overwritten");
  assert.equal(arrangeWidgets([panel], 400).get(panel), 400);
  assert.equal(arrangeWidgets([panel], 900).get(panel), 900);
});

test("the declared minimum is a floor the split cannot go under", () => {
  const panel = fillNodeHeight({}, { minWidth: 320, minHeight: 144 });
  assert.equal(arrangeWidgets([panel], 40).get(panel), 144);
  assert.equal(arrangeWidgets([panel], 0).get(panel), 144);
});

test("no maxHeight is declared, so nothing caps the panel", () => {
  const panel = fillNodeHeight({}, { minHeight: 100 });
  assert.equal(panel.computeLayoutSize({}).maxHeight, undefined);
});

test("a panel shares leftover height with the plain widgets above it", () => {
  const rowA = {};
  const rowB = {};
  const panel = fillNodeHeight({}, { minHeight: 144 });
  const heights = arrangeWidgets([rowA, rowB, panel], 500);
  assert.equal(heights.get(rowA), 24);
  assert.equal(heights.get(rowB), 24);
  assert.equal(heights.get(panel), 500 - 48, "the panel takes exactly what the rows left");
});

test("two growing panels split the remainder evenly", () => {
  const first = fillNodeHeight({}, { minHeight: 100 });
  const second = fillNodeHeight({}, { minHeight: 100 });
  const heights = arrangeWidgets([first, second], 600);
  assert.equal(heights.get(first), 300);
  assert.equal(heights.get(second), 300);
});

test("minimums may be functions, for panels whose floor depends on state", () => {
  const state = { populated: false };
  const panel = fillNodeHeight({}, {
    minWidth: 300,
    minHeight: () => (state.populated ? 420 : 132),
  });
  assert.equal(panel.computeLayoutSize({}).minHeight, 132);
  state.populated = true;
  assert.equal(panel.computeLayoutSize({}).minHeight, 420, "the floor is read per call");
  assert.equal(panel.computeLayoutSize({}).minWidth, 300);
});

test("minNodeSize is passed through for frontends that clamp with it", () => {
  const panel = fillNodeHeight({}, { minHeight: 144, minNodeSize: [320, 220] });
  assert.deepEqual(panel.options.minNodeSize, [320, 220]);
  const bare = fillNodeHeight({}, { minHeight: 144 });
  assert.equal(bare.options.minNodeSize, undefined);
  const kept = fillNodeHeight({ options: { minNodeSize: [1, 2], hideOnZoom: true } }, {});
  assert.equal(kept.options.hideOnZoom, true, "existing options survive");
});

test("bad or missing minimums degrade to zero rather than NaN", () => {
  const panel = fillNodeHeight({}, { minWidth: "wide", minHeight: () => undefined });
  assert.deepEqual(panel.computeLayoutSize({}), { minWidth: 0, minHeight: 0 });
  const negative = fillNodeHeight({}, { minHeight: -50 });
  assert.equal(negative.computeLayoutSize({}).minHeight, 0);
  assert.deepEqual(fillNodeHeight({}).computeLayoutSize({}), { minWidth: 0, minHeight: 0 });
});

test("a missing widget is tolerated", () => {
  assert.equal(fillNodeHeight(null, { minHeight: 10 }), null);
  assert.equal(fillNodeHeight(undefined), undefined);
});

test("hiding a filled panel still collapses it, and showing restores the fill", () => {
  // widget_visibility stashes and restores both sizing hooks. With
  // computeSize deleted it stashes undefined - the restore must put the
  // panel back in the split, not leave a truthy computeSize behind.
  const panel = fillNodeHeight({}, { minHeight: 144 });
  const stash = { computeSize: panel.computeSize, computeLayoutSize: panel.computeLayoutSize };
  panel.computeSize = () => [0, -4];
  panel.computeLayoutSize = () => ({ minWidth: 0, minHeight: 0 });
  assert.equal(arrangeWidgets([panel], 500).get(panel), 0, "hidden collapses to nothing");
  panel.computeSize = stash.computeSize;
  panel.computeLayoutSize = stash.computeLayoutSize;
  assert.equal(panel.computeSize, undefined);
  assert.equal(arrangeWidgets([panel], 500).get(panel), 500, "shown fills again");
});
