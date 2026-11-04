import test from "node:test";
import assert from "node:assert/strict";

import {
  BRUSH_SIZE,
  ADJUST_DEAD_ZONE,
  adjustAxis,
  adjustedBrush,
  brushAdjusts,
  brushFlips,
  brushKey,
  brushProfile,
  brushReach,
  brushWords,
  clampBrushSize,
  clampSoft,
  moveAdjust,
  startAdjust,
  steppedBrushSize,
  steppedSoft,
  toolKey,
} from "../js/shared/brush.mjs";

const press = (flags = {}) => ({ button: 0, ctrlKey: false, altKey: false, shiftKey: false, ...flags });

test("Ctrl or the right button does the opposite of the chosen tool", () => {
  assert.equal(brushFlips(press()), false);
  assert.equal(brushFlips(press({ ctrlKey: true })), true);
  assert.equal(brushFlips(press({ button: 2 })), true);
  // Alt alone is not a second key for the same thing.
  assert.equal(brushFlips(press({ altKey: true })), false);
  assert.equal(brushFlips(press({ shiftKey: true })), false);
});

test("Alt with the right button sets the brush, and is no stroke", () => {
  assert.equal(brushAdjusts(press({ altKey: true, button: 2 })), true);
  // On a Mac a click with Control held is the right button.
  assert.equal(brushAdjusts(press({ altKey: true, ctrlKey: true })), true);
  assert.equal(brushAdjusts(press({ altKey: true })), false);
  assert.equal(brushAdjusts(press({ button: 2 })), false);
  assert.equal(brushFlips(press({ altKey: true, button: 2 })), false, "the drag that sets the brush flips nothing");
});

test("[ and ] are the size, with Shift the edge", () => {
  assert.deepEqual(brushKey({ key: "]", code: "BracketRight" }), { what: "size", up: true });
  assert.deepEqual(brushKey({ key: "[", code: "BracketLeft" }), { what: "size", up: false });
  // With Shift the keys type { and }: softer is the left one, as in Photoshop.
  assert.deepEqual(brushKey({ key: "{", code: "BracketLeft", shiftKey: true }), { what: "soft", up: true });
  assert.deepEqual(brushKey({ key: "}", code: "BracketRight", shiftKey: true }), { what: "soft", up: false });
  // A keyboard that has the brackets somewhere else still works by the letter.
  assert.deepEqual(brushKey({ key: "]", code: "Digit9" }), { what: "size", up: true });
  assert.equal(brushKey({ key: "a", code: "KeyA" }), null);
});

test("a node may keep its brush in a narrower range", () => {
  const range = [4, 1000];
  assert.equal(clampBrushSize(1, range), 4);
  assert.equal(clampBrushSize(5000, range), 1000);
  assert.equal(clampBrushSize(5000), BRUSH_SIZE[1]);
  assert.equal(steppedBrushSize(1000, true, range), 1000);
  assert.equal(steppedBrushSize(100, true, range), 120);
  assert.deepEqual(adjustedBrush({ size: 900, soft: 0 }, "size", 400, 0, 1, range), { size: 1000, soft: 0 });
  // A drag started with a range keeps to it as it turns.
  let drag = startAdjust(0, 0, { size: 900, soft: 0 }, range);
  drag = moveAdjust(drag, 300, 0);
  assert.deepEqual(drag.brush, { size: 1000, soft: 0 });
  // Turning up sets the edge from where the drag turned.
  drag = moveAdjust(drag, 300, -20);
  drag = moveAdjust(drag, 300, -60);
  assert.equal(drag.axis, "soft");
  assert.equal(drag.brush.size, 1000);
  assert.ok(drag.brush.soft > 0 && drag.brush.soft <= 30, `soft ${drag.brush.soft}`);
});

test("a brush that was never set soft is hard where a node says so", () => {
  assert.equal(clampSoft(undefined, 0), 0);
  assert.equal(clampSoft(undefined), 50);
  assert.equal(clampSoft(120, 0), 100);
});

test("the brush in words", () => {
  assert.deepEqual(brushWords(46, 25), ["Size 46 px", "Soft 25%"]);
});

test("W, B and E pick the tool, as in Photoshop", () => {
  assert.equal(toolKey({ key: "w", code: "KeyW" }), "pick");
  assert.equal(toolKey({ key: "B", code: "KeyB", shiftKey: true }), "paint");
  assert.equal(toolKey({ key: "e", code: "KeyE" }), "erase");
  // A keyboard whose letters are not Latin: by the key's place.
  assert.equal(toolKey({ key: "\u0443", code: "KeyE" }), "erase");
  // With Ctrl, Alt or Cmd the letter is someone else's shortcut.
  for (const flag of ["ctrlKey", "altKey", "metaKey"]) assert.equal(toolKey({ key: "b", code: "KeyB", [flag]: true }), null);
  assert.equal(toolKey({ key: "q", code: "KeyQ" }), null);
});

test("the brush under the pointer fades as its marks do", () => {
  // Hard: solid out to the ring, nothing past it.
  assert.equal(brushProfile(39.9, 80, 0), 1);
  assert.equal(brushProfile(40.1, 80, 0), 0);
  assert.equal(brushReach(80, 0), 40);
  // Soft: solid in the middle, half at the rim of the solid middle, nearly gone at the reach.
  assert.ok(brushProfile(0, 80, 1) > 0.95);
  assert.ok(Math.abs(brushProfile(20, 80, 1) - 0.5) < 0.01);
  assert.ok(brushProfile(brushReach(80, 1), 80, 1) < 0.01);
  for (let d = 0; d < 50; d += 5) assert.ok(brushProfile(d, 80, 0.6) >= brushProfile(d + 5, 80, 0.6), "never brighter further out");
});

test("brush values round, clamp and fall back without producing NaN", () => {
  assert.equal(clampBrushSize("25.6"), 26);
  assert.equal(clampBrushSize(1), BRUSH_SIZE[0]);
  for (const value of [undefined, "large", NaN, Infinity, -Infinity]) {
    assert.equal(clampBrushSize(value, [4, 1000]), 4);
    assert.equal(clampSoft(value, 20), 20);
  }
  assert.equal(clampSoft("24.6"), 25);
  assert.equal(clampSoft(-5), 0);
  assert.equal(clampSoft(101), 100);
  assert.equal(clampSoft(undefined, 120), 100);
});

test("brush keys change small sizes by at least two pixels and stop at the bounds", () => {
  assert.equal(steppedBrushSize(2, true), 4);
  assert.equal(steppedBrushSize(4, false), 2);
  assert.equal(steppedBrushSize(2, false), 2);
  assert.equal(steppedBrushSize(100, false), 84);
  assert.equal(steppedBrushSize(2000, true), 2000);
  assert.equal(steppedSoft(50, true), 75);
  assert.equal(steppedSoft(50, false), 25);
  assert.equal(steppedSoft(90, true), 100);
  assert.equal(steppedSoft(10, false), 0);
});

test("brush adjustment starts at the dead-zone boundary and breaks diagonal ties by size", () => {
  const edge = ADJUST_DEAD_ZONE;
  assert.equal(adjustAxis(edge - 1, -(edge - 1)), null);
  for (const direction of [-1, 1]) {
    assert.equal(adjustAxis(direction * edge, 0), "size");
    assert.equal(adjustAxis(0, direction * edge), "soft");
    assert.equal(adjustAxis(direction * edge, -edge), "size");
  }
});

test("a tiny blur keeps the hard-brush edge, while a soft brush scales with its size", () => {
  // Below a quarter pixel of blur the preview uses a solid disc.
  assert.equal(brushProfile(1, 2, 0.5), 1);
  assert.equal(brushProfile(1.01, 2, 0.5), 0);
  assert.equal(brushReach(2, 0.5), 1);
  for (const soft of [0.25, 0.5, 1]) {
    assert.equal(brushReach(160, soft), 2 * brushReach(80, soft));
    for (const distance of [0, 10, 20, 40, 80]) {
      const value = brushProfile(distance, 80, soft);
      assert.ok(value >= 0 && value <= 1);
      assert.equal(brushProfile(distance * 2, 160, soft), value);
    }
  }
});
