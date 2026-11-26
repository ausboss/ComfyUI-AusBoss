// The curve the Strength Curve face draws (js/shared/strength_curve_math.mjs)
// is the one the node outputs (nodes/_curve_helpers.py), and the edits on
// the face keep the points the node can read.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_POINTS, PRESETS, addPoint, curveValues, movePoint, parsePoints, pointsText, presetOf, removePoint, strengthOf, tagPlace,
} from "../js/shared/strength_curve_math.mjs";

const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6, `${value} vs ${expected[i]}`));

test("the face draws the same line as the node", () => {
  // Values from nodes/_curve_helpers.curve_values for the same points.
  close(curveValues(parsePoints("[[0,1],[0.3,0.2],[0.7,0.9],[1,0]]"), [0.1, 0.25, 0.5, 0.8, 0.95]),
    [0.674074, 0.240741, 0.55, 0.733333, 0.170833]);
  close(curveValues(parsePoints([[0, 1], [0.25, 0.92], [0.75, 0.08], [1, 0]]), [0.1, 0.5, 0.9]),
    [0.983251, 0.5, 0.016749]);
});

test("points that cannot be read are a flat line at full strength, and the ends are filled in", () => {
  assert.deepEqual(parsePoints("not json"), [[0, 1], [1, 1]]);
  assert.deepEqual(parsePoints("[]"), [[0, 1], [1, 1]]);
  assert.deepEqual(parsePoints("[[0.5, 0.3], [2, -1]]"), [[0, 0.3], [0.5, 0.3], [1, 0]]);
  assert.equal(parsePoints(JSON.stringify(Array.from({ length: 40 }, (_, i) => [i / 39, 0.5]))).length <= MAX_POINTS + 2, true);
});

test("the ends stay at the start and the end, and a point stays between its neighbours", () => {
  const points = [[0, 1], [0.5, 0.5], [1, 0]];
  assert.deepEqual(movePoint(points, 0, 0.4, 0.2), [[0, 0.2], [0.5, 0.5], [1, 0]]);
  assert.deepEqual(movePoint(points, 2, 0.4, 2), [[0, 1], [0.5, 0.5], [1, 1]]);
  assert.deepEqual(movePoint(points, 1, 1.5, 0.3)[1], [0.99, 0.3]);
  assert.deepEqual(points, [[0, 1], [0.5, 0.5], [1, 0]]);
});

test("a point is added in order, never on top of another, and the ends are never removed", () => {
  const points = [[0, 1], [1, 0]];
  const added = addPoint(points, 0.3, 0.7);
  assert.deepEqual(added, { points: [[0, 1], [0.3, 0.7], [1, 0]], index: 1 });
  assert.equal(addPoint(added.points, 0.305, 0.1), null);
  assert.deepEqual(removePoint(added.points, 1), points);
  assert.deepEqual(removePoint(added.points, 0), added.points);
  assert.deepEqual(removePoint(added.points, 2), added.points);
});

test("presets are recognised, the saved text reads back the same, and a value maps between Bottom and Top", () => {
  for (const preset of PRESETS) assert.equal(presetOf(parsePoints(pointsText(preset.points))), preset.name);
  assert.equal(presetOf([[0, 1], [0.5, 0.4], [1, 0]]), "");
  assert.equal(pointsText([[0, 1], [1 / 3, 0.123456789], [1, 0]]), "[[0,1],[0.3333,0.1235],[1,0]]");
  assert.equal(strengthOf(0.5, 0.2, 0.8), 0.5);
  assert.equal(strengthOf(1, 0, 1.5), 1.5);
});

test("the hover readout never covers a point", () => {
  const box = { left: 30, top: 10, right: 330, bottom: 150 };
  const covers = ({ left, top }, [px, py], w, h) => px + 7 > left && px - 7 < left + w && py + 7 > top && py - 7 < top + h;
  // The bug: a point just above and right of the spot sat under the tag.
  const point = [120, 70];
  const spot = { x: 100, y: 95 };
  const tag = tagPlace({ ...spot, width: 70, height: 17, box, points: [point] });
  assert.equal(covers(tag, point, 70, 17), false);
  // Free above right: that is where it goes, as before.
  assert.deepEqual(tagPlace({ ...spot, width: 70, height: 17, box, points: [[300, 140]] }), { left: 106, top: 72 });
  // Always inside the box, even in a corner.
  const corner = tagPlace({ x: 325, y: 12, width: 70, height: 17, box, points: [] });
  assert.ok(corner.left >= box.left && corner.left + 70 <= box.right && corner.top >= box.top && corner.top + 17 <= box.bottom);
  // Every side covered: the one that covers the fewest.
  const crowd = [[110, 80], [90, 80], [110, 110]];
  const placed = tagPlace({ ...spot, width: 20, height: 10, box, points: crowd });
  assert.equal(crowd.filter((p) => covers(placed, p, 20, 10)).length, 0);
});
