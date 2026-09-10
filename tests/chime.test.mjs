import assert from "node:assert/strict";
import test from "node:test";

import { CHIME_RATE, CHIME_SECONDS, chimeSamples, wavBytes } from "../js/notify/chime.mjs";

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

test("the chime is a valid mono 16-bit PCM WAV", () => {
  const samples = chimeSamples();
  const bytes = wavBytes(samples);
  const view = new DataView(bytes.buffer);
  assert.equal(ascii(bytes, 0, 4), "RIFF");
  assert.equal(ascii(bytes, 8, 4), "WAVE");
  assert.equal(ascii(bytes, 12, 4), "fmt ");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), CHIME_RATE);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(ascii(bytes, 36, 4), "data");
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(samples.length, Math.round(CHIME_SECONDS * CHIME_RATE));
});

test("two soft notes: silent edges, gentle peaks, never clipped", () => {
  const samples = chimeSamples();
  const at = (seconds) => Math.round(seconds * CHIME_RATE);
  const loudest = (from, to) => Math.max(...Array.from(samples.slice(at(from), at(to)), Math.abs));
  assert.ok(Math.abs(samples[0]) < 1e-3, "starts from silence");
  assert.ok(loudest(0.015, 0.03) > 0.05, "the first note sounds");
  assert.ok(loudest(0.175, 0.19) > 0.05, "the second note sounds");
  assert.ok(loudest(0, CHIME_SECONDS) < 0.2, "soft and far from clipping");
  assert.ok(loudest(0.67, CHIME_SECONDS) < 1e-3, "fades out before the file ends");
});
