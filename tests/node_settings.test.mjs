import test from "node:test";
import assert from "node:assert/strict";

import {
  coerceSetting,
  mergeSettings,
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
