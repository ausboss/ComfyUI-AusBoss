import test from "node:test";
import assert from "node:assert/strict";

import {
  AXES, autoConstraint, closestOnAxis, constraintLabel, nearestLocalAxis, nearestScreenAxis, nextConstraint,
  parseTyped, pickVector, rayPlane, readout, scaleFactors, screenTurn, snapStep, snapTo, typeKey,
} from "../js/shared/blender_transform.mjs";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("an axis key locks global, then local, then lets go", () => {
  let c = nextConstraint(null, "x");
  assert.deepEqual(c, { kind: "axis", axis: "x", space: "global" });
  c = nextConstraint(c, "x");
  assert.equal(c.space, "local");
  assert.equal(nextConstraint(c, "x"), null);
  // Another axis starts over on that axis.
  assert.deepEqual(nextConstraint({ kind: "axis", axis: "x", space: "local" }, "y"), { kind: "axis", axis: "y", space: "global" });
  // Shift+axis is the plane that leaves the axis out.
  assert.equal(nextConstraint(nextConstraint(null, "x"), "x", true).kind, "plane");
});

test("the lock reads in plain words", () => {
  assert.equal(constraintLabel(null), "");
  assert.equal(constraintLabel({ kind: "axis", axis: "x", space: "global" }), "along global X");
  assert.equal(constraintLabel({ kind: "plane", axis: "y", space: "local" }), "on local XZ");
});

test("a ray meets the floor; a ray along it never does", () => {
  near(rayPlane([0, 5, 0], [0, -1, 0], [0, 0, 0], [0, 1, 0]), 5);
  assert.equal(rayPlane([0, 5, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]), null);
});

test("the spot on an axis nearest a ray", () => {
  // A ray straight down at x = 2 meets the X axis at 2.
  near(closestOnAxis([2, 5, 0], [0, -1, 0], [0, 0, 0], AXES.x), 2);
  // Looking straight along the axis: no answer.
  assert.equal(closestOnAxis([0, 0, 5], [0, 0, -1], [0, 0, 0], AXES.z), null);
});

test("a screen turn is counter-clockwise positive with y down", () => {
  near(screenTurn([0, 0], [1, 0], [0, -1]), Math.PI / 2);
  near(screenTurn([0, 0], [1, 0], [0, 1]), -Math.PI / 2);
  assert.equal(screenTurn([0, 0], [0, 0], [1, 1]), 0);
});

test("typing a number the way Blender takes it", () => {
  let text = "";
  for (const key of ["1", ".", "5", ".", "-"]) text = typeKey(text, key);
  assert.equal(text, "-1.5");
  assert.equal(parseTyped(text), -1.5);
  assert.equal(parseTyped(typeKey(text, "-")), 1.5);
  assert.equal(typeKey("12", "Backspace"), "1");
  assert.equal(parseTyped(""), null);
  assert.equal(parseTyped("-"), null);
  assert.equal(parseTyped("."), null);
  assert.equal(typeKey("1", "a"), "1");
});

test("Ctrl snaps; Shift makes the step ten times finer", () => {
  assert.equal(snapStep("rotate", false), 5);
  assert.equal(snapStep("rotate", true), 1);
  assert.equal(snapStep("move", false), 0.1);
  assert.equal(snapStep("scale", true), 0.01);
  near(snapTo(17.4, 5), 15);
  near(snapTo(0.26, 0.1), 0.3);
  assert.equal(snapTo(0.26, 0), 0.26);
});

test("scaling along a world axis picks the model's nearest own axis", () => {
  // Turned 90 degrees about Y: its own X points along world -Z.
  const local = [[0, 0, -1], [0, 1, 0], [1, 0, 0]];
  assert.equal(nearestLocalAxis(local, AXES.z), 0);
  assert.equal(nearestLocalAxis(local, AXES.x), 2);
  assert.deepEqual(scaleFactors(2, null, 0), [2, 2, 2]);
  assert.deepEqual(scaleFactors(2, { kind: "axis", axis: "x" }, 0), [2, 1, 1]);
  assert.deepEqual(scaleFactors(2, { kind: "plane", axis: "y" }, 1), [2, 1, 2]);
});

test("the middle button picks the axis the mouse slides along", () => {
  // A view from the front-right: X runs right and down, Y (up) runs up the
  // screen, Z runs left and down (screen y points down).
  const screen = [[40, 12], [0, -45], [-30, 18]];
  assert.equal(nearestScreenAxis([0, -60], screen), 1); // up the screen: the vertical axis
  assert.equal(nearestScreenAxis([0, 30], screen), 1); // down too
  assert.equal(nearestScreenAxis([80, 20], screen), 0);
  assert.equal(nearestScreenAxis([-50, 31], screen), 2);
  // An axis pointing at the camera is left out.
  assert.equal(nearestScreenAxis([0, -60], [[40, 12], [0, -0.5], [-30, 18]], 3), 2);
  assert.equal(nearestScreenAxis([0, 0], screen), -1);
});

test("held, the move since the press picks; clicked, the move since G", () => {
  // Held and slid: the move since the press.
  assert.deepEqual(pickVector([0, 0], [100, 0], [100, -20]), [0, -20]);
  // A click after moving: the whole move since G.
  assert.deepEqual(pickVector([0, 0], [100, 0], [102, 1]), [102, 1]);
  // A click before any move: nothing yet, so the next move picks.
  assert.equal(pickVector([0, 0], [2, 1], [3, 1]), null);
  assert.equal(pickVector([0, 0], null, [3, 1]), null);
  assert.deepEqual(autoConstraint("y"), { kind: "axis", axis: "y", space: "global" });
  assert.deepEqual(autoConstraint("y", true), { kind: "plane", axis: "y", space: "global" });
});

test("the header reads like Blender's", () => {
  assert.equal(readout("grab", [0, -0.5, 0], { kind: "axis", axis: "y" }, -0.5), "D: -0.500 (0.500)");
  assert.equal(readout("grab", [0.3, 0, 0.4]), "Dx: 0.300  Dy: 0.000  Dz: 0.400 (0.500)");
  assert.equal(readout("rotate", 45), "Rot: 45.0°");
  assert.equal(readout("trackball", [10, -5]), "Trackball: 10.0°  -5.0°");
  assert.equal(readout("scale", 1.2, { kind: "axis", axis: "x" }), "Scale: 1.200");
  assert.equal(readout("scale", 2), "Scale X: 2.000  Y: 2.000  Z: 2.000");
});
