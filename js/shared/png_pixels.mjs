// Reads a PNG's pixels straight from its bytes, without a canvas.
//
// Some browsers and privacy add-ons (Firefox's fingerprint protection,
// canvas blockers) hand back blank or made-up pixels when a page reads a
// canvas. A node that needs the exact numbers in a picture the server made,
// such as Mask by Touch's packed masks, reads them here instead: the bytes
// are unpacked with the browser's own DecompressionStream, which no privacy
// setting touches.
//
// Handles what the pack's server writes: 8 bits per channel, not
// interlaced, grey, grey + alpha, RGB or RGBA (Pillow's L, LA, RGB, RGBA).
// Anything else throws, and the caller falls back to a canvas read.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function chunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const list = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (at + 12 + length > bytes.length) throw new Error("PNG is cut short");
    list.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === "IEND") break;
  }
  return list;
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Undoes PNG's per-row filters in place; returns the bare rows.
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("PNG data is cut short");
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const at = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[at + x - channels] : 0;
      const up = y > 0 ? out[at + x - stride] : 0;
      const corner = y > 0 && x >= channels ? out[at + x - stride - channels] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, corner);
      else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      out[at + x] = value & 255;
    }
  }
  return out;
}

// PNG bytes -> { width, height, rgba }: RGBA bytes, not premultiplied, as a
// canvas would give them when it reads true.
export async function decodePng(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8 || SIGNATURE.some((value, i) => bytes[i] !== value)) throw new Error("not a PNG");
  const list = chunks(bytes);
  const header = list[0]?.type === "IHDR" ? list[0].data : null;
  if (!header || header.length < 13) throw new Error("PNG has no header");
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(0), height = view.getUint32(4);
  const depth = header[8], colour = header[9], interlace = header[12];
  const channels = CHANNELS[colour];
  if (depth !== 8 || !channels || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`);
  if (!width || !height) throw new Error("PNG has no pixels");
  const idat = list.filter((chunk) => chunk.type === "IDAT");
  const joined = new Uint8Array(idat.reduce((sum, chunk) => sum + chunk.data.length, 0));
  let at = 0;
  for (const chunk of idat) { joined.set(chunk.data, at); at += chunk.data.length; }
  const pixels = unfilter(await inflate(joined), width, height, channels);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const o = i * 4;
    if (channels <= 2) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[p];
      rgba[o + 3] = channels === 2 ? pixels[p + 1] : 255;
    } else {
      rgba[o] = pixels[p]; rgba[o + 1] = pixels[p + 1]; rgba[o + 2] = pixels[p + 2];
      rgba[o + 3] = channels === 4 ? pixels[p + 3] : 255;
    }
  }
  return { width, height, rgba };
}
