import assert from "node:assert/strict";
import test from "node:test";

import { scriptMarkup } from "../js/shared/script_colours_math.mjs";
import { rulerSeconds } from "../js/shared/moment_strip_math.mjs";

const strip = (html) => html.replace(/<[^>]+>/g, "").replace(/​/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("the coloured copy holds exactly the typed text, so both wrap the same", () => {
  const text = 'She says "hi <there> & bye".\n\n3s: @1 runs\nmusic: piano\n';
  assert.equal(strip(scriptMarkup(text)).replace(/ $/, ""), text);
});

test("@ names, times, labels and quotes get their colour", () => {
  const html = scriptMarkup('3s: @1 says "go"\nmusic: piano');
  assert.match(html, /<span class="time">3s:<\/span>/);
  assert.match(html, /<span class="at">@1<\/span>/);
  assert.match(html, /<span class="say">"go"<\/span>/);
  assert.match(html, /<span class="key">music:<\/span>/);
});

test("a picture that is not plugged in shows amber", () => {
  const html = scriptMarkup("@1 meets @2 and @5", (number) => number === 1);
  assert.match(html, /<span class="at">@1<\/span>/);
  assert.match(html, /<span class="at unknown">@2<\/span>/);
  assert.match(html, /<span class="at unknown">@5<\/span>/);
});

test("a blank line between lines is a cut, once, and no cuts turns it off", () => {
  assert.equal((scriptMarkup("a\n\n\nb").match(/class="cut"/g) ?? []).length, 1);
  assert.equal((scriptMarkup("\n\na\n\n").match(/class="cut"/g) ?? []).length, 0);
  assert.equal((scriptMarkup("no cuts\na\n\nb").match(/class="cut"/g) ?? []).length, 0);
  assert.equal((scriptMarkup("a\n\nmusic: piano").match(/class="cut"/g) ?? []).length, 0);
});

test("typed markup is shown as text, never run", () => {
  assert.doesNotMatch(scriptMarkup("<img src=x onerror=alert(1)>"), /<img/);
});

test("the bar marks every second up to 10 s, every other one after, and always the end", () => {
  assert.deepEqual(rulerSeconds(8), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(rulerSeconds(15), [0, 2, 4, 6, 8, 10, 12, 15]);
  assert.deepEqual(rulerSeconds(12), [0, 2, 4, 6, 8, 10, 12]);
});

test("dragging a block types its second into its own line", async () => {
  const { retime, dragRange } = await import("../js/shared/moment_strip_math.mjs");
  assert.equal(retime("@1 walks.\n@1 sits.", 1, 2), "@1 walks.\n2s: @1 sits.");
  assert.equal(retime("@1 walks.\n  3s: @1 sits.", 1, 5), "@1 walks.\n  5s: @1 sits.", "an old time gives way");
  assert.equal(retime("@1 walks.\nat 4 seconds, she sits", 1, 6), "@1 walks.\n6s: she sits");
  assert.equal(retime("@1 walks.", 7, 2), "@1 walks.", "a line that isn't there changes nothing");
  assert.deepEqual(dragRange([{ start: 0 }, { start: 4 }, { start: 6 }], 1, 8), [1, 5]);
  assert.deepEqual(dragRange([{ start: 0 }, { start: 4 }], 1, 8), [1, 7]);
  assert.equal(dragRange([{ start: 0 }, { start: 0.5 }, { start: 1 }], 1, 8), null, "no whole second fits");
});

test("moving a block swaps the words; times and cuts stay in place", async () => {
  const { moveMoment, toggleCut } = await import("../js/shared/moment_strip_math.mjs");
  const text = "A walks.\n3s: B sits.\n\n6s: C runs.\nmusic: x";
  assert.equal(moveMoment(text, [0, 1, 3], 2, 0), "C runs.\n3s: A walks.\n\n6s: B sits.\nmusic: x");
  assert.equal(moveMoment(text, [0, 1, 3], 0, 2), "B sits.\n3s: C runs.\n\n6s: A walks.\nmusic: x");
  assert.equal(moveMoment(text, [0, 1, 3], 1, 1), text);
  assert.equal(moveMoment(text, [0, 9], 0, 1), text, "a line that isn't there changes nothing");
  assert.equal(toggleCut(text, 3), "A walks.\n3s: B sits.\n6s: C runs.\nmusic: x", "a cut comes out");
  assert.equal(toggleCut(text, 1), "A walks.\n\n3s: B sits.\n\n6s: C runs.\nmusic: x", "a cut goes in");
  assert.equal(toggleCut("A.\n\n\nB.", 3), "A.\nB.", "every blank line before it goes");
  assert.equal(toggleCut(text, 0), text);
});
