import test from "node:test";
import assert from "node:assert/strict";

import {
  BYPASS_MODE,
  DEFAULT_STEP,
  FINE_STEP,
  SCRUB_DEAD_ZONE,
  SCRUB_PIXELS_PER_STEP,
  clampHighlight,
  clampStrength,
  commonFolderPrefix,
  cycleMasterToggle,
  duplicateLoraKeys,
  filterLoras,
  formatFileSize,
  groupByFolder,
  highlightedName,
  hoverRowIndex,
  importNeedsSeparateStrengths,
  importSummary,
  isScrubbing,
  loaderLoraEntries,
  mergeImportedRows,
  moveHighlight,
  moveRow,
  newRow,
  normalizeRows,
  parseRows,
  reorderRows,
  resolveLoraName,
  roundStrength,
  shortLoraName,
  snapshotEnabled,
  strengthBarBackground,
  strengthBarScale,
  strengthBarSpan,
  thumbPosition,
  scrubValue,
  serializeRows,
  setStrength,
  strengthOutOfRange,
  summarizeRows,
  toggleAllRows,
  toggleAllState,
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

test("reorderRows drops a row into any slot and rejects impossible moves", () => {
  const rows = normalizeRows([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }]);
  assert.deepEqual(reorderRows(rows, 0, 2).map((r) => r.name), ["b", "c", "a", "d"]);
  assert.deepEqual(reorderRows(rows, 3, 0).map((r) => r.name), ["d", "a", "b", "c"]);
  assert.equal(reorderRows(rows, 1, 1), rows, "no-op move returns the same array");
  assert.equal(reorderRows(rows, -1, 2), rows);
  assert.equal(reorderRows(rows, 0, 4), rows);
  const moved = reorderRows(rows, 0, 2);
  assert.equal(moved[2], rows[0], "row objects move untouched, not copied");
});

test("hoverRowIndex maps a pointer y to the visual slot it is over", () => {
  const centers = [15, 45, 75];
  assert.equal(hoverRowIndex(centers, 0), 0, "above everything is the first slot");
  assert.equal(hoverRowIndex(centers, 30), 1);
  assert.equal(hoverRowIndex(centers, 60), 2);
  assert.equal(hoverRowIndex(centers, 500), 2, "past the last center stays on the last slot");
  assert.equal(hoverRowIndex([], 10), -1, "an empty stack has no slot");
});

test("thumbPosition trails the cursor and flips or clamps at the edges", () => {
  assert.deepEqual(thumbPosition(100, 100, 1000, 800), { left: 114, top: 114 });
  const flipped = thumbPosition(950, 100, 1000, 800);
  assert.equal(flipped.left, 950 - 188 - 14, "flips to the cursor's left at the right edge");
  const clamped = thumbPosition(100, 780, 1000, 800);
  assert.equal(clamped.top, 800 - 188, "pins above the bottom edge");
  assert.equal(thumbPosition(2, 2, 100, 100).left, 4, "never goes off-screen");
});

test("formatFileSize picks a sane unit and hides junk", () => {
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(Math.round(143.4 * 1024 * 1024)), "143.4 MB");
  assert.equal(formatFileSize(150 * 1024 * 1024), "150 MB", "a whole value drops the .0");
  assert.equal(formatFileSize(2.5 * 1024 ** 3), "2.5 GB");
  assert.equal(formatFileSize(-1), "");
  assert.equal(formatFileSize("junk"), "");
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

test("scrubbing honors a custom coarse step but Shift stays fine", () => {
  const travel = SCRUB_DEAD_ZONE + SCRUB_PIXELS_PER_STEP;
  assert.equal(scrubValue(1, travel, false, 0.25), roundStrength(1.25));
  assert.equal(scrubValue(1, travel, true, 0.25), roundStrength(1 + FINE_STEP));
  assert.equal(scrubValue(1, travel, false, 0), roundStrength(1 + DEFAULT_STEP),
    "junk steps fall back to the default");
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

test("master toggle reports on/off/mixed and blank rows do not vote", () => {
  const mixed = normalizeRows([{ name: "a" }, { name: "b", enabled: false }, { name: "" }]);
  assert.equal(toggleAllState(mixed), "mixed");
  assert.equal(toggleAllState(normalizeRows([{ name: "a" }, { name: "" }])), "on");
  assert.equal(toggleAllState(normalizeRows([{ name: "a", enabled: false }])), "off");
  assert.equal(toggleAllState(normalizeRows([{ name: "" }])), "off");
});

test("master toggle click: mixed and off turn all on, on turns all off", () => {
  const mixed = normalizeRows([{ name: "a" }, { name: "b", enabled: false }]);
  const allOn = toggleAllRows(mixed);
  assert.equal(toggleAllState(allOn), "on");
  const allOff = toggleAllRows(allOn);
  assert.equal(toggleAllState(allOff), "off");
  assert.equal(toggleAllState(toggleAllRows(allOff)), "on");
});

test("common folder prefix strips whole segments only, never a lone file's dir", () => {
  assert.equal(
    commonFolderPrefix(["styles/wan/a.safetensors", "styles/wan/b.safetensors"]),
    "styles/wan/"
  );
  assert.equal(commonFolderPrefix(["styles/a.safetensors", "faces/b.safetensors"]), "");
  assert.equal(commonFolderPrefix(["only/one.safetensors"]), "");
  // The shared segment is also one entry's full remaining path: stop above it.
  assert.equal(commonFolderPrefix(["styles/a.safetensors", "styles/wan/b.safetensors"]), "styles/");
});

test("folder grouping buckets by top folder in first-appearance order", () => {
  const groups = groupByFolder(["root.safetensors", "styles/a", "faces/b", "styles/c"]);
  assert.deepEqual(
    groups.map((group) => [group.folder, group.names.length]),
    [["", 1], ["styles", 2], ["faces", 1]]
  );
});

test("strength range flags only real finite bounds", () => {
  assert.equal(strengthOutOfRange(1.5, { min: 0, max: 1 }), true);
  assert.equal(strengthOutOfRange(-0.5, { min: 0, max: 1 }), true);
  assert.equal(strengthOutOfRange(0.5, { min: 0, max: 1 }), false);
  assert.equal(strengthOutOfRange(5, { min: null, max: null }), false);
  assert.equal(strengthOutOfRange(5, null), false);
  assert.equal(strengthOutOfRange(0.5, { max: 1 }), false);
});

test("templateFromRows snapshots rows without ids and trims the name", async () => {
  const { templateFromRows } = await import("../js/shared/lora_stack.mjs");
  const rows = [
    { id: "r1", name: "styles/a.safetensors", strength: 0.8, strength_clip: 0.6, enabled: true, triggers: "foo" },
  ];
  const template = templateFromRows("  My Set  ", rows);
  assert.equal(template.name, "My Set");
  assert.equal(template.rows.length, 1);
  assert.equal(template.rows[0].id, undefined);
  assert.equal(template.rows[0].strength, 0.8);
  assert.equal(templateFromRows("   ", rows), null);
});

test("applyTemplate mints fresh row ids and keeps values", async () => {
  const { applyTemplate, templateFromRows } = await import("../js/shared/lora_stack.mjs");
  const template = templateFromRows("set", [
    { name: "a", strength: 0.5, strength_clip: 0.4, enabled: false, triggers: "x, y" },
  ]);
  const rows = applyTemplate(template);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].id);
  assert.equal(rows[0].strength, 0.5);
  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].triggers, "x, y");
  assert.deepEqual(applyTemplate(null), []);
});

test("upsertTemplate replaces same names case-insensitively and sorts", async () => {
  const { templateFromRows, upsertTemplate } = await import("../js/shared/lora_stack.mjs");
  const a = templateFromRows("Beta", []);
  const b = templateFromRows("alpha", []);
  let list = upsertTemplate(upsertTemplate([], a), b);
  assert.deepEqual(list.map((t) => t.name), ["alpha", "Beta"]);
  const replacement = templateFromRows("BETA", [{ name: "x" }]);
  list = upsertTemplate(list, replacement);
  assert.deepEqual(list.map((t) => t.name), ["alpha", "BETA"]);
  assert.equal(list[1].rows.length, 1);
});

test("removeTemplate and parseTemplates round-trip storage", async () => {
  const { parseTemplates, removeTemplate, templateFromRows, upsertTemplate } = await import(
    "../js/shared/lora_stack.mjs"
  );
  const list = upsertTemplate([], templateFromRows("keep", [{ name: "a" }]));
  const stored = JSON.stringify(upsertTemplate(list, templateFromRows("drop", [])));
  const loaded = parseTemplates(stored);
  assert.deepEqual(loaded.map((t) => t.name), ["drop", "keep"]);
  assert.deepEqual(removeTemplate(loaded, "DROP").map((t) => t.name), ["keep"]);
  assert.deepEqual(parseTemplates("not json"), []);
  assert.deepEqual(parseTemplates('{"name":"x"}'), []);
});

// ---------- promoted lab experiments: bars, absorb, resolution, memory ----------

const row = (name, strength, extra = {}) => ({
  id: `t-${name}`, name, strength,
  strength_clip: strength, enabled: true, triggers: "", ...extra,
});

// ---------- scale ----------

test("scale floors at 1 so the everyday range reads absolutely", () => {
  assert.equal(strengthBarScale([row("a", 0.5), row("b", 0.3)]), 1);
  assert.equal(strengthBarScale([]), 1);
});

test("scale follows the largest magnitude, positive or negative", () => {
  assert.equal(strengthBarScale([row("a", 2), row("b", 0.5)]), 2);
  assert.equal(strengthBarScale([row("a", -1.6), row("b", 0.5)]), 1.6);
});

test("nameless rows do not vote on the scale", () => {
  assert.equal(strengthBarScale([row("", 5), row("a", 0.5)]), 1);
});

// ---------- span ----------

test("positive strength grows right of center", () => {
  assert.deepEqual(strengthBarSpan(1, 1), { from: 50, to: 100 });
  assert.deepEqual(strengthBarSpan(0.5, 1), { from: 50, to: 75 });
});

test("negative strength grows left of center", () => {
  assert.deepEqual(strengthBarSpan(-1, 1), { from: 0, to: 50 });
  assert.deepEqual(strengthBarSpan(-0.95, 1), { from: 2.5, to: 50 });
});

test("the -1 among 0.5s example: far edges represent 1.0", () => {
  const rows = [row("a", -1), row("b", 0.5), row("c", 0.5)];
  const scale = strengthBarScale(rows);
  assert.equal(scale, 1);
  assert.deepEqual(strengthBarSpan(-1, scale), { from: 0, to: 50 });
  assert.deepEqual(strengthBarSpan(0.5, scale), { from: 50, to: 75 });
});

test("magnitudes beyond the scale clamp at the field edge", () => {
  assert.deepEqual(strengthBarSpan(3, 2), { from: 50, to: 100 });
});

// ---------- background string ----------

test("zero strength paints only the center tick", () => {
  const css = strengthBarBackground(0, 1);
  assert.match(css, /calc\(50% - 0\.5px\)/);
  assert.ok(!css.includes("0.28"), "no positive fill layer");
  assert.ok(!css.includes("0.26"), "no negative fill layer");
});

test("positive bar carries fill, cap at the outer edge, tick, and base", () => {
  const css = strengthBarBackground(0.5, 1);
  assert.match(css, /rgba\(0, 180, 170, 0\.28\) 50%/);
  assert.match(css, /calc\(75% - 2px\)/);
  assert.match(css, /#23272c$/);
});

test("negative bar caps its left edge", () => {
  const css = strengthBarBackground(-0.95, 1);
  assert.match(css, /rgba\(235, 106, 96, 0\.26\)/);
  assert.match(css, /transparent 2\.5%, rgba\(255, 138, 128, 0\.9\) 2\.5%/);
});

// ---------- upstream extraction ----------

const widgets = (pairs) => Object.entries(pairs).map(([name, value]) => ({ name, value }));

test("core LoraLoader contributes one dual-strength entry", () => {
  const entries = loaderLoraEntries({
    type: "LoraLoader",
    widgets: widgets({ lora_name: "a/b.safetensors", strength_model: 0.8, strength_clip: 0.6 }),
  });
  assert.deepEqual(entries, [{
    name: "a/b.safetensors", strength: 0.8, strength_clip: 0.6,
    enabled: true, triggers: "",
  }]);
});

test("model-only loader imports with clip strength 0", () => {
  const entries = loaderLoraEntries({
    type: "LoraLoaderModelOnly",
    widgets: widgets({ lora_name: "x.safetensors", strength_model: 1 }),
  });
  assert.equal(entries[0].strength_clip, 0);
});

test("rgthree power loader rows keep their toggles and dual strengths", () => {
  const entries = loaderLoraEntries({
    type: "Power Lora Loader (rgthree)",
    widgets: [
      { name: "lora_1", value: { on: true, lora: "a.safetensors", strength: 0.7 } },
      { name: "lora_2", value: { on: false, lora: "b.safetensors", strength: 1, strengthTwo: 0.4 } },
      { name: "lora_3", value: { on: true, lora: "None", strength: 1 } },
      { name: "unrelated", value: 3 },
    ],
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].strength, 0.7);
  assert.equal(entries[1].enabled, false);
  assert.equal(entries[1].strength_clip, 0.4);
});

test("an AusBoss loader upstream hands over its whole stack, triggers included", () => {
  const stack = JSON.stringify([
    { name: "a.safetensors", strength: 0.9, enabled: true, triggers: "glow" },
    { name: "", strength: 1 },
  ]);
  const entries = loaderLoraEntries({
    type: "AUSBOSS_NODES_LoraLoader",
    widgets: widgets({ loras: stack }),
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].triggers, "glow");
});

test("unknown node types stop the walk with null", () => {
  assert.equal(loaderLoraEntries({ type: "KSampler", widgets: [] }), null);
  assert.equal(BYPASS_MODE, 4);
});

// ---------- name resolution ----------

const AVAILABLE = [
  "krea2/Beauty.safetensors",
  "styles/Beauty.safetensors",
  "klein/outpaint_v1.safetensors",
];

test("exact names pass through", () => {
  assert.deepEqual(resolveLoraName("klein/outpaint_v1.safetensors", AVAILABLE),
    { name: "klein/outpaint_v1.safetensors", status: "exact" });
});

test("a foreign folder layout resolves by unique basename", () => {
  assert.deepEqual(resolveLoraName("old\\path\\outpaint_v1.safetensors", AVAILABLE),
    { name: "klein/outpaint_v1.safetensors", status: "remapped" });
});

test("an ambiguous basename stays untouched and is reported", () => {
  assert.equal(resolveLoraName("elsewhere/Beauty.safetensors", AVAILABLE).status,
    "ambiguous");
});

test("a name nowhere in the install is reported missing", () => {
  assert.equal(resolveLoraName("gone.safetensors", AVAILABLE).status, "missing");
});

// ---------- merge ----------

test("imported rows land above the existing stack in chain order", () => {
  const existing = [row("mine.safetensors", 1)];
  const imported = [
    { name: "first.safetensors", strength: 1, strength_clip: 1, enabled: true, triggers: "" },
    { name: "second.safetensors", strength: 0.5, strength_clip: 0.5, enabled: true, triggers: "" },
  ];
  const { rows, added, skipped } = mergeImportedRows(existing, imported);
  assert.equal(added, 2);
  assert.equal(skipped, 0);
  assert.deepEqual(rows.map((r) => r.name),
    ["first.safetensors", "second.safetensors", "mine.safetensors"]);
  assert.ok(rows[0].id && rows[0].id !== rows[1].id, "fresh row ids");
});

test("a lora already in the stack is skipped, case-insensitively", () => {
  const existing = [row("A.safetensors", 1)];
  const { added, skipped, rows } = mergeImportedRows(existing, [
    { name: "a.safetensors", strength: 0.5, strength_clip: 0.5, enabled: true, triggers: "" },
  ]);
  assert.equal(added, 0);
  assert.equal(skipped, 1);
  assert.equal(rows.length, 1);
});

test("separate-strength detection catches model-only imports", () => {
  assert.equal(importNeedsSeparateStrengths([
    { strength: 1, strength_clip: 1 },
  ]), false);
  assert.equal(importNeedsSeparateStrengths([
    { strength: 1, strength_clip: 0 },
  ]), true);
});

test("summary reads as one sentence", () => {
  assert.equal(importSummary({}), "No LoRA loaders found in the model chain.");
  assert.match(importSummary({ added: 3, bypassed: 2, remapped: 1 }),
    /Imported 3 LoRAs; bypassed 2 loader nodes; 1 path remapped/);
});

// ---------- Pixaroma extraction ----------

test("a Pixaroma loader hands over its rows with toggles and dual strengths", () => {
  const entries = loaderLoraEntries({
    type: "PixaromaLoraLoader",
    widgets: [{
      name: "loras_ui",
      value: {
        version: 1,
        loras: [
          { id: "x1", name: "krea2/lenovo.safetensors", on: true, sm: 0.8, sc: 0.6 },
          { id: "x2", name: "styles/off.safetensors", on: false, sm: 1, sc: 1 },
          { id: "x3", name: "None", on: true, sm: 1, sc: 1 },
        ],
      },
    }],
  });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    name: "krea2/lenovo.safetensors", strength: 0.8, strength_clip: 0.6,
    enabled: true, triggers: "",
  });
  assert.equal(entries[1].enabled, false);
});

test("a Pixaroma loader with junk panel state contributes nothing", () => {
  assert.deepEqual(loaderLoraEntries({ type: "PixaromaLoraLoader", widgets: [] }), []);
  assert.deepEqual(loaderLoraEntries({
    type: "PixaromaLoraLoader",
    widgets: [{ name: "loras_ui", value: "not an object" }],
  }), []);
});

// ---------- downstream merge position ----------

test("downstream rows append below the stack and share the dedupe", () => {
  const existing = [row("mine.safetensors", 1)];
  const { rows, added, skipped } = mergeImportedRows(existing, [
    { name: "after.safetensors", strength: 0.5, strength_clip: 0.5, enabled: true, triggers: "" },
    { name: "MINE.safetensors", strength: 1, strength_clip: 1, enabled: true, triggers: "" },
  ], { position: "after" });
  assert.equal(added, 1);
  assert.equal(skipped, 1);
  assert.deepEqual(rows.map((r) => r.name), ["mine.safetensors", "after.safetensors"]);
});

// ---------- display names ----------

test("shortLoraName strips folders and extension independently", () => {
  assert.equal(shortLoraName("krea2/dr0smorgan_krea2_v1.safetensors"), "dr0smorgan_krea2_v1");
  assert.equal(shortLoraName("a\\b\\c.ckpt"), "c");
  assert.equal(shortLoraName("krea2/x.safetensors", { hideFolders: false }), "krea2/x");
  assert.equal(shortLoraName("krea2/x.safetensors", { hideExtension: false }), "x.safetensors");
  assert.equal(shortLoraName("plain_name"), "plain_name");
});

// ---------- duplicates ----------

test("duplicate detection is by full name, case-insensitive, blanks ignored", () => {
  const keys = duplicateLoraKeys([
    row("krea2/a.safetensors", 1),
    { ...row("KREA2/A.safetensors", 0.5), id: "t2" },
    row("styles/a.safetensors", 1),
    row("", 1),
  ]);
  assert.deepEqual([...keys], ["krea2/a.safetensors"]);
});

// ---------- master-toggle memory ----------

test("the master pill cycles mixed -> all on -> all off -> restored", () => {
  const mixed = [
    row("a.safetensors", 1),
    { ...row("b.safetensors", 1), id: "t-b", enabled: false },
    row("c.safetensors", 1),
  ];
  const first = cycleMasterToggle(mixed, undefined);
  assert.ok(first.rows.every((r) => r.enabled), "mixed turns all on");
  assert.deepEqual(first.snapshot, { "t-a.safetensors": true, "t-b": false, "t-c.safetensors": true });

  const second = cycleMasterToggle(first.rows, first.snapshot);
  assert.ok(second.rows.every((r) => !r.enabled), "on turns all off");

  const third = cycleMasterToggle(second.rows, second.snapshot);
  assert.deepEqual(third.rows.map((r) => r.enabled), [true, false, true], "off restores the setup");
});

test("all off with no memory is a plain binary toggle", () => {
  const off = [
    { ...row("a.safetensors", 1), enabled: false },
    { ...row("b.safetensors", 1), id: "t-b2", enabled: false },
  ];
  const { rows } = cycleMasterToggle(off, undefined);
  assert.ok(rows.every((r) => r.enabled));
});

test("a stale snapshot that lights nothing falls back to all on", () => {
  const off = [{ ...row("a.safetensors", 1), enabled: false }];
  const { rows } = cycleMasterToggle(off, { "gone-id": true });
  assert.ok(rows.every((r) => r.enabled));
});

test("snapshotEnabled records named rows only", () => {
  assert.deepEqual(
    snapshotEnabled([row("a.safetensors", 1), row("", 1)]),
    { "t-a.safetensors": true },
  );
});
