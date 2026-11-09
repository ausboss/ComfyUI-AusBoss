// A stopped run's message on Mask by Touch goes once the next result comes in.
//
// When a run stops at Mask by Touch (nothing picked, picks made on another
// picture), its message goes on the node's face and stays there, so the
// person can read it. It used to stay after the next run from the Run button
// had worked, until something else on the face was said. The face's own
// runs cleared it; a workflow run's result did not.
//
// touch_stage.mjs imports ComfyUI's api, so it cannot be loaded here. This
// file runs its setNote for real and holds the stop and the result to the
// lines that clear the message. The live proof is a stopped run followed by
// a good one on a real canvas.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("../js/shared/touch_stage.mjs", import.meta.url), "utf-8");

function functionSource(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `touch_stage.mjs has no function ${name}`);
  const end = SOURCE.indexOf("\n}\n", start);
  return SOURCE.slice(start, end + 2);
}

// The face's note, with setNote as touch_stage.mjs has it.
function noteFace() {
  const setNote = new Function(`${functionSource("setNote")}\nreturn setNote;`)();
  const classes = new Set();
  const face = {
    noteTimer: 0,
    noteEl: { textContent: "", classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } },
  };
  return { face, setNote, shown: () => (classes.has("on") ? face.noteEl.textContent : "") };
}

test("a stopped run's message stays up until the next result, then goes", () => {
  const { face, setNote, shown } = noteFace();
  const stopped = SOURCE.match(/face\.stopped = \(message\) => \{([\s\S]*?)\n {2}\};/)?.[1];
  assert.ok(stopped, "touch_stage.mjs has no face.stopped");
  assert.match(stopped, /setNote\(face, String\(message \?\? ""\)\);\s*(?:\/\/[^\n]*\n\s*)*face\.stopNote = true;/,
    "a stop marks its message as a stop message, after it is set");
  // What face.stopped does to the note.
  setNote(face, "Mask by Touch: nothing is picked.");
  face.stopNote = true;
  assert.equal(shown(), "Mask by Touch: nothing is picked.");

  // The next result clears it, as the head of show() does.
  const head = functionSource("show").split("\n").slice(0, 6).join("\n");
  assert.match(head, /if \(face\.stopNote && !interim && !restored\) setNote\(face, ""\);/,
    "show() clears a stop message when a result comes in");
  if (face.stopNote) setNote(face, "");
  assert.equal(shown(), "");
});

test("any other message ends the stop message's hold", () => {
  const { face, setNote } = noteFace();
  setNote(face, "Mask by Touch: nothing is picked.");
  face.stopNote = true;
  setNote(face, "Nothing found there.", { life: 1 });
  clearTimeout(face.noteTimer);
  assert.equal(face.stopNote, false, "a note said since is not cleared by the next result");
});
