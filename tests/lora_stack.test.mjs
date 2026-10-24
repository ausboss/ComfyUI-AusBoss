import test from "node:test";
import assert from "node:assert/strict";

import {
  BYPASS_MODE,
  DEFAULT_STEP,
  FINE_STEP,
  MAX_ROWS,
  SCRUB_DEAD_ZONE,
  SCRUB_PIXELS_PER_STEP,
  appendFolderRows,
  clampHighlight,
  clampStrength,
  commonFolderPrefix,
  cycleMasterToggle,
  duplicateLoraKeys,
  filterLoras,
  fitLoraLabel,
  formatFileSize,
  groupByFolder,
  hasTrigger,
  highlightedName,
  hoverRowIndex,
  importNeedsSeparateStrengths,
  importSummary,
  isScrubbing,
  loaderLoraEntries,
  loraFolders,
  loraPickerEntries,
  loraStackKeyAction,
  mergeImportedRows,
  middleEllipsis,
  moveHighlight,
  moveRow,
  newRow,
  normalizeRows,
  parseRows,
  pickerWidth,
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

test("stack arrows move through rows to the add button without wrapping", () => {
  const action = (key, index) => loraStackKeyAction({ key }, { index, rowCount: 3 });
  assert.deepEqual(action("ArrowUp", 0), { kind: "focus", index: 0 });
  assert.deepEqual(action("ArrowDown", 0), { kind: "focus", index: 1 });
  assert.deepEqual(action("ArrowUp", 2), { kind: "focus", index: 1 });
  assert.deepEqual(action("ArrowDown", 2), { kind: "focus", index: 3 });
  assert.deepEqual(action("ArrowUp", 3), { kind: "focus", index: 2 });
  assert.deepEqual(action("ArrowDown", 3), { kind: "focus", index: 3 });
  assert.deepEqual(loraStackKeyAction({ key: "ArrowUp" }, { rowCount: 3, atAdd: true }),
    { kind: "focus", index: 2 });
});

test("an empty stack has only its add destination and leaves Space to the button", () => {
  for (const key of ["ArrowUp", "ArrowDown"]) {
    assert.deepEqual(loraStackKeyAction({ key }, { index: 0, rowCount: 0 }), { kind: "focus", index: 0 });
  }
  assert.deepEqual(loraStackKeyAction({ key: "Enter" }, { rowCount: 0, atAdd: true }), { kind: "pick" });
  for (const key of [" ", "ArrowLeft", "ArrowRight"]) {
    assert.equal(loraStackKeyAction({ key }, { index: 0, rowCount: 0 }), null);
    assert.equal(loraStackKeyAction({ key }, { rowCount: 3, atAdd: true }), null);
  }
});

test("row keyboard picking and toggling do not repeat a held Space", () => {
  const row = { index: 1, rowCount: 3 };
  assert.deepEqual(loraStackKeyAction({ key: "Enter" }, row), { kind: "pick" });
  assert.deepEqual(loraStackKeyAction({ key: "Enter" }, { index: 3, rowCount: 3 }), { kind: "pick" });
  assert.deepEqual(loraStackKeyAction({ key: " " }, row), { kind: "toggle" });
  assert.equal(loraStackKeyAction({ key: " ", repeat: true }, row), null);
});

test("row strength arrows use Shift for fine changes and can repeat", () => {
  const row = { index: 0, rowCount: 1 };
  assert.deepEqual(loraStackKeyAction({ key: "ArrowLeft" }, row), { kind: "strength", direction: -1, fine: false });
  assert.deepEqual(loraStackKeyAction({ key: "ArrowRight", repeat: true }, row),
    { kind: "strength", direction: 1, fine: false });
  assert.deepEqual(loraStackKeyAction({ key: "ArrowLeft", shiftKey: true }, row),
    { kind: "strength", direction: -1, fine: true });
  assert.deepEqual(loraStackKeyAction({ key: "ArrowRight", shiftKey: true }, row),
    { kind: "strength", direction: 1, fine: true });
});

test("stack keyboard leaves shortcuts, edited fields, composition and handled events alone", () => {
  const row = { index: 0, rowCount: 2 };
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " ", "Delete", "Backspace"]) {
    for (const flag of ["ctrlKey", "metaKey", "altKey", "isComposing", "defaultPrevented"]) {
      assert.equal(loraStackKeyAction({ key, [flag]: true }, row), null, `${flag} ${key}`);
    }
    assert.equal(loraStackKeyAction({ key, keyCode: 229 }, row), null, "IME composition fallback");
    assert.equal(loraStackKeyAction({ key }, { ...row, editing: true }), null, "field editing");
  }
  for (const key of ["Escape", "Tab", "Home", "End", "a"]) {
    assert.equal(loraStackKeyAction({ key }, row), null);
  }
});

test("the stack keeps Delete and Backspace from ComfyUI on a row, its controls and + LoRA", () => {
  for (const key of ["Delete", "Backspace"]) {
    assert.deepEqual(loraStackKeyAction({ key }, { index: 1, rowCount: 3 }), { kind: "block" });
    assert.deepEqual(loraStackKeyAction({ key }, { index: 1, rowCount: 3, onControl: true }), { kind: "block" });
    assert.deepEqual(loraStackKeyAction({ key }, { rowCount: 3, atAdd: true }), { kind: "block" });
    assert.deepEqual(loraStackKeyAction({ key, repeat: true }, { index: 0, rowCount: 1 }), { kind: "block" });
  }
});

test("a row's own buttons keep Enter and Space; arrows still act from them", () => {
  const control = { index: 1, rowCount: 3, onControl: true };
  for (const key of ["Enter", " "]) {
    assert.equal(loraStackKeyAction({ key }, control), null, key);
  }
  assert.deepEqual(loraStackKeyAction({ key: "ArrowDown" }, control), { kind: "focus", index: 2 });
  assert.deepEqual(loraStackKeyAction({ key: "ArrowLeft", shiftKey: true }, control),
    { kind: "strength", direction: -1, fine: true });
});

test("trigger chips toggle in and out preserving order", () => {
  let triggers = toggleTrigger("", "ink wash");
  triggers = toggleTrigger(triggers, "brush");
  assert.equal(triggers, "ink wash, brush");
  triggers = toggleTrigger(triggers, "Ink Wash");
  assert.equal(triggers, "brush", "toggle-off matches case-insensitively");
});

test("a trigger that holds commas is still one chip: it lights, and a second click removes it", () => {
  const sentence = "Outpaint the image: replace the gray areas, keeping the picture unchanged.";
  assert.equal(hasTrigger("ink wash", sentence), false);
  let triggers = toggleTrigger("ink wash", sentence);
  assert.equal(triggers, `ink wash, ${sentence}`, "the row holds the same text as before");
  assert.equal(hasTrigger(triggers, sentence), true);
  assert.equal(hasTrigger(triggers, sentence.toUpperCase()), true);
  assert.equal(hasTrigger(triggers, "ink wash"), true);
  assert.equal(toggleTrigger(triggers, sentence), "ink wash");

  // Any number of commas, however they are spaced.
  const tags = "1girl,solo ,  long hair";
  triggers = toggleTrigger("", tags);
  assert.equal(triggers, "1girl, solo, long hair");
  assert.equal(hasTrigger(triggers, tags), true);
  assert.equal(toggleTrigger(triggers, tags), "");

  // Two chips that share words stay independent.
  const other = "1girl, solo, short hair";
  triggers = toggleTrigger(toggleTrigger("", tags), other);
  assert.equal(hasTrigger(triggers, tags) && hasTrigger(triggers, other), true);
  triggers = toggleTrigger(triggers, tags);
  assert.equal(triggers, other);
  assert.equal(hasTrigger(triggers, tags), false);

  // The same words apart or out of order are not the phrase.
  assert.equal(hasTrigger("solo, ink wash, 1girl", "1girl, solo"), false);

  // A row saved while a second click added the sentence again clears in one click.
  assert.equal(toggleTrigger(`${sentence}, ink wash, ${sentence}`, sentence), "ink wash");
  assert.equal(toggleTrigger("brush, ink wash, brush", "brush"), "ink wash");
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

test("folder choices include every ancestor and keep each branch together", () => {
  const names = [
    "root.safetensors", "styles/ink/a.safetensors", "faces/head.safetensors",
    "styles/paint/deep/b.safetensors", "styles/c.safetensors", "styles-old/d.safetensors",
  ];
  const folders = loraFolders(names);
  assert.deepEqual(folders.map(({ folder }) => folder), [
    "styles", "styles/ink", "styles/paint", "styles/paint/deep", "faces", "styles-old",
  ]);
  assert.deepEqual(folders[0].names, [names[1], names[3], names[4]],
    "parent includes all descendants in server order without a similarly prefixed sibling");
  assert.deepEqual(folders[1].names, [names[1]]);
  assert.deepEqual(folders[3].names, [names[3]]);
  assert.deepEqual(loraFolders([]), []);
  assert.deepEqual(loraFolders(["root.safetensors"]), [], "root files are still available in the file picker");
});

test("folder choices normalize Windows separators while preserving server filenames", () => {
  const names = ["styles\\ink\\a.safetensors", "styles/ink/b.safetensors", "styles\\c.safetensors"];
  assert.deepEqual(loraFolders(names), [
    { folder: "styles", names },
    { folder: "styles/ink", names: names.slice(0, 2) },
  ]);
  assert.deepEqual(filterLoras(loraFolders(names).map(({ folder }) => folder), "INK"), ["styles/ink"]);
});

test("mixed picker keeps first-appearance order within each folder and root", () => {
  const names = [
    "root.safetensors", "styles/first.safetensors", "faces/head.safetensors",
    "styles/ink/a.safetensors", "styles/last.safetensors", "styles/ink/b.safetensors",
    "tail.safetensors",
  ];
  assert.deepEqual(loraPickerEntries(names), [
    { kind: "file", name: names[0], label: "root.safetensors", depth: 0 },
    { kind: "folder", name: "styles", label: "styles", depth: 0, count: 4 },
    { kind: "file", name: names[1], label: "first.safetensors", depth: 1 },
    { kind: "folder", name: "styles/ink", label: "ink", depth: 1, count: 2 },
    { kind: "file", name: names[3], label: "a.safetensors", depth: 2 },
    { kind: "file", name: names[5], label: "b.safetensors", depth: 2 },
    { kind: "file", name: names[4], label: "last.safetensors", depth: 1 },
    { kind: "folder", name: "faces", label: "faces", depth: 0, count: 1 },
    { kind: "file", name: names[2], label: "head.safetensors", depth: 1 },
    { kind: "file", name: names[6], label: "tail.safetensors", depth: 0 },
  ], "folder headers precede their own descendants and the array is keyboard order");
  assert.deepEqual(loraPickerEntries(names, "  "), loraPickerEntries(names));
});

test("mixed picker search keeps ancestor headers with full unfiltered folder counts", () => {
  const names = ["styles/ink/hit.safetensors", "styles/ink/other.safetensors", "styles/paint/a.safetensors", "faces/hit.safetensors"];
  assert.deepEqual(loraPickerEntries(names, "STYLES/INK/HIT"), [
    { kind: "folder", name: "styles", label: "styles", depth: 0, count: 3 },
    { kind: "folder", name: "styles/ink", label: "ink", depth: 1, count: 2 },
    { kind: "file", name: names[0], label: "hit.safetensors", depth: 2 },
  ]);
  const entries = loraPickerEntries(names, "hit");
  assert.deepEqual(entries.map(({ name }) => name), ["styles", "styles/ink", names[0], "faces", names[3]]);
  const folder = loraFolders(names).find(({ folder }) => folder === entries[0].name);
  assert.equal(appendFolderRows([], folder.names).added, entries[0].count,
    "clicking a searched header adds its whole folder, including hidden matches");
  assert.deepEqual(loraPickerEntries(names, "no match"), []);
});

test("mixed picker normalizes Windows paths for hierarchy and search, keeping exact file names", () => {
  const names = ["styles\\ink\\Hit.safetensors", "styles/ink/other.safetensors"];
  const expected = [
    { kind: "folder", name: "styles", label: "styles", depth: 0, count: 2 },
    { kind: "folder", name: "styles/ink", label: "ink", depth: 1, count: 2 },
    { kind: "file", name: names[0], label: "Hit.safetensors", depth: 2 },
  ];
  assert.deepEqual(loraPickerEntries(names, "  STYLES\\INK\\HIT  "), expected);
  assert.deepEqual(loraPickerEntries(names, "styles/ink/hit"), expected);
  assert.deepEqual(loraPickerEntries(names).filter(({ kind }) => kind === "file").map(({ name }) => name), names);
});

test("mixed picker handles empty lists and root files without inventing a folder", () => {
  assert.deepEqual(loraPickerEntries([]), []);
  assert.deepEqual(loraPickerEntries([], "anything"), []);
  assert.deepEqual(loraPickerEntries(["Root.safetensors"], "root"), [
    { kind: "file", name: "Root.safetensors", label: "Root.safetensors", depth: 0 },
  ]);
});

test("folded folders retain headers and full counts without hiding similarly prefixed siblings", () => {
  const names = ["styles/ink/a.safetensors", "styles/ink/deep/b.safetensors",
    "styles/ink-old/c.safetensors", "styles/paint/d.safetensors", "root.safetensors"];
  const collapsed = new Set(["styles/ink", "styles/paint"]);
  assert.deepEqual(loraPickerEntries(names, "", collapsed), [
    { kind: "folder", name: "styles", label: "styles", depth: 0, count: 4 },
    { kind: "folder", name: "styles/ink", label: "ink", depth: 1, count: 2 },
    { kind: "folder", name: "styles/ink-old", label: "ink-old", depth: 1, count: 1 },
    { kind: "file", name: names[2], label: "c.safetensors", depth: 2 },
    { kind: "folder", name: "styles/paint", label: "paint", depth: 1, count: 1 },
    { kind: "file", name: names[4], label: "root.safetensors", depth: 0 },
  ]);
  assert.deepEqual([...collapsed], ["styles/ink", "styles/paint"], "rendering never mutates caller preferences");
});

test("reopening a parent keeps its independently folded descendants closed", () => {
  const names = ["styles/ink/a.safetensors", "styles/ink/deep/b.safetensors", "styles/paint/c.safetensors", "faces/d.safetensors"];
  const collapsed = new Set(["styles", "styles/ink"]);
  assert.deepEqual(loraPickerEntries(names, "", collapsed).map(({ name }) => name), ["styles", "faces", names[3]]);
  assert.deepEqual([...collapsed], ["styles", "styles/ink"]);
  collapsed.delete("styles");
  assert.deepEqual(loraPickerEntries(names, "", collapsed).map(({ name }) => name),
    ["styles", "styles/ink", "styles/paint", names[2], "faces", names[3]]);
  collapsed.delete("styles/ink");
  assert.deepEqual(loraPickerEntries(names, "", collapsed), loraPickerEntries(names));
});

test("search honors supplied folds while an empty set reveals matches with unchanged counts", () => {
  const names = ["styles/ink/hit.safetensors", "styles/ink/other.safetensors", "styles/paint/a.safetensors", "faces/hit.safetensors"];
  const collapsed = new Set(["styles/ink"]);
  assert.deepEqual(loraPickerEntries(names, "hit", collapsed), [
    { kind: "folder", name: "styles", label: "styles", depth: 0, count: 3 },
    { kind: "folder", name: "styles/ink", label: "ink", depth: 1, count: 2 },
    { kind: "folder", name: "faces", label: "faces", depth: 0, count: 1 },
    { kind: "file", name: names[3], label: "hit.safetensors", depth: 1 },
  ]);
  assert.deepEqual(loraPickerEntries(names, "hit", new Set()), loraPickerEntries(names, "hit"));
  assert.deepEqual(loraPickerEntries(names, "missing", collapsed), [], "folding does not reveal unrelated headers");
  assert.deepEqual([...collapsed], ["styles/ink"], "temporary search expansion leaves browse state untouched");
});

test("folded Windows folders match normalized paths and preserve visible server filenames", () => {
  const names = ["Styles\\ink\\hidden.safetensors", "Styles\\ink-old\\keep.safetensors", "styles\\other.safetensors"];
  const normalized = new Set(["Styles/ink"]);
  const entries = loraPickerEntries(names, "", normalized);
  assert.deepEqual(entries.filter(({ kind }) => kind === "file").map(({ name }) => name), names.slice(1));
  assert.deepEqual(loraPickerEntries(names, "", new Set(["Styles\\ink"])), entries);
  assert.deepEqual(entries.filter(({ kind }) => kind === "folder").map(({ name, count }) => [name, count]),
    [["Styles", 2], ["Styles/ink", 1], ["Styles/ink-old", 1], ["styles", 1]]);
  assert.deepEqual(loraPickerEntries([], "", normalized), []);
});

test("folder add appends once, skips full-path duplicates and preserves existing row state", () => {
  const rows = normalizeRows([
    { id: "old", name: "styles\\ink\\a.safetensors", strength: 0.3, strength_clip: 0.6, enabled: false, triggers: "ink" },
    { id: "repeat", name: "styles/ink/a.safetensors", strength: -0.2, triggers: "wash" },
    { id: "blank", name: "", strength: 2 },
  ]);
  const before = serializeRows(rows);
  const result = appendFolderRows(rows, [
    "styles/ink/a.safetensors", "styles/ink/b.safetensors", "styles\\ink\\b.safetensors",
    "styles/paint/a.safetensors", "styles/ink/A.safetensors",
  ], 0.754);
  assert.equal(result.added, 3);
  assert.equal(result.skipped, 2);
  assert.equal(serializeRows(rows), before, "input rows are never mutated");
  rows.forEach((row, index) => assert.equal(result.rows[index], row, "original objects and ids survive"));
  assert.deepEqual(result.rows.slice(rows.length).map(({ name, strength, strength_clip, enabled, triggers }) =>
    ({ name, strength, strength_clip, enabled, triggers })), [
    { name: "styles/ink/b.safetensors", strength: 0.75, strength_clip: 0.75, enabled: true, triggers: "" },
    { name: "styles/paint/a.safetensors", strength: 0.75, strength_clip: 0.75, enabled: true, triggers: "" },
    { name: "styles/ink/A.safetensors", strength: 0.75, strength_clip: 0.75, enabled: true, triggers: "" },
  ], "same basename in another folder and differently cased Linux names stay distinct");
  assert.equal(new Set(result.rows.map(({ id }) => id)).size, result.rows.length);
});

test("folder add preserves Windows filenames and uses the ordinary default strength", () => {
  const names = ["styles\\ink\\b.safetensors", "styles\\a.safetensors"];
  const result = appendFolderRows([], loraFolders(names)[0].names);
  assert.deepEqual(result.rows.map(({ name }) => name), names);
  assert.ok(result.rows.every(({ strength, strength_clip }) => strength === 1 && strength_clip === 1));
  assert.equal(appendFolderRows([], [names[0]], 100).rows[0].strength, 10);
});

test("folder add is all-or-nothing at the row limit, counting empty rows and skipping duplicates first", () => {
  const rows = normalizeRows(Array.from({ length: MAX_ROWS - 1 }, (_, i) => ({ name: i ? "" : "styles/a" })));
  const blocked = appendFolderRows(rows, ["styles/a", "styles/b", "styles/c"]);
  assert.equal(blocked.rows, rows);
  assert.deepEqual({ added: blocked.added, skipped: blocked.skipped, needed: blocked.needed, room: blocked.room },
    { added: 0, skipped: 1, needed: 2, room: 1 });
  const fits = appendFolderRows(rows, ["styles/a", "styles/b"]);
  assert.equal(fits.added, 1);
  assert.equal(fits.rows.length, MAX_ROWS);
  const full = appendFolderRows(fits.rows, ["styles/c"]);
  assert.equal(full.rows, fits.rows);
  assert.equal(full.added, 0);
  assert.equal(full.room, 0);
});

test("an empty or already-added folder is a no-op with no new row identities", () => {
  const rows = normalizeRows([{ name: "styles/a" }]);
  assert.deepEqual(appendFolderRows(rows, []), { rows, added: 0, skipped: 0, needed: 0, room: 63 });
  const result = appendFolderRows(rows, ["styles/a"]);
  assert.equal(result.rows, rows);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.needed, 0);
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

// ---------- bars, absorb, resolution, memory ----------

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

test("strengthBarScale follows the enabled rows only", () => {
  const off = { ...row("a", 2), enabled: false };
  assert.equal(strengthBarScale([off, row("b", 0.5)]), 1);
  assert.equal(strengthBarScale([off, row("b", 1.5)]), 1.5);
  assert.equal(strengthBarScale([off, { ...row("b", 1.5), enabled: false }]), 1);
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

// One unit per character: widths below read as character counts.
const chars = (text) => text.length;

test("a long name is cut in the middle and keeps the larger share of its end", () => {
  const name = "ausboss_aesthetic_krea2_raw_r12_v1_000004000";
  assert.equal(middleEllipsis(name, 100, chars), name, "fits: untouched");
  assert.equal(middleEllipsis(name, 15, chars), "ausbo\u2026000004000");
  assert.equal(middleEllipsis(name, 30, chars), "ausboss_aes\u2026w_r12_v1_000004000");
  // Checkpoints of one run stay tellable apart at a narrow width.
  assert.equal(middleEllipsis("minimax_h3_fl2v_turbo_4step_v1.0_7600", 15, chars), "minim\u2026v1.0_7600");
  assert.equal(middleEllipsis("minimax_h3_fl2v_turbo_4step_v1.2_7600", 15, chars), "minim\u2026v1.2_7600");
  for (const width of [1, 5, 12, 20, 43]) {
    assert.ok(middleEllipsis(name, width, chars).length <= width, `fits in ${width}`);
  }
  assert.equal(middleEllipsis(name, 0, chars), "\u2026", "no room: just the mark");
  assert.equal(middleEllipsis("", 10, chars), "");
});

test("a path shortens its folder before it touches the file name", () => {
  const label = "minimaxh3/MiniMax-H3-Turbo-Lora-ComfyUI/minimax_h3_fl2v_turbo_4step_v1.2_7600";
  assert.deepEqual(fitLoraLabel(label, 200, chars), {
    folder: "minimaxh3/MiniMax-H3-Turbo-Lora-ComfyUI/",
    name: "minimax_h3_fl2v_turbo_4step_v1.2_7600",
  });
  assert.deepEqual(fitLoraLabel(label, 50, chars), {
    folder: "minimaxh3/M\u2026/",
    name: "minimax_h3_fl2v_turbo_4step_v1.2_7600",
  });
  // No room left for any of the folder: it goes, and the name is cut.
  assert.deepEqual(fitLoraLabel(label, 20, chars), { folder: "", name: "minimax\u2026ep_v1.2_7600" });
  assert.deepEqual(fitLoraLabel("styles\\ink_wash_v3", 30, chars), { folder: "styles\\", name: "ink_wash_v3" });
  assert.deepEqual(fitLoraLabel("AltGirlKrea", 30, chars), { folder: "", name: "AltGirlKrea" });
  assert.deepEqual(fitLoraLabel(undefined, 30, chars), { folder: "", name: "" });
});

test("the picker widens for long names, within the cap and the window", () => {
  // Short names: the old width (name field + 80, 260..380).
  assert.equal(pickerWidth(100, 150, 1920), 260);
  assert.equal(pickerWidth(100, 280, 1920), 360);
  assert.equal(pickerWidth(100, 900, 1920), 380);
  // A long name widens it to fit (label + 48 px of padding and scrollbar)...
  assert.equal(pickerWidth(400, 150, 1920), 448);
  // ...up to the cap, and never past the window's edge.
  assert.equal(pickerWidth(900, 150, 1920), 560);
  assert.equal(pickerWidth(900, 150, 400), 384);
  assert.equal(pickerWidth(900, 150, 200), 184);
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

test("rgthree stack imports numbered rows in order with shared strengths", () => {
  const rows = loaderLoraEntries({type: "Lora Loader Stack (rgthree)", widgets: widgets({
    lora_03: "c.safetensors", strength_03: -0.25,
    lora_01: "a.safetensors", strength_01: 0.8,
    lora_02: "None", strength_02: 1,
  })});
  assert.deepEqual(rows.map(r => [r.name, r.strength, r.strength_clip]), [
    ["a.safetensors", 0.8, 0.8], ["c.safetensors", -0.25, -0.25],
  ]);
});

test("JPS loader retains its Off switch instead of enabling the LoRA", () => {
  for (const setting of ["Off", "On"]) {
    const rows = loaderLoraEntries({type: "Lora Loader (JPS)", widgets: widgets({
      switch: setting, lora_name: "a.safetensors", strength_model: 0.5, strength_clip: 0.2,
    })});
    assert.equal(rows[0].enabled, setting === "On");
    assert.equal(rows[0].strength_clip, 0.2);
  }
});

test("rgthree null strengthTwo means linked strengths, not zero CLIP", () => {
  const rows = loaderLoraEntries({type: "Power Lora Loader (rgthree)", widgets: [
    {name: "lora_1", value: {on: true, lora: "a.safetensors", strength: 0.8, strengthTwo: null}},
  ]});
  assert.equal(rows[0].strength_clip, 0.8);
});


test("absorb walks a mixed stack in both directions regardless of canvas position", async () => {
  const { collectUpstreamLoaders, collectDownstreamLoaders } = await import("../js/shared/lora_stack.mjs");
  const graph = { links: {}, getNodeById: id => nodes.find(n => n.id === id) };
  const types = ["Lora Loader (JPS)", "Power Lora Loader (rgthree)", "Lora Loader Stack (rgthree)", "AUSBOSS_NODES_LoraLoader"];
  const nodes = types.map((type, id) => ({ id, type, graph, widgets: [], pos: [500 - id * 100, id * 30],
    inputs: [{ name: "model", type: "MODEL", link: id ? id : null }],
    outputs: [{ name: "MODEL", type: "MODEL", links: id < 3 ? [id + 1] : [] }],
  }));
  for (let id = 1; id < 4; id++) graph.links[id] = { origin_id: id - 1, target_id: id };
  assert.deepEqual(collectUpstreamLoaders(nodes[3]).map(n => n.id), [2, 1, 0]);
  // Put AusBoss before the foreign loaders in the same connected chain.
  nodes[0].type = "AUSBOSS_NODES_LoraLoader";
  nodes[3].type = "Lora Loader (JPS)";
  assert.deepEqual(collectDownstreamLoaders(nodes[0]).map(n => n.id), [1, 2, 3]);
  nodes[1].type = "Reroute";
  assert.deepEqual(collectDownstreamLoaders(nodes[0]).map(n => n.id), [2, 3]);
  nodes[1].outputs[0].links.push(99);
  assert.deepEqual(collectDownstreamLoaders(nodes[0]), []);
});

test("absorption keeps repeated applications in upstream, current, downstream order", () => {
  const existing = [row("same.safetensors", 0.4)];
  const before = mergeImportedRows(existing, [row("same.safetensors", 0.2)], {position: "before", deduplicate: false});
  const after = mergeImportedRows(before.rows, [row("same.safetensors", 0.7)], {position: "after", deduplicate: false});
  assert.deepEqual(after.rows.map(r => r.strength), [0.2, 0.4, 0.7]);
  assert.equal(after.skipped, 0);
});

test("absorption refuses shared model paths, mismatched CLIP paths and used trigger outputs", async () => {
  const {absorbChainIssue} = await import("../js/shared/lora_stack.mjs");
  const nodes = [];
  const graph = {links: {}, getNodeById: id => nodes[id]};
  const make = id => nodes[id] = {id, type: "LoraLoader", graph,
    widgets: widgets({lora_name:"a.safetensors",strength_model:1,strength_clip:1}),
    inputs:[{type:"MODEL",link:900},{type:"CLIP",link:901}],
    outputs:[{type:"MODEL",links:[]},{type:"CLIP",links:[]}]};
  const source=make(0), target=make(1);
  const wire=(from,out,to,input,id)=>{graph.links[id]={origin_id:from.id,origin_slot:out,target_id:to.id,target_slot:input};from.outputs[out].links.push(id);to.inputs[input].link=id};
  wire(source,0,target,0,1);wire(source,1,target,1,2);
  assert.equal(absorbChainIssue(target,[source],[]),null);
  target.mode = 4;
  assert.match(absorbChainIssue(target,[source],[]),/Enable this/);
  target.mode = 0; target.inputs.push({name:"loras",type:"STRING",link:9});
  assert.match(absorbChainIssue(target,[source],[]),/connected input/);
  target.inputs.pop();
  source.outputs[0].links.push(3);
  assert.match(absorbChainIssue(target,[source],[]),/model chain branches/);
  source.outputs[0].links.pop();source.outputs[1].links.push(3);
  assert.match(absorbChainIssue(target,[source],[]),/CLIP/);
  source.outputs[1].links.pop();target.inputs[1].link=null;
  assert.match(absorbChainIssue(target,[source],[]),/CLIP/);
  target.inputs[1].link=2;
  source.outputs.push({type:"STRING",links:[3]});
  assert.match(absorbChainIssue(target,[source],[]),/trigger words/);
  source.outputs.pop();
  // A reroute before the target must not hide a shared branch.
  const reroute=make(2);reroute.type="Reroute";
  source.outputs[0].links=[];wire(source,0,reroute,0,4);wire(reroute,0,target,0,5);
  assert.equal(absorbChainIssue(target,[source],[]),null);
  reroute.outputs[0].links.push(6);
  assert.match(absorbChainIssue(target,[source],[]),/model chain branches/);
});

// ---------- groups ----------

const groupRow = (id, group) => ({
  id, name: `${id}.safetensors`, strength: 1, strength_clip: 1, enabled: true, triggers: "",
  ...(group ? { group } : {}),
});
const shape = (rows) => rows.map((row) => row.id + (row.group ? `:${row.group}` : "")).join(" ");

test("rows keep their group through a save, and a group's rows stand together", async () => {
  const { normalizeRows, parseRows, serializeRows } = await import("../js/shared/lora_stack.mjs");
  const rows = normalizeRows([groupRow("a", "Style"), groupRow("b"), groupRow("c", "Style"), groupRow("d", "  ")]);
  assert.equal(shape(rows), "a:Style c:Style b d");
  assert.equal("group" in rows[3], false, "a blank group is no group");
  assert.equal(shape(parseRows(serializeRows(rows))), "a:Style c:Style b d");
});

test("grouping takes the place of the topmost chosen row, never inside another group", async () => {
  const { groupRows } = await import("../js/shared/lora_stack.mjs");
  const rows = [groupRow("a"), groupRow("b"), groupRow("c"), groupRow("d")];
  assert.equal(shape(groupRows(rows, ["d", "b"], "G")), "a b:G d:G c");
  const nested = [groupRow("a", "Old"), groupRow("b", "Old"), groupRow("c", "Old"), groupRow("d")];
  assert.equal(shape(groupRows(nested, ["b"], "New")), "a:Old c:Old b:New d");
});

test("moving rows into a group puts them at its end", async () => {
  const { moveRowsToGroup } = await import("../js/shared/lora_stack.mjs");
  const rows = [groupRow("a"), groupRow("b", "G"), groupRow("c", "G"), groupRow("d")];
  assert.equal(shape(moveRowsToGroup(rows, ["a", "d"], "G")), "b:G c:G a:G d:G");
});

test("taking rows out of a group leaves edge rows where they are", async () => {
  const { ungroupRows } = await import("../js/shared/lora_stack.mjs");
  const rows = [groupRow("a", "G"), groupRow("b", "G"), groupRow("c", "G"), groupRow("d")];
  assert.equal(shape(ungroupRows(rows, ["a"])), "a b:G c:G d");
  assert.equal(shape(ungroupRows(rows, ["c"])), "a:G b:G c d");
  assert.equal(shape(ungroupRows(rows, ["b"])), "a:G c:G b d");
  assert.equal(shape(ungroupRows(rows, ["a", "b", "c"])), "a b c d", "ungrouping all keeps the order");
});

test("move up and down step a row out of and into groups one step at a time", async () => {
  const { moveRowInStack } = await import("../js/shared/lora_stack.mjs");
  const rows = [groupRow("a"), groupRow("b", "G"), groupRow("c", "G"), groupRow("d")];
  assert.equal(shape(moveRowInStack(rows, 0, 1)), "a:G b:G c:G d", "a row above a group steps in");
  assert.equal(shape(moveRowInStack(rows, 1, -1)), "a b c:G d", "a group's top row steps out");
  assert.equal(shape(moveRowInStack(rows, 1, 1)), "a c:G b:G d", "inside a group rows swap");
  assert.equal(shape(moveRowInStack(rows, 3, -1)), "a b:G c:G d:G", "a row below a group steps in");
  const top = [groupRow("a", "G"), groupRow("b")];
  assert.equal(shape(moveRowInStack(top, 0, -1)), "a b", "the very first row can still step out");
  assert.equal(moveRowInStack(rows, 0, -1), rows, "a plain first row stays");
});

test("dropping a row and a whole group lands where the line shows", async () => {
  const { placeGroup, placeRow, moveGroup } = await import("../js/shared/lora_stack.mjs");
  const rows = [groupRow("a"), groupRow("b", "G"), groupRow("c", "G"), groupRow("d")];
  assert.equal(shape(placeRow(rows, "d", { group: "G", beforeId: "c" })), "a b:G d:G c:G");
  assert.equal(shape(placeRow(rows, "a", { group: "G" })), "b:G c:G a:G d");
  assert.equal(shape(placeRow(rows, "c", { beforeId: "b" })), "a c b:G d");
  assert.equal(shape(placeRow(rows, "b", {})), "a c:G d b");
  assert.equal(shape(placeGroup(rows, "G", "a")), "b:G c:G a d");
  assert.equal(shape(placeGroup(rows, "G", null)), "a d b:G c:G");
  assert.equal(shape(moveGroup(rows, "G", -1)), "b:G c:G a d");
  assert.equal(shape(moveGroup(rows, "G", 1)), "a d b:G c:G");
  const two = [groupRow("a", "X"), groupRow("b", "Y"), groupRow("c", "Y")];
  assert.equal(shape(moveGroup(two, "X", 1)), "b:Y c:Y a:X", "a group steps past a whole group");
});

test("the stack layout puts a header before each group with its on count", async () => {
  const { stackLayout, setGroupEnabled, renameGroup, uniqueGroupName, hasGroupName } =
    await import("../js/shared/lora_stack.mjs");
  const rows = [groupRow("a"), groupRow("b", "G"), { ...groupRow("c", "G"), enabled: false }];
  assert.deepEqual(stackLayout(rows).map((item) => item.kind === "group"
    ? `[${item.group} ${item.on}/${item.total}]` : item.index).join(" "), "0 [G 1/2] 1 2");
  assert.ok(setGroupEnabled(rows, "G", true).every((row) => row.enabled));
  assert.equal(setGroupEnabled(rows, "G", false)[0].enabled, true, "rows outside keep their switch");
  assert.equal(shape(renameGroup(rows, "G", "Faces")), "a b:Faces c:Faces");
  assert.equal(uniqueGroupName(rows), "Group 1");
  assert.equal(uniqueGroupName([groupRow("a", "group 1")]), "Group 2");
  assert.equal(hasGroupName(rows, "g"), true);
  assert.equal(hasGroupName(rows, "g", "G"), false, "a group may change its own case");
});

test("templates keep groups", async () => {
  const { applyTemplate, templateFromRows } = await import("../js/shared/lora_stack.mjs");
  const template = templateFromRows("Look", [groupRow("a", "G"), groupRow("b")]);
  assert.equal(template.rows[0].group, "G");
  assert.equal(applyTemplate(template)[0].group, "G");
});

test("a group switched off stops its rows, and each row keeps its own switch", async () => {
  const { isGroupOff, normalizeRows, setGroupOff, stackLayout, strengthBarScale, summarizeRows, toggleAllState } =
    await import("../js/shared/lora_stack.mjs");
  const rows = [groupRow("a"), { ...groupRow("b", "G"), strength: 3 }, { ...groupRow("c", "G"), enabled: false }, groupRow("d")];
  const off = setGroupOff(rows, "G", true);
  assert.deepEqual(off.map((row) => Boolean(row.group_off)), [false, true, true, false]);
  assert.deepEqual(off.map((row) => row.enabled), [true, true, false, true], "the rows' own switches stay");
  assert.equal(isGroupOff(off, "G"), true);
  assert.equal(summarizeRows(off), "2 / 4 on");
  assert.equal(toggleAllState(off), "mixed");
  assert.equal(strengthBarScale(off), 1, "a row in an off group sits out of the bar scale");
  const head = stackLayout(off).find((item) => item.kind === "group");
  assert.deepEqual([head.on, head.total, head.off], [1, 2, true]);
  assert.deepEqual(setGroupOff(off, "G", false), rows, "back on is exactly what it was");
  assert.equal("group_off" in normalizeRows([{ ...groupRow("x"), group_off: true }])[0], false, "no group, nothing to switch off");
  assert.equal(normalizeRows(off)[1].group_off, true, "it survives a save");
});

test("a row joining a switched-off group goes off with it, and a row leaving it does not", async () => {
  const { groupRows, moveRowInStack, moveRowsToGroup, normalizeRows, placeRow, renameGroup, setGroupOff, ungroupRows } =
    await import("../js/shared/lora_stack.mjs");
  const off = setGroupOff([groupRow("a"), groupRow("b", "G"), groupRow("c", "G"), groupRow("d")], "G", true);
  const offOf = (rows, id) => Boolean(rows.find((row) => row.id === id).group_off);
  assert.equal(offOf(placeRow(off, "a", { group: "G", beforeId: "b" }), "a"), true);
  assert.equal(offOf(moveRowsToGroup(off, ["d"], "G"), "d"), true);
  assert.equal(offOf(moveRowInStack(off, 0, 1), "a"), true);
  assert.equal(offOf(ungroupRows(off, ["b"]), "b"), false);
  assert.equal(offOf(placeRow(off, "b", {}), "b"), false);
  assert.equal(offOf(groupRows(off, ["b"], "New"), "b"), false, "a new group starts on");
  assert.equal(offOf(renameGroup(off, "G", "H"), "c"), true, "a renamed group stays off");
  const mixed = normalizeRows([{ ...groupRow("x", "G"), group_off: true }, groupRow("y", "G")]);
  assert.deepEqual(mixed.map((row) => Boolean(row.group_off)), [true, true]);
});

test("the master switch turns groups back on, and its memory brings them back off", async () => {
  const { cycleMasterToggle, setGroupOff, toggleAllState } = await import("../js/shared/lora_stack.mjs");
  const off = setGroupOff([groupRow("a"), groupRow("b", "G"), { ...groupRow("c", "G"), enabled: false }], "G", true);
  const first = cycleMasterToggle(off, undefined);
  assert.equal(toggleAllState(first.rows), "on");
  assert.equal(first.rows.some((row) => row.group_off), false);
  const second = cycleMasterToggle(first.rows, first.snapshot);
  assert.equal(toggleAllState(second.rows), "off");
  const third = cycleMasterToggle(second.rows, second.snapshot);
  assert.deepEqual(third.rows.map((row) => [row.enabled, Boolean(row.group_off)]), [[true, false], [true, true], [false, true]]);
});
