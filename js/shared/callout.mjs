// Callout 🆎: the decisions behind the note's text, with no DOM so node:test
// can run them.
//
// The text is plain lines. A blank line starts a new point, a leading "## "
// is ignored (older sticky notes were written that way), **bold** marks a
// word, and an arrow (an arrow emoji such as ⬆️, a plain ← → ↑ ↓, a pointing
// hand, or -> and <-) turns into one of the pack's teal arrows. An arrow
// followed at once by #12 is linked to node 12: the text keeps the link, so
// editing the words around it never moves it.
//
// Words in square brackets with a target in round brackets right after them
// are a link. [Watch the video](https://youtu.be/...) opens that page in a
// new tab; [the Seed box](#5) brings node 5 into view, the way a linked arrow
// does; [the models](#g3) brings group 3 into view. An arrow takes a group
// the same way: ⬇️#g3. Only http and https addresses become links: anything
// else in the round brackets leaves the text as typed. A release before this
// one shows the brackets and the address as text, so the address can still
// be read and copied there.
//
// A line that starts with six hashes ("###### ") is small print: the details
// under the line above it. Six, because every release before this one already
// drops one to six leading hashes, so a note with small print still reads
// right there, all at one size, and no note written before changes its look
// unless it used that one mark.

export const FONT_MIN = 12;
export const FONT_MAX = 30;

const VS16 = "️";

// The characters that become an arrow, and which way each one points.
const KIND_OF = new Map([
  ["⬆", "up"], ["⬇", "down"], ["⬅", "left"], ["➡", "right"],
  ["↗", "upright"], ["↘", "downright"], ["↙", "downleft"], ["↖", "upleft"],
  ["↕", "updown"], ["↔", "leftright"],
  ["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"],
  ["\u{1F446}", "up"], ["\u{1F447}", "down"], ["\u{1F448}", "left"], ["\u{1F449}", "right"],
  ["->", "right"], ["<-", "left"],
]);

// None of the keys holds a regex character, so they join as they are.
const ID = "[A-Za-z0-9_]+(?::[A-Za-z0-9_]+)*";
const LINK = `#(${ID})`;
// [words](target). The address may hold one pair of round brackets of its own.
const WORDS_LINK_RE = /\[([^\[\]\n]+)\]\(([^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)/g;
const URL_MAX = 2000;

// Where a link goes: { url }, { link } (a node's id) or { group } (a group's
// id), or null when the text is none of them. `raw` is what stands in the
// round brackets, or after an arrow's #.
export function linkTarget(raw) {
  const text = String(raw ?? "").trim();
  if (/^https?:\/\/[^\s<>"]+$/i.test(text) && text.length <= URL_MAX) return { url: text };
  const id = text.startsWith("#") ? text.slice(1) : null;
  if (id === null) return null;
  if (/^g\d+$/.test(id)) return { group: id.slice(1) };
  return new RegExp(`^${ID}$`).test(id) ? { link: id } : null;
}

// What a link's address is called in a tooltip: "youtube.com/@name".
export function urlLabel(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    const label = parsed.hostname.replace(/^www\./, "") + path;
    return label.length > 60 ? `${label.slice(0, 57)}...` : label;
  } catch {
    return String(url ?? "");
  }
}
const ARROW_RE = new RegExp(`(${[...KIND_OF.keys()].join("|")})${VS16}?(?:${LINK})?`, "gu");

// Degrees to turn the right-pointing arrow, and whether it has a head at
// both ends.
export const ARROW_ANGLE = {
  right: 0, downright: 45, down: 90, downleft: 135, left: 180, upleft: 225, up: 270, upright: 315,
  leftright: 0, updown: 90,
};
export const DOUBLE_ARROWS = new Set(["leftright", "updown"]);

// What the editor offers to insert, in the order it shows them.
export const ARROW_CHOICES = [
  ["up", "⬆️"], ["down", "⬇️"], ["left", "⬅️"], ["right", "➡️"],
  ["upleft", "↖️"], ["upright", "↗️"], ["downleft", "↙️"], ["downright", "↘️"],
];

// A heading mark at the start of a line, and the one that means small print.
const HEADING_RE = /^\s*#{1,6}\s+/;
const SMALL_RE = /^\s*#{6}\s+(?=\S)/;
export const SMALL_MARK = "###### ";

// Text -> points -> lines -> pieces. A piece is { text, bold } or
// { arrow, bold }. A line of small print is the same list of pieces with
// `small: true` set on it.
export function parseBlocks(text) {
  const blocks = [];
  let lines = [];
  const flush = () => {
    if (lines.length) blocks.push(lines);
    lines = [];
  };
  for (const raw of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(HEADING_RE, "").trim();
    if (!line) { flush(); continue; }
    const parts = pieces(line);
    if (SMALL_RE.test(raw)) parts.small = true;
    lines.push(parts);
  }
  flush();
  return blocks;
}

// The editor's Small button. Every written line the selection touches becomes
// small print; if they all are already, they go back to normal. Returns the
// text that replaces `from`..`to`, and where the selection sits afterwards.
export function toggleSmall(text, start = 0, end = start) {
  const value = String(text ?? "");
  const low = Math.max(0, Math.min(start, end));
  const high = Math.min(value.length, Math.max(start, end));
  const from = low === 0 ? 0 : value.lastIndexOf("\n", low - 1) + 1;
  const stop = value.indexOf("\n", high);
  const to = stop < 0 ? value.length : stop;
  const lines = value.slice(from, to).split("\n");
  const written = lines.filter((line) => line.trim());
  const allSmall = written.length > 0 && written.every((line) => SMALL_RE.test(line));
  const insert = lines
    .map((line) => {
      if (!line.trim()) return line;
      const bare = line.replace(HEADING_RE, "");
      return allSmall ? bare : SMALL_MARK + bare;
    })
    .join("\n");
  const grown = insert.length - (to - from);
  // A caret stays on its letter; a selection covers the lines it changed.
  const caret = Math.max(from, Math.min(from + insert.length, low + grown));
  return low === high
    ? { from, to, insert, selectionStart: caret, selectionEnd: caret }
    : { from, to, insert, selectionStart: from, selectionEnd: from + insert.length };
}

// A line as pieces. The words of one link carry its target (`url`, `link` or
// `group`) and the same `run` number, so the page can wrap them as one link.
function pieces(source) {
  // **[words](target)** is the same as [**words**](target).
  const line = source.replace(/\*\*(\[[^\[\]\n]+\])(\([^\s()]+(?:\([^\s()]*\)[^\s()]*)*\))\*\*/g, (_all, words, target) => `[**${words.slice(1, -1)}**]${target}`);
  const out = [];
  let last = 0;
  let run = 0;
  for (const match of line.matchAll(WORDS_LINK_RE)) {
    const target = linkTarget(match[2]);
    if (!target) continue; // not a link: its text is read with the rest of the line
    if (match.index > last) out.push(...styled(line.slice(last, match.index)));
    run += 1;
    // An arrow with a link of its own inside the words keeps that link.
    for (const piece of styled(match[1])) out.push(piece.link !== undefined || piece.group !== undefined ? piece : { ...piece, ...target, run });
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push(...styled(line.slice(last)));
  return out;
}

// Bold and arrows, in text that holds no link.
function styled(line) {
  const out = [];
  let last = 0;
  for (const match of line.matchAll(/\*\*(.+?)\*\*/g)) {
    if (match.index > last) out.push(...withArrows(line.slice(last, match.index), false));
    out.push(...withArrows(match[1], true));
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push(...withArrows(line.slice(last), false));
  return out;
}

function withArrows(text, bold) {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(ARROW_RE)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), bold });
    const piece = { arrow: KIND_OF.get(match[1]), bold };
    // #12 is a node, #g3 a group.
    if (match[2] !== undefined) Object.assign(piece, linkTarget(`#${match[2]}`) ?? { link: match[2] });
    out.push(piece);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold });
  return out;
}

// The largest whole-pixel size in [min, max] that fits. `fits(px)` is true
// when the text at that size stays inside its box. Falls back to min.
export function fitFontSize(fits, min = FONT_MIN, max = FONT_MAX) {
  let low = min;
  let high = max;
  if (fits(high)) return high;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

// The text for one arrow: the emoji, and the node it is linked to if any.
export function arrowText(emoji, nodeId) {
  return nodeId === undefined || nodeId === null || nodeId === "" ? emoji : `${emoji}#${nodeId}`;
}

// What stands after # for a picked node or group: "12", or "g3" for a group.
export function targetId(item, isGroup = false) {
  const id = item?.id;
  if (id === undefined || id === null || id === "") return "";
  return isGroup ? `g${id}` : String(id);
}

// The editor's Link button. The selected words become a link; with nothing
// selected, the word the caret is in does, and with no word there, the word
// "link". `target` is "#12" or "#g3" for a picked node or group; without one
// the address is "https://" and comes back selected, so the next paste or
// keystroke replaces it. Returns the text that replaces `from`..`to`, and
// where the selection sits afterwards.
export function wrapLink(text, start = 0, end = start, target = "") {
  const value = String(text ?? "");
  let from = Math.max(0, Math.min(start, end));
  let to = Math.min(value.length, Math.max(start, end));
  if (from === to) {
    while (from > 0 && /\S/.test(value[from - 1]) && !/[\[\]()]/.test(value[from - 1])) from -= 1;
    while (to < value.length && /\S/.test(value[to]) && !/[\[\]()]/.test(value[to])) to += 1;
  }
  const picked = value.slice(from, to);
  // A link's words stay on one line and hold no square brackets.
  const words = picked.includes("\n") || /[\[\]]/.test(picked) || !picked.trim() ? "" : picked;
  if (!words && from !== to) { from = Math.max(0, Math.min(start, end)); to = from; }
  const shown = words || "link";
  const address = target || "https://";
  const insert = `[${shown}](${address})`;
  const addressAt = from + shown.length + 3;
  return target
    ? { from, to, insert, selectionStart: from + insert.length, selectionEnd: from + insert.length }
    : { from, to, insert, selectionStart: addressAt, selectionEnd: addressAt + address.length };
}

// Pasting an address over selected words makes them a link to it. Returns
// the text that replaces the selection, or null when this is an ordinary
// paste.
export function pastedLink(selected, pasted) {
  const words = String(selected ?? "");
  const target = linkTarget(String(pasted ?? "").trim());
  if (!target?.url || !words.trim() || words.includes("\n") || /[\[\]]/.test(words)) return null;
  if (linkTarget(words.trim())?.url) return null; // an address over an address is just a paste
  return `[${words}](${target.url})`;
}

// A pasted note's text, its links pointed at the pasted copies of the nodes
// and groups they name. `nodes` and `groups` map an old id (as text) to its
// copy's id (js/shared/paste_ids.mjs). A link to anything the paste did not
// copy is kept as typed. Returns null when no link changes.
export function repointLinks(text, nodes, groups) {
  let changed = false;
  const follow = (raw) => {
    const target = linkTarget(raw);
    const isGroup = target?.group !== undefined;
    const old = isGroup ? target.group : target?.link;
    const copy = old === undefined ? undefined : (isGroup ? groups : nodes)?.get(String(old));
    if (copy === undefined || copy === null) return raw;
    changed = true;
    return `#${isGroup ? "g" : ""}${copy}`;
  };
  const next = String(text ?? "")
    .replace(WORDS_LINK_RE, (_all, words, address) => `[${words}](${follow(address)})`)
    .replace(ARROW_RE, (all, _arrow, id) => (id === undefined ? all : `${all.slice(0, -id.length - 1)}${follow(`#${id}`)}`));
  return changed ? next : null;
}
