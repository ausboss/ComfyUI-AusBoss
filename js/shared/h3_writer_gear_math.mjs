// H3 Prompt Writer's model_asks: the node's own wording for each thing the
// small model is asked, as JSON in one hidden text input. Empty means the
// built-in wording. Kept free of app imports so node:test covers it.

const KEYS = ["describe", "next", "heard", "tidy"];
// The longest wording the writer reads (LONGEST_ASK in nodes/_h3_model_asks.py).
export const LONGEST_ASK = 8000;

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

// The names the writer fills into each wording (fill_words in
// nodes/_h3_script_helpers.py), and what each one tells the model.
const FILLS = {
  next: { seconds: "how long the clip is", first: "what happens first", count: "how many lines to write" },
  heard: { lines: "what happens in the clip" },
};
const NAME = /\{(\w+)\}/g;
const listed = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const namesIn = (text) => [...new Set([...String(text ?? "").matchAll(NAME)].map((match) => match[1]))];

// What a node's own wording would lose, or send as typed, in plain words:
// a name the built-in wording fills in that it no longer has, and a name
// the writer does not fill in. Empty when it has neither.
export function wordingWarning(key, words, built) {
  const fills = FILLS[key] ?? {};
  const fillsIn = (name) => Object.hasOwn(fills, name);
  const typed = namesIn(words);
  const missing = namesIn(built).filter((name) => fillsIn(name) && !typed.includes(name));
  const unknown = typed.filter((name) => !fillsIn(name));
  const said = [];
  if (missing.length) {
    said.push(`Without ${listed(missing.map((name) => `{${name}}`))}, the model is not told ${listed(missing.map((name) => fills[name]))}.`);
  }
  if (unknown.length) {
    const many = unknown.length > 1;
    said.push(`${listed(unknown.map((name) => `{${name}}`))} ${many ? "are" : "is"} not filled in: the model reads ${many ? "them" : "it"} as typed.`);
  }
  return said.join(" ");
}
