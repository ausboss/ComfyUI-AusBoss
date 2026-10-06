// Callout 🆎: the decisions behind the note's text, with no DOM so node:test
// can run them.
//
// The text is plain lines. A blank line starts a new point, a leading "## "
// is ignored (older sticky notes were written that way), **bold** marks a
// word, and an arrow (an arrow emoji such as ⬆️, a plain ← → ↑ ↓, a pointing
// hand, or -> and <-) turns into one of the pack's teal arrows. An arrow
// followed at once by #12 is linked to node 12: the text keeps the link, so
// editing the words around it never moves it.

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
const LINK = "#([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)*)";
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

// Text -> points -> lines -> pieces. A piece is { text, bold } or
// { arrow, bold }.
export function parseBlocks(text) {
  const blocks = [];
  let lines = [];
  const flush = () => {
    if (lines.length) blocks.push(lines);
    lines = [];
  };
  for (const raw of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/^\s*#{1,6}\s+/, "").trim();
    if (!line) flush();
    else lines.push(pieces(line));
  }
  flush();
  return blocks;
}

function pieces(line) {
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
    if (match[2] !== undefined) piece.link = match[2];
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
