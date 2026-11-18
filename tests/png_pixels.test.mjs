import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { decodePng } from "../js/shared/png_pixels.mjs";

// A small PNG writer for the tests: every row uses the filter given for it,
// so each of PNG's five filters is undone at least once.
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function encode(width, height, colour, pixels, filters, { split = false } = {}) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length];
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const v = pixels[y * stride + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];
      raw[y * (stride + 1) + 1 + x] = (v - predicted) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = colour;
  const data = deflateSync(raw);
  const idat = split ? [data.subarray(0, 7), data.subarray(7)] : [data];
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    ...idat.map((part) => chunk("IDAT", part)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const noise = (count, seed = 7) => Uint8Array.from({ length: count }, (_, i) => (i * 73 + seed * 31 + ((i * i) >> 3)) & 255);

test("every PNG filter decodes back to the exact bytes, in each colour layout the server writes", async () => {
  const width = 5, height = 6;
  for (const colour of [0, 2, 4, 6]) {
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
    const pixels = noise(width * height * channels, colour);
    const png = await decodePng(encode(width, height, colour, pixels, [0, 1, 2, 3, 4], { split: colour === 2 }));
    assert.equal(png.width, width); assert.equal(png.height, height);
    for (let i = 0; i < width * height; i++) {
      const p = pixels.subarray(i * channels, (i + 1) * channels);
      const want = channels === 1 ? [p[0], p[0], p[0], 255]
        : channels === 2 ? [p[0], p[0], p[0], p[1]]
          : channels === 3 ? [p[0], p[1], p[2], 255] : [...p];
      assert.deepEqual(Array.from(png.rgba.subarray(i * 4, i * 4 + 4)), want, `colour ${colour} pixel ${i}`);
    }
  }
});

// The packed planes carry 24 masks in one picture: one wrong bit is a
// wrong mask, so colour and see-through values must come back untouched.
test("see-through pixels keep their colour, as a packed mask needs", async () => {
  const pixels = Uint8Array.from([10, 20, 30, 0, 200, 100, 50, 1, 255, 255, 255, 255]);
  const png = await decodePng(encode(3, 1, 6, pixels, [0]));
  assert.deepEqual(Array.from(png.rgba), Array.from(pixels));
});

test("a file it cannot read throws, so the face falls back to a canvas read", async () => {
  await assert.rejects(decodePng(new Uint8Array([1, 2, 3])));
  const sixteenBit = encode(1, 1, 0, Uint8Array.of(9), [0]);
  sixteenBit[24] = 16; // IHDR bit depth
  await assert.rejects(decodePng(sixteenBit));
});

test("Mask by Touch reads the files its server made from their bytes, not a canvas", () => {
  const stage = readFileSync(new URL("../js/shared/touch_stage.mjs", import.meta.url), "utf8");
  const reads = [...stage.matchAll(/readPixels\(/g)].length;
  // The definition and the one fallback inside loadPixels.
  assert.equal(reads, 2);
  assert.match(stage, /async function loadPixels\([^)]*\) \{[\s\S]*?decodePng\([\s\S]*?readPixels\(/);
});
