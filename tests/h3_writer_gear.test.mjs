import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { LONGEST_ASK, editedAsks, readAsks, writeAsks } from "../js/shared/h3_writer_gear_math.mjs";

test("an empty or broken model_asks reads as no wording of the node's own", () => {
  for (const value of ["", undefined, "nope", "[1]", '{"next": 3}']) assert.deepEqual(readAsks(value), {});
  assert.deepEqual(readAsks('{"next": "Write {count}.", "other": "x", "heard": "  "}'), { next: "Write {count}." });
});

test("saving a wording keeps the others, and an empty one goes back to built-in", () => {
  const one = writeAsks("", "next", "Write {count}.");
  assert.equal(one, '{"next":"Write {count}."}');
  const two = writeAsks(one, "tidy", "Be brief.");
  assert.deepEqual(JSON.parse(two), { next: "Write {count}.", tidy: "Be brief." });
  assert.deepEqual(JSON.parse(writeAsks(two, "next", "   ")), { tidy: "Be brief." });
  assert.equal(writeAsks(writeAsks(two, "next", ""), "tidy", ""), "");
});

test("the menu marks the wordings the node has changed", () => {
  assert.deepEqual([...editedAsks('{"describe": "x", "tidy": "y"}')].sort(), ["describe", "tidy"]);
  assert.equal(editedAsks("").size, 0);
});

test("the editor's longest wording is the one the writer reads", async () => {
  const { readFileSync } = await import("node:fs");
  const python = readFileSync(new URL("../nodes/_h3_model_asks.py", import.meta.url), "utf8");
  assert.equal(LONGEST_ASK, Number(python.match(/LONGEST_ASK = (\d+)/)[1]));
});

test("a wording that drops a name the writer fills in, or adds one it does not, is called out", async () => {
  const { wordingWarning } = await import("../js/shared/h3_writer_gear_math.mjs");
  const heard = "This happens in a video:\n{lines}\n\nList the sounds.";
  const next = "This is a {seconds} second video.\nFirst this happens: {first}\n\nWrite {count} short lines.";
  assert.equal(wordingWarning("heard", "Where is this?\n{lines}\nName the steady sounds.", heard), "");
  assert.equal(wordingWarning("heard", "Name the steady sounds.", heard), "Without {lines}, the model is not told what happens in the clip.");
  assert.equal(
    wordingWarning("next", "A {seconds} second video. Write {count} lines.", next),
    "Without {first}, the model is not told what happens first.",
  );
  assert.equal(
    wordingWarning("heard", "In the clip: {line}. Name the sounds.", heard),
    "Without {lines}, the model is not told what happens in the clip. {line} is not filled in: the model reads it as typed.",
  );
  assert.equal(wordingWarning("describe", "Describe {who}.", "Describe the person."), "{who} is not filled in: the model reads it as typed.");
  assert.equal(wordingWarning("tidy", "Keep it short.", "Tidy the lines."), "");
});

// The gear itself, with only ComfyUI and the page replaced: the menu's Reset,
// and the editor's Escape and Save.
class Element {
  constructor(tag) {
    Object.assign(this, { tag, children: [], parent: null, listeners: {}, removed: false, value: "", title: "", className: "", textContent: "" });
    const names = new Set();
    this.classList = { toggle: (name, on) => (on ? names.add(name) : names.delete(name)), contains: (name) => names.has(name) };
    this.style = {};
  }
  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  set innerHTML(_html) {}
  all() {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  querySelectorAll(selector) {
    const tags = selector.split(",").map((part) => part.trim());
    return this.all().filter((element) => element !== this && tags.includes(element.tag));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20 };
  }
}

async function fire(element, type, extra = {}) {
  const event = { type, target: element, preventDefault() {}, stopPropagation() {}, ...extra };
  const waits = [];
  for (let at = element; at; at = at.parent) for (const listener of at.listeners[type] ?? []) waits.push(listener(event));
  await Promise.all(waits);
}

// Each load is a module of its own, so one test's stand-ins never leak into the next.
let loads = 0;
async function loadGear({ asks = "", showAll = false } = {}) {
  const realDocument = globalThis.document;
  const body = new Element("body");
  globalThis.document = { body, head: new Element("head"), activeElement: null, getElementById: () => null, createElement: (tag) => new Element(tag) };
  const settings = { "AusBoss.H3PromptWriter.ShowEverySocket": showAll };
  const menus = [];
  const toasts = [];
  const written = [];
  let closed = 0;
  globalThis.__gearTest = {
    api: { fetchApi: async () => ({ ok: true, json: async () => ({ describe: "Describe the person.", next: "Write {count} lines after {first}, in {seconds} s.", heard: "In the clip:\n{lines}\nName the sounds.", tidy: "Tidy the lines." }) }) },
    app: { extensionManager: { setting: { get: (key) => settings[key], set: (key, value) => { settings[key] = value; } } } },
    openSettingsMenu: (options) => menus.push(options),
    closeSettingsMenu: () => { closed += 1; },
    showToast: (toast) => toasts.push(toast),
  };
  let source = readFileSync(new URL("../js/shared/h3_writer_gear.mjs", import.meta.url), "utf8");
  source = source.replace(/^import .*;$/gm, (line) => {
    if (/h3_writer_gear_math|h3_sockets|theme/.test(line)) {
      return line.replace(/"\.\/(.*?)"/, (_match, file) => JSON.stringify(new URL(`../js/shared/${file}`, import.meta.url).href));
    }
    if (line.includes("api.js")) return "const { api } = globalThis.__gearTest;";
    if (line.includes("app.js")) return "const { app } = globalThis.__gearTest;";
    if (line.includes("settings_menu.mjs")) return "const { openSettingsMenu, closeSettingsMenu } = globalThis.__gearTest; const gearIconSvg = () => '';";
    if (line.includes("index.mjs")) return "const { showToast } = globalThis.__gearTest;";
    throw new Error(`Unmocked import ${line}`);
  });
  source += `\n// load ${(loads += 1)}`;
  const { writerGear } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const values = { model_asks: asks };
  const card = {
    values: () => ({ ...values }),
    setWidget: (name, value) => { values[name] = value; written.push([name, value]); },
    refresh() {},
  };
  const gear = writerGear({ id: 1 }, card).element;
  const open = async () => { await fire(gear, "click"); return menus.at(-1); };
  const editor = async (key) => {
    const menu = await open();
    await menu.schema.find((entry) => entry.key === `ask_${key}`).onAction();
    const back = body.children.at(-1);
    const find = (tag, text) => back.all().find((element) => element.tag === tag && (text === undefined || element.textContent === text));
    return { back, area: find("textarea"), state: back.all().find((element) => element.className.startsWith("state")), find };
  };
  const restore = () => {
    globalThis.document = realDocument;
    delete globalThis.__gearTest;
  };
  return { settings, menus, toasts, written, values, open, editor, restore, closed: () => closed };
}

test("Reset in the gear puts the sockets and every wording back, and says how to undo it", async () => {
  const gear = await loadGear({ asks: '{"heard": "Mine: {lines}"}', showAll: true });
  try {
    const menu = await gear.open();
    assert.equal(menu.initial.sockets, "all");
    menu.onChange({ sockets: "all" }, null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(gear.settings["AusBoss.H3PromptWriter.ShowEverySocket"], false);
    assert.deepEqual(gear.written, [["model_asks", ""]]);
    assert.match(gear.toasts[0]?.detail ?? "", /built-in/);
    assert.match(gear.toasts[0]?.detail ?? "", /Ctrl\+Z/);
    const shown = gear.menus.at(-1);
    assert.notEqual(shown, menu);
    assert.equal(shown.initial.sockets, "in use");
    assert.equal(shown.schema.find((entry) => entry.key === "ask_heard").hint, "Built-in wording.");
  } finally {
    gear.restore();
  }
});

test("Reset with nothing edited changes no wording and says nothing", async () => {
  const gear = await loadGear();
  try {
    (await gear.open()).onChange({ sockets: "in use" }, null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(gear.written, []);
    assert.deepEqual(gear.toasts, []);
  } finally {
    gear.restore();
  }
});

test("Escape over typing that is not saved asks once before it closes the editor", async () => {
  const gear = await loadGear();
  try {
    const { back, area, state } = await gear.editor("heard");
    await fire(area, "keydown", { key: "Escape" });
    assert.equal(back.removed, true, "nothing typed: Escape closes at once");
    const again = await gear.editor("heard");
    again.area.value = "Mine: {lines}";
    await fire(again.area, "input");
    await fire(again.area, "keydown", { key: "Escape" });
    assert.equal(again.back.removed, false);
    assert.match(again.state.textContent, /Esc again/);
    await fire(again.area, "keydown", { key: "Escape" });
    assert.equal(again.back.removed, true);
    assert.deepEqual(gear.written, []);
    void state;
  } finally {
    gear.restore();
  }
});

test("a click outside the editor over unsaved typing asks first too", async () => {
  const gear = await loadGear();
  try {
    const { back, area } = await gear.editor("tidy");
    area.value = "Keep it short.";
    await fire(area, "input");
    await fire(back, "pointerdown");
    assert.equal(back.removed, false);
    await fire(back, "pointerdown");
    assert.equal(back.removed, true);
    assert.deepEqual(gear.written, []);
  } finally {
    gear.restore();
  }
});

test("Save over a wording that drops {lines} says so first, and saves on the second press", async () => {
  const gear = await loadGear();
  try {
    const { back, area, state, find } = await gear.editor("heard");
    area.value = "Name the steady sounds.";
    await fire(area, "input");
    const save = find("button", "Save");
    await fire(save, "click");
    assert.deepEqual(gear.written, []);
    assert.equal(back.removed, false);
    assert.match(state.textContent, /Without \{lines\}/);
    assert.equal(save.textContent, "Save anyway");
    await fire(save, "click");
    assert.deepEqual(gear.written, [["model_asks", '{"heard":"Name the steady sounds."}']]);
    assert.equal(back.removed, true);
  } finally {
    gear.restore();
  }
});

test("Save over an empty wording goes back to built-in without asking", async () => {
  const gear = await loadGear({ asks: '{"heard": "Mine: {lines}"}' });
  try {
    const { back, area, find } = await gear.editor("heard");
    area.value = "  ";
    await fire(area, "input");
    await fire(find("button", "Save"), "click");
    assert.deepEqual(gear.written, [["model_asks", ""]]);
    assert.equal(back.removed, true);
  } finally {
    gear.restore();
  }
});
