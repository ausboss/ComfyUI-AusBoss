// Cards and panels are not saved values, and older saves still carry one.
//
// The frontend saves every widget whose own `serialize` is not false into
// widgets_values, and hands saved values back by position when a workflow
// opens. `options.serialize = false` only keeps a widget out of the queued
// prompt, so until this pack set `widget.serialize = false` on its cards and
// panels, each of them saved an empty value of its own after the node's real
// values. An input appended to the node since then sits where that empty
// value was: Stitch Inpaint's seam and Crop For Inpaint's keep_inside both
// opened empty from older saves.
//
// This test is policy:
//   1. every DOM widget in the pack is left out of saved workflows;
//   2. the shipped examples, saved with the old layout, still hand every real
//      widget its own value when the cards and panels are skipped;
//   3. an input added to a node whose older saves end in such a value is
//      declared below, and a widget input gets a fallback that fires.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resetUnknownValues } from "../js/shared/widget_card_math.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JS_ROOT = join(ROOT, "js");

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.m?js$/.test(name)) files.push(path);
  }
  return files;
}

// ---------- 1. DOM widgets stay out of saved workflows ----------

test("every DOM widget is left out of saved workflows", () => {
  let calls = 0;
  for (const path of walk(JS_ROOT)) {
    const source = readFileSync(path, "utf-8");
    const file = path.slice(JS_ROOT.length + 1);
    for (const match of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\w+\.addDOMWidget\(/g)) {
      calls += 1;
      const name = match[1];
      // The flag must follow before the file creates its next DOM widget.
      const after = source.slice(match.index + match[0].length);
      const next = after.indexOf("addDOMWidget(");
      const scope = next < 0 ? after : after.slice(0, next);
      assert.match(
        scope,
        new RegExp(`\\b${name}\\.serialize = false;`),
        `${file}: ${name} = addDOMWidget(...) is saved with the workflow - set ${name}.serialize = false `
          + "right after it (options.serialize only keeps it out of the prompt)",
      );
    }
    // A DOM widget created without a name to flag cannot be checked.
    const unnamed = [...source.matchAll(/\.addDOMWidget\(/g)].length
      - [...source.matchAll(/(?:const|let)\s+\w+\s*=\s*\w+\.addDOMWidget\(/g)].length;
    assert.equal(unnamed, 0, `${file}: addDOMWidget called without keeping the widget in a variable`);
  }
  assert.ok(calls >= 15, `expected the pack's DOM widgets, found ${calls}`);
});

// ---------- 2. the shipped examples still restore every value ----------

// A card or panel in a named copy: the pack's own name, saved as "".
const isPlaceholder = (key, value) => key.startsWith("ausboss_") && (value === "" || value === null);

function exampleNodes() {
  const dir = join(ROOT, "example_workflows");
  const nodes = [];
  for (const name of readdirSync(dir).filter((item) => item.endsWith(".json")).sort()) {
    const graph = JSON.parse(readFileSync(join(dir, name), "utf-8"));
    const all = [...(graph.nodes ?? []), ...(graph.definitions?.subgraphs ?? []).flatMap((sub) => sub.nodes ?? [])];
    for (const node of all) nodes.push({ file: name, node });
  }
  return nodes;
}

test("the examples hand every widget its own value with the cards and panels skipped", () => {
  let checked = 0;
  for (const { file, node } of exampleNodes()) {
    const values = node.widgets_values;
    const named = node.widgets_values_named;
    // A dict save restores by name, and a save with no named copy says
    // nothing about which slot was a panel.
    if (!Array.isArray(values) || !named || typeof named !== "object") continue;
    const keys = Object.keys(named);
    const real = keys.filter((key) => !isPlaceholder(key, named[key]));
    if (real.length === keys.length) continue;
    checked += 1;
    // Skipping the cards and panels moves nothing only while they all come
    // after the real values.
    const firstPlaceholder = keys.findIndex((key) => isPlaceholder(key, named[key]));
    assert.ok(
      keys.slice(firstPlaceholder).every((key) => isPlaceholder(key, named[key])),
      `${file}: ${node.type} ${node.id} saved a panel before a real value: ${keys.join(", ")}`,
    );
    real.forEach((key, index) => {
      assert.deepEqual(values[index], named[key], `${file}: ${node.type} ${node.id} ${key} would load another value`);
    });
  }
  assert.ok(checked >= 10, `expected examples saved with cards and panels, found ${checked}`);
});

// ---------- 3. inputs added since a node's saves began ending in a placeholder ----------

// Workflows saved before the cards and panels stopped saving end each of
// these nodes' widget values with an empty value per card or panel: since
// 1.1.0 for the preview, LoRA, pad and Compare panels (1.2.0 for Select
// Frame and Show Text), since 2.0.0 for the cards and the other panels, and
// since 2.3.0 for Realign to Source. Replaying every release from 1.0.0
// against today's inputs found the inputs added since; APPENDED_SINCE
// declares them. The input listed here is the node's last one when this
// guard began, so any input after it is new and must be declared as well.
// Frozen history: a node added later never saved such a value. The
// widget_kv nodes (Load Video, Save Video, Save Image and the three Crop +
// Rotate + Pad nodes) save by name and are not listed.
const LAST_GUARDED_INPUT = {
  AUSBOSS_NODES_AlignImage: "pad_color",
  AUSBOSS_NODES_ColorMatch: "reference_mode",
  AUSBOSS_NODES_Compare: "image_b",
  AUSBOSS_NODES_CropForInpaint: "keep_inside",
  AUSBOSS_NODES_Float: "value",
  AUSBOSS_NODES_FrameInterpolate: "batch_size",
  AUSBOSS_NODES_ImageResize: "mask",
  AUSBOSS_NODES_Integer: "value",
  AUSBOSS_NODES_Krea2Encode: "vlm_reference",
  AUSBOSS_NODES_Krea2OutpaintModelPatch: "placement",
  AUSBOSS_NODES_LaMaInpaint: "preview",
  AUSBOSS_NODES_LoadImagePad: "source_image",
  AUSBOSS_NODES_LoraLoader: "on_missing",
  AUSBOSS_NODES_MathExpression: "c",
  AUSBOSS_NODES_MergeBatches: "on_mismatch",
  AUSBOSS_NODES_RealignToSource: "stitcher",
  AUSBOSS_NODES_RefineMask: "guide_image",
  AUSBOSS_NODES_Resolution: "batch_size",
  AUSBOSS_NODES_RunTimer: null,
  AUSBOSS_NODES_Seed: "seed",
  AUSBOSS_NODES_SelectEveryNth: "fps",
  AUSBOSS_NODES_SelectFrame: "preview",
  AUSBOSS_NODES_ShowText: "text",
  AUSBOSS_NODES_SplitBatch: "index",
  AUSBOSS_NODES_StitchInpaint: "seam",
  AUSBOSS_NODES_Text: "text",
  AUSBOSS_NODES_WorkflowNote: "note",
};

// Every input added to those nodes since their saves began ending in an
// empty value, and what it is: a socket (a link only, never a saved value)
// or its widget type. Adding an input to one of these nodes means listing it
// here, and a widget input also needs a fallback equal to the node's default
// - what an API prompt without the input runs with: resetUnknown in its card
// (js/widget_cards/index.js), or RESET_UNKNOWN beside NODE_CLASS in its own
// js/<name>/index.js for a node without a card.
const APPENDED_SINCE = {
  // Added in 2.4.0; 2.0.0 - 2.3.0 saves hold the card's value there.
  AUSBOSS_NODES_CropForInpaint: { keep_inside: "toggle" },
  AUSBOSS_NODES_StitchInpaint: { seam: "combo" },
  // Added in 2.0.0; 1.x saves hold the preview panel's value there (Select
  // Frame's from 1.2.0), or the LoRA panel's.
  AUSBOSS_NODES_LaMaInpaint: { preview: "toggle" },
  AUSBOSS_NODES_RefineMask: { preview: "toggle" },
  AUSBOSS_NODES_SelectFrame: { preview: "toggle" },
  AUSBOSS_NODES_LoraLoader: { on_missing: "combo" },
  // Sockets, which hold no saved value.
  AUSBOSS_NODES_Krea2Encode: { mask: "socket" },
  AUSBOSS_NODES_LoadImagePad: { source_image: "socket" },
  AUSBOSS_NODES_SelectEveryNth: { fps: "socket" },
};

// What such an input receives from an older save: the card's or panel's "",
// or on a node with an upload button, the button's saved "image".
const OLD_SLOT_VALUES = ["", "image"];

const NODE_API = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "node_api.json"), "utf-8"));

// A resetUnknown or RESET_UNKNOWN object literal, keys unquoted.
const parseFallbacks = (literal) => JSON.parse(literal.replace(/(\w+):/g, '"$1":'));

function cardEntry(nodeId) {
  const source = readFileSync(join(JS_ROOT, "widget_cards", "index.js"), "utf-8");
  const start = source.indexOf(`\n  ${nodeId}: {`);
  if (start < 0) return null;
  const next = source.slice(start + 1).search(/\n {2}AUSBOSS_NODES_\w+: \{/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

// A node's fallbacks: its card's resetUnknown, or RESET_UNKNOWN in the
// js/<name>/index.js whose NODE_CLASS is the node.
function nodeFallbacks(nodeId) {
  const card = cardEntry(nodeId)?.match(/resetUnknown: (\{[^}]*\})/)?.[1];
  if (card) return parseFallbacks(card);
  for (const name of readdirSync(JS_ROOT)) {
    let source;
    try {
      source = readFileSync(join(JS_ROOT, name, "index.js"), "utf-8");
    } catch {
      continue;
    }
    if (!source.includes(`const NODE_CLASS = "${nodeId}";`)) continue;
    const own = source.match(/^const RESET_UNKNOWN = (\{[^}]*\});$/m)?.[1];
    if (own) return parseFallbacks(own);
  }
  return {};
}

test("every input added since a node's saves began ending in a placeholder is declared", () => {
  for (const [nodeId, last] of Object.entries(LAST_GUARDED_INPUT)) {
    const api = NODE_API[nodeId];
    assert.ok(api, `${nodeId} is missing from tests/fixtures/node_api.json`);
    const inputs = [...api.required, ...api.optional];
    const at = last === null ? -1 : inputs.indexOf(last);
    assert.ok(last === null || at >= 0, `${nodeId} no longer has ${last}; inputs only grow`);
    const declared = APPENDED_SINCE[nodeId] ?? {};
    for (const name of inputs.slice(at + 1)) {
      assert.ok(
        name in declared,
        `${nodeId}: ${name} is new, and older saves hand it a card's or panel's empty value. `
          + "List it in APPENDED_SINCE in this test as a socket or its widget type; a widget input also "
          + "needs a fallback equal to the node's default (see APPENDED_SINCE)",
      );
    }
    for (const name of Object.keys(declared)) {
      assert.ok(inputs.includes(name), `${nodeId}: APPENDED_SINCE lists ${name}, which is not one of its inputs`);
    }
  }
  for (const nodeId of Object.keys(APPENDED_SINCE)) {
    assert.ok(nodeId in LAST_GUARDED_INPUT, `${nodeId} is in APPENDED_SINCE but not in LAST_GUARDED_INPUT`);
  }
});

test("an added widget input opens an older save with its fallback, not the old slot's value", () => {
  for (const [nodeId, inputs] of Object.entries(APPENDED_SINCE)) {
    for (const [name, type] of Object.entries(inputs)) {
      if (type === "socket") continue;
      const fallbacks = nodeFallbacks(nodeId);
      assert.ok(
        name in fallbacks,
        `${nodeId}: no fallback for ${name} - add it to the card's resetUnknown, or to RESET_UNKNOWN `
          + "beside NODE_CLASS in the node's own js/<name>/index.js",
      );
      const fallback = fallbacks[name];
      for (const old of OLD_SLOT_VALUES) {
        const widget = { name, type, value: old, options: { values: [fallback] } };
        assert.deepEqual(
          resetUnknownValues([widget], { [name]: fallback }),
          [name],
          `${nodeId}: a ${type} widget holding ${JSON.stringify(old)} is not reset - resetUnknownValues cannot judge it`,
        );
        assert.deepEqual(widget.value, fallback);
      }
      // A value the user saved is left alone.
      const saved = { name, type, value: fallback, options: { values: [fallback] } };
      assert.deepEqual(resetUnknownValues([saved], { [name]: fallback }), []);
    }
  }
});

test("a node without a card applies its own RESET_UNKNOWN when a workflow opens", () => {
  // The LoRA Loader has no card; its fallback only helps if the node runs it.
  const source = readFileSync(join(JS_ROOT, "lora_loader", "index.js"), "utf-8");
  assert.deepEqual(nodeFallbacks("AUSBOSS_NODES_LoraLoader"), { on_missing: "error" });
  assert.match(
    source,
    /chainCallback\(nodeType\.prototype, "onConfigure", function \(\) \{\s*resetUnknownValues\(this\.widgets, RESET_UNKNOWN\);/,
  );
});
