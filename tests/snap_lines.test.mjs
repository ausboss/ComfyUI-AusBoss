import test from "node:test";
import assert from "node:assert/strict";

import {
  guidesFor,
  insideAny,
  linesOf,
  nearestCatch,
  rectLines,
  snapEdges,
  snapMove,
  unionOf,
} from "../js/shared/snap_lines.mjs";

const box = (x, y, w, h) => ({ x, y, w, h });

test("a rect offers its start edge, middle and end edge on each axis", () => {
  assert.deepEqual(linesOf(box(10, 20, 100, 40), "x"), [10, 60, 110]);
  assert.deepEqual(linesOf(box(10, 20, 100, 40), "y"), [20, 40, 60]);
});

test("a dragged rect catches the nearest line within reach", () => {
  const target = box(100, 0, 200, 100);
  // left edge 5 off the target's left edge
  assert.deepEqual(snapMove(box(105, 300, 80, 50), [target], 8), { dx: -5, dy: 0 });
  // middle to middle
  assert.deepEqual(snapMove(box(158, 300, 80, 50), [target], 8), { dx: 2, dy: 0 });
});

test("nothing within reach leaves the rect where the pointer put it", () => {
  assert.deepEqual(snapMove(box(130, 300, 80, 50), [box(100, 0, 200, 100)], 8), { dx: 0, dy: 0 });
  assert.deepEqual(snapMove(box(130, 300, 80, 50), [], 8), { dx: 0, dy: 0 });
});

test("both axes catch at once", () => {
  const target = box(0, 0, 100, 100);
  assert.deepEqual(snapMove(box(3, 104, 100, 60), [target], 8), { dx: -3, dy: -4 });
});

test("the nearer of two lines wins", () => {
  const left = box(0, 0, 100, 100);
  const right = box(206, 0, 100, 100);
  // rect left edge at 203: 3 from right's left edge (206), 3 from nothing else nearer
  assert.equal(nearestCatch([203], box(203, 300, 50, 50), [left, right], "x", 8), 3);
  assert.equal(nearestCatch([101], box(101, 300, 50, 50), [left, right], "x", 8), -1);
});

test("on a tie the target in the same row or column wins", () => {
  const far = box(0, 2000, 100, 100);
  const near = box(0, 0, 100, 100);
  const moving = box(4, 120, 100, 50);
  // both targets offer x = 0; the shift is the same, but the near one wins and the answer stays -4
  assert.equal(nearestCatch(linesOf(moving, "x"), moving, [far, near], "x", 8), -4);
  // a closer far line still wins over a farther near line
  const farCloser = box(2, 2000, 100, 100);
  assert.equal(nearestCatch(linesOf(moving, "x"), moving, [near, farCloser], "x", 8), -2);
});

test("a resize moves only the edges being pulled", () => {
  const target = box(300, 0, 100, 100);
  // right edge at 296 catches the target's left edge at 300; the left edge holds
  assert.deepEqual(snapEdges(box(0, 0, 296, 50), { right: true, bottom: true }, [target], 8), box(0, 0, 300, 50));
  // left edge pulled: x moves, the right edge holds
  assert.deepEqual(snapEdges(box(395, 200, 105, 50), { left: true, top: true }, [target], 8), box(400, 200, 100, 50));
});

test("a resize never catches a line under the node's smallest size", () => {
  const target = box(80, 0, 10, 10);
  // the right edge at 95 would catch 90, making the rect 90 wide; the floor is 92
  assert.deepEqual(snapEdges(box(0, 200, 95, 50), { right: true }, [target], 8, { w: 92 }), box(0, 200, 95, 50));
  assert.deepEqual(snapEdges(box(0, 200, 95, 50), { right: true }, [target], 8, { w: 80 }), box(0, 200, 90, 50));
});

test("guides run across the rect and every target on the line", () => {
  const a = box(0, 0, 100, 50);
  const b = box(0, 300, 150, 50);
  const placed = box(0, 120, 80, 40);
  const guides = guidesFor(placed, [a, b], rectLines(placed));
  const left = guides.find((guide) => guide.axis === "x" && guide.at === 0);
  assert.ok(left, "the shared left edge is drawn");
  assert.equal(left.from, 0);
  assert.equal(left.to, 350);
  assert.equal(left.middle, false);
  assert.deepEqual(left.marks, [120, 160, 0, 50, 300, 350]);
  // the rect's middle (x = 40) and right edge (x = 80) match no target line
  assert.ok(!guides.some((guide) => guide.axis === "x" && guide.at !== 0));
});

test("a shared middle line is marked as a middle", () => {
  const target = box(0, 0, 100, 50);
  const placed = box(20, 120, 60, 40);
  const guides = guidesFor(placed, [target], rectLines(placed));
  const middle = guides.find((guide) => guide.axis === "x");
  assert.equal(middle.at, 50);
  assert.equal(middle.middle, true);
});

test("a resize draws only the edges it moved", () => {
  const target = box(0, 0, 100, 50);
  const placed = box(0, 120, 100, 40); // left and right both match the target
  const guides = guidesFor(placed, [target], rectLines(placed, { right: true, bottom: true }));
  assert.deepEqual(guides.map((guide) => [guide.axis, guide.at]), [["x", 100]]);
});

test("a node is inside a group when its middle is", () => {
  const group = box(0, 0, 400, 300);
  assert.equal(insideAny(box(350, 250, 100, 100), [group]), true);
  assert.equal(insideAny(box(380, 280, 100, 100), [group]), false);
});

test("the outline of several rects covers them all", () => {
  assert.deepEqual(unionOf([box(0, 10, 50, 50), box(100, -20, 20, 20)]), box(0, -20, 120, 80));
  assert.equal(unionOf([]), null);
});
