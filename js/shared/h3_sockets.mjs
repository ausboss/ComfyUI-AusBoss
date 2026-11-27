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

// Where a wire dropped on the node's body should go. `inputs` is the node's
// input list as { name, type, wired, shown }, and `landed` the index the
// frontend picked. A wire never stays on a socket nobody can see while a
// shown one of the same kind is free.
export function dropTarget(inputs, landed) {
  const slot = inputs[landed];
  if (!slot || slot.shown) return landed;
  const free = inputs.findIndex((other, index) => index !== landed && other.shown && !other.wired && other.type === slot.type);
  return free === -1 ? landed : free;
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
