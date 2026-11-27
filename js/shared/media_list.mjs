// Pure decisions behind the media picker (media_picker.mjs): which query
// /view needs for a combo value, which values a filter keeps, how a value
// splits into folder and name, and where the highlight moves. No DOM, so
// node:test covers them.

import { parseImageReference } from "./pad_canvas.mjs";

// "pasted/image (2).png" or "clip.mp4 [output]" -> "filename=...&subfolder=...&type=...".
export function mediaViewQuery(value) {
  const reference = parseImageReference(value);
  return reference ? new URLSearchParams(reference).toString() : "";
}

// Every space-separated term must appear in the value, ignoring case, so
// "night png" finds "pasted/ausboss_night_bridge.png".
export function filterMedia(values, query) {
  const list = Array.isArray(values) ? values.map(String) : [];
  const terms = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return list;
  return list.filter((value) => {
    const text = value.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

// The value to add to a media widget's list, or "" when the list has it. A
// value counts as listed with or without its " [input]" tail, which is how
// the frontend looks one up before it calls a picture missing.
export function unlistedMedia(values, value) {
  const text = String(value ?? "");
  if (!text || !Array.isArray(values)) return "";
  const bare = text.replace(/\s+\[input\]$/, "");
  return values.includes(text) || values.includes(bare) ? "" : text;
}

// The dim folder prefix and the name the list shows for one value.
export function mediaLabel(value) {
  const reference = parseImageReference(value);
  if (!reference) return { folder: "", name: String(value ?? "") };
  const where = reference.type === "input" ? "" : ` [${reference.type}]`;
  return { folder: reference.subfolder ? `${reference.subfolder}/` : "", name: `${reference.filename}${where}` };
}

// Arrow-key movement that stops at the ends; -1 when there is nothing to
// highlight. From no highlight, down starts at the top and up at the bottom.
export function moveHighlight(index, delta, length) {
  if (!(length > 0)) return -1;
  if (index < 0 || index >= length) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, index + delta));
}

// Keep every file in memory but only present one folder at a time; searching
// is global, like ComfyUI's default file selector. Values remain unchanged so
// ComfyUI's image widget still receives the full original filename.
export function browseMediaRows(options, query, directory = [], bare = (value) => value) {
  if (String(query ?? "").trim()) {
    return filterMedia(options, query).map((value) => ({ kind: "file", value }));
  }
  const folders = new Map();
  const files = [];
  for (const value of options) {
    const parts = bare(value).replace(/\\/g, "/").split("/").filter(Boolean);
    if (!directory.every((part, i) => parts[i] === part)) continue;
    const name = parts[directory.length];
    if (!name) continue;
    if (parts.length > directory.length + 1) {
      if (!folders.has(name)) folders.set(name, { kind: "folder", label: name, directory: [...directory, name] });
    } else {
      files.push({ kind: "file", value });
    }
  }
  return [
    ...(directory.length ? [{ kind: "back", label: "..", directory: directory.slice(0, -1) }] : []),
    ...folders.values(),
    ...files,
  ];
}

// The folder a picked file sits in, as the parts browseMediaRows takes, so
// the picker opens where the current pick is. A top-level file gives [].
export function mediaFolderOf(value, bare = (v) => v) {
  const parts = bare(String(value ?? "")).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(0, -1);
}

// Virtual scrolling uses a fixed row height. The DOM only contains this range
// while the scroll container's spacer retains the height of the entire list.
export function visibleMediaRange(total, scrollTop, height, rowHeight, overscan) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  return { first, last };
}
