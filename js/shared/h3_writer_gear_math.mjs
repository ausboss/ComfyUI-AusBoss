// H3 Prompt Writer's model_asks: the node's own wording for each thing the
// small model is asked, as JSON in one hidden text input. Empty means the
// built-in wording. Kept free of app imports so node:test covers it.

const KEYS = ["describe", "next", "heard", "tidy"];

export function readAsks(value) {
  let found;
  try {
    found = value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
  if (!found || typeof found !== "object" || Array.isArray(found)) return {};
  const asks = {};
  for (const key of KEYS) {
    if (typeof found[key] === "string" && found[key].trim()) asks[key] = found[key];
  }
  return asks;
}

// The input's new text with one wording set, or taken out when empty.
export function writeAsks(value, key, words) {
  const asks = readAsks(value);
  if (String(words ?? "").trim()) asks[key] = String(words);
  else delete asks[key];
  return Object.keys(asks).length ? JSON.stringify(asks) : "";
}

export function editedAsks(value) {
  return new Set(Object.keys(readAsks(value)));
}
