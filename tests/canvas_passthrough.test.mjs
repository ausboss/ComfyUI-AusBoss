import assert from "node:assert/strict";
import test from "node:test";

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canScrollFurther, dragCarriesFiles, graphDragStarts, isAppShortcut, keepKeyInField, panelKeepsWheel,
  panelNeedsDropHelp, panelRoot,
} from "../js/shared/canvas_passthrough.mjs";

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

test("only the pack's own panels count, in both node renderers", () => {
  const chain = (host, ...classes) => {
    let parent = host;
    return classes.map((className) => (parent = { className, parentElement: parent, closest: (sel) => (sel === ".dom-widget, .lg-node-widgets" ? host : null) }));
  };
  const widgetHost = { className: "dom-widget", parentElement: null };
  const [root, inner] = chain(widgetHost, "ausboss-compare-root h-full", "ausboss-compare-stage");
  assert.equal(panelRoot(inner), root, "classic node: the outermost ausboss- element");
  const vueHost = { className: "lg-node-widgets grid", parentElement: null };
  const [wrap, vueRoot, vueInner] = chain(vueHost, "flex flex-col", "ausboss-card", "ausboss-card-row");
  assert.equal(panelRoot(vueInner), vueRoot, "Nodes 2.0: past the frontend's own wrapper");
  assert.equal(wrap.className, "flex flex-col");
  const [foreign] = chain(widgetHost, "comfy-multiline-input");
  assert.equal(panelRoot(foreign), null, "core widget");
  assert.equal(panelRoot({ closest: () => null }), null, "not in a widget area");
  assert.equal(panelRoot(null), null);
});

test("a drag from the desktop carries files; a row dragged inside a panel does not", () => {
  assert.equal(dragCarriesFiles({ dataTransfer: { types: ["Files"] } }), true);
  assert.equal(dragCarriesFiles({ dataTransfer: { types: ["text/plain", "Files"] } }), true);
  assert.equal(dragCarriesFiles({ dataTransfer: { types: ["text/plain"] } }), false);
  assert.equal(dragCarriesFiles({ dataTransfer: { types: [] } }), false);
  assert.equal(dragCarriesFiles({ dataTransfer: {} }), false);
  assert.equal(dragCarriesFiles({}), false);
  assert.equal(dragCarriesFiles(null), false);
});

test("a dropped file needs handing to its node only on a classic panel of the pack", () => {
  // The frontend wraps a classic panel in a .dom-widget; in Nodes 2.0 the
  // panel sits in the node's own element, which hands a drop to the node.
  const inside = (hostClass, ...classes) => {
    const host = { className: hostClass, parentElement: null };
    const closest = (sel) => {
      if (sel === ".dom-widget, .lg-node-widgets") return host;
      if (sel === ".dom-widget") return hostClass.split(" ").includes("dom-widget") ? host : null;
      return null;
    };
    let parent = host;
    for (const className of classes) parent = { className, parentElement: parent, closest };
    return parent;
  };
  assert.equal(panelNeedsDropHelp(inside("dom-widget", "ausboss-transform-panel", "ausboss-transform-preview")), true, "classic: the picture");
  assert.equal(panelNeedsDropHelp(inside("dom-widget", "ausboss-card", "ausboss-card-row")), true, "classic: a card row");
  assert.equal(panelNeedsDropHelp(inside("lg-node-widgets grid", "flex", "ausboss-transform-panel", "ausboss-transform-preview")), false, "Nodes 2.0 hands it over itself");
  assert.equal(panelNeedsDropHelp(inside("dom-widget", "comfy-multiline-input")), false, "a core widget");
  assert.equal(panelNeedsDropHelp({ closest: () => null }), false, "the bare canvas");
  assert.equal(panelNeedsDropHelp(null), false);
});

test("the pack listens for drops before ComfyUI's own handler and only stops a drop a node took", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "js", "canvas_passthrough", "index.js"), "utf-8");
  assert.match(source, /addEventListener\("dragover", onDragOver, true\)/, "dragover must be allowed in the capture phase");
  assert.match(source, /addEventListener\("drop", onDrop, true\)/, "drop must be taken in the capture phase");
  const drop = source.slice(source.indexOf("async function onDrop"), source.indexOf("function onDragEnd"));
  assert.ok(drop.indexOf("if (!node) return;") < drop.indexOf("stopPropagation"), "a drop no node takes is left to ComfyUI");
  assert.match(drop, /app\.handleFile/, "a file the node refuses still goes to ComfyUI");
});

const key = (k, mods = {}) => {
  const event = { key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, stopped: false, ...mods };
  event.stopPropagation = () => { event.stopped = true; };
  return event;
};

test("app shortcuts are told apart from the keys a field types and edits with", () => {
  assert.equal(isAppShortcut(key("Enter", { ctrlKey: true })), true, "Ctrl + Enter queues a run");
  assert.equal(isAppShortcut(key("Enter", { metaKey: true })), true, "Cmd + Enter on a Mac");
  assert.equal(isAppShortcut(key("Enter", { ctrlKey: true, shiftKey: true })), true, "Ctrl + Shift + Enter queues in front");
  assert.equal(isAppShortcut(key("Enter", { ctrlKey: true, altKey: true })), true, "Ctrl + Alt + Enter interrupts");
  assert.equal(isAppShortcut(key("s", { ctrlKey: true })), true, "Ctrl + S saves the workflow");
  for (const k of ["a", "c", "v", "x", "z", "y", "A", "Z", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End"]) {
    assert.equal(isAppShortcut(key(k, { ctrlKey: true })), false, `Ctrl + ${k} edits the text`);
  }
  for (const k of ["a", "Enter", "Delete", "Backspace", "Escape", " ", "ArrowUp"]) {
    assert.equal(isAppShortcut(key(k)), false, `plain ${JSON.stringify(k)} is typing`);
    assert.equal(isAppShortcut(key(k, { shiftKey: true })), false, `Shift + ${JSON.stringify(k)} is typing`);
  }
  assert.equal(isAppShortcut(key("r", { altKey: true })), false, "Alt alone is not an app shortcut here");
});

test("a field keeps its own keys and lets app shortcuts through", () => {
  const typed = key("Delete");
  keepKeyInField(typed);
  assert.equal(typed.stopped, true, "Delete must not reach the canvas, it would delete the node");
  const selectAll = key("a", { ctrlKey: true });
  keepKeyInField(selectAll);
  assert.equal(selectAll.stopped, true, "Ctrl + A selects the text, not every node");
  const run = key("Enter", { ctrlKey: true });
  keepKeyInField(run);
  assert.equal(run.stopped, false, "Ctrl + Enter reaches ComfyUI and queues a run");
});

test("the fields on a node face pass app shortcuts on", () => {
  // Each of these stopped every key, so Ctrl + Enter did nothing while the
  // cursor was in a Text node, a number box or the Seed box (reported on the
  // Text node). A new field on a node face uses keepKeyInField too.
  const js = join(dirname(fileURLToPath(import.meta.url)), "..", "js");
  const fields = ["shared/widget_card.mjs", "shared/scrub_input.mjs", "seed/index.js", "save_image/index.js", "load_video/index.js", "lora_loader/index.js"];
  for (const file of fields) {
    const source = readFileSync(join(js, file), "utf-8");
    assert.match(source, /keepKeyInField\(event\)/, `${file}: its field stops every key again`);
  }
  for (const file of ["shared/widget_card.mjs", "shared/scrub_input.mjs"]) {
    const source = readFileSync(join(js, file), "utf-8");
    assert.doesNotMatch(source, /addEventListener\("keydown", \(event\) => \{\s*event\.stopPropagation\(\)/, `${file}: a keydown handler stops every key`);
  }
});

// Every inline keydown handler under js/, as { target, event, body }.
function keydownHandlers(source) {
  const found = [];
  const pattern = /([\w.$]+)\.addEventListener\(\s*"keydown",\s*\(?\s*(\w+)\s*\)?\s*=>\s*/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index + match[0].length;
    let end = start;
    if (source[start] === "{") {
      for (let depth = 0; end < source.length; end++) {
        if (source[end] === "{") depth++;
        else if (source[end] === "}" && --depth === 0) break;
      }
      found.push({ target: match[1], event: match[2], body: source.slice(start + 1, end) });
    } else {
      while (end < source.length && !"\n,;".includes(source[end])) end++;
      found.push({ target: match[1], event: match[2], body: source.slice(start, end) });
    }
  }
  return found;
}

// True when the handler stops a key before it has looked at which key it is:
// a stopPropagation() at the top of the handler with no early return ahead.
function stopsEveryKey({ event, body }) {
  let top = "";
  let depth = 0;
  for (const char of body.replace(/\/\/[^\n]*/g, "")) {
    if (char === "{") { if (depth++ === 0) top += "{}"; }
    else if (char === "}") depth--;
    else if (depth === 0) top += char;
  }
  const stop = top.search(new RegExp(`(^|[;{}])\\s*${event}\\.stopPropagation\\(\\)`));
  return stop >= 0 && !/\breturn\b/.test(top.slice(0, stop));
}

test("no keydown handler stops every key, outside the two dialogs that own the keyboard", () => {
  // A handler that stops a key before looking at it also stops Ctrl + Enter,
  // so the workflow does not run from that box. A box uses keepKeyInField.
  const js = join(dirname(fileURLToPath(import.meta.url)), "..", "js");
  const ownTheKeyboard = [
    "shared/discard_prompt.mjs backdrop", // the keep or discard question
    "workflow_note/index.js overlay", // the note editor: Ctrl + Enter saves the note
  ];
  const files = readdirSync(js, { recursive: true }).map(String).filter((file) => /\.m?js$/.test(file)).map((file) => file.replaceAll("\\", "/"));
  assert.ok(files.length > 40, "the scan found the pack's scripts");
  const found = [];
  let handlers = 0;
  for (const file of files) {
    for (const handler of keydownHandlers(readFileSync(join(js, file), "utf-8"))) {
      handlers++;
      if (stopsEveryKey(handler)) found.push(`${file} ${handler.target}`);
    }
  }
  assert.ok(handlers >= 20, "the scan read the keydown handlers");
  assert.deepEqual(found.sort(), ownTheKeyboard);
});

test("the scan tells a handler that stops every key from one that picks its keys", () => {
  const stops = (code) => keydownHandlers(code).map(stopsEveryKey);
  assert.deepEqual(stops(`box.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter") box.blur(); });`), [true]);
  assert.deepEqual(stops(`box.addEventListener("keydown", (event) => event.stopPropagation());`), [true]);
  assert.deepEqual(stops(`box.addEventListener("keydown", (event) => {\n  if (event.key === "Enter") { event.preventDefault(); save(); }\n  event.stopPropagation();\n});`), [true]);
  assert.deepEqual(stops(`box.addEventListener("keydown", (event) => { keepKeyInField(event); if (event.key === "Enter") box.blur(); });`), [false]);
  assert.deepEqual(stops(`window.addEventListener(\n  "keydown",\n  (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } },\n  { capture: true });`), [false]);
  assert.deepEqual(stops(`stage.addEventListener("keydown", (event) => {\n  if (!move(event.key)) return;\n  event.preventDefault();\n  event.stopPropagation();\n});`), [false]);
});
