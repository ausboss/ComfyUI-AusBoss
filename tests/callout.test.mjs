import assert from "node:assert/strict";
import test from "node:test";

import { ARROW_ANGLE, ARROW_CHOICES, arrowText, fitFontSize, parseBlocks } from "../js/shared/callout.mjs";

test("a blank line starts a new point and ## is ignored", () => {
  const blocks = parseBlocks("## One\nsecond line\n\n\n## Two");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].length, 2);
  assert.equal(blocks[0][0][0].text, "One");
  assert.equal(blocks[1][0][0].text, "Two");
});

test("**bold** marks a word and an unmatched ** stays text", () => {
  const [[line]] = parseBlocks("a **big** idea");
  assert.deepEqual(line.map((p) => [p.text, p.bold]), [["a ", false], ["big", true], [" idea", false]]);
  const [[open]] = parseBlocks("two ** open");
  assert.deepEqual(open, [{ text: "two ** open", bold: false }]);
  assert.deepEqual(parseBlocks("   \n\n"), []);
  assert.deepEqual(parseBlocks(undefined), []);
});

test("an arrow emoji becomes an arrow inside the line", () => {
  const [[line]] = parseBlocks("Drag ⬆️ the handles");
  assert.deepEqual(line, [
    { text: "Drag ", bold: false },
    { arrow: "up", bold: false },
    { text: " the handles", bold: false },
  ]);
});

test("every arrow spelling is read, with or without the emoji selector", () => {
  const kinds = (text) => parseBlocks(text)[0][0].filter((p) => p.arrow).map((p) => p.arrow);
  assert.deepEqual(kinds("⬆⬇⬅➡"), ["up", "down", "left", "right"]);
  assert.deepEqual(kinds("⬆️⬇️⬅️➡️"), ["up", "down", "left", "right"]);
  assert.deepEqual(kinds("↖↗↘↙"), ["upleft", "upright", "downright", "downleft"]);
  assert.deepEqual(kinds("← ↑ → ↓"), ["left", "up", "right", "down"]);
  assert.deepEqual(kinds("↔️ ↕️"), ["leftright", "updown"]);
  assert.deepEqual(kinds("\u{1F446}\u{1F447}\u{1F448}\u{1F449}"), ["up", "down", "left", "right"]);
  assert.deepEqual(kinds("a -> b <- c"), ["right", "left"]);
});

test("an arrow inside **bold** stays inside the bold", () => {
  const [[line]] = parseBlocks("**here ➡️** now");
  assert.deepEqual(line.map((p) => [p.text ?? p.arrow, p.bold]), [["here ", true], ["right", true], [" now", false]]);
});

test("the editor offers all eight directions and each one can be drawn", () => {
  assert.equal(ARROW_CHOICES.length, 8);
  for (const [kind, emoji] of ARROW_CHOICES) {
    assert.ok(kind in ARROW_ANGLE, `${kind} has an angle`);
    assert.equal(parseBlocks(emoji)[0][0][0].arrow, kind, `${kind} reads back as itself`);
  }
});

test("the text grows to the largest size that fits", () => {
  assert.equal(fitFontSize((px) => px <= 19), 19);
  assert.equal(fitFontSize(() => true), 30);
  assert.equal(fitFontSize(() => false), 12);
});

test("an arrow followed by #id is linked to that node", () => {
  const [[line]] = parseBlocks("See \u27A1\uFE0F#12 and \u2B07\uFE0F#5:7. Then \u2B06\uFE0F #3 and -> done");
  const arrows = line.filter((p) => p.arrow);
  assert.deepEqual(arrows.map((p) => [p.arrow, p.link]), [["right", "12"], ["down", "5:7"], ["up", undefined], ["right", undefined]]);
  // The link is not shown as text, and the full stop after a link stays text.
  assert.ok(line.some((p) => p.text === ". Then "));
  assert.ok(line.some((p) => p.text === " #3 and "));
});

test("arrowText writes the link the parser reads", () => {
  assert.equal(arrowText("\u27A1\uFE0F", "9"), "\u27A1\uFE0F#9");
  assert.equal(arrowText("\u27A1\uFE0F", 9), "\u27A1\uFE0F#9");
  assert.equal(arrowText("\u27A1\uFE0F"), "\u27A1\uFE0F");
  assert.equal(arrowText("\u27A1\uFE0F", ""), "\u27A1\uFE0F");
  assert.deepEqual(parseBlocks(arrowText("\u2197\uFE0F", "4"))[0][0], [{ arrow: "upright", link: "4", bold: false }]);
});
