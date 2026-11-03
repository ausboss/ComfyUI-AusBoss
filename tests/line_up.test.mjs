import test from "node:test";
import assert from "node:assert/strict";

import { MIN_GAP, enoughFor, lineUp, matchWidth, sameSize, spreadEvenly } from "../js/shared/line_up.mjs";

const box = (x, y, w, h) => ({ x, y, w, h });
const rects = [box(10, 0, 100, 50), box(40, 100, 200, 80), box(0, 300, 60, 40)];

test("edges line up on the outermost edge of the selection", () => {
  assert.deepEqual(lineUp(rects, "left").map((p) => p.x), [0, 0, 0]);
  assert.deepEqual(lineUp(rects, "right").map((p) => p.x), [140, 40, 180]); // right edge 240 for all
  assert.deepEqual(lineUp(rects, "top").map((p) => p.y), [0, 0, 0]);
  // the bottom edge of the selection is 340
  assert.deepEqual(lineUp(rects, "bottom").map((p) => p.y), [290, 260, 300]);
});

test("lining up on one axis leaves the other alone", () => {
  assert.deepEqual(lineUp(rects, "left").map((p) => p.y), [0, 100, 300]);
  assert.deepEqual(lineUp(rects, "top").map((p) => p.x), [10, 40, 0]);
});

test("middles line up on the middle of the selection", () => {
  // selection spans x 0..240, middle 120
  assert.deepEqual(lineUp(rects, "middleX").map((p) => p.x), [70, 20, 90]);
  // selection spans y 0..340, middle 170
  assert.deepEqual(lineUp(rects, "middleY").map((p) => p.y), [145, 130, 150]);
});

test("same size takes the widest, narrowest, tallest or shortest", () => {
  assert.deepEqual(sameSize(rects, "widest"), [{ w: 200, h: 50 }, { w: 200, h: 80 }, { w: 200, h: 40 }]);
  assert.deepEqual(sameSize(rects, "narrowest").map((s) => s.w), [60, 60, 60]);
  assert.deepEqual(sameSize(rects, "tallest").map((s) => s.h), [80, 80, 80]);
  assert.deepEqual(sameSize(rects, "shortest"), [{ w: 100, h: 40 }, { w: 200, h: 40 }, { w: 60, h: 40 }]);
});

test("even spacing keeps the outer edges and the order", () => {
  // three rects across: 0..100, 130..180, 400..500 -> span 500, filled 250, gap 125
  const row = [box(0, 0, 100, 10), box(400, 0, 100, 10), box(130, 50, 50, 10)];
  const placed = spreadEvenly(row, "across");
  assert.deepEqual(placed.map((p) => p.x), [0, 400, 225]);
  assert.deepEqual(placed.map((p) => p.y), [0, 0, 50]);
});

test("even spacing down works on the other axis", () => {
  const column = [box(0, 0, 10, 100), box(0, 150, 10, 20), box(0, 600, 10, 100)];
  assert.deepEqual(spreadEvenly(column, "down").map((p) => p.y), [0, 340, 600]);
});

test("even spacing needs three or more", () => {
  const two = [box(0, 0, 10, 10), box(100, 0, 10, 10)];
  assert.deepEqual(spreadEvenly(two, "across"), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  assert.equal(enoughFor("spacing", 2), false);
  assert.equal(enoughFor("spacing", 3), true);
  assert.equal(enoughFor("lineUp", 2), true);
  assert.equal(enoughFor("lineUp", 1), false);
});

test("even spacing pulls overlapping nodes apart", () => {
  // three nodes lined up on one spot, as "left edges" leaves a row of nodes
  const pile = [box(0, 0, 100, 100), box(0, 10, 100, 60), box(0, 20, 100, 40)];
  const placed = spreadEvenly(pile, "down");
  // order by middle: 40 (second), 50 (first), 40 (third) -> second, third, first
  assert.deepEqual(placed.map((p) => p.y), [60 + 40 + 2 * MIN_GAP, 0, 60 + MIN_GAP]);
});

test("gaps under the smallest gap grow to it", () => {
  const tight = [box(0, 0, 10, 10), box(15, 0, 10, 10), box(30, 0, 10, 10)];
  assert.deepEqual(spreadEvenly(tight, "across").map((p) => p.x), [0, 10 + MIN_GAP, 20 + 2 * MIN_GAP]);
});

test("resizing one node gives the others its width, keeping their left edges", () => {
  const starts = [{ x: 0, w: 300 }, { x: 50, w: 200 }];
  assert.deepEqual(matchWidth(420, starts), [{ x: 0, w: 420 }, { x: 50, w: 420 }]);
});

test("a pull on the left edge keeps the others' right edges", () => {
  const starts = [{ x: 0, w: 300 }, { x: 50, w: 200 }]; // right edges 300 and 250
  assert.deepEqual(matchWidth(400, starts, { fromLeft: true }), [{ x: -100, w: 400 }, { x: -150, w: 400 }]);
});

test("a node never goes under its own narrowest width", () => {
  const starts = [{ x: 0, w: 300, least: 260 }, { x: 0, w: 300, least: 100 }];
  assert.deepEqual(matchWidth(150, starts), [{ x: 0, w: 260 }, { x: 0, w: 150 }]);
  assert.deepEqual(matchWidth(150, starts, { fromLeft: true }), [{ x: 40, w: 260 }, { x: 150, w: 150 }]);
});
