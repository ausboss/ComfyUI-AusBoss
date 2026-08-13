import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STEP,
  FINE_STEP,
  SCRUB_DEAD_ZONE,
  SCRUB_PIXELS_PER_STEP,
  clampHighlight,
  clampStrength,
  filterLoras,
  highlightedName,
  isScrubbing,
  moveHighlight,
  moveRow,
  newRow,
  normalizeRows,
  parseRows,
  roundStrength,
  scrubValue,
  serializeRows,
  setStrength,
  summarizeRows,
  toggleTrigger,
} from "../js/shared/lora_stack.mjs";

test("strengths clamp to the UI range and round to two decimals", () => {
  assert.equal(clampStrength(50), 10);
  assert.equal(clampStrength(-50), -10);
  assert.equal(clampStrength("nonsense"), 0);
  assert.equal(roundStrength(0.12345), 0.12);
});

test("normalizeRows heals partial rows and round-trips through serialize/parse", () => {
  const rows = normalizeRows([
    { name: "styles/ink.safetensors", strength: 0.8 },
    { bogus: true },
    "not an object",
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].strength_clip, 0.8, "clip strength defaults to model strength");
  assert.equal(rows[0].enabled, true);
  assert.equal(rows[1].name, "");
  const back = parseRows(serializeRows(rows));
  assert.deepEqual(back, rows);
  assert.deepEqual(parseRows("not json"), []);
});

test("row ids survive normalization so external references stay stable", () => {
  const row = newRow();
  const [kept] = normalizeRows([{ ...row, name: "a.safetensors" }]);
  assert.equal(kept.id, row.id);
});

test("moveRow reorders within bounds and ignores impossible moves", () => {
  const rows = normalizeRows([{ name: "a" }, { name: "b" }, { name: "c" }]);
  const moved = moveRow(rows, 2, -1);
  assert.deepEqual(moved.map((r) => r.name), ["a", "c", "b"]);
  assert.equal(moveRow(rows, 0, -1), rows);
  assert.equal(moveRow(rows, 2, 1), rows);
});

test("setStrength mirrors to clip only while linked", () => {
  const rows = normalizeRows([{ name: "a", strength: 1 }]);
  const linked = setStrength(rows, 0, 0.4, true);
  assert.equal(linked[0].strength_clip, 0.4);
  const split = setStrength(rows, 0, 0.4, false);
  assert.equal(split[0].strength_clip, 1);
});

test("scrubbing is inert inside the dead zone, then steps with distance", () => {
  assert.equal(scrubValue(1, SCRUB_DEAD_ZONE), 1);
  assert.equal(scrubValue(1, -SCRUB_DEAD_ZONE), 1);
  const oneStep = scrubValue(1, SCRUB_DEAD_ZONE + SCRUB_PIXELS_PER_STEP);
  assert.equal(oneStep, roundStrength(1 + DEFAULT_STEP));
  const fine = scrubValue(1, SCRUB_DEAD_ZONE + SCRUB_PIXELS_PER_STEP, true);
  assert.equal(fine, roundStrength(1 + FINE_STEP));
  assert.equal(scrubValue(9.99, 10_000), 10, "scrub clamps at the range edge");
  assert.equal(scrubValue(-9.99, -10_000), -10);
});

test("a mostly-vertical drag is not a scrub", () => {
  assert.equal(isScrubbing(10, 4), true);
  assert.equal(isScrubbing(4, 10), false);
  assert.equal(isScrubbing(SCRUB_DEAD_ZONE, 0), false);
});

test("picker filter is a case-insensitive substring over the full list", () => {
  const names = ["styles/InkWash.safetensors", "faces/portrait.safetensors"];
  assert.deepEqual(filterLoras(names, "ink"), ["styles/InkWash.safetensors"]);
  assert.deepEqual(filterLoras(names, "  "), names);
  assert.deepEqual(filterLoras(names, "zzz"), []);
});

test("highlight wraps with arrows, clamps when the list shrinks, resolves names", () => {
  assert.equal(moveHighlight(-1, 1, 3), 0, "first ArrowDown lands on the first item");
  assert.equal(moveHighlight(-1, -1, 3), 2, "first ArrowUp lands on the last item");
  assert.equal(moveHighlight(2, 1, 3), 0, "wraps past the end");
  assert.equal(moveHighlight(0, -1, 3), 2, "wraps past the start");
  assert.equal(moveHighlight(0, 1, 0), -1, "empty list has no highlight");
  assert.equal(clampHighlight(5, 3), 2);
  assert.equal(clampHighlight(-1, 3), 0);
  assert.equal(highlightedName(["a", "b"], 1), "b");
  assert.equal(highlightedName(["a", "b"], -1), null);
});

test("trigger chips toggle in and out preserving order", () => {
  let triggers = toggleTrigger("", "ink wash");
  triggers = toggleTrigger(triggers, "brush");
  assert.equal(triggers, "ink wash, brush");
  triggers = toggleTrigger(triggers, "Ink Wash");
  assert.equal(triggers, "brush", "toggle-off matches case-insensitively");
});

test("row summary counts only named rows", () => {
  assert.equal(summarizeRows([]), "no LoRAs");
  const rows = normalizeRows([{ name: "a" }, { name: "b", enabled: false }, { name: "" }]);
  assert.equal(summarizeRows(rows), "1 / 2 on");
});
