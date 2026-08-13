import assert from "node:assert/strict";
import test from "node:test";

import { FALLBACK_FILL, normalizeFillColor, parseFillColor } from "../js/shared/fill_color.mjs";

test("hex forms normalize to #rrggbb", () => {
  assert.equal(parseFillColor("#123456"), "#123456");
  assert.equal(parseFillColor("#FA8"), "#ffaa88");
  assert.equal(parseFillColor("  #808080  "), "#808080");
  // Bare hex stays supported when unambiguous.
  assert.equal(parseFillColor("808080"), "#808080");
  assert.equal(parseFillColor("fa8"), "#ffaa88");
});

test("csv integers clamp to 0-255", () => {
  assert.equal(parseFillColor("10, 20, 30"), "#0a141e");
  assert.equal(parseFillColor("10 20 30"), "#0a141e");
  assert.equal(parseFillColor("300, -5, 128"), "#ff0080");
});

test("csv floats are auto-detected when all values <= 1", () => {
  assert.equal(parseFillColor("0.5, 0.5, 0.5"), "#808080");
  assert.equal(parseFillColor("1, 1, 1"), "#ffffff");
  assert.equal(parseFillColor("0, 0, 0"), "#000000");
  // One value above 1 switches the whole triple to 0-255.
  assert.equal(parseFillColor("0.5, 128, 0.5"), "#018001");
});

test("bare grayscale numbers", () => {
  assert.equal(parseFillColor("128"), "#808080");
  assert.equal(parseFillColor("255"), "#ffffff");
  assert.equal(parseFillColor("0.5"), "#808080");
  assert.equal(parseFillColor("0"), "#000000");
});

test("named colors go through the injected resolver", () => {
  const resolver = (name) => (name === "teal" ? "#008080" : null);
  assert.equal(parseFillColor("teal", resolver), "#008080");
  assert.equal(parseFillColor("Teal", resolver), "#008080");
  assert.equal(parseFillColor("nonsense", resolver), null);
  // Numeric and hex forms never reach the resolver.
  assert.equal(parseFillColor("128", () => "#ff0000"), "#808080");
  assert.equal(parseFillColor("#fff", () => "#ff0000"), "#ffffff");
  // A resolver returning junk is ignored.
  assert.equal(parseFillColor("teal", () => "junk"), null);
});

test("normalize falls back to mid-gray", () => {
  assert.equal(normalizeFillColor("not a color"), FALLBACK_FILL);
  assert.equal(normalizeFillColor(""), FALLBACK_FILL);
  assert.equal(normalizeFillColor(null), FALLBACK_FILL);
  assert.equal(normalizeFillColor("1, 2"), FALLBACK_FILL);
  assert.equal(normalizeFillColor("teal", (name) => (name === "teal" ? "#008080" : null)), "#008080");
});
