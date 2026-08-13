import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCHEME,
  NODE_COLOR_SCHEMES,
  collectGraphNodes,
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
