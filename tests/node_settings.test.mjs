import test from "node:test";
import assert from "node:assert/strict";

import {
  coerceSetting,
  isOverrideActive,
  isOverrideEntry,
  mergeSettings,
  overrideEnableValue,
  overrideIsCustom,
  schemaDefaults,
} from "../js/shared/node_settings.mjs";

const SCHEMA = [
  { section: "Behavior" },
  { key: "linked", label: "Linked strengths", type: "toggle", default: true },
  { key: "step", label: "Strength step", type: "number", default: 0.05, min: 0.01, max: 1 },
  { key: "separator", label: "Separator", type: "text", default: ", " },
  { key: "memory", label: "Memory", type: "choice", default: "standard", options: ["standard", "fast", "lowest"] },
];

test("schemaDefaults skips section headers", () => {
  assert.deepEqual(schemaDefaults(SCHEMA), {
    linked: true,
    step: 0.05,
    separator: ", ",
    memory: "standard",
  });
});

test("mergeSettings validates every stored value", () => {
  const merged = mergeSettings(SCHEMA, {
    linked: "yes",          // wrong type -> default
    step: "0.2",            // numeric string -> number
    separator: 7,           // wrong type -> default
    memory: "turbo",        // not an option -> default
    stray: true,            // unknown key -> dropped
  });
  assert.deepEqual(merged, {
    linked: true,
    step: 0.2,
    separator: ", ",
    memory: "standard",
  });
  assert.equal("stray" in merged, false);
});

test("numbers clamp to the schema range", () => {
  const entry = SCHEMA.find((item) => item.key === "step");
  assert.equal(coerceSetting(entry, 99), 1);
  assert.equal(coerceSetting(entry, 0), 0.01);
  assert.equal(coerceSetting(entry, Number.NaN), 0.05);
  assert.equal(coerceSetting(entry, ""), 0.05);
});

test("mergeSettings tolerates junk storage", () => {
  assert.deepEqual(mergeSettings(SCHEMA, null), schemaDefaults(SCHEMA));
  assert.deepEqual(mergeSettings(SCHEMA, "corrupt"), schemaDefaults(SCHEMA));
});

test("choice keeps valid stored picks", () => {
  const merged = mergeSettings(SCHEMA, { memory: "fast", linked: false });
  assert.equal(merged.memory, "fast");
  assert.equal(merged.linked, false);
});

// ---------- override entries ----------

const TOP_P = {
  key: "top_p", label: "Top-p", type: "number",
  default: 1, neutral: 1, active: 0.95, min: 0, max: 1,
};
const PRESENCE = {
  key: "presence_penalty", label: "Presence penalty", type: "number",
  default: 0, neutral: 0, active: 0.5, min: -2, max: 2,
};
const PLAIN = { key: "steps", label: "Steps", type: "number", default: 8, min: 1, max: 50 };

test("only entries declaring a neutral value are overrides", () => {
  assert.equal(isOverrideEntry(TOP_P), true);
  assert.equal(isOverrideEntry(PLAIN), false);
  assert.equal(isOverrideEntry({ section: "Sampling" }), false);
  assert.equal(isOverrideEntry(undefined), false);
});

test("an override sitting on its neutral value is off", () => {
  assert.equal(isOverrideActive(TOP_P, 1), false);
  assert.equal(isOverrideActive(TOP_P, 0.9), true);
  assert.equal(isOverrideActive(PRESENCE, 0), false);
  assert.equal(isOverrideActive(PRESENCE, -0.5), true);
});

test("a hand-typed neutral value reads as off", () => {
  // The checkbox has to follow the number box, not just the other way round.
  assert.equal(isOverrideActive(TOP_P, "1"), false);
});

test("plain entries are always active", () => {
  assert.equal(isOverrideActive(PLAIN, 8), true);
});

test("ticking on prefers the user's previous value", () => {
  assert.equal(overrideEnableValue(TOP_P, 0.8), 0.8);
});

test("ticking on falls back to the suggested active value", () => {
  assert.equal(overrideEnableValue(TOP_P, undefined), 0.95);
  assert.equal(overrideEnableValue(PRESENCE, undefined), 0.5);
});

test("ticking on never lands back on neutral", () => {
  // A remembered value of exactly neutral would leave a ticked box sending
  // nothing, which reads as a broken control.
  assert.notEqual(overrideEnableValue(TOP_P, 1), 1);
  const stuck = { key: "x", type: "number", default: 0, neutral: 0, min: 0, max: 1 };
  assert.notEqual(overrideEnableValue(stuck, 0), 0);
});

test("the reset affordance shows only for an on, customized row", () => {
  assert.equal(overrideIsCustom(TOP_P, 1), false);     // off
  assert.equal(overrideIsCustom(TOP_P, 0.95), false);  // on, at the suggestion
  assert.equal(overrideIsCustom(TOP_P, 0.3), true);    // on, customized
});
