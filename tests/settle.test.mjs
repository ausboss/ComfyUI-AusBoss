// A note that waits for the hand to stop.
//
// The Crop + Rotate + Pad nodes show an amber note under the size when the
// resize stretches the picture. During a drag the answer changes every few
// pixels, and a note that followed it flashed in and out and pushed the rows
// under it up and down. js/shared/settle.mjs says when a run of changes is
// over; the first half of this file holds it to its rules with a clock the
// test turns by hand. The second half holds the editor to using it: the
// live proof is a real drag on a canvas (docs/live_testing.md).

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createSettle } from "../js/shared/settle.mjs";

const DELAY = 200;

// Timers the test runs by hand: advance(ms) fires what falls due, in order.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(run, delay) { const id = nextId++; timers.set(id, { at: now + delay, run }); return id; },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
}

function rig() {
  const clock = fakeClock();
  const hand = { down: false };
  let settled = 0;
  const rest = createSettle({
    delay: DELAY, held: () => hand.down, onSettle: () => { settled += 1; },
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  return {
    clock, rest,
    settled: () => settled,
    press() { hand.down = true; },
    release() { hand.down = false; rest.release(); },
  };
}

test("a change with the pointer up shows at once and owes nothing later", () => {
  const { clock, rest, settled } = rig();
  assert.equal(rest.touch(), true, "a click, a typed number, a new picture");
  clock.advance(5000);
  assert.equal(settled(), 0, "nothing was held back, so nothing settles");
  assert.equal(rest.touch(), true, "and the next single change shows at once again");
});

test("nothing shows during a drag, and it settles once after the release", () => {
  const { clock, rest, settled, press, release } = rig();
  press();
  for (let move = 0; move < 40; move++) {
    assert.equal(rest.touch(), false, "every move of the drag is held back");
    clock.advance(16);
  }
  assert.equal(settled(), 0);
  release();
  clock.advance(DELAY - 1);
  assert.equal(settled(), 0, "not at the release itself");
  clock.advance(1);
  assert.equal(settled(), 1, "a moment after it");
  clock.advance(5000);
  assert.equal(settled(), 1, "and only once");
});

test("a hand that rests with the button down settles nothing", () => {
  const { clock, rest, settled, press, release } = rig();
  press();
  rest.touch();
  clock.advance(10000);
  assert.equal(settled(), 0, "however long the pause");
  release();
  clock.advance(DELAY - 1);
  assert.equal(settled(), 0, "the wait starts at the release, not at the last move");
  clock.advance(1);
  assert.equal(settled(), 1);
});

test("a second press before it settles keeps it waiting", () => {
  const { clock, rest, settled, press, release } = rig();
  press();
  rest.touch();
  release();
  clock.advance(DELAY / 2);
  press();
  clock.advance(3000);
  assert.equal(settled(), 0, "grabbed again in time: still waiting");
  release();
  clock.advance(DELAY);
  assert.equal(settled(), 1);
});

test("a burst with no pointer shows its first value at once and its last one after", () => {
  const { clock, rest, settled } = rig();
  assert.equal(rest.touch(), true, "the first step of a held arrow key");
  for (let step = 0; step < 12; step++) {
    clock.advance(33);
    assert.equal(rest.touch(), false, "the steps that follow wait");
  }
  clock.advance(DELAY - 1);
  assert.equal(settled(), 0);
  clock.advance(1);
  assert.equal(settled(), 1, "the last value, once the keys are quiet");
  assert.equal(rest.touch(), true, "after that a single change shows at once again");
});

test("a press that changes nothing owes nothing", () => {
  const { clock, rest, settled, press, release } = rig();
  press();
  clock.advance(800);
  release();
  clock.advance(5000);
  assert.equal(settled(), 0);
  assert.equal(rest.touch(), true);
});

test("cancel drops what was waiting", () => {
  const { clock, rest, settled, press, release } = rig();
  press();
  rest.touch();
  rest.cancel();
  release();
  clock.advance(5000);
  assert.equal(settled(), 0, "the picture is gone: no note to settle");
  assert.equal(rest.touch(), true);
});

// --- The editor uses it ---------------------------------------------------------

const editor = readFileSync(new URL("../js/shared/transform_editor.mjs", import.meta.url), "utf-8");
// A top-level function of the editor, from its name to its closing brace.
const body = (name) => {
  const start = editor.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is gone from transform_editor.mjs`);
  const end = editor.indexOf("\n}\n", start);
  return editor.slice(start, end < 0 ? undefined : end + 2);
};
const rule = (selector) => {
  const start = editor.indexOf(`${selector}{`);
  assert.ok(start >= 0, `no CSS rule for ${selector}`);
  return editor.slice(start + selector.length + 1, editor.indexOf("}", start));
};

test("the note's line is as tall empty as it is with a note", () => {
  const lineHeight = Number(/font:11px\/(\d+)px/.exec(rule(".ausboss-transform-readout"))?.[1]);
  assert.ok(lineHeight > 0, "the readout no longer sets its line height in px");
  const note = rule(".ausboss-transform-readout i");
  assert.match(note, /display:block/);
  assert.equal(Number(/min-height:(\d+)px/.exec(note)?.[1]), lineHeight, "an empty note line must keep one line of height");
  // An inline button on the text's baseline made the line a pixel taller
  // than a line without one, so the rows under it moved when it came.
  const button = rule(".ausboss-transform-readout button");
  assert.match(button, /vertical-align:top/);
  assert.ok(Number(/height:(\d+)px/.exec(button)?.[1]) <= lineHeight, "Even out must fit inside the line");
});

test("the line is there with Resize on and gone with it off", () => {
  assert.match(body("syncReadout"), /state\.noteLine\.hidden = !resize;/);
  assert.match(editor, /\.ausboss-transform-readout i\[hidden\]\{display:none\}/);
});

test("the readout asks before it shows a note, and never writes one itself", () => {
  const sync = body("syncReadout");
  assert.match(sync, /const now = changed && state\.settle\.touch\(\);/);
  assert.match(sync, /if \(now\) showNote\(state, wanted\);/);
  assert.doesNotMatch(sync, /Even out|createElement\("i"/, "the note is written in showNote only");
  // A drag is the only thing that takes a note off the face before its time.
  assert.match(sync, /else if \(changed && pointerHeld && noteKey !== state\.shownNoteKey\) hideNote\(state\);/);
  assert.match(body("hideNote"), /visibility = "hidden"/, "hidden with its line kept, not removed");
  assert.match(body("settleReadout"), /showNote\(state, state\.wantedNote/);
});

test("mid-drag the size line only grows", () => {
  assert.match(body("syncReadout"), /sizeLine\.style\.minHeight = now \? "" : `\$\{Math\.max\(before, sizeLine\.offsetHeight\)\}px`;/);
  assert.match(body("settleReadout"), /state\.sizeLine\.style\.minHeight = "";/);
});

test("the editor's size box and status show the settled note too", () => {
  assert.match(body("drawOutputSize"), /const warnings = shownNote\(state\)\.warnings;/);
  assert.doesNotMatch(body("drawOutputSize"), /\{ tokens, warnings \}/);
  const lines = body("sizeLines");
  assert.match(lines, /const note = shownNote\(state\);/);
  assert.doesNotMatch(lines, /sizeChainTokens/, "the status must not read the live warnings");
  assert.match(body("updateModalInfo"), /status\.style\.minHeight = state\.unsettled \?/);
});

test("Even out works its padding out at the click", () => {
  // The note can be a moment behind the values, so padding worked out when
  // the note was written could be for other values.
  const show = body("showNote");
  const click = show.slice(show.indexOf('addEventListener("click"'));
  assert.match(click, /const pads = stretchFix\(state\)\.pads;/);
});

test("one watch on the page tells every node when the pointer comes up", () => {
  const watch = body("watchPointer");
  assert.match(watch, /addEventListener\("pointerdown"/);
  assert.match(watch, /addEventListener\("pointerup", up, true\)/);
  assert.match(watch, /addEventListener\("pointercancel", up, true\)/);
  assert.match(watch, /for \(const live of liveStates\) live\.settle\.release\(\);/);
  assert.match(editor, /state\.settle = createSettle\(\{ delay: NOTE_SETTLE_MS, held: \(\) => pointerHeld, onSettle: \(\) => settleReadout\(state\) \}\);/);
});
