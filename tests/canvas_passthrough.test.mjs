import assert from "node:assert/strict";
import test from "node:test";

import { canScrollFurther, graphDragStarts, panelKeepsWheel, panelRoot } from "../js/shared/canvas_passthrough.mjs";

const box = (over = {}) => ({ scrollHeight: 300, clientHeight: 100, scrollTop: 0, ...over });

test("a box that can still scroll the way the wheel turns keeps the wheel", () => {
  assert.equal(canScrollFurther(box(), 100), true, "at the top, wheel down");
  assert.equal(canScrollFurther(box(), -100), false, "at the top, wheel up");
  assert.equal(canScrollFurther(box({ scrollTop: 200 }), 100), false, "at the bottom, wheel down");
  assert.equal(canScrollFurther(box({ scrollTop: 200 }), -100), true, "at the bottom, wheel up");
  assert.equal(canScrollFurther(box({ scrollHeight: 100 }), 100), false, "nothing to scroll");
  assert.equal(canScrollFurther(null, 100), false);
});

test("the graph gets the wheel unless the panel has a use for it", () => {
  const root = { tagName: "DIV", parentElement: null };
  const stage = { tagName: "DIV", parentElement: root };
  const list = { tagName: "DIV", parentElement: root, ...box() };
  const field = { tagName: "INPUT", parentElement: root };
  const styleOf = (el) => ({ overflowY: el === list ? "auto" : "visible" });
  const ctx = (extra = {}) => ({ root, styleOf, activeElement: null, ...extra });
  assert.equal(panelKeepsWheel(stage, { deltaY: -100 }, ctx()), false, "plain picture stage");
  assert.equal(panelKeepsWheel(list, { deltaY: 100 }, ctx()), true, "list with room to scroll");
  assert.equal(panelKeepsWheel(list, { deltaY: -100 }, ctx()), false, "list at its top, wheel up zooms");
  assert.equal(panelKeepsWheel(field, { deltaY: 100 }, ctx()), false, "idle field");
  assert.equal(panelKeepsWheel(field, { deltaY: 100 }, ctx({ activeElement: field })), true, "field being typed in");
});

test("middle button and Ctrl+Shift drag go to the graph; ordinary clicks do not", () => {
  const on = { dragZoomEnabled: true };
  assert.equal(graphDragStarts({ button: 1, buttons: 4 }, on), true);
  assert.equal(graphDragStarts({ button: 0, buttons: 1, ctrlKey: true, shiftKey: true }, on), true);
  assert.equal(graphDragStarts({ button: 0, buttons: 1, ctrlKey: true, shiftKey: true }, { dragZoomEnabled: false }), false, "shortcut switched off");
  assert.equal(graphDragStarts({ button: 0, buttons: 1, ctrlKey: true, shiftKey: true, altKey: true }, on), false);
  assert.equal(graphDragStarts({ button: 0, buttons: 1 }, on), false, "a plain click is the panel's");
  assert.equal(graphDragStarts({ button: 0, buttons: 1, ctrlKey: true }, on), false);
});

test("only the pack's own panels count", () => {
  const root = { className: "ausboss-compare-root h-full", contains: (el) => el === inner || el === root };
  const inner = { closest: (sel) => (sel === ".dom-widget" ? { firstElementChild: root } : null) };
  assert.equal(panelRoot(inner), root);
  const foreign = { className: "comfy-multiline-input", contains: () => true };
  assert.equal(panelRoot({ closest: () => ({ firstElementChild: foreign }) }), null, "core widget");
  assert.equal(panelRoot({ closest: () => null }), null, "not in a DOM widget");
  assert.equal(panelRoot(null), null);
});
