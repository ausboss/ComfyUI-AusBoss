// Pure decisions behind js/shared/script_assist.mjs: what the help card says,
// and what to suggest at the caret in H3 Prompt Writer's script box. No DOM,
// so tests run it under node:test.

// The help card: each thing the node reads in the words, in plain words.
export const CHEAT_SHEET = [
  { code: "@1 to @4", text: "A picture you plugged in. @1 is Picture 1." },
  { code: "3s:", text: "At the start of a line: this moment starts 3 seconds in. Lines with no time share what is left evenly. Dragging a block's left edge on the bar types this for you." },
  { code: "blank line", text: "A cut to a new shot. No blank lines means one take." },
  { code: "\"in quotes\"", text: "Said out loud, word for word." },
  { code: "sound:", text: "On its own line: what the clip sounds like. Same as the Sound box." },
  { code: "music:", text: "On its own line: the music. Music makes the clip louder." },
  { code: "camera:", text: "On its own line: how the camera moves, like push in or handheld." },
  { code: "look:", text: "On its own line: a style, like anime or watercolour." },
  { code: "no cuts", text: "Anywhere in the words: keep it all one shot." },
];

const LABELS = [
  { word: "sound", hint: "what the clip sounds like" },
  { word: "music", hint: "the music, makes it louder" },
  { word: "camera", hint: "how the camera moves" },
  { word: "look", hint: "a style for the whole clip" },
];

const starts = (value, typed) => value.toLowerCase().startsWith(typed.toLowerCase());

// What to offer at the caret, or null.
//   pictures: [{ number, job, plugged }] for @1 to @4
//   cameras, looks: the choices the node knows, for camera: and look: lines
//   seconds: the clip's length, so a time past the end isn't offered
// The answer replaces text[from, to) with an item's insert. `strong` means
// the person typed a trigger (@, camera:, look:), so Enter may take an item;
// a guess from the first letters of a line only takes Tab or a click, so
// Enter still starts a new line.
export function suggestAt(text, caret, { pictures = [], cameras = [], looks = [], seconds = 8 } = {}) {
  const value = String(text ?? "");
  const before = value.slice(0, caret);
  const line = before.slice(before.lastIndexOf("\n") + 1);

  const at = before.match(/(?:^|[^\w@])@(\d?)$/);
  if (at) {
    const typed = at[1];
    const plugged = pictures.filter((picture) => picture.plugged);
    const offer = (plugged.length ? plugged : pictures).filter((picture) => String(picture.number).startsWith(typed));
    if (!offer.length) return null;
    return {
      from: caret - typed.length - 1,
      to: caret,
      strong: true,
      items: offer.map((picture) => ({
        label: `@${picture.number}`,
        insert: `@${picture.number}`,
        hint: picture.plugged ? picture.job || "" : "not plugged in",
        number: picture.number,
      })),
    };
  }

  const choice = line.match(/^\s*(camera|look)\s*:\s*([\w ]*)$/i);
  if (choice) {
    const typed = choice[2];
    const list = choice[1].toLowerCase() === "camera" ? cameras : looks;
    const offer = list.filter((name) => starts(name, typed) && name.toLowerCase() !== typed.toLowerCase());
    if (!offer.length) return null;
    return { from: caret - typed.length, to: caret, strong: true, items: offer.map((name) => ({ label: name, insert: name, hint: "" })) };
  }

  const time = line.match(/^(\s*)(\d{1,2})$/);
  if (time) {
    const second = Number(time[2]);
    if (second < 1 || second >= seconds) return null;
    return {
      from: caret - time[2].length,
      to: caret,
      strong: false,
      items: [{ label: `${second}s:`, insert: `${second}s: `, hint: `this moment starts ${second} seconds in` }],
    };
  }

  const word = line.match(/^(\s*)([a-z]{2,6})$/i);
  if (word) {
    const offer = LABELS.filter((label) => starts(label.word, word[2]) && label.word !== word[2].toLowerCase());
    if (!offer.length) return null;
    return {
      from: caret - word[2].length,
      to: caret,
      strong: false,
      items: offer.map((label) => ({ label: `${label.word}:`, insert: `${label.word}: `, hint: label.hint })),
    };
  }
  return null;
}
