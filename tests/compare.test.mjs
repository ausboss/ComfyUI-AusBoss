import assert from "node:assert/strict";
import test from "node:test";

import {
  clipFraction,
  compareBadges,
  slideFraction,
  compareClip,
  compareResultSide,
  compareSizeLabel,
  findCompareImages,
  normalizeCompareMode,
} from "../js/shared/compare.mjs";

test("clip fraction follows the pointer and clamps to the panel", () => {
  assert.equal(clipFraction(150, 100, 200), 0.25);
  assert.equal(clipFraction(100, 100, 200), 0);
  assert.equal(clipFraction(40, 100, 200), 0);
  assert.equal(clipFraction(900, 100, 200), 1);
});

test("degenerate panels and junk input resolve to no left overlay", () => {
  assert.equal(clipFraction(150, 100, 0), 0);
  assert.equal(clipFraction(150, 100, -5), 0);
  assert.equal(clipFraction(NaN, 100, 200), 0);
  assert.equal(clipFraction(150, 100, "wide"), 0);
});

test("mode normalization", () => {
  assert.equal(normalizeCompareMode("slide"), "slide");
  assert.equal(normalizeCompareMode("toggle"), "toggle");
  assert.equal(normalizeCompareMode("wiggle"), "slide");
  assert.equal(normalizeCompareMode(undefined), "slide");
});

test("a workflow saved on the old hold mode lands on the toggle it became", () => {
  // Dropping it to slide instead would silently change how a saved node
  // behaves, which is exactly what someone reopening their graph notices.
  assert.equal(normalizeCompareMode("hold"), "toggle");
});

test("the caption names the compared resolution, once", () => {
  assert.equal(
    compareSizeLabel({ a: { width: 576, height: 1024 }, b: { width: 576, height: 1024 } }),
    "576×1024",
  );
  // One side only is the common case mid-load; A speaks for the pair.
  assert.equal(compareSizeLabel({ a: { width: 512, height: 512 } }), "512×512");
});

test("a size mismatch is stated rather than hidden behind A", () => {
  // Comparing images of different sizes is usually a wiring mistake, and the
  // panel stretches both to fit, so nothing else on screen would show it.
  assert.equal(
    compareSizeLabel({ a: { width: 512, height: 512 }, b: { width: 1024, height: 1024 } }),
    "A 512×512 · B 1024×1024",
  );
});

test("nothing loaded means no caption at all", () => {
  assert.equal(compareSizeLabel(null), "");
  assert.equal(compareSizeLabel({}), "");
  assert.equal(compareSizeLabel({ a: { width: 0, height: 0 } }), "");
  assert.equal(compareSizeLabel({ a: { filename: "x.png" } }), "");
});

test("clip CSS keeps the overlay left of the seam and hides the seam at the edges", () => {
  assert.deepEqual(compareClip(0.25), {
    clipPath: "inset(0 75.00% 0 0)",
    seamLeft: "25.00%",
    seamVisible: true,
  });
  assert.equal(compareClip(0).seamVisible, false);
  assert.equal(compareClip(1).seamVisible, false);
  assert.equal(compareClip(2).clipPath, "inset(0 0.00% 0 0)");
  assert.equal(compareClip("junk").clipPath, "inset(0 100.00% 0 0)");
});

test("compare previews are pulled from the execution payload as a pair", () => {
  const a = { filename: "a.png", subfolder: "", type: "temp" };
  const b = { filename: "b.png", subfolder: "", type: "temp" };
  assert.deepEqual(findCompareImages({ a_images: [a], b_images: [b] }), { a, b });
  assert.equal(findCompareImages({ a_images: [a] }), null);
  assert.equal(findCompareImages({ a_images: [{}], b_images: [b] }), null);
  assert.equal(findCompareImages(null), null);
});

test("slide gives edges a forgiving landing zone without disturbing the middle", () => {
  assert.equal(slideFraction(110, 100, 200), 0);
  assert.equal(slideFraction(290, 100, 200), 1);
  assert.equal(slideFraction(150, 100, 200), 0.25);
});

test("leaving above or below settles to the nearest full image", () => {
  assert.equal(slideFraction(175, 100, 200, true), 0);
  assert.equal(slideFraction(225, 100, 200, true), 1);
  assert.equal(slideFraction(200, 100, 200, true), 1);
  assert.equal(slideFraction(50, 100, 200, true), 0);
  assert.equal(slideFraction(350, 100, 200, true), 1);
});

test("A and B sit on either side of the split line and move with it", () => {
  // At 30% of a 400 px stage the line is at 120: A just left of it, B just right.
  const split = compareBadges(0.3, 400, 22, 5);
  assert.deepEqual(split, { a: 93, b: 125 });
  assert.deepEqual(compareBadges(0.8, 400, 22, 5), { a: 293, b: 325 });
  // One picture showing: its label alone, centred.
  assert.deepEqual(compareBadges(1, 400, 22), { a: 189, b: null });
  assert.deepEqual(compareBadges(0, 400, 22), { a: null, b: 189 });
  // A side too narrow for its label drops the label rather than cover the line.
  assert.equal(compareBadges(0.05, 400, 22, 5).a, null);
  assert.equal(compareBadges(0.97, 400, 22, 5).b, null);
  assert.deepEqual(compareBadges(0.5, 0), { a: null, b: null });
});

// A graph as { node id: ids of the nodes wired into it }. A subgraph node
// also lists, under `subgraphs`, the graph inside it and where each of its
// outputs comes from in there.
function view(feeds, subgraphs = {}) {
  return {
    feeds: (id) => feeds[id] ?? [],
    inside(id) {
      const inner = subgraphs[id];
      if (!inner) return null;
      return { ...view(inner.feeds, inner.subgraphs), output: (slot) => inner.outputs[slot] ?? null };
    },
  };
}
const from = (id, slot = 0) => ({ id, slot });

test("the panel rests on B, the after picture, when nothing says otherwise", () => {
  // Two loaders, or two samplers side by side: neither is made from the other.
  assert.equal(compareResultSide(from(1), from(2), view({})), "B");
  assert.equal(compareResultSide(from(4), from(5), view({ 4: [1, 2], 5: [1, 3] })), "B");
  // B made from A is the convention itself.
  assert.equal(compareResultSide(from(1), from(3), view({ 2: [1], 3: [2] })), "B");
});

test("a result wired to A is found through the links", () => {
  // loader 1 -> edit 2 -> decode 3: A is the edit, B the picture it started from.
  const graph = view({ 2: [1, 9], 3: [2] });
  assert.equal(compareResultSide(from(3), from(1), graph), "A");
  assert.equal(compareResultSide(from(2), from(1), graph), "A");
  // An input with no link reads as undefined and is skipped.
  assert.equal(compareResultSide(from(3), from(1), view({ 2: [undefined, 1], 3: [null, 2] })), "A");
});

test("both pictures out of one subgraph are told apart inside it", () => {
  // Subgraph 12 resizes the picture (30), edits it (31 -> 38) and hands out
  // the edit on output 0 and the resized picture on output 1.
  const inner = { feeds: { 30: [-10], 31: [30], 38: [31] }, outputs: [from(38), from(30)] };
  const graph = view({ 12: [1] }, { 12: inner });
  assert.equal(compareResultSide(from(12, 0), from(12, 1), graph), "A");
  assert.equal(compareResultSide(from(12, 1), from(12, 0), graph), "B");
  // The same, one subgraph deeper.
  const outer = view({}, { 5: { feeds: { 12: [-10] }, subgraphs: { 12: inner }, outputs: [from(12, 0), from(12, 1)] } });
  assert.equal(compareResultSide(from(5, 0), from(5, 1), outer), "A");
  // An output that is not wired inside gives nothing to go on.
  const open = view({}, { 12: { feeds: {}, outputs: [from(38)] } });
  assert.equal(compareResultSide(from(12, 0), from(12, 1), open), "B");
});

test("an input with nothing to compare against rests on B", () => {
  assert.equal(compareResultSide(null, from(1), view({})), "B");
  assert.equal(compareResultSide(from(1), null, view({})), "B");
  // Both pictures out of one plain node: no telling which came first.
  assert.equal(compareResultSide(from(7, 0), from(7, 3), view({ 7: [1] })), "B");
});

test("a loop in the links does not hang the search", () => {
  assert.equal(compareResultSide(from(1), from(9), view({ 1: [2], 2: [1] })), "B");
});
