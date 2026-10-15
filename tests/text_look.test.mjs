// The Text node's big look: a display choice kept on the node, never an
// input, so saved values, prompts and older packs are untouched.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TEXT_LOOKS, TEXT_LOOK_MENU, TEXT_LOOK_PROPERTY, setTextLook, textLook, textLookCornerReserve,
} from "../js/shared/text_look.mjs";
import { nodeHeightAfterCardChange } from "../js/shared/panel_layout.mjs";
import { CARD_PADDING, cardChangeRestore, cardHeight, rowHeight } from "../js/shared/widget_card_math.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf-8");

test("a node is in the big look only when its property says big", () => {
  assert.equal(TEXT_LOOK_PROPERTY, "ausboss_text_look");
  assert.equal(textLook({ properties: { ausboss_text_look: "big" } }), "big");
  for (const node of [null, undefined, {}, { properties: {} }, { properties: { ausboss_text_look: "normal" } },
    { properties: { ausboss_text_look: "Big" } }, { properties: { ausboss_text_look: true } }]) {
    assert.equal(textLook(node), "normal", JSON.stringify(node));
  }
});

test("setting the look writes big, and the usual box leaves no property behind", () => {
  const node = {};
  assert.equal(setTextLook(node, "big"), "big");
  assert.deepEqual(node.properties, { ausboss_text_look: "big" });
  const other = { properties: { "Node name for S&R": "AUSBOSS_NODES_Text", ausboss_text_look: "big" } };
  assert.equal(setTextLook(other, "normal"), "normal");
  assert.deepEqual(other.properties, { "Node name for S&R": "AUSBOSS_NODES_Text" });
  // Anything that is not a look is the usual box.
  assert.equal(setTextLook(other, "huge"), "normal");
  assert.equal(TEXT_LOOK_PROPERTY in other.properties, false);
  assert.equal(setTextLook(null, "big"), "normal");
});

test("the gear menu offers both looks, opens on the usual box and keeps the choice on the node", () => {
  assert.deepEqual(TEXT_LOOKS, ["normal", "big"]);
  const entries = TEXT_LOOK_MENU.filter((entry) => entry.key !== undefined);
  assert.equal(entries.length, 1);
  const [look] = entries;
  assert.equal(look.type, "choice");
  assert.deepEqual(look.options, TEXT_LOOKS);
  assert.equal(look.default, "normal");
  // persist: false - a choice for this node, never the default for new ones.
  assert.equal(look.persist, false);
  for (const option of TEXT_LOOKS) assert.ok(look.optionHints?.[option], `no hint for ${option}`);
});

test("the gear sits beside the usual box and inside the big field", () => {
  assert.equal(textLookCornerReserve("normal"), 30);
  assert.equal(textLookCornerReserve("big"), 0);
});

// The Text node's card entry in js/widget_cards/index.js.
function textCard() {
  const source = read("js", "widget_cards", "index.js");
  const start = source.indexOf("\n  AUSBOSS_NODES_Text: {");
  assert.ok(start >= 0, "js/widget_cards/index.js has no card for the Text node");
  const next = source.slice(start + 1).search(/\n {2}(\/\/|AUSBOSS_NODES_\w+: \{)/);
  return source.slice(start, start + 1 + next);
}

test("the Text card takes its look from the node and has the gear in its corner", () => {
  const card = textCard();
  assert.match(card, /look: textLook/);
  assert.match(card, /corner: textLookCorner/);
  // Today's box is unchanged: the same row, height and placeholder.
  assert.match(card, /widget: "text", kind: "textarea", placeholder: "Prompt, caption, or shared text", height: 100, grow: true/);
  assert.match(card, /looks: \{ big: \{ height: 62, placeholder: "type here" \} \}/);
});

test("the big field is compact: two lines at its smallest, shorter than the usual box", () => {
  const row = { widget: "text", kind: "textarea", height: 100, grow: true, looks: { big: { height: 62 } } };
  assert.equal(rowHeight(row, "normal"), 100);
  assert.equal(rowHeight(row, "big"), 62);
  assert.equal(cardHeight([row], "big"), CARD_PADDING * 2 + 62);
  assert.ok(cardHeight([row], "big") < cardHeight([row], "normal"));
  // Two lines of the big text fit the field: line height, padding, border.
  const source = read("js", "shared", "widget_card.mjs");
  const constant = (name) => Number(source.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
  assert.ok(constant("BIG_LINE") * 2 + constant("BIG_PAD_Y") * 2 + 2 <= 62);
});

test("the big look's text is large, centred and out of flow", () => {
  const source = read("js", "shared", "widget_card.mjs");
  const font = Number(source.match(/const BIG_FONT = (\d+);/)?.[1]);
  assert.ok(font >= 20 && font <= 24, `big text is ${font}px`);
  const rule = source.match(/\n\.ausboss-card\.look-big \.ausboss-card-area\{([^\n]*)/)?.[1];
  assert.ok(rule, "the big look's rule for the text box is gone");
  assert.match(rule, /text-align:center/);
  assert.match(rule, /font:600 /);
  // Out of flow, so the text never sizes the card in Nodes 2.0, and capped
  // by the field so a long text scrolls instead of growing the node.
  assert.match(rule, /position:absolute/);
  assert.match(rule, /max-height:100%/);
  // The same padding on both sides keeps it centred on the card and clear
  // of the gear.
  assert.match(rule, /padding:\$\{BIG_PAD_Y\}px \$\{BIG_PAD_X\}px/);
});

// A Text node's height, as the card works it out when the card's height
// changes: the floor is the node's computeSize() height in the new look.
const TEXT_ROW = { widget: "text", kind: "textarea", height: 100, grow: true, looks: { big: { height: 62 } } };
const CHANGE = cardHeight([TEXT_ROW], "big") - cardHeight([TEXT_ROW], "normal");
const NORMAL_FLOOR = 168;
const BIG_FLOOR = NORMAL_FLOOR + CHANGE;
const heightAfterLook = ({ current, byHand = false }) => nodeHeightAfterCardChange({
  floor: BIG_FLOOR, current, change: CHANGE, byHand,
  ...cardChangeRestore({ restoring: false, lookChanged: true, byHand, current }),
});

test("a big-look node saved taller than its floor keeps its height when the workflow loads", () => {
  assert.equal(BIG_FLOOR, 130);
  // How a node loads: its card is built in the usual look, then ComfyUI puts
  // the saved size and properties on the node and fills in the saved text,
  // whose callback redraws the card in the big look - before onConfigure,
  // so the card does not yet know a workflow is loading. The node is under
  // the usual look's floor there; it once took that for "at the floor" and
  // went down to the big floor (424 x 152 came back 424 x 130).
  for (const saved of [131, 152, 167, 168, 240]) assert.equal(heightAfterLook({ current: saved }), saved, `saved at ${saved}`);
  // Saved at the floor, or under it by an older pack, it opens at the floor.
  assert.equal(heightAfterLook({ current: 130 }), 130);
  assert.equal(heightAfterLook({ current: 100 }), 130);
});

test("picking big from the gear fits the node to the big look", () => {
  // A node at the usual floor goes to the big floor; one made taller keeps
  // what it had beyond the floor.
  assert.equal(heightAfterLook({ current: NORMAL_FLOOR, byHand: true }), BIG_FLOOR);
  assert.equal(heightAfterLook({ current: 240, byHand: true }), 240 + CHANGE);
  // A change by hand is never a restore, and a load stays one.
  assert.deepEqual(cardChangeRestore({ lookChanged: true, byHand: true, current: 168 }), { restoring: false, saved: undefined });
  assert.deepEqual(cardChangeRestore({ restoring: true, savedHeight: 152, lookChanged: true, current: 168 }), { restoring: true, saved: 152 });
  assert.deepEqual(cardChangeRestore({ current: 168 }), { restoring: false, saved: undefined });
});

test("the card asks cardChangeRestore before it changes the node's height", () => {
  const source = read("js", "shared", "widget_card.mjs");
  assert.match(source, /const lookChanged = look !== state\.look;/);
  assert.match(source, /cardChangeRestore\(\{[^}]*lookChanged, byHand: state\.byHand, current: node\.size\?\.\[1\]/);
  assert.match(source, /saved: restore\.saved, change, first, restoring: restore\.restoring/);
});

test("the look adds no input: the Text node still takes its one text box", () => {
  const api = JSON.parse(read("tests", "fixtures", "node_api.json"));
  assert.deepEqual(api.AUSBOSS_NODES_Text, { required: ["text"], optional: [], outputs: [["STRING", "text"]] });
});
