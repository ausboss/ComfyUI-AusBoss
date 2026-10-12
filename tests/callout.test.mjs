import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARROW_ANGLE, ARROW_CHOICES, SMALL_MARK, arrowText, fitFontSize, linkTarget, parseBlocks, pastedLink, targetId,
  toggleSmall, urlLabel, wrapLink,
} from "../js/shared/callout.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

test("a line that starts with six hashes is small print under the line above", () => {
  const [point] = parseBlocks("**Auto prompt** writes the prompt.\n###### Off, your words go in as typed.\n######   It adds two seconds.");
  assert.equal(point.length, 3);
  assert.equal(point[0].small, undefined);
  assert.equal(point[1].small, true);
  assert.equal(point[2].small, true);
  // The mark is not part of the text, and bold and arrows work inside it.
  assert.deepEqual([...point[1]], [{ text: "Off, your words go in as typed.", bold: false }]);
  const [[, linked]] = parseBlocks("Top\n###### see ➡️#20 for the **text**");
  assert.equal(linked.small, true);
  assert.deepEqual([...linked], [
    { text: "see ", bold: false },
    { arrow: "right", bold: false, link: "20" },
    { text: " for the ", bold: false },
    { text: "text", bold: true },
  ]);
  // Small print can open a point, and a blank line still ends one.
  const blocks = parseBlocks("###### a footnote\n\nNext point");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0][0].small, true);
  assert.equal(blocks[1][0].small, undefined);
});

test("only six hashes and a space mean small print", () => {
  const small = (text) => parseBlocks(text).flat().map((line) => Boolean(line.small));
  assert.deepEqual(small("# a\n## b\n### c\n#### d\n##### e"), [false, false, false, false, false]);
  assert.deepEqual(small("####### seven"), [false]);
  assert.deepEqual(small("######none"), [false]);
  assert.deepEqual(small("- a dash\n– a long dash\n-# a chat mark"), [false, false, false]);
  assert.deepEqual(small("  ###### indented"), [true]);
  // The mark with nothing after it is a blank line, as it always was.
  assert.deepEqual(parseBlocks("one\n###### \ntwo").length, 2);
});

test("a note written before small print reads exactly as the release before read it", () => {
  // The fixture holds what release 2.10.1 made of each text: dash lists,
  // every heading mark but the six-hash one, and the pack's example notes.
  const notes = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "callout_released_notes.json"), "utf-8"));
  assert.ok(notes.length >= 12);
  for (const { text, blocks } of notes) {
    const now = parseBlocks(text);
    assert.deepEqual(JSON.parse(JSON.stringify(now)), blocks, text);
    assert.ok(now.flat().every((line) => !line.small), text);
  }
});

test("a release before small print shows the same words, all at one size", () => {
  // What those releases did with a line: drop one to six leading hashes.
  const released = (line) => line.replace(/^\s*#{1,6}\s+/, "").trim();
  const text = `Top line\n${SMALL_MARK}the details`;
  const now = parseBlocks(text)[0].map((line) => line.map((piece) => piece.text).join(""));
  assert.deepEqual(text.split("\n").map(released), now);
});

test("the Small button marks the caret's line and takes the mark off again", () => {
  const apply = (text, start, end = start) => {
    const next = toggleSmall(text, start, end);
    return { text: text.slice(0, next.from) + next.insert + text.slice(next.to), start: next.selectionStart, end: next.selectionEnd };
  };
  const text = "Top line\nthe details\n\nNext";
  // Caret in "the de|tails": the line gets the mark and the caret stays on its letter.
  const on = apply(text, 15);
  assert.equal(on.text, "Top line\n###### the details\n\nNext");
  assert.equal(on.text.slice(on.start, on.start + 5), "tails");
  assert.equal(on.start, on.end);
  const off = apply(on.text, on.start);
  assert.equal(off.text, text);
  assert.equal(off.start, 15);
  // A selection over several lines: every written line, and the blank one is left alone.
  const many = apply(text, 2, text.length);
  assert.equal(many.text, "###### Top line\n###### the details\n\n###### Next");
  assert.deepEqual([many.start, many.end], [0, many.text.length]);
  assert.equal(apply(many.text, 0, many.text.length).text, text);
  // Lines that are only partly small all become small; another heading mark is replaced.
  assert.equal(apply("###### a\n## b", 0, 14).text, "###### a\n###### b");
  // The first and the last line, a caret at either end, and an empty box.
  assert.equal(apply("one\ntwo", 0).text, "###### one\ntwo");
  assert.equal(apply("one\ntwo", 7).text, "one\n###### two");
  assert.deepEqual(apply("", 0), { text: "", start: 0, end: 0 });
  // A caret before the mark never lands in front of the line.
  assert.equal(apply("###### x", 2).start, 0);
});

test("words in square brackets with an address after them are a link to that page", () => {
  const [[line]] = parseBlocks("See [the video](https://youtu.be/abc) first");
  assert.deepEqual(line, [
    { text: "See ", bold: false },
    { text: "the video", bold: false, url: "https://youtu.be/abc", run: 1 },
    { text: " first", bold: false },
  ]);
  // The whole note can be one link, with bold and an arrow inside its words.
  const [[whole]] = parseBlocks("[➡️ **Watch** the video](https://www.youtube.com/@name)");
  assert.equal(whole.length, 4);
  assert.ok(whole.every((piece) => piece.url === "https://www.youtube.com/@name" && piece.run === 1));
  assert.deepEqual(whole.map((piece) => piece.arrow ?? piece.text), ["right", " ", "Watch", " the video"]);
  assert.equal(whole[2].bold, true);
  // Stars around a link are the same as stars inside it, and an address may hold round brackets.
  const [[bold]] = parseBlocks("**[more](https://en.wikipedia.org/wiki/Mask_(computing))**");
  assert.deepEqual(bold, [{ text: "more", bold: true, url: "https://en.wikipedia.org/wiki/Mask_(computing)", run: 1 }]);
  // Two links on a line are two runs.
  const [[two]] = parseBlocks("[a](https://a.example) and [b](http://b.example)");
  assert.deepEqual(two.filter((piece) => piece.run).map((piece) => [piece.text, piece.run]), [["a", 1], ["b", 2]]);
});

test("a link can also bring a node or a group into view, and an arrow can point at a group", () => {
  const [[line]] = parseBlocks("Set [the seed](#5) or open [the models](#g3) ⬇️#g3 ⬇️#12");
  assert.deepEqual(line.filter((piece) => piece.run || piece.arrow), [
    { text: "the seed", bold: false, link: "5", run: 1 },
    { text: "the models", bold: false, group: "3", run: 2 },
    { arrow: "down", bold: false, group: "3" },
    { arrow: "down", bold: false, link: "12" },
  ]);
  // An arrow inside linked words belongs to that link; one with its own link keeps it.
  const [[mixed]] = parseBlocks("[go ➡️ there ⬇️#7](#g2)");
  assert.deepEqual(mixed.map((piece) => [piece.arrow ?? piece.text, piece.group ?? null, piece.link ?? null]),
    [["go ", "2", null], ["right", "2", null], [" there ", "2", null], ["down", null, "7"]]);
});

test("only http and https addresses, nodes and groups are links: anything else stays as typed", () => {
  assert.deepEqual(linkTarget("https://example.com/a?b=1#c"), { url: "https://example.com/a?b=1#c" });
  assert.deepEqual(linkTarget("HTTP://EXAMPLE.COM"), { url: "HTTP://EXAMPLE.COM" });
  assert.deepEqual(linkTarget("#12"), { link: "12" });
  assert.deepEqual(linkTarget("#12:34"), { link: "12:34" });
  assert.deepEqual(linkTarget("#g3"), { group: "3" });
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://a.b", "//a.b", "example.com", "#", "#a b", "", "https://", `https://a.b/${"x".repeat(2100)}`, 'https://a.b/"x', "https://a.b/<x>"]) {
    assert.equal(linkTarget(bad), null, bad.slice(0, 40));
  }
  for (const text of ["[x](javascript:alert(1))", "[x](notalink)", "[x] (https://a.b)", "[](https://a.b)", "[x]()", "a [b] c (d)"]) {
    const [[line]] = parseBlocks(text);
    assert.deepEqual(line, [{ text, bold: false }], text);
  }
});

test("a note without a link reads as it did, and small print can hold a link", () => {
  const [[plain]] = parseBlocks("Drag ⬆️ the **handles** (both of them) [sic]");
  assert.ok(plain.every((piece) => piece.run === undefined && piece.url === undefined && piece.group === undefined));
  const [[, small]] = parseBlocks("Top\n###### see [the docs](https://a.example)");
  assert.equal(small.small, true);
  assert.equal(small[1].url, "https://a.example");
});

test("the tooltip names where a link goes", () => {
  assert.equal(urlLabel("https://www.youtube.com/@ausbossdev"), "youtube.com/@ausbossdev");
  assert.equal(urlLabel("https://example.com/"), "example.com");
  assert.equal(urlLabel("https://example.com/a/b/?q=1"), "example.com/a/b");
  assert.ok(urlLabel(`https://example.com/${"long/".repeat(30)}`).length <= 60);
});

test("the Link button wraps the selected words, or the word under the caret", () => {
  const apply = (text, start, end, target) => {
    const next = wrapLink(text, start, end, target);
    const out = text.slice(0, next.from) + next.insert + text.slice(next.to);
    return { text: out, selected: out.slice(next.selectionStart, next.selectionEnd) };
  };
  // No node picked: the address comes back selected, ready to be pasted over.
  assert.deepEqual(apply("watch the video now", 6, 15), { text: "watch [the video](https://) now", selected: "https://" });
  // A caret inside a word takes that word.
  assert.deepEqual(apply("watch the video", 8, 8), { text: "watch [the](https://) video", selected: "https://" });
  // A picked node or group is the target, and the caret lands after the link.
  assert.deepEqual(apply("see the seed", 8, 12, "#5"), { text: "see the [seed](#5)", selected: "" });
  assert.deepEqual(apply("the models", 4, 10, `#${targetId({ id: 3 }, true)}`), { text: "the [models](#g3)", selected: "" });
  // Nothing to wrap: the word "link" stands in.
  assert.deepEqual(apply("", 0, 0), { text: "[link](https://)", selected: "https://" });
  assert.deepEqual(apply("a  b", 2, 2), { text: "a [link](https://) b", selected: "https://" });
  // A selection over two lines or over brackets is not wrapped: a new link is put at its start.
  assert.equal(apply("one\ntwo", 0, 7).text, "[link](https://)one\ntwo");
  assert.equal(targetId({ id: 12 }), "12");
  assert.equal(targetId(null), "");
  assert.equal(arrowText("⬇️", targetId({ id: 3 }, true)), "⬇️#g3");
});

test("an address pasted over selected words makes them a link", () => {
  assert.equal(pastedLink("the video", "https://youtu.be/abc"), "[the video](https://youtu.be/abc)");
  assert.equal(pastedLink("the video", "  https://youtu.be/abc\n"), "[the video](https://youtu.be/abc)");
  // Not a link: nothing selected, two lines, brackets, something that is no address, an address over an address.
  assert.equal(pastedLink("", "https://a.example"), null);
  assert.equal(pastedLink("a\nb", "https://a.example"), null);
  assert.equal(pastedLink("[a]", "https://a.example"), null);
  assert.equal(pastedLink("the video", "just words"), null);
  assert.equal(pastedLink("https://old.example", "https://new.example"), null);
});

test("a link is a real link: a new tab, no way back to this page, and a press on it never drags the note", () => {
  const source = readFileSync(join(ROOT, "js", "callout", "index.js"), "utf-8");
  const run = source.slice(source.indexOf("function linkRun"), source.indexOf("// Bring a node or a group into view"));
  assert.match(run, /link\.target = "_blank"/);
  assert.match(run, /link\.rel = "noopener noreferrer"/);
  assert.match(run, /pointerdown[^\n]*stopPropagation/);
  // The address is only ever one the parser called http or https.
  assert.match(run, /link\.href = first\.url/);
  assert.equal(source.includes("window.open"), false);
});
