import assert from "node:assert/strict";
import test from "node:test";

import { copyToClipboard } from "../js/shared/clipboard.mjs";

function fakeDocument(copyResult) {
  const appended = [];
  const doc = {
    copied: null,
    body: { appendChild: (element) => appended.push(element) },
    createElement: () => {
      const element = {
        value: "",
        style: {},
        setAttribute() {},
        select() { doc.selected = element.value; },
        remove() { element.removed = true; },
      };
      return element;
    },
    execCommand(command) {
      if (command !== "copy") return false;
      if (copyResult instanceof Error) throw copyResult;
      if (copyResult) doc.copied = doc.selected;
      return copyResult;
    },
  };
  return { doc, appended };
}

test("the Clipboard API is used when the page has it", async () => {
  const written = [];
  const clipboard = { writeText: async (text) => { written.push(text); } };
  assert.equal(await copyToClipboard(42, { clipboard, document: null }), true);
  assert.deepEqual(written, ["42"]);
});

test("plain http has no Clipboard API: the copy command takes over", async () => {
  const { doc, appended } = fakeDocument(true);
  assert.equal(await copyToClipboard("seed 7", { clipboard: undefined, document: doc }), true);
  assert.equal(doc.copied, "seed 7");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].removed, true, "the helper textarea is cleaned up");
});

test("a refused Clipboard API falls back to the copy command", async () => {
  const clipboard = { writeText: async () => { throw new Error("NotAllowedError"); } };
  const { doc } = fakeDocument(true);
  assert.equal(await copyToClipboard("x", { clipboard, document: doc }), true);
  assert.equal(doc.copied, "x");
});

test("nothing copied reports false instead of a false success", async () => {
  assert.equal(await copyToClipboard("x", { clipboard: undefined, document: null }), false);
  const refused = fakeDocument(false);
  assert.equal(await copyToClipboard("x", { clipboard: undefined, document: refused.doc }), false);
  const throws = fakeDocument(new Error("SecurityError"));
  assert.equal(await copyToClipboard("x", { clipboard: undefined, document: throws.doc }), false);
  assert.equal(throws.appended[0].removed, true);
});
