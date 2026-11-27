// Where the live preview (js/shared/live_stage.mjs) and Film Grain's Auto get
// the pictures a node works on, and how they are read.
//
// A picture is known at once when it comes straight from a Load Image: its
// file is read through ComfyUI's own /view route (the pack's routes only ever
// answer with data they made, never a file by its path). Any other source
// (a VAE Decode, another node's result) exists only after a run, so the node
// writes the pictures it worked from to ComfyUI's temp folder with its result
// (ui.ausboss_live) and the page keeps reading those; they are valid while
// the wiring is the one that run had (`connectionKey`).
import { linkById, sourceFileWidget, viewQueryForFile } from "./input_preview.mjs";
import { makeImage } from "./live_image.mjs";

// Only ComfyUI's own Load Image hands its file on untouched, as its first
// output. (The pack's Load Image can resize or pad, so it is not read this way.)
const DIRECT_TYPES = new Set(["LoadImage"]);

export function inputLink(node, name) {
  const input = node?.inputs?.find((candidate) => candidate?.name === name);
  return linkById(node?.graph, input?.link);
}

// How one input of the node will be known:
//   { state: "none" }                    nothing is wired to it
//   { state: "direct", query, key }      a Load Image's file: known at once
//   { state: "run", key }                known after one run
export function planInput(node, name) {
  const link = inputLink(node, name);
  if (!link) return { state: "none" };
  const origin = node.graph?.getNodeById?.(link.origin_id) ?? null;
  const widget = origin && DIRECT_TYPES.has(origin.type) && Number(link.origin_slot) === 0 ? sourceFileWidget(origin) : null;
  if (widget && widget.name === "image" && typeof widget.value === "string" && widget.value) {
    const query = viewQueryForFile(widget.value);
    return { state: "direct", query, key: `view:${query}` };
  }
  return { state: "run", key: `link:${link.id}:${link.origin_id}:${link.origin_slot}` };
}

// How many channels a source is read with. A Load Image's file is read as
// colour only, as ComfyUI's Load Image hands its see-through part to the
// mask and not to the picture; a picture a run kept carries its alpha.
export const channelsFor = (input, state) => (state === "direct" ? Math.min(input.channels, 3) : input.channels);

// What the wiring of these inputs is, as one string: the pictures a run kept
// belong to this wiring, and are not used once it changes.
export function connectionKey(node, names) {
  return names.map((name) => {
    const link = inputLink(node, name);
    return link ? `${name}=${link.id}:${link.origin_id}:${link.origin_slot}` : `${name}=-`;
  }).join("|");
}

// The /view query of one of the pictures a run kept (ui.ausboss_live[0][name]
// is { filename, subfolder, type }), or null.
export function keptQuery(record, name) {
  const entry = record?.ausboss_live?.[0]?.[name];
  if (!entry || typeof entry.filename !== "string" || !entry.filename) return null;
  return new URLSearchParams({ filename: entry.filename, subfolder: entry.subfolder ?? "", type: entry.type ?? "temp" }).toString();
}

// ---------- reading pixels ----------

const cache = new Map();
const CACHE_PIXELS = 40e6;

function forget() {
  let total = 0;
  for (const entry of cache.values()) total += entry.pixels;
  for (const [url, entry] of cache) {
    if (total <= CACHE_PIXELS || cache.size <= 1) break;
    cache.delete(url);
    total -= entry.pixels;
  }
}

// A picture's pixels as 8-bit RGBA: { w, h, data }. Rejects when the page
// cannot read pixels (a privacy browser hands back blank ones), so the
// caller falls back to showing the picture as it is.
export function loadPixels(url) {
  const held = cache.get(url);
  if (held) return held.promise;
  const entry = { pixels: 0, promise: null };
  entry.promise = (async () => {
    // An <img> rather than a fetch: it is the page's own picture, read from
    // ComfyUI's /view route like any other.
    const picture = new Image();
    picture.decoding = "async";
    picture.src = url;
    await picture.decode();
    const w = picture.naturalWidth;
    const h = picture.naturalHeight;
    if (!(w > 0 && h > 0)) throw new Error("The picture could not be read.");
    const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(picture, 0, 0);
    const { data } = context.getImageData(0, 0, w, h);
    if (pixelsLookBlocked(data)) throw new Error("This browser hides picture pixels from the page.");
    entry.pixels = w * h;
    return { w, h, data };
  })();
  cache.set(url, entry);
  entry.promise.then(forget, () => cache.delete(url));
  return entry.promise;
}

// A read that returns nothing but zeros, even the alpha, is a blocked read.
export function pixelsLookBlocked(data) {
  const step = Math.max(4, (Math.floor(data.length / 4 / 997) || 1) * 4);
  for (let i = 0; i < data.length; i += step) {
    if (data[i] || data[i + 1] || data[i + 2] || data[i + 3]) return false;
  }
  return data.length > 0;
}

// 8-bit RGBA pixels as a picture of 0-1 values: 3 channels (alpha dropped),
// 4 (kept), or 1 (the red channel: a mask is saved as grey).
export function pixelsToImage(pixels, channels = 3) {
  const { w, h, data } = pixels;
  const out = new Float32Array(w * h * channels);
  for (let i = 0; i < w * h; i += 1) {
    for (let k = 0; k < channels; k += 1) out[i * channels + k] = data[i * 4 + (channels === 1 ? 0 : k)] / 255;
  }
  return makeImage(w, h, channels, out);
}

// A part of a picture's pixels as 0-1 values: the window (x, y, w, h) with
// the picture's edge repeated past its sides, `channels` as for pixelsToImage.
export function windowImage(pixels, win, channels = 3) {
  const out = new Float32Array(win.w * win.h * channels);
  for (let y = 0; y < win.h; y += 1) {
    const sy = Math.min(Math.max(win.y + y, 0), pixels.h - 1);
    for (let x = 0; x < win.w; x += 1) {
      const sx = Math.min(Math.max(win.x + x, 0), pixels.w - 1);
      const at = (sy * pixels.w + sx) * 4;
      for (let k = 0; k < channels; k += 1) out[(y * win.w + x) * channels + k] = pixels.data[at + (channels === 1 ? 0 : k)] / 255;
    }
  }
  return makeImage(win.w, win.h, channels, out);
}

// The whole picture shrunk to w x h by averaging (torch's "area"), as 0-1
// values with `channels` channels. Reads 8-bit pixels directly, so a big
// picture is never held twice as floats.
export function scaledImage(pixels, outW, outH, channels = 3) {
  const out = new Float32Array(outW * outH * channels);
  const span = (inLength, outLength, i) => [Math.floor((i * inLength) / outLength), Math.max(Math.ceil(((i + 1) * inLength) / outLength), Math.floor((i * inLength) / outLength) + 1)];
  for (let oy = 0; oy < outH; oy += 1) {
    const [y0, y1] = span(pixels.h, outH, oy);
    for (let ox = 0; ox < outW; ox += 1) {
      const [x0, x1] = span(pixels.w, outW, ox);
      const count = (y1 - y0) * (x1 - x0);
      for (let k = 0; k < channels; k += 1) {
        let sum = 0;
        for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) sum += pixels.data[(y * pixels.w + x) * 4 + (channels === 1 ? 0 : k)];
        out[(oy * outW + ox) * channels + k] = sum / count / 255;
      }
    }
  }
  return makeImage(outW, outH, channels, out);
}

// The picture's brightness as one plane, for measuring its noise without
// holding the whole picture as floats.
export function lumaImage(pixels) {
  const out = new Float32Array(pixels.w * pixels.h);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (0.2126 * pixels.data[i * 4] + 0.7152 * pixels.data[i * 4 + 1] + 0.0722 * pixels.data[i * 4 + 2]) / 255;
  }
  return makeImage(pixels.w, pixels.h, 1, out);
}
