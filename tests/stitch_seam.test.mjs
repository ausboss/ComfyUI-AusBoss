import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeSettings } from "../js/shared/node_settings.mjs";
import {
  SEAM_CHOICES,
  SEAM_MENU,
  SEAM_MUTE_TITLES,
  isBlendIn,
  seamCornerReserve,
} from "../js/shared/stitch_seam.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The backend's Seam choices, read from the Python source rather than
// copied, so the card cannot drift from what the node accepts.
function backendChoices() {
  const source = readFileSync(join(ROOT, "nodes", "_inpaint_crop_helpers.py"), "utf-8");
  const constant = (name) => source.match(new RegExp(`^${name} = "([^"]+)"$`, "m"))?.[1];
  const order = source.match(/^SEAM_MODES = \(([^)]*)\)$/m)?.[1].split(",").map((part) => part.trim()).filter(Boolean);
  return order.map((name) => constant(name));
}

test("the card offers the backend's choices, classic first", () => {
  assert.deepEqual(SEAM_CHOICES, backendChoices());
  assert.equal(SEAM_CHOICES[0], "classic");
});

test("the gear menu sets this node's Seam and never a default for new ones", () => {
  assert.equal(SEAM_MENU.length, 1);
  const [entry] = SEAM_MENU;
  assert.equal(entry.key, "seam");
  assert.equal(entry.type, "choice");
  assert.deepEqual(entry.options, SEAM_CHOICES);
  assert.equal(entry.default, "classic");
  assert.equal(entry.persist, false);
});

test("each choice gets one short plain line in the menu", () => {
  const [entry] = SEAM_MENU;
  assert.deepEqual(Object.keys(entry.optionHints), SEAM_CHOICES);
  for (const line of Object.values(entry.optionHints)) {
    assert.ok(line.length <= 64, `too long for one line: ${line}`);
    assert.doesNotMatch(line, /\n/);
  }
  assert.match(entry.optionHints["blend in"], /turned pictures/);
  assert.match(entry.optionHints["blend in"], /Tone match still works/);
});

test("a stored or restored value outside the choices reads as classic", () => {
  assert.equal(mergeSettings(SEAM_MENU, { seam: "blend in" }).seam, "blend in");
  for (const odd of ["", null, undefined, "blend", 3]) {
    assert.equal(mergeSettings(SEAM_MENU, { seam: odd }).seam, "classic");
  }
});

test("blend in mutes the rows and widens the corner; classic does neither", () => {
  assert.equal(isBlendIn({ seam: "blend in" }), true);
  for (const values of [{ seam: "classic" }, { seam: "" }, {}, null, undefined]) {
    assert.equal(isBlendIn(values), false);
  }
  assert.equal(seamCornerReserve({ seam: "classic" }), 30);
  assert.equal(seamCornerReserve({ seam: "blend in" }), 84);
  // Tone match works in both seams; only the halo fix is classic's alone.
  assert.deepEqual(Object.keys(SEAM_MUTE_TITLES), ["fix_edge_halo"]);
  for (const title of Object.values(SEAM_MUTE_TITLES)) {
    assert.match(title, /^Blend in doesn't use/);
    assert.match(title, /gear menu/);
  }
});
