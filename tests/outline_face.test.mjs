import assert from "node:assert/strict";
import test from "node:test";

import { outlineOf } from "../js/shared/outline.mjs";

// A frameless tile draws a card inside a transparent node. Snap into line and
// Line up must use the card people see, not the node's wider bounds.
const canvas = {
  canvas: { getBoundingClientRect: () => ({ left: 10, top: 20 }) },
  ds: { scale: 2, offset: [5, 5] },
};
const card = (rect) => ({ isConnected: true, getBoundingClientRect: () => rect });

test("a tile's outline is its visible card", () => {
  const node = {
    boundingRect: [100, 100, 380, 80],
    ausbossOutlineElement: card({ left: 10 + 2 * (114 + 5), top: 20 + 2 * (114 + 5), width: 704, height: 100 }),
  };
  assert.deepEqual(outlineOf(node, canvas), { x: 114, y: 114, w: 352, h: 50 });
});

test("a collapsed or unshown tile falls back to the node's bounds", () => {
  const bounds = { x: 100, y: 100, w: 380, h: 80 };
  const shown = card({ left: 0, top: 0, width: 50, height: 50 });
  assert.deepEqual(outlineOf({ boundingRect: [100, 100, 380, 80], flags: { collapsed: true }, ausbossOutlineElement: shown }, canvas), bounds);
  const hidden = card({ left: 0, top: 0, width: 0, height: 0 });
  assert.deepEqual(outlineOf({ boundingRect: [100, 100, 380, 80], ausbossOutlineElement: hidden }, canvas), bounds);
  assert.deepEqual(outlineOf({ boundingRect: [100, 100, 380, 80] }, canvas), bounds);
});
