import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_SCHEME,
  DEFAULT_SCHEME,
  NODE_COLOR_SCHEMES,
  SCHEME_NAMES,
  collectGraphNodes,
  customColors,
  deriveBody,
  normalizeHexColor,
  schemeColors,
  shouldRecolor,
  titleInk,
} from "../js/shared/appearance.mjs";

test("scheme table is well formed", () => {
  const names = NODE_COLOR_SCHEMES.map((scheme) => scheme.name);
  assert.equal(new Set(names).size, names.length, "scheme names must be unique");
  assert.equal(NODE_COLOR_SCHEMES[0].name, DEFAULT_SCHEME);
  assert.equal(NODE_COLOR_SCHEMES[0].colors, null, "default scheme leaves theme colors alone");
  for (const scheme of NODE_COLOR_SCHEMES.slice(1)) {
    assert.match(scheme.colors.title, /^#[0-9a-f]{6}$/);
    assert.match(scheme.colors.body, /^#[0-9a-f]{6}$/);
    assert.notEqual(scheme.colors.title, scheme.colors.body);
  }
});

test("schemeColors resolves names and rejects unknowns", () => {
  assert.equal(schemeColors("Theme default"), null);
  assert.equal(schemeColors("Slate"), NODE_COLOR_SCHEMES.find((s) => s.name === "Slate").colors);
  assert.equal(schemeColors("Not A Scheme"), null);
  assert.equal(schemeColors(undefined), null);
});

test("SCHEME_NAMES is the table plus Custom, all unique", () => {
  assert.deepEqual(SCHEME_NAMES, [...NODE_COLOR_SCHEMES.map((s) => s.name), CUSTOM_SCHEME]);
  assert.equal(new Set(SCHEME_NAMES).size, SCHEME_NAMES.length);
});

test("normalizeHexColor accepts bare and prefixed hex, drops alpha", () => {
  assert.equal(normalizeHexColor("#aabbcc"), "#aabbcc");
  assert.equal(normalizeHexColor("aabbcc"), "#aabbcc");
  assert.equal(normalizeHexColor(" AABBCC "), "#aabbcc");
  assert.equal(normalizeHexColor("#AABBCCDD"), "#aabbcc");
  assert.equal(normalizeHexColor("aabbccdd"), "#aabbcc");
});

test("normalizeHexColor rejects junk", () => {
  assert.equal(normalizeHexColor(undefined), null);
  assert.equal(normalizeHexColor(""), null);
  assert.equal(normalizeHexColor("#abc"), null);
  assert.equal(normalizeHexColor("zzzzzz"), null);
  assert.equal(normalizeHexColor("#aabbccd"), null);
  assert.equal(normalizeHexColor(0xaabbcc), null);
});

test("deriveBody mixes the title halfway toward the dark neutral", () => {
  assert.equal(deriveBody("#000000"), "#181818");
  assert.equal(deriveBody("#ffffff"), "#979797");
  assert.equal(deriveBody("00b4aa"), "#18726d");
});

test("deriveBody never collapses the title and body into one flat color", () => {
  // The neutral is the mix's fixed point, so it would otherwise return itself
  // and draw a node with no visible title bar.
  assert.equal(deriveBody("#2f2f2f"), "#393939");
  assert.equal(deriveBody("#303030"), "#3a3a3a");
  // Picks outside that band already separate on their own.
  assert.equal(deriveBody("#f0f0f0"), "#909090");
  for (let value = 0; value <= 255; value += 1) {
    const title = `#${value.toString(16).padStart(2, "0").repeat(3)}`;
    const body = deriveBody(title);
    assert.notEqual(body, title, `${title} produced an identical body`);
  }
});

test("deriveBody normalizes its input and rejects junk", () => {
  assert.equal(deriveBody("#FFFFFF"), deriveBody("ffffff"));
  assert.equal(deriveBody(undefined), null);
  assert.equal(deriveBody("#abc"), null);
  assert.equal(deriveBody("not hex"), null);
});

test("deriveBody always emits well-formed hex", () => {
  for (const title of ["#010203", "#f00baa", "#deadbe", "#7f7f7f"]) {
    assert.match(deriveBody(title), /^#[0-9a-f]{6}$/, title);
  }
});

test("customColors pairs the normalized title with its derived body", () => {
  assert.deepEqual(customColors("AABBCC"), { title: "#aabbcc", body: deriveBody("#aabbcc") });
  assert.equal(customColors("junk"), null);
  assert.equal(customColors(undefined), null);
});

test("schemeColors resolves Custom from the picked color only", () => {
  assert.deepEqual(schemeColors(CUSTOM_SCHEME, "00b4aa"), customColors("00b4aa"));
  assert.equal(schemeColors(CUSTOM_SCHEME), null);
  assert.equal(schemeColors(CUSTOM_SCHEME, "junk"), null);
  // Static names ignore the custom title entirely.
  assert.equal(schemeColors("Slate", "00b4aa"), schemeColors("Slate"));
});

test("uncolored nodes follow the setting only from the theme default", () => {
  const bare = {};
  assert.equal(shouldRecolor(bare, null), true);
  // Unset while a scheme was active means the user cleared it by hand.
  assert.equal(shouldRecolor(bare, schemeColors("Teal")), false);
});

test("nodes wearing the previous scheme are repainted, manual colors win", () => {
  const teal = schemeColors("Teal");
  const wearing = { color: teal.title, bgcolor: teal.body };
  assert.equal(shouldRecolor(wearing, teal), true);
  assert.equal(shouldRecolor({ color: "#123456", bgcolor: "#654321" }, teal), false);
  assert.equal(shouldRecolor({ color: "#123456", bgcolor: "#654321" }, null), false);
  // Half-matching colors mean the user edited one channel — leave both alone.
  assert.equal(shouldRecolor({ color: teal.title, bgcolor: "#654321" }, teal), false);
});

test("color comparison ignores case and whitespace", () => {
  const plum = schemeColors("Plum");
  const noisy = { color: ` ${plum.title.toUpperCase()} `, bgcolor: plum.body.toUpperCase() };
  assert.equal(shouldRecolor(noisy, plum), true);
});

test("custom-tinted nodes sweep like any scheme pair", () => {
  const custom = schemeColors(CUSTOM_SCHEME, "00b4aa");
  const wearing = { color: custom.title, bgcolor: custom.body };
  // Still following the setting: a sweep away from Custom repaints it.
  assert.equal(shouldRecolor(wearing, custom), true);
  // A CustomColor edit sweeps too: the old pair is the "previous" colors.
  const edited = schemeColors(CUSTOM_SCHEME, "ff0000");
  assert.notDeepEqual(edited, custom);
  assert.equal(shouldRecolor(wearing, edited), false);
  // Hand-edited bodies win over any custom sweep.
  assert.equal(shouldRecolor({ color: custom.title, bgcolor: "#123456" }, custom), false);
});

test("a menu-picked scheme survives a settings sweep", () => {
  // The user picked Plum from the node menu while the setting was Teal;
  // sweeping the setting to anything else must leave the node alone.
  const plum = schemeColors("Plum");
  const picked = { color: plum.title, bgcolor: plum.body };
  assert.equal(shouldRecolor(picked, schemeColors("Teal")), false);
  assert.equal(shouldRecolor(picked, null), false);
});

test("titleInk keeps light ink on every shipped scheme", () => {
  for (const scheme of NODE_COLOR_SCHEMES.slice(1)) {
    assert.equal(titleInk(scheme.colors.title), "#ffffff", scheme.name);
  }
});

test("titleInk flips to dark ink on light colors", () => {
  assert.equal(titleInk("#e0e0e0"), "#1a1a1a");
  assert.equal(titleInk(" #FFFFFF "), "#1a1a1a");
});

test("titleInk falls back to light ink on malformed input", () => {
  assert.equal(titleInk(undefined), "#ffffff");
  assert.equal(titleInk(""), "#ffffff");
  assert.equal(titleInk("#e0e"), "#ffffff");
  assert.equal(titleInk("e0e0e0"), "#ffffff");
  assert.equal(titleInk("#zzzzzz"), "#ffffff");
});

test("collectGraphNodes flattens nested subgraphs", () => {
  const inner = { _nodes: [{ id: 3 }] };
  const graph = { _nodes: [{ id: 1 }, { id: 2, subgraph: inner }] };
  assert.deepEqual(
    collectGraphNodes(graph).map((node) => node.id),
    [1, 2, 3],
  );
});

test("collectGraphNodes accepts nodes arrays and plain arrays", () => {
  const viaNodes = { nodes: [{ id: 1 }] };
  assert.deepEqual(collectGraphNodes(viaNodes).map((node) => node.id), [1]);
  const plain = [{ id: 1 }, { id: 2, subgraph: [{ id: 3 }] }];
  assert.deepEqual(collectGraphNodes(plain).map((node) => node.id), [1, 2, 3]);
  assert.deepEqual(collectGraphNodes(null), []);
  assert.deepEqual(collectGraphNodes({}), []);
});

test("collectGraphNodes survives subgraph reference cycles", () => {
  const graph = { _nodes: [{ id: 1 }] };
  graph._nodes.push({ id: 2, subgraph: graph });
  assert.deepEqual(
    collectGraphNodes(graph).map((node) => node.id),
    [1, 2],
  );
});

// The node-color setting resolves a scheme to a colour pair before repainting.
// Custom with an unusable stored colour resolves to null, which downstream
// reads as "Theme default" and strips the colour off every AusBoss node - so
// both the setting and the per-node menu have to refuse it.
function repaintDecision(nextScheme, previousScheme, customColor) {
  if (previousScheme === nextScheme) return "no change";
  const colors = schemeColors(nextScheme, customColor);
  if (nextScheme === "Custom" && !colors) return "refused";
  return colors ? "repaint" : "theme default";
}

test("switching to Custom with an unusable colour repaints nothing", () => {
  for (const bad of ["#abc", "", "red", "not a colour", null, undefined]) {
    assert.equal(repaintDecision("Custom", "Teal", bad), "refused", String(bad));
  }
});

test("switching to Custom with a usable colour repaints", () => {
  assert.equal(repaintDecision("Custom", "Teal", "#ffee00"), "repaint");
  assert.equal(repaintDecision("Custom", "Teal", "1f2c38"), "repaint");
});

test("Theme default still clears colours, which is its whole job", () => {
  assert.equal(repaintDecision("Theme default", "Teal", "#ffee00"), "theme default");
});
