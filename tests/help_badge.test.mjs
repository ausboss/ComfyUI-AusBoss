import test from "node:test";
import assert from "node:assert/strict";

import {
  badgeCenter,
  helpSections,
  hitsBadge,
  showBadge,
} from "../js/shared/help_badge.mjs";

test("badge sits at the title bar's right edge", () => {
  const [x, y] = badgeCenter(260);
  assert.equal(x, 244);
  assert.ok(y < 0, "title-bar coordinates are negative");
});

test("badge hides on collapsed or very narrow nodes", () => {
  assert.equal(showBadge(260, false), true);
  assert.equal(showBadge(260, true), false);
  assert.equal(showBadge(120, false), false);
});

test("hit zone is generous and tracks the width", () => {
  assert.equal(hitsBadge(badgeCenter(260), 260), true);
  assert.equal(hitsBadge([244 - 9, -15], 260), true);
  assert.equal(hitsBadge([200, -15], 260), false);
  assert.equal(hitsBadge([244, 10], 260), false, "body clicks never hit");
});

test("helpSections mirrors the registered schema", () => {
  const sections = helpSections({
    description: "Does the thing.",
    input: {
      required: { image: ["IMAGE", { tooltip: "The image to fix." }] },
      optional: { mask: ["MASK", { tooltip: "Scopes the fix." }] },
    },
    output_name: ["image"],
    output_tooltips: ["The fixed image."],
  });
  assert.equal(sections[0].text, "Does the thing.");
  assert.equal(sections[1].heading, "Inputs");
  assert.deepEqual(sections[1].items[0], { term: "image", detail: "The image to fix." });
  assert.deepEqual(sections[1].items[1], { term: "mask", detail: "Scopes the fix." });
  assert.equal(sections[2].heading, "Outputs");
  assert.deepEqual(sections[2].items[0], { term: "image", detail: "The fixed image." });
});

test("helpSections tolerates missing schema pieces", () => {
  assert.deepEqual(helpSections(undefined), []);
  assert.deepEqual(helpSections({ description: "x", input: {} }), [{ text: "x" }]);
});
