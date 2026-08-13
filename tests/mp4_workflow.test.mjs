import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMp4MetadataTags,
  looksLikeMp4,
  mp4WorkflowPayload,
} from "../js/shared/mp4_workflow.mjs";

// --- synthetic fixture ------------------------------------------------------
// Builds the exact atom layout ffmpeg's mov muxer emits for use_metadata_tags:
// moov > udta > meta(fullbox) > hdlr("mdta") + keys + ilst.

const ASCII = new TextEncoder();

function u32(value) {
  return Uint8Array.from([
    (value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255,
  ]);
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function box(type, ...parts) {
  const payload = concat(parts);
  return concat([u32(payload.length + 8), ASCII.encode(type), payload]);
}

function fullbox(type, ...parts) {
  return box(type, u32(0), ...parts);
}

function keysBox(names) {
  const entries = names.map((name) => {
    const encoded = ASCII.encode(name);
    return concat([u32(8 + encoded.length), ASCII.encode("mdta"), encoded]);
  });
  return fullbox("keys", u32(names.length), ...entries);
}

function ilstEntry(index, text, dataType = 1) {
  const data = box("data", u32(dataType), u32(0), ASCII.encode(text));
  return concat([u32(data.length + 8), u32(index), data]);
}

function metaChildren(entries) {
  const hdlr = fullbox("hdlr", u32(0), ASCII.encode("mdta"), u32(0), u32(0), u32(0));
  return [hdlr, keysBox(entries.map(([name]) => name)),
    box("ilst", ...entries.map(([, payload], i) => ilstEntry(i + 1, payload)))];
}

const WORKFLOW = { nodes: [{ id: 1 }], links: [] };
const PROMPT = { 1: { class_type: "AUSBOSS_NODES_LoadVideo" } };

function fixture({ metaIsFullbox = true, entries } = {}) {
  const tagged = entries ?? [
    ["prompt", JSON.stringify(PROMPT)],
    ["workflow", JSON.stringify(WORKFLOW)],
    ["encoder", "Lavf62.3.100"],
  ];
  const children = metaChildren(tagged);
  const meta = metaIsFullbox ? fullbox("meta", ...children) : box("meta", ...children);
  return concat([
    box("ftyp", ASCII.encode("isomiso2avc1")),
    box("moov", box("mvhd", new Uint8Array(20)), box("udta", meta)),
    box("mdat", Uint8Array.from([1, 2, 3, 4])),
  ]);
}

// --- tests ------------------------------------------------------------------

test("workflow and prompt round-trip through the metadata atoms", () => {
  const bytes = fixture();
  assert.equal(looksLikeMp4(bytes), true);
  const tags = extractMp4MetadataTags(bytes);
  assert.equal(tags.encoder, "Lavf62.3.100");
  const { workflow, prompt } = mp4WorkflowPayload(bytes);
  assert.deepEqual(workflow, WORKFLOW);
  assert.deepEqual(prompt, PROMPT);
});

test("QuickTime-style meta without version bytes still parses", () => {
  const { workflow } = mp4WorkflowPayload(fixture({ metaIsFullbox: false }));
  assert.deepEqual(workflow, WORKFLOW);
});

test("non-mp4 bytes are rejected without throwing", () => {
  const junk = Uint8Array.from({ length: 64 }, (_, i) => i * 7 % 256);
  assert.equal(looksLikeMp4(junk), false);
  assert.deepEqual(extractMp4MetadataTags(junk), {});
  assert.deepEqual(mp4WorkflowPayload(junk), { workflow: null, prompt: null });
  assert.deepEqual(mp4WorkflowPayload(null), { workflow: null, prompt: null });
});

test("an mp4 without embedded metadata yields empty tags", () => {
  const plain = concat([
    box("ftyp", ASCII.encode("isomiso2")),
    box("moov", box("mvhd", new Uint8Array(20))),
  ]);
  assert.deepEqual(extractMp4MetadataTags(plain), {});
});

test("truncated files never throw", () => {
  const bytes = fixture();
  for (const length of [0, 4, 9, 40, bytes.length - 7, bytes.length - 1]) {
    assert.doesNotThrow(() => extractMp4MetadataTags(bytes.subarray(0, length)));
  }
});

test("entries with unknown key indexes or non-text data are skipped", () => {
  const children = metaChildren([["workflow", JSON.stringify(WORKFLOW)]]);
  const rogueIlst = box(
    "ilst",
    ilstEntry(1, JSON.stringify(WORKFLOW)),
    ilstEntry(9, "orphan value"), // no ninth key
    ilstEntry(1, "binary", 0), // data type 0 is not UTF-8
  );
  const meta = fullbox("meta", children[0], children[1], rogueIlst);
  const bytes = concat([
    box("ftyp", ASCII.encode("isomiso2")),
    box("moov", box("udta", meta)),
  ]);
  assert.deepEqual(extractMp4MetadataTags(bytes), { workflow: JSON.stringify(WORKFLOW) });
});

test("invalid embedded JSON becomes null instead of an exception", () => {
  const bytes = fixture({ entries: [["workflow", "{not json"], ["prompt", "42"]] });
  assert.deepEqual(mp4WorkflowPayload(bytes), { workflow: null, prompt: null });
});
