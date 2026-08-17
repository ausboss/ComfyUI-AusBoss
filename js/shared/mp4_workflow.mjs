// Pure byte parsing for the workflow Save Video 🆎 embeds in its mp4s.
//
// The backend writes container metadata with ffmpeg's use_metadata_tags flag,
// which lands as the ISO BMFF "mdta" scheme: moov > udta > meta holding a
// `keys` atom (key names) and an `ilst` atom (values indexed by key number).
// This module walks those boxes and returns the embedded JSON strings. It is
// dependency-free so node:test can drive it directly.

const UTF8 = new TextDecoder();

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return null;
}

function fourcc(bytes, offset) {
  return String.fromCharCode(
    bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3],
  );
}

function u32(view, offset) {
  return view.getUint32(offset);
}

// List the child boxes of [start, end). Each entry carries the type both as a
// string and as the raw uint32, because ilst entries use a key index where
// every other box keeps a printable four-character code. Corrupt or truncated
// sizes stop the walk instead of throwing.
function childBoxes(bytes, view, start, end) {
  const children = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(view, offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = u32(view, offset + 8) * 2 ** 32 + u32(view, offset + 12);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    children.push({
      type: fourcc(bytes, offset + 4),
      rawType: u32(view, offset + 4),
      start: offset + headerSize,
      end: offset + size,
    });
    offset += size;
  }
  return children;
}

function findChild(children, type) {
  return children.find((child) => child.type === type) ?? null;
}

// keys atom: fullbox (version/flags), entry count, then per entry a size,
// a namespace code (mdta), and the key name. Returns names in atom order.
function parseKeys(bytes, view, box) {
  if (box.end - box.start < 8) return [];
  const names = [];
  const count = u32(view, box.start + 4);
  let offset = box.start + 8;
  while (names.length < count && offset + 8 <= box.end) {
    const size = u32(view, offset);
    if (size < 8 || offset + size > box.end) break;
    names.push(UTF8.decode(bytes.subarray(offset + 8, offset + size)));
    offset += size;
  }
  return names;
}

// ilst atom: each child's type is a 1-based index into keys; its `data`
// sub-box carries a type code (1 = UTF-8), a locale, then the payload.
function parseIlst(bytes, view, box, names) {
  const tags = {};
  for (const entry of childBoxes(bytes, view, box.start, box.end)) {
    const name = names[entry.rawType - 1];
    if (!name) continue;
    const data = findChild(childBoxes(bytes, view, entry.start, entry.end), "data");
    if (!data || data.end - data.start < 8) continue;
    if (u32(view, data.start) !== 1) continue; // not UTF-8 text
    tags[name] = UTF8.decode(bytes.subarray(data.start + 8, data.end));
  }
  return tags;
}

export function looksLikeMp4(input) {
  const bytes = toBytes(input);
  return !!bytes && bytes.length >= 12 && fourcc(bytes, 4) === "ftyp";
}

// All UTF-8 metadata tags embedded via the mdta scheme, as name -> string.
// Empty object when the file has none or the bytes are not a usable mp4.
export function extractMp4MetadataTags(input) {
  const bytes = toBytes(input);
  if (!bytes || !looksLikeMp4(bytes)) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = findChild(childBoxes(bytes, view, 0, bytes.length), "moov");
  if (!moov) return {};
  const udta = findChild(childBoxes(bytes, view, moov.start, moov.end), "udta");
  if (!udta) return {};
  const meta = findChild(childBoxes(bytes, view, udta.start, udta.end), "meta");
  if (!meta) return {};
  // ISO files make meta a fullbox (4 bytes of version/flags before the first
  // child); QuickTime-brand files do not. Try both offsets.
  for (const start of [meta.start + 4, meta.start]) {
    if (start > meta.end) continue;
    const children = childBoxes(bytes, view, start, meta.end);
    const keysBox = findChild(children, "keys");
    const ilstBox = findChild(children, "ilst");
    if (keysBox && ilstBox) {
      return parseIlst(bytes, view, ilstBox, parseKeys(bytes, view, keysBox));
    }
  }
  return {};
}

function parseJson(text) {
  if (typeof text !== "string" || !text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

// The embedded graphs as objects: `workflow` (editor format) and `prompt`
// (API format). Either is null when missing or unparseable.
export function mp4WorkflowPayload(input) {
  const tags = extractMp4MetadataTags(input);
  return { workflow: parseJson(tags.workflow), prompt: parseJson(tags.prompt) };
}
