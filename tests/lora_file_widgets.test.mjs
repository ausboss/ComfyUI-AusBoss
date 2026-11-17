import test from "node:test";
import assert from "node:assert/strict";

import {
  FILE_WIDGET_PREFIX,
  coreLoraList,
  fileChoices,
  isFileWidget,
  rowsNeedingFiles,
  syncFileWidgets,
} from "../js/shared/lora_file_widgets.mjs";

// A node the way LiteGraph hands it over: addWidget appends and returns.
function fakeNode() {
  return {
    widgets: [{ name: "loras", type: "customtext", value: "[]" }],
    addWidget(type, name, value, callback, options) {
      const widget = { type, name, value, callback, options };
      this.widgets.push(widget);
      return widget;
    },
  };
}

const row = (id, name, extra = {}) => ({ id, name, strength: 1, strength_clip: 1, enabled: true, ...extra });
const choices = (widget) => widget.options.values(widget);

test("only rows the server would load need a file", () => {
  const rows = [
    row("a", "pika.safetensors"),
    row("b", ""),
    row("c", "off.safetensors", { enabled: false }),
    row("d", "group_off.safetensors", { group: "g", group_off: true }),
    row("e", "zero.safetensors", { strength: 0, strength_clip: 0 }),
    row("f", "clip_only.safetensors", { strength: 0, strength_clip: 0.5 }),
  ];
  assert.deepEqual(rowsNeedingFiles(rows).map((item) => item.id), ["a", "f"]);
});

test("a file the loader would find anyway is not missing", () => {
  const installed = ["minimax-h3/pika.safetensors", "style.safetensors"];
  assert.ok(fileChoices("minimax-h3/pika.safetensors", installed).includes("minimax-h3/pika.safetensors"));
  // saved as a bare name, installed in a subfolder: the loader finds it
  assert.ok(fileChoices("pika.safetensors", installed).includes("pika.safetensors"));
  assert.ok(fileChoices("STYLE.safetensors", installed).includes("STYLE.safetensors"));
  assert.ok(!fileChoices("gone.safetensors", installed).includes("gone.safetensors"));
  // no list to ask: never a false alarm
  assert.deepEqual(fileChoices("gone.safetensors", null), ["gone.safetensors"]);
});

test("the install's list comes from ComfyUI's own LoRA loader", () => {
  assert.deepEqual(coreLoraList({ input: { required: { lora_name: [["a.safetensors"], { tooltip: "x" }] } } }), ["a.safetensors"]);
  assert.deepEqual(coreLoraList({ input: { required: { lora_name: ["COMBO", { options: ["b.safetensors"] }] } } }), ["b.safetensors"]);
  assert.equal(coreLoraList(undefined), null);
  assert.equal(coreLoraList({ input: { required: {} } }), null);
});

test("one hidden list per needed row, out of the save and the prompt", () => {
  const node = fakeNode();
  const hidden = [];
  const changed = syncFileWidgets(node, [row("a", "pika.safetensors"), row("b", "")], {
    installed: () => [],
    hide: (widget) => hidden.push(widget),
  });
  assert.equal(changed, true);
  const files = node.widgets.filter(isFileWidget);
  assert.equal(files.length, 1);
  const [widget] = files;
  assert.equal(widget.type, "combo");
  assert.equal(widget.name, `${FILE_WIDGET_PREFIX}1`);
  assert.equal(widget.value, "pika.safetensors");
  assert.equal(widget.serialize, false);
  assert.equal(widget.options.serialize, false);
  assert.deepEqual(hidden, [widget]);
  // ComfyUI's check: a value that is not among the choices is a missing model
  assert.ok(!choices(widget).includes(widget.value));
  // the loras text keeps its place in front
  assert.equal(node.widgets[0].name, "loras");
});

test("the lists follow the rows: renamed, added, removed", () => {
  const node = fakeNode();
  const options = { installed: () => ["here.safetensors"], hide: () => {} };
  syncFileWidgets(node, [row("a", "one.safetensors"), row("b", "two.safetensors")], options);
  const first = node.widgets.filter(isFileWidget)[0];
  assert.equal(syncFileWidgets(node, [row("a", "here.safetensors"), row("b", "two.safetensors")], options), false);
  assert.equal(node.widgets.filter(isFileWidget)[0], first, "the same widget is reused");
  assert.equal(first.value, "here.safetensors");
  assert.ok(choices(first).includes("here.safetensors"));
  assert.equal(syncFileWidgets(node, [row("b", "two.safetensors")], options), true);
  assert.deepEqual(node.widgets.filter(isFileWidget).map((widget) => [widget.value, widget.ausbossRowId]), [["two.safetensors", "b"]]);
  syncFileWidgets(node, [], options);
  assert.equal(node.widgets.filter(isFileWidget).length, 0);
  assert.deepEqual(node.widgets.map((widget) => widget.name), ["loras"]);
});

test("a replacement put in the list goes to its row", () => {
  const node = fakeNode();
  const picks = [];
  syncFileWidgets(node, [row("a", "one.safetensors"), row("b", "gone.safetensors")], {
    installed: () => ["new.safetensors"],
    hide: () => {},
    onPick: (rowId, name) => picks.push([rowId, name]),
  });
  const widget = node.widgets.filter(isFileWidget)[1];
  // what ComfyUI's Issues panel does: set the value, then call back
  widget.value = "new.safetensors";
  widget.callback("new.safetensors");
  // a call back with the row's own file is no change
  node.widgets.filter(isFileWidget)[0].callback("one.safetensors");
  assert.deepEqual(picks, [["b", "new.safetensors"]]);
});
