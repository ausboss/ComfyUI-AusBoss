// The Chinese on the pack's own node faces (js/shared/i18n.mjs).
//
//  - a string with no Chinese entry stays English,
//  - every word a widget card shows has a Chinese entry, or is on the short
//    list of things that deliberately stay English,
//  - only displayed text is translated: nothing in a card config that names a
//    widget or a value is a key of the table by accident of spelling.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { PATTERNS, STAYS_ENGLISH, ZH } from "../js/shared/i18n_zh.mjs";
import { isChineseLocale, translateText } from "../js/shared/i18n.mjs";
import { PANEL_LABELS } from "../js/shared/panel_controls.mjs";

const cards = fs.readFileSync(new URL("../js/widget_cards/index.js", import.meta.url), "utf8");

// Every string a card shows: row labels, group headers, pill texts, the
// words of a choice (`labels`), tooltips (`title`, `titles`), placeholders,
// button captions.
function displayedStrings(source) {
  const found = new Set();
  const literal = (raw) => JSON.parse(`"${raw}"`);
  for (const match of source.matchAll(/\b(?:label|onText|offText|placeholder|title|muteTitle|readOnlyTitle|section|text|readOnlyText)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) found.add(literal(match[1]));
  for (const block of source.matchAll(/\b(?:labels|titles)\s*:\s*\{([^}]*)\}/g)) {
    for (const match of block[1].matchAll(/:\s*"((?:[^"\\]|\\.)*)"/g)) found.add(literal(match[1]));
  }
  return found;
}

test("an unknown string stays English", () => {
  assert.equal(translateText("A sentence no table has ever heard of"), "A sentence no table has ever heard of");
  assert.equal(translateText(""), "");
  assert.equal(translateText("   "), "   ");
  assert.equal(translateText("constructor"), "constructor");
  assert.equal(translateText("toString"), "toString");
  assert.equal(translateText("Preview", {}, []), "Preview");
});

test("a known string is translated and keeps the spaces around it", () => {
  assert.equal(translateText("Feather"), ZH.Feather);
  assert.equal(translateText("  Feather\n"), `  ${ZH.Feather}\n`);
  assert.notEqual(ZH.Feather, "Feather");
});

test("the scrub hint is translated around a tooltip", () => {
  const out = translateText("Feather. Drag to scrub, click to type a number or a sum (1024*1.5), arrows to step; Shift = fine.");
  assert.match(out, /拖动调节/);
  assert.ok(out.startsWith("Feather."));
  const known = translateText("Do nothing Drag to scrub, click to type a number or a sum (1024*1.5), arrows to step; Shift = fine.");
  assert.ok(known.startsWith(ZH["Do nothing"]) && /拖动调节/.test(known));
});

test("every Chinese language code takes the Chinese table", () => {
  for (const code of ["zh", "zh-CN", "zh-TW", "zh_CN", "ZH"]) assert.equal(isChineseLocale(code), true, code);
  for (const code of ["en", "ja", "ko", "", undefined, null, "zhx"]) assert.equal(isChineseLocale(code), false, String(code));
});

test("no entry is empty or the same as its key without being listed as English", () => {
  for (const [english, chinese] of Object.entries(ZH)) {
    assert.ok(typeof chinese === "string" && chinese.length > 0, `empty entry for ${english}`);
  }
  for (const [pattern] of PATTERNS) assert.ok(pattern instanceof RegExp);
});

test("every word a widget card shows has a Chinese entry or stays English on purpose", () => {
  const strings = new Set([...displayedStrings(cards), ...Object.values(PANEL_LABELS).flatMap((value) => (typeof value === "string" ? [value] : Object.values(value)))]);
  assert.ok(strings.size > 150, `only ${strings.size} strings found: the extraction broke`);
  const missing = [...strings].filter((text) => !(text in ZH) && !STAYS_ENGLISH.has(text) && !/^[^A-Za-z]*$/.test(text));
  assert.deepEqual(missing, []);
});
