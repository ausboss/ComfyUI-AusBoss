import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { THEME } from "../js/shared/theme.mjs";

// The card, the number box and the switch take every colour from theme.mjs,
// so the palette is changed in one place.
const ON_THEME = ["js/shared/widget_card.mjs", "js/shared/scrub_input.mjs", "js/shared/slide_switch.mjs"];

test("the card, number box and switch carry no colour of their own", () => {
  for (const file of ON_THEME) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const hex = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepEqual(hex, [], `${file} has colour literals; add them to js/shared/theme.mjs`);
  }
});

const luminance = (hex) => {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("text a person reads holds 4.5:1 on the card and on a control", () => {
  const pairs = [
    ["ink", "fill"], ["inkSoft", "card"], ["label", "card"], ["label", "fill"],
    ["faint", "card"], ["faint", "fill"], ["onBrand", "brand"], ["ink", "switchOff"], ["warnInk", "warnSoft"],
  ];
  for (const [text, ground] of pairs) {
    const ratio = contrast(THEME[text], THEME[ground]);
    assert.ok(ratio >= 4.5, `${text} on ${ground} is ${ratio.toFixed(2)}:1`);
  }
});
