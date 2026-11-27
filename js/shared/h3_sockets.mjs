// Which sockets H3 Prompt Writer 🆎 shows. The node keeps every socket in
// its lists, so a saved workflow and what is sent are unchanged; the ones
// not in use are only left out of the drawing (js/h3_sockets/index.js).
//
// Kept free of /scripts/app.js imports so node:test can cover it
// (tests/h3_sockets.test.mjs).

const PICTURES = ["picture_1", "picture_2", "picture_3", "picture_4"];

export const INPUT_NAMES = ["clip", ...PICTURES, "video", "video_sound", "voice", "song"];
export const OUTPUT_NAMES = [
  "prompt", ...PICTURES, "video", "video_sound", "voice", "song", "song_under",
  "frames", "width", "height", "keeps_clip_sound",
];

// The setting that shows every socket, and every picture chip, all the time.
export const SHOW_ALL = "AusBoss.H3PromptWriter.ShowEverySocket";

const ALWAYS_IN = ["clip", "video", "voice", "song"];
const ALWAYS_OUT = ["prompt", "frames", "width", "height"];
// An output that shows once the input of the same name has a wire.
const FOLLOWS_ITS_INPUT = ["video", "video_sound", "voice", "song"];

// The names of the sockets to draw. A socket with a wire on it always shows.
export function socketsToShow({ wiredInputs = [], wiredOutputs = [], showAll = false } = {}) {
  if (showAll) return { inputs: new Set(INPUT_NAMES), outputs: new Set(OUTPUT_NAMES) };
  const wired = new Set(wiredInputs);
  const inputs = new Set([...ALWAYS_IN, ...wired]);
  const outputs = new Set([...ALWAYS_OUT, ...wiredOutputs]);

  // Every picture up to the last wired one, and the next free one after it.
  const lastWired = PICTURES.reduce((last, name, index) => (wired.has(name) ? index : last), -1);
  PICTURES.slice(0, lastWired + 2).forEach((name) => inputs.add(name));
  // The pictures come out in order, so two wired pictures are outputs 1 and
  // 2 whichever inputs they are on.
  const pictures = PICTURES.filter((name) => wired.has(name)).length;
  PICTURES.slice(0, pictures).forEach((name) => outputs.add(name));

  if (wired.has("video")) inputs.add("video_sound");
  FOLLOWS_ITS_INPUT.filter((name) => wired.has(name)).forEach((name) => outputs.add(name));
  if (wired.has("voice") && wired.has("song")) outputs.add("song_under");
  if (wired.has("video")) outputs.add("keeps_clip_sound");
  return { inputs, outputs };
}

// The chips to draw under "Pictures and settings": one for each picture and
// for the video that has a wire, in the node's order.
export function chipsToShow({ wiredInputs = [], showAll = false } = {}) {
  const wired = new Set(wiredInputs);
  return [...PICTURES, "video"].filter((name) => showAll || wired.has(name));
}

// Where a wire dropped on the node's body should go. `slots` is the node's
// input or output list as { name, type, wired, shown }, and `landed` the
// index the frontend picked. A wire never stays on a socket nobody can see
// while a shown one of the same kind can take it. An input takes one wire;
// an output takes many (`shared`), so a wired one will do when none is free.
export function dropTarget(slots, landed, { shared = false } = {}) {
  const slot = slots[landed];
  if (!slot || slot.shown) return landed;
  const fits = (other, index) => index !== landed && other.shown && other.type === slot.type;
  const free = slots.findIndex((other, index) => fits(other, index) && !other.wired);
  if (free !== -1) return free;
  const any = shared ? slots.findIndex(fits) : -1;
  return any === -1 ? landed : any;
}

// A node's id comes from the workflow file and can be any text, so it goes
// into a style rule escaped: it can name a row and nothing else.
const cssText = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char.codePointAt(0).toString(16)} `);

// The style rule for one node in Nodes 2.0: it hides the row of each hidden
// socket. `keys` are "in-<index>" and "out-<index>". Nodes 2.0 measures
// where the sockets are only when the node or its widget grid changes size,
// and a row that comes or goes in the shorter column changes neither, which
// left wires ending beside their dots. `nudge` makes the grid a tenth of a
// pixel narrower; flipping it makes the frontend measure again.
export function hiddenRowsRule(nodeId, keys, nudge = false) {
  const id = cssText(nodeId);
  const rows = keys.length ? `${keys.map((key) => `.lg-slot:has([data-slot-key="${id}-${key}"])`).join(",")}{display:none}` : "";
  return nudge ? `${rows}[data-widgets-grid-node-id="${id}"]{padding-left:0.1px}` : rows;
}

// A socket with a position of its own gets no row: the frontend only stacks
// the ones without (and writes the position into the saved file, which
// js/h3_sockets/index.js takes out again).
const PARKED = [0, -4000];
const noDraw = () => {};

// Hide or show one socket of a live node. Returns false, and changes
// nothing, when it cannot be done here: a frontend whose sockets do not draw
// themselves, or a socket that was placed by someone else.
export function setSocketHidden(slot, hidden) {
  if (!slot || typeof slot.draw !== "function") return false;
  if (!slot._ausbossHidden && slot.pos) return false;
  if (hidden === Boolean(slot._ausbossHidden)) return true;
  slot._ausbossHidden = hidden;
  if (hidden) {
    slot.pos = PARKED;
    slot.draw = noDraw;
    slot.drawCollapsed = noDraw;
  } else {
    delete slot.pos;
    delete slot.draw;
    delete slot.drawCollapsed;
  }
  return true;
}
