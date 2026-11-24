// Pause for Shot's hidden `view` input: the viewer's 360 settings and Cut as
// one string, the same string for the same settings.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { viewValue } from "../js/shared/viewer_view.mjs";

test("the same settings give the same string, whatever the key order", () => {
  const a = viewValue({ sky: { turn: 90, tilt: 2 }, cut: { back: 0.3, front: 0 } });
  const b = viewValue({ cut: { front: 0, back: 0.3 }, sky: { tilt: 2, turn: 90 } });
  assert.equal(a, b);
  assert.deepEqual(JSON.parse(a), { sky: { tilt: 2, turn: 90 }, cut: { back: 0.3, front: 0 } });
});

test("a changed setting changes the string", () => {
  assert.notEqual(viewValue({ sky: { turn: 90 } }), viewValue({ sky: { turn: 0 } }));
  assert.notEqual(viewValue({ sky: { turn: 90 } }), viewValue({ sky: { turn: 90 }, cut: { back: 0.2 } }));
});

test("only the 360 settings and the Cut ride along; nothing saved gives nothing", () => {
  assert.equal(viewValue({ sky: { turn: 45 }, panorama: false, other: 1 }), JSON.stringify({ sky: { turn: 45 } }));
  for (const junk of [undefined, null, "", "x", 3, [], { sky: "x", cut: [1] }]) assert.equal(viewValue(junk), "");
});

test("the pause fills the input as the prompt is built, and the card hides it", () => {
  const pause = readFileSync(new URL("../js/pause_shot/index.js", import.meta.url), "utf8");
  assert.match(pause, /view\.serializeValue\s*=\s*\(\)\s*=>\s*viewValue\(/);
  const cards = readFileSync(new URL("../js/widget_cards/index.js", import.meta.url), "utf8");
  assert.match(cards, /AUSBOSS_NODES_PauseShot:[^\n]*hide: \["view"\], socketless: \["view"\]/);
});

test("a Background picked on the node redraws the viewer at once", () => {
  // The viewer draws only when something moves in it; without this the old
  // background stayed up until the camera was touched.
  const pause = readFileSync(new URL("../js/pause_shot/index.js", import.meta.url), "utf8");
  assert.match(pause, /chainCallback\(mode, "callback", \(\) => redrawViewer\(/);
});
