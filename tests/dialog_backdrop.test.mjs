import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { closeOnBackdropClick, pointOutside } from "../js/shared/dialog_backdrop.mjs";

// A stand-in for a modal <dialog>: a box from (100, 100) to (500, 400) with
// one child, the card's content.
function fakeDialog() {
  const dialog = new EventTarget();
  dialog.closed = 0;
  dialog.close = () => { dialog.closed += 1; };
  dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400 });
  const child = new EventTarget();
  closeOnBackdropClick(dialog);
  return { dialog, child };
}

// Events fired at the dialog itself, with the target the browser would give.
function fire(dialog, type, target, x, y) {
  const event = new Event(type);
  Object.defineProperties(event, {
    target: { value: target },
    clientX: { value: x },
    clientY: { value: y },
  });
  dialog.dispatchEvent(event);
}

function click(dialog, down, up) {
  fire(dialog, "pointerdown", down.target, down.x, down.y);
  fire(dialog, "click", up.target, up.x, up.y);
}

test("pointOutside is true only beyond the box", () => {
  const rect = { left: 10, top: 10, right: 20, bottom: 20 };
  assert.equal(pointOutside(rect, 15, 15), false);
  assert.equal(pointOutside(rect, 10, 20), false);
  assert.equal(pointOutside(rect, 9, 15), true);
  assert.equal(pointOutside(rect, 15, 21), true);
});

test("a click on the backdrop closes the popup", () => {
  const { dialog } = fakeDialog();
  click(dialog, { target: dialog, x: 40, y: 40 }, { target: dialog, x: 40, y: 40 });
  assert.equal(dialog.closed, 1);
});

test("a click inside the card keeps it open", () => {
  const { dialog, child } = fakeDialog();
  click(dialog, { target: child, x: 200, y: 200 }, { target: child, x: 200, y: 200 });
  // The card's own padding and scroll bar are the dialog element itself.
  click(dialog, { target: dialog, x: 495, y: 200 }, { target: dialog, x: 495, y: 200 });
  assert.equal(dialog.closed, 0);
});

test("selecting text or dragging out of the card keeps it open", () => {
  const { dialog, child } = fakeDialog();
  // The browser sends the click to the dialog, the common parent.
  click(dialog, { target: child, x: 200, y: 200 }, { target: dialog, x: 40, y: 40 });
  assert.equal(dialog.closed, 0);
  // A press on the backdrop that ends on the card does not close it either.
  click(dialog, { target: dialog, x: 40, y: 40 }, { target: dialog, x: 200, y: 200 });
  assert.equal(dialog.closed, 0);
  // A click with no press before it (a key on a focused button) is not outside.
  fire(dialog, "click", dialog, 40, 40);
  assert.equal(dialog.closed, 0);
});

test("the Workflow Note popup closes on a backdrop click", () => {
  const source = readFileSync(new URL("../js/workflow_note/index.js", import.meta.url), "utf8");
  const reader = source.slice(source.indexOf('el("dialog", "ausboss-note-reader")'), source.indexOf("dialog.showModal()"));
  assert.match(reader, /closeOnBackdropClick\(dialog\)/);
});
