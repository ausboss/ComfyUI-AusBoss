import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SETTINGS, MEMBERS_MAX, MODE_ALWAYS, MODE_BYPASS, MODE_NEVER, PILL_CHOICES_MAX, PILL_FRAME, PILL_NODE_WIDTH_MAX,
  PILL_SEGMENT_PAD, SWITCHES_MAX, TITLE_MAX, VALUE_TEXT_MAX,
  addMembers, addOffMembers, addSwitch, canvasOrder, cardView, centreInside, choiceState, choosePlan, cleanIds, cleanSnapshots,
  flipTo, frameBounds, groupBounds, groupListed, hasOffSide, heldCount, isRunning, listedRows, matchTerms, modeMatters,
  moveSwitch, nodeBounds, normalizeSettings, normalizeSwitches, offFreshCount, offHeldCount, offMode, pairNow, pairValue,
  partState, pillNodeWidth, placeNodes, readGroups, readSwitches, removeMembers, removeOffMembers, removeSwitch, renameSwitch,
  rowLabel, rowsSignature, saveValues, snapshotNode, stackRows, suggestTitle, switchAllPlan, switchPlan, titleOrder, unionRect,
  valueAllPlan, valuePairs, valuePlan,
} from "../js/shared/workflow_switches.mjs";

const node = (id, x, y, { w = 200, h = 100, mode = MODE_ALWAYS, ...rest } = {}) => ({ id, pos: [x, y], size: [w, h], mode, ...rest });
const group = (title, x, y, w, h, extra = {}) => ({ title, boundingRect: [x, y, w, h], ...extra });
const titles = (rows) => rows.map((row) => row.title);
const ids = (nodes) => nodes.map((member) => member.id);

test("settings fall back to the defaults for anything a workflow left behind", () => {
  const defaults = { ...DEFAULT_SETTINGS, switches: [] };
  assert.deepEqual(normalizeSettings(undefined), defaults);
  assert.deepEqual(normalizeSettings("nonsense"), defaults);
  assert.deepEqual(
    normalizeSettings({ off: "mute", groups: "matching", match: "upscale", order: "title", exclusive: true }),
    { off: "mute", groups: "matching", match: "upscale", order: "title", exclusive: true, show: "rows", switches: [] },
  );
  assert.deepEqual(
    normalizeSettings({ off: "delete", groups: 3, order: null, exclusive: "yes", show: "tabs", match: 7, switches: "all" }),
    defaults,
  );
  assert.equal(normalizeSettings({ exclusive: true, show: "pill" }).show, "pill");
  assert.equal(normalizeSettings({ match: "x".repeat(500) }).match.length, 200);
  assert.equal(normalizeSettings({ groups: "none" }).groups, "none");
  // Every read hands out a list of its own: the frozen default is never shared.
  assert.notEqual(normalizeSettings(undefined).switches, DEFAULT_SETTINGS.switches);
});

test("made switches are cleaned, and every one keeps an id of its own", () => {
  assert.deepEqual(cleanIds([3, "3", 4, null, NaN, " a ", "", {}, 4]), [3, 4, "a"]);
  // A whole number kept as text is stored as the number; other text stays text.
  assert.deepEqual(cleanIds(["12", " 7 ", "007", "1e3", "-2", "0"]), [12, 7, "007", "1e3", "-2", 0]);
  assert.equal(cleanIds(Array.from({ length: MEMBERS_MAX + 50 }, (_, index) => index)).length, MEMBERS_MAX);
  const switches = normalizeSwitches([
    { id: 2, title: "  The   whole thing ", nodes: [5, 5, 6], groups: [1] },
    { id: 2, title: "", nodes: "x" }, // a repeated id and no title
    null,
    { id: -4, title: "y".repeat(200) },
  ]);
  assert.deepEqual(switches[0], { id: 2, title: "The whole thing", nodes: [5, 6], groups: [1], on: {}, off: {} });
  assert.deepEqual(switches[1], { id: 1, title: "Switch 1", nodes: [], groups: [], on: {}, off: {} });
  assert.equal(switches[2].id, 3);
  assert.equal(switches[2].title.length, TITLE_MAX);
  assert.equal(normalizeSwitches(Array.from({ length: SWITCHES_MAX + 5 }, () => ({}))).length, SWITCHES_MAX);
});

test("off means bypass unless the card says mute; only muted and bypassed nodes are off", () => {
  assert.equal(offMode(DEFAULT_SETTINGS), MODE_BYPASS);
  assert.equal(offMode({ off: "mute" }), MODE_NEVER);
  assert.equal(isRunning(MODE_ALWAYS), true);
  assert.equal(isRunning(1), true); // on event
  assert.equal(isRunning(MODE_NEVER), false);
  assert.equal(isRunning(MODE_BYPASS), false);
});

test("a node belongs to a group when the group holds its centre, edges half-open like LiteGraph", () => {
  const box = [0, 0, 100, 100];
  assert.equal(centreInside(box, [40, 40, 20, 20]), true);
  assert.equal(centreInside(box, [90, 90, 40, 40]), false); // centre at 110
  assert.equal(centreInside(box, [-10, -10, 20, 20]), true); // centre at the corner
  assert.equal(centreInside(box, [90, 0, 20, 20]), false); // centre on the right edge
});

test("node bounds come from the canvas's own measurement, or are measured like LiteGraph does", () => {
  assert.deepEqual(nodeBounds({ boundingRect: [5, -25, 200, 130], pos: [0, 0], size: [1, 1] }), [5, -25, 200, 130]);
  // Never drawn yet: the rect is still all zeros.
  assert.deepEqual(nodeBounds({ boundingRect: [0, 0, 0, 0], pos: [10, 50], size: [200, 100] }), [10, 20, 200, 130]);
  assert.deepEqual(nodeBounds({ pos: [10, 50], size: [200, 100], title_mode: 1 }), [10, 50, 200, 100]);
  assert.deepEqual(nodeBounds({ pos: [10, 50], size: [200, 100], flags: { collapsed: true } }), [10, 20, 80, 30]);
  assert.deepEqual(nodeBounds({ pos: [10, 50], size: [200, 100], flags: { collapsed: true }, _collapsed_width: 120 }), [10, 20, 120, 30]);
  assert.deepEqual(nodeBounds({ pos: [0, 40], size: [100, 60] }, { titleHeight: 20 }), [0, 20, 100, 80]);
});

test("group bounds read the synced rect first, then the legacy fields", () => {
  assert.deepEqual(groupBounds({ boundingRect: [1, 2, 3, 4] }), [1, 2, 3, 4]);
  assert.deepEqual(groupBounds({ _bounding: [5, 6, 7, 8] }), [5, 6, 7, 8]);
  assert.deepEqual(groupBounds({ pos: [9, 10], size: [11, 12] }), [9, 10, 11, 12]);
});

test("the frame around a switch's nodes is the smallest box that holds them all", () => {
  assert.equal(unionRect([]), null);
  assert.equal(unionRect([[0, 0, 0, 0]]), null);
  assert.deepEqual(unionRect([[10, 20, 100, 50]]), [10, 20, 100, 50]);
  assert.deepEqual(unionRect([[10, 20, 100, 50], [-40, 60, 30, 200], null]), [-40, 20, 150, 240]);
});

test("the frame button never zooms in past natural size", () => {
  const view = [1000, 500];
  // A big part is left alone: the canvas fits it whole.
  assert.deepEqual(frameBounds([0, 0, 2000, 300], view), [0, 0, 2000, 300]);
  assert.deepEqual(frameBounds([0, 0, 300, 400], view), [0, 0, 300, 400]);
  // A small one grows around its centre until one side fills 80% of the view: zoom 1.
  const grown = frameBounds([100, 100, 200, 100], view);
  assert.deepEqual(grown, [-200, -50, 800, 400]);
  assert.equal(0.8 * Math.min(view[0] / grown[2], view[1] / grown[3]), 1);
  assert.deepEqual(frameBounds([5, 5, 10, 10], [0, 0]), [5, 5, 10, 10]);
});

test("a part reads on, off, mixed or empty from the nodes whose mode matters", () => {
  const on = { mode: MODE_ALWAYS };
  const bypassed = { mode: MODE_BYPASS };
  const muted = { mode: MODE_NEVER };
  assert.deepEqual(partState([on, on]), { state: "on", on: 2, total: 2 });
  assert.deepEqual(partState([bypassed, muted]), { state: "off", on: 0, total: 2 });
  assert.deepEqual(partState([on, bypassed, on]), { state: "mixed", on: 2, total: 3 });
  assert.deepEqual(partState([]), { state: "empty", on: 0, total: 0 });
  // A note left on inside a switched-off part does not make it mixed...
  const note = { mode: MODE_ALWAYS, note: true };
  const counts = (member) => !member.note;
  assert.deepEqual(partState([bypassed, note], counts), { state: "off", on: 0, total: 1 });
  // ...and a part of nothing but notes is read from the notes.
  assert.deepEqual(partState([note], counts), { state: "on", on: 1, total: 1 });
});

test("only nodes that can run decide a part's state", () => {
  const defined = (nodeData, extra = {}) => Object.assign(Object.create({ constructor: { nodeData } }), extra);
  const sampler = defined({ output_node: false }, { outputs: [{}] });
  const save = defined({ output_node: true }, { outputs: [] });
  const note = { isVirtualNode: true };
  const subgraph = { isVirtualNode: true, isSubgraphNode: () => true };
  const workflowNote = defined({ output_node: false }, { outputs: [] });
  const missing = { outputs: [] }; // a node whose pack is not installed: no definition to go by
  assert.deepEqual([sampler, save, note, subgraph, workflowNote, missing].map(modeMatters), [true, true, false, true, false, true]);
});

test("readGroups finds each group's nodes; a node inside nested groups belongs to both", () => {
  const outer = group("Finish", 0, 0, 1000, 600);
  const inner = group("Upscale", 500, 50, 400, 400);
  const nodes = [
    node(1, 100, 100), // outer only
    node(2, 600, 150, { mode: MODE_BYPASS }), // outer and inner
    node(3, 2000, 100), // no group
    node(4, 650, 300, { switches: true }), // skipped entirely
  ];
  const placed = placeNodes(nodes, { skip: (n) => n.switches });
  assert.deepEqual(ids(placed.map((entry) => entry.node)), [1, 2, 3]);
  const [finish, upscale] = readGroups([outer, inner], placed);
  assert.deepEqual(ids(finish.members), [1, 2]);
  assert.equal(finish.state, "mixed");
  assert.equal(finish.kind, "group");
  assert.deepEqual(ids(upscale.members), [2]);
  assert.equal(upscale.state, "off");
  assert.equal(finish.title, "Finish");
  assert.equal(finish.color, null);
  assert.equal(readGroups([group("x", 0, 0, 10, 10, { color: "#335" })], [])[0].color, "#335");
  assert.equal(readGroups([group("x", 0, 0, 10, 10)], [])[0].state, "empty");
});

test("a made switch holds its picked nodes and whatever sits in its picked groups right now", () => {
  const box = node(11, 1000, 0, { mode: MODE_BYPASS });
  const save = node(12, 3000, 400, { mode: MODE_BYPASS });
  const loader = node(13, 100, 100);
  const inGroup = node(14, 120, 300);
  const placed = placeNodes([box, save, loader, inGroup, node(15, 5000, 5000)]);
  const groups = readGroups([group("Models", 0, 0, 600, 600, { id: 7 })], placed);
  const switches = normalizeSwitches([
    { id: 1, title: "The whole thing", nodes: [11, 12, "11"] },
    { id: 2, title: "Models and save", nodes: [12, 99], groups: [7, 8] },
    { id: 3, title: "Gone", nodes: [404] },
  ]);
  const [whole, mixed, gone] = readSwitches(switches, placed, groups);
  assert.equal(whole.kind, "switch");
  assert.deepEqual(ids(whole.members), [11, 12]);
  assert.equal(whole.state, "off");
  assert.equal(whole.gone, 0);
  assert.deepEqual(whole.rect, [1000, -30, 2200, 530]);
  // The save, then the two nodes inside the group; node 99 and group 8 are gone.
  assert.deepEqual(ids(mixed.members), [12, 13, 14]);
  assert.deepEqual([mixed.state, mixed.on, mixed.total, mixed.gone], ["mixed", 2, 3, 2]);
  assert.deepEqual([gone.state, gone.gone, gone.rect], ["empty", 1, null]);
  // A node id is matched as a workflow stores it, number or text.
  assert.deepEqual(ids(readSwitches(normalizeSwitches([{ nodes: ["13"] }]), placed, groups)[0].members), [13]);
  const textIds = placeNodes([node("13", 0, 0)]);
  assert.deepEqual(ids(readSwitches(normalizeSwitches([{ nodes: [13] }]), textIds, [])[0].members), ["13"]);
});

test("numbered lists titles that start with a digit; matching takes comma-separated terms; none lists nothing", () => {
  const numbered = { groups: "numbered" };
  assert.equal(groupListed("1 · Models + LoRA", numbered), true);
  assert.equal(groupListed("  10 Upscale", numbered), true);
  assert.equal(groupListed("Step 1", numbered), false);
  const matching = { groups: "matching", match: "upscale, Face" };
  assert.deepEqual(matchTerms(matching.match), ["upscale", "face"]);
  assert.equal(groupListed("4K Upscale", matching), true);
  assert.equal(groupListed("face detail", matching), true);
  assert.equal(groupListed("Create", matching), false);
  assert.equal(groupListed("Create", { groups: "matching", match: " , " }), true);
  assert.equal(groupListed("anything", DEFAULT_SETTINGS), true);
  assert.equal(groupListed("1 · Load", { groups: "none" }), false);
});

// The group boxes of the Qwen Image 2.1 Studio workflow: stages stacked in
// columns, numbered down each column and then across.
const STUDIO = [
  ["1 · Models + LoRA", -20, 40, 480, 690],
  ["2 · Prompt enhancer · optional", -20, 770, 480, 930],
  ["3 · Create", 520, 40, 980, 1350],
  ["4 · Source · draft or your photo", 520, 1440, 980, 640],
  ["5 · Polish to 2K", 1560, 40, 1000, 1110],
  ["6 · Edit · off until you flip it", 2620, 40, 500, 1460],
  ["7 · 4K finish · SeedVR2 · optional", 3180, 40, 960, 1000],
  ["8 · Compare + save", 4200, 40, 1220, 1040],
].map(([title, x, y, w, h]) => ({ title, rect: [x, y, w, h] }));

test("canvas order reads column by column, so stacked stages keep their numbers", () => {
  const shuffled = [STUDIO[7], STUDIO[3], STUDIO[0], STUDIO[5], STUDIO[1], STUDIO[6], STUDIO[2], STUDIO[4]];
  assert.deepEqual(titles(canvasOrder(shuffled)), titles(STUDIO));
});

test("canvas order: a row of groups reads left to right, a stack top to bottom", () => {
  const row = [["C", 1200, 0], ["A", 0, 10], ["B", 600, -20]].map(([title, x, y]) => ({ title, rect: [x, y, 500, 400] }));
  assert.deepEqual(titles(canvasOrder(row)), ["A", "B", "C"]);
  const stack = [["low", 30, 900], ["top", 0, 0], ["mid", 10, 450]].map(([title, x, y]) => ({ title, rect: [x, y, 500, 400] }));
  assert.deepEqual(titles(canvasOrder(stack)), ["top", "mid", "low"]);
  // A wide banner over three columns does not swallow them.
  const banner = [
    { title: "banner", rect: [0, 0, 3000, 200] },
    { title: "one", rect: [0, 300, 800, 400] },
    { title: "two", rect: [1000, 300, 800, 400] },
    { title: "three", rect: [2000, 300, 800, 400] },
  ];
  assert.deepEqual(titles(canvasOrder([...banner].reverse())), ["banner", "one", "two", "three"]);
});

test("title order compares numbers as numbers and breaks ties by canvas order", () => {
  const rows = [["10 · Save", 0], ["9 · Upscale", 600], ["Alpha", 1200], ["alpha", 1800], ["2 · Create", 2400]]
    .map(([title, x]) => ({ title, rect: [x, 0, 500, 400] }));
  assert.deepEqual(titles(titleOrder(rows)), ["2 · Create", "9 · Upscale", "10 · Save", "Alpha", "alpha"]);
});

test("the card lists the made switches first, as made, then the listed groups in order", () => {
  const made = [{ title: "Zebra" }, { title: "Apple" }];
  const groups = [...STUDIO, { title: "Scratch notes", rect: [0, 3000, 400, 300] }];
  assert.equal(listedRows(made, groups, DEFAULT_SETTINGS).length, 11);
  assert.deepEqual(titles(listedRows(made, groups, { ...DEFAULT_SETTINGS, groups: "numbered" })), ["Zebra", "Apple", ...titles(STUDIO)]);
  assert.deepEqual(
    titles(listedRows(made, groups, { ...DEFAULT_SETTINGS, groups: "matching", match: "optional", order: "title" })),
    ["Zebra", "Apple", "2 · Prompt enhancer · optional", "7 · 4K finish · SeedVR2 · optional"],
  );
  assert.deepEqual(titles(listedRows(made, groups, { ...DEFAULT_SETTINGS, groups: "none" })), ["Zebra", "Apple"]);
  assert.deepEqual(listedRows(undefined, undefined, DEFAULT_SETTINGS), []);
});

test("a click anywhere on the pill flips it; a mixed row goes to the half that was clicked", () => {
  assert.deepEqual([flipTo("on", true), flipTo("on", false)], [false, false]);
  assert.deepEqual([flipTo("off", true), flipTo("off", false)], [true, true]);
  assert.deepEqual([flipTo("mixed", true), flipTo("mixed", false)], [true, false]);
  assert.deepEqual([flipTo("empty", true), flipTo(undefined, false)], [true, false]);
});

test("a switch sets every node it holds, and reports only the nodes that change", () => {
  const a = { id: "a", mode: MODE_ALWAYS };
  const b = { id: "b", mode: MODE_BYPASS };
  const row = { members: [a, b] };
  assert.deepEqual(switchPlan([row], row, true, DEFAULT_SETTINGS), [[b, MODE_ALWAYS]]);
  assert.deepEqual(switchPlan([row], row, false, DEFAULT_SETTINGS), [[a, MODE_BYPASS]]);
  assert.deepEqual(switchPlan([row], row, false, { ...DEFAULT_SETTINGS, off: "mute" }), [[a, MODE_NEVER], [b, MODE_NEVER]]);
  assert.deepEqual(switchPlan([row], { members: [] }, true, DEFAULT_SETTINGS), []);
});

test("one at a time switches the other listed rows off, and a shared node stays on", () => {
  const shared = { id: "shared", mode: MODE_BYPASS };
  const x = { id: "x", mode: MODE_ALWAYS };
  const y = { id: "y", mode: MODE_BYPASS };
  const first = { members: [x, shared] };
  const second = { members: [y, shared] };
  const settings = { ...DEFAULT_SETTINGS, exclusive: true };
  const plan = new Map(switchPlan([first, second], second, true, settings));
  assert.equal(plan.get(x), MODE_BYPASS);
  assert.equal(plan.get(y), MODE_ALWAYS);
  assert.equal(plan.get(shared), MODE_ALWAYS);
  // Switching a row off leaves the others alone.
  assert.deepEqual(switchPlan([first, second], first, false, settings), [[x, MODE_BYPASS]]);
});

test("switching every listed row sets each node once", () => {
  const a = { mode: MODE_BYPASS };
  const b = { mode: MODE_ALWAYS };
  const rows = [{ members: [a, b] }, { members: [b] }];
  assert.deepEqual(switchAllPlan(rows, true, DEFAULT_SETTINGS), [[a, MODE_ALWAYS]]);
  assert.deepEqual(switchAllPlan(rows, false, { off: "mute" }), [[a, MODE_NEVER], [b, MODE_NEVER]]);
});

test("a new switch is named after the box, the group or the first node that was picked", () => {
  const box = { title: "Draw the whole thing", box: true };
  const save = { title: "Save Image - The whole thing" };
  assert.equal(suggestTitle({ nodes: [save, box] }), "Draw the whole thing");
  assert.equal(suggestTitle({ nodes: [save], groups: [{ title: "4 · Result" }] }), "4 · Result");
  assert.equal(suggestTitle({ nodes: [save, { title: "Other" }] }), "Save Image - The whole thing");
  assert.equal(suggestTitle({ nodes: [box, { ...box, title: "Second box" }] }), "Draw the whole thing");
  assert.equal(suggestTitle({ groups: [{ title: "A" }, { title: "B" }] }), "A");
  assert.equal(suggestTitle({}), "Switch");
  assert.equal(suggestTitle({ nodes: [{ title: "  " }] }), "Switch");
  // A name already on the card gets a number.
  assert.equal(suggestTitle({ nodes: [box] }, ["draw the whole thing"]), "Draw the whole thing 2");
  assert.equal(suggestTitle({ nodes: [box] }, ["Draw the whole thing", "Draw the whole thing 2"]), "Draw the whole thing 3");
  assert.ok(suggestTitle({ nodes: [{ title: "z".repeat(90) }] }, ["z".repeat(TITLE_MAX)]).length <= TITLE_MAX);
});

test("switches are added, renamed, moved, changed and removed without touching the rest", () => {
  const start = normalizeSettings({ off: "mute", groups: "none" });
  const first = addSwitch(start, { title: "The cut-out", nodes: [5] });
  assert.equal(first.id, 1);
  const second = addSwitch(first.settings, { nodes: [6, 7, 6], groups: [2] });
  assert.equal(second.id, 2);
  let settings = second.settings;
  assert.deepEqual(settings.switches, [
    { id: 1, title: "The cut-out", nodes: [5], groups: [], on: {}, off: {} },
    { id: 2, title: "Switch 2", nodes: [6, 7], groups: [2], on: {}, off: {} },
  ]);
  assert.deepEqual([settings.off, settings.groups], ["mute", "none"]);
  assert.deepEqual(start.switches, []); // the settings handed in are left alone

  settings = renameSwitch(settings, 2, "  The whole thing ");
  assert.equal(settings.switches[1].title, "The whole thing");
  assert.equal(renameSwitch(settings, 2, "   ").switches[1].title, "The whole thing");

  settings = addMembers(settings, 1, { nodes: [5, 8], groups: [3] });
  assert.deepEqual(settings.switches[0], { id: 1, title: "The cut-out", nodes: [5, 8], groups: [3], on: {}, off: {} });
  assert.equal(heldCount(settings.switches[0], { nodes: [8, 9, "5"], groups: [3, 4] }), 3);
  settings = removeMembers(settings, 1, { nodes: ["5"], groups: [3] });
  assert.deepEqual(settings.switches[0], { id: 1, title: "The cut-out", nodes: [8], groups: [], on: {}, off: {} });

  assert.deepEqual(moveSwitch(settings, 1, 1).switches.map((entry) => entry.id), [2, 1]);
  assert.deepEqual(moveSwitch(settings, 1, -1).switches.map((entry) => entry.id), [1, 2]);
  assert.deepEqual(moveSwitch(settings, 99, 1).switches.map((entry) => entry.id), [1, 2]);

  // A removed switch's id is not handed to the next one made while it is the highest left.
  const third = addSwitch(removeSwitch(settings, 1), { title: "Third" });
  assert.deepEqual(third.settings.switches.map((entry) => entry.id), [2, 3]);

  let full = start;
  for (let index = 0; index < SWITCHES_MAX; index += 1) full = addSwitch(full, {}).settings;
  assert.equal(addSwitch(full, {}).id, null);
});

// ---------- switches that change settings ----------

const STACK = (turbo, strength = 1) => JSON.stringify([
  { name: "consistency.safetensors", strength, enabled: true, triggers: "" },
  { name: "turbo.safetensors", strength: 1, enabled: turbo, triggers: "" },
]);
const stepsNode = (value) => ({ id: 21, pos: [0, 0], size: [200, 100], mode: MODE_ALWAYS, widgets: [{ name: "value", value }, { name: "card", value: "", serialize: false }] });
const loraNode = (value) => ({ id: 22, pos: [300, 0], size: [200, 100], mode: MODE_ALWAYS, widgets: [{ name: "loras", value }, { name: "on_missing", value: "error" }] });

test("saving a side remembers what a node's own controls hold, and nothing else", () => {
  assert.deepEqual(snapshotNode(stepsNode(8)), { value: 8 });
  assert.deepEqual(snapshotNode(loraNode(STACK(true))), { loras: STACK(true), on_missing: "error" });
  assert.deepEqual(snapshotNode({ widgets: [{ name: "a", value: { x: 1 } }, { name: "b", value: NaN }, { name: "", value: 1 }, { name: "ok", value: false }, null] }), { ok: false });
  assert.deepEqual(snapshotNode({ widgets: [{ name: "long", value: "x".repeat(VALUE_TEXT_MAX + 1) }, { name: "fits", value: "x".repeat(VALUE_TEXT_MAX) }] }), { fits: "x".repeat(VALUE_TEXT_MAX) });
  assert.deepEqual(snapshotNode({}), {});
  assert.deepEqual(cleanSnapshots({ 21: { value: 8, bad: [1] }, 22: "x", 23: {} }), { 21: { value: 8 } });
  assert.deepEqual(cleanSnapshots([1, 2]), {});
});

test("a switch changes only the settings that differ between its on and its off", () => {
  const entry = {
    on: { 21: { value: 8, same: "x" }, 22: { loras: STACK(true), on_missing: "error" }, 30: { only: 1 } },
    off: { 21: { value: 25, same: "x" }, 22: { loras: STACK(false), on_missing: "error" } },
  };
  assert.deepEqual(valuePairs(entry), [
    { node: "21", widget: "value", on: 8, off: 25 },
    { node: "22", widget: "loras", row: "turbo.safetensors", on: { enabled: true, strength: 1 }, off: { enabled: false, strength: 1 } },
  ]);
  assert.deepEqual(valuePairs({ on: { 21: { value: 8 } }, off: {} }), []);
  assert.deepEqual(valuePairs({}), []);
  // Text that only looks like a stack on one side is switched whole.
  assert.deepEqual(valuePairs({ on: { 5: { text: "[1, 2]" } }, off: { 5: { text: "plain" } } }), [{ node: "5", widget: "text", on: "[1, 2]", off: "plain" }]);
  assert.equal(stackRows("[]"), null);
  assert.equal(stackRows('[{"name":"a"}]'), null);
  assert.equal(stackRows("not json ["), null);
});

test("a setting reads on, off or neither, and a stack row is changed in place", () => {
  const plain = { node: "21", widget: "value", on: 8, off: 25 };
  assert.deepEqual([8, 25, 30].map((now) => pairNow(plain, now)), ["on", "off", "other"]);
  assert.equal(pairValue(plain, "on", 30), 8);
  assert.equal(pairValue(plain, "off", 8), 25);
  const row = { node: "22", widget: "loras", row: "turbo.safetensors", on: { enabled: true, strength: 1 }, off: { enabled: false, strength: 1 } };
  assert.deepEqual([STACK(true), STACK(false), "[]", STACK(true).replace('"strength":1,"enabled":true,"triggers":""}]', '"strength":0.5,"enabled":true,"triggers":""}]')].map((now) => pairNow(row, now)), ["on", "off", "other", "other"]);
  // The other row keeps the strength it was given since the switch was made.
  const changed = STACK(false, 0.8);
  assert.equal(pairValue(row, "on", changed), STACK(true, 0.8));
  assert.equal(pairValue(row, "off", STACK(true, 0.8)), STACK(false, 0.8));
  assert.equal(pairValue(row, "on", "gone"), "gone");
});

test("a stack row is still the same row after the LoRA Loader gives it the folder its file is in", () => {
  const row = { node: "22", widget: "loras", row: "turbo.safetensors", on: { enabled: true, strength: 1 }, off: { enabled: false, strength: 1 } };
  // What a refresh writes when the file sits in models/loras/qwen: the row's name gains the folder.
  const named = (name, turbo) => STACK(turbo).replace('"turbo.safetensors"', JSON.stringify(name));
  const moved = (turbo) => named("qwen/turbo.safetensors", turbo);
  assert.deepEqual([moved(true), moved(false)].map((now) => pairNow(row, now)), ["on", "off"]);
  assert.equal(pairValue(row, "off", moved(true)), moved(false));
  assert.equal(pairValue(row, "on", moved(false)), moved(true));
  // Another separator, letter case or model extension is the same file, as it is to the loader.
  assert.deepEqual(["Qwen\\Turbo.safetensors", "qwen/turbo.sft"].map((name) => pairNow(row, named(name, true))), ["on", "on"]);
  // A switch made while the row had its folder finds the plain name again.
  assert.equal(pairNow({ ...row, row: "qwen/turbo.safetensors" }, STACK(false)), "off");
  // Its two sides saved before and after the move still pair up.
  assert.deepEqual(valuePairs({ on: { 22: { loras: STACK(true) } }, off: { 22: { loras: moved(false) } } }), [row]);
  // Two rows with that file name: only the exact name counts, nothing is guessed.
  const twice = JSON.stringify([
    { name: "a/turbo.safetensors", strength: 1, enabled: true, triggers: "" },
    { name: "b/turbo.safetensors", strength: 1, enabled: false, triggers: "" },
  ]);
  assert.equal(pairNow(row, twice), "other");
  assert.equal(pairValue(row, "off", twice), twice);
  assert.equal(pairNow({ ...row, row: "b/turbo.safetensors" }, twice), "off");
});

test("a made switch that changes settings reads them from the graph and never turns those nodes off", () => {
  let settings = addSwitch(normalizeSettings({}), { title: "Fast", nodes: [21, 22] }).settings;
  // Saving a side moves the node from "turn off" to "change its settings".
  settings = saveValues(settings, 1, "on", [{ id: 21, values: { value: 8 } }, { id: 22, values: { loras: STACK(true) } }]);
  assert.deepEqual(settings.switches[0].nodes, []);
  const steps = stepsNode(8);
  const lora = loraNode(STACK(true));
  const placed = placeNodes([steps, lora]);
  let [row] = readSwitches(settings.switches, placed, []);
  assert.deepEqual([row.half, row.pairs.length, row.state, row.valueNodes.length], [true, 0, "empty", 2]);
  settings = saveValues(settings, 1, "off", [{ id: "21", values: { value: 25 } }, { id: 22, values: { loras: STACK(false) } }]);
  [row] = readSwitches(settings.switches, placed, []);
  assert.deepEqual([row.half, row.pairs.length, row.state, row.on, row.total], [false, 2, "on", 2, 2]);
  assert.deepEqual(row.members, []);
  assert.deepEqual(row.rect, [0, -30, 500, 130]);
  steps.widgets[0].value = 25;
  [row] = readSwitches(settings.switches, placed, []);
  assert.deepEqual([row.state, row.on, row.total], ["mixed", 1, 2]);
  lora.widgets[0].value = STACK(false);
  assert.equal(readSwitches(settings.switches, placed, [])[0].state, "off");
  steps.widgets[0].value = 30; // set by hand to something else: neither on nor off
  assert.equal(readSwitches(settings.switches, placed, [])[0].state, "mixed");
  // The click: every setting not already there.
  [row] = readSwitches(settings.switches, placed, []);
  assert.deepEqual(valuePlan([row], row, true, settings).map(([pair, side]) => [pair.widget, side]), [["value", "on"], ["loras", "on"]]);
  assert.deepEqual(valuePlan([row], row, false, settings).map(([pair, side]) => [pair.widget, side]), [["value", "off"]]);
  assert.deepEqual(switchPlan([row], row, false, settings), []); // no node is turned off
  assert.deepEqual(valueAllPlan([row], false).map(([pair]) => pair.widget), ["value"]);
  // Held, added and taken out like any other node of the switch.
  assert.equal(heldCount(settings.switches[0], { nodes: [21, 99] }), 1);
  assert.deepEqual(addMembers(settings, 1, { nodes: [21, 40] }).switches[0].nodes, [40]);
  const without = removeMembers(settings, 1, { nodes: [21] }).switches[0];
  assert.deepEqual([Object.keys(without.on), Object.keys(without.off)], [["22"], ["22"]]);
  assert.deepEqual(saveValues(settings, 1, "sideways", []).switches[0].on, settings.switches[0].on);
  // A node whose control is gone drops out of the settings it changes.
  assert.equal(readSwitches(settings.switches, placeNodes([lora]), [])[0].pairs.length, 1);
  // A saved file that lists a node both ways keeps it as a settings node.
  assert.deepEqual(normalizeSwitches([{ id: 1, nodes: [21, 5], on: { 21: { value: 8 } } }])[0].nodes, [5]);
});

test("one at a time sends the other rows' settings to off", () => {
  const fast = { pairs: [{ node: "21", widget: "value", on: 8, off: 25, now: "on" }] };
  const slow = { pairs: [{ node: "23", widget: "value", on: 50, off: 25, now: "off" }] };
  const settings = { ...DEFAULT_SETTINGS, exclusive: true };
  assert.deepEqual(valuePlan([fast, slow], slow, true, settings).map(([pair, side]) => [pair.node, side]), [["21", "off"], ["23", "on"]]);
  assert.deepEqual(valuePlan([fast, slow], slow, true, DEFAULT_SETTINGS).map(([pair, side]) => [pair.node, side]), [["23", "on"]]);
  assert.deepEqual(valuePlan([fast, { members: [] }], { members: [] }, true, DEFAULT_SETTINGS), []);
});

test("a row that turns nodes off and changes settings is on only when both are", () => {
  const running = { mode: MODE_ALWAYS };
  const bypassed = { mode: MODE_BYPASS };
  const on = { now: "on" };
  const off = { now: "off" };
  assert.deepEqual(partState([running], () => true, [on]), { state: "on", on: 2, total: 2 });
  assert.deepEqual(partState([bypassed], () => true, [off]), { state: "off", on: 0, total: 2 });
  assert.deepEqual(partState([running], () => true, [off]), { state: "mixed", on: 1, total: 2 });
  assert.deepEqual(partState([], () => true, [{ now: "other" }]), { state: "mixed", on: 0, total: 1 });
  // A note beside a setting does not count: the setting decides.
  assert.deepEqual(partState([{ mode: MODE_ALWAYS, note: true }], (member) => !member.note, [off]), { state: "off", on: 0, total: 1 });
});

// ---------- a switch with two sides ----------

// The case behind it: an edit takes its size from the picture, so "Latent
// Size" has to look switched off while "Edit a picture" is on, and run while
// it is off. "Your picture" is the other way round.
const picture = (mode = MODE_ALWAYS) => node(1, 0, 0, { mode });
const latentSize = (mode = MODE_ALWAYS) => node(2, 400, 0, { mode });
const twoSided = (extra = {}) => normalizeSettings({ switches: [{ id: 1, title: "Edit a picture", nodes: [1], nodes_off: [2], ...extra }] });
const readOne = (settings, nodes, groups = [], options) => {
  const placed = placeNodes(nodes);
  return readSwitches(settings.switches, placed, readGroups(groups, placed), options)[0];
};
const planned = (plan) => Object.fromEntries(plan.map(([member, mode]) => [member.id, mode]));

test("the off side is cleaned like the nodes beside it, and left out while it is empty", () => {
  const [entry] = normalizeSwitches([
    { id: 1, title: "Edit", nodes: [1], groups: [2], nodes_off: [3, "3", 4, null, NaN, {}], groups_off: [5, "5"] },
  ]);
  assert.deepEqual(entry, { id: 1, title: "Edit", nodes: [1], groups: [2], nodes_off: [3, 4], groups_off: [5], on: {}, off: {} });
  assert.deepEqual([hasOffSide(entry), hasOffSide({ groups_off: [5] }), hasOffSide({ nodes: [1] }), hasOffSide(undefined)], [true, true, false, false]);
  // Nothing on the off side: the keys are not stored, so the switch saves as it always did.
  assert.deepEqual(Object.keys(normalizeSwitches([{ id: 1, nodes: [1], nodes_off: [], groups_off: "x" }])[0]), ["id", "title", "nodes", "groups", "on", "off"]);
  assert.deepEqual(Object.keys(normalizeSwitches([{ nodes_off: [7] }])[0]), ["id", "title", "nodes", "groups", "nodes_off", "on", "off"]);
  // An id on both sides stays on the normal side only, as a number or as text.
  const both = normalizeSwitches([{ nodes: [1, 2], nodes_off: [2, "1", 3], groups: [7], groups_off: ["7", 8] }])[0];
  assert.deepEqual([both.nodes, both.nodes_off, both.groups, both.groups_off], [[1, 2], [3], [7], [8]]);
  const same = normalizeSwitches([{ nodes: [1], nodes_off: [1], groups: [2], groups_off: [2] }])[0];
  assert.equal("nodes_off" in same || "groups_off" in same, false);
  // A node whose values the switch changes is not turned off, on either side.
  assert.deepEqual(normalizeSwitches([{ nodes_off: [21, 22], on: { 21: { value: 8 } } }])[0].nodes_off, [22]);
  // Each list holds as many as the nodes and groups beside it do.
  const many = Array.from({ length: MEMBERS_MAX + 50 }, (_, index) => index);
  const limited = normalizeSwitches([{ nodes_off: many, groups_off: many }])[0];
  assert.deepEqual([limited.nodes_off.length, limited.groups_off.length], [MEMBERS_MAX, MEMBERS_MAX]);
  // What is stored reads back the same.
  const stored = normalizeSettings({ switches: [entry] });
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(stored))), stored);
});

test("a switch saved before the off side existed is stored, read and switched exactly as it was", () => {
  const before = '{"off":"bypass","groups":"none","match":"","order":"canvas","exclusive":false,"switches":['
    + '{"id":1,"title":"The cut-out","nodes":[8],"groups":[],"on":{},"off":{}},'
    + '{"id":2,"title":"Fast","nodes":[],"groups":[3],"on":{"7":{"value":8}},"off":{"7":{"value":25}}}]}';
  const settings = normalizeSettings(JSON.parse(before));
  // The switches read back as they were saved. The settings beside them have
  // since grown by one key, which reads as its default.
  const now = before.replace('"switches":[', '"show":"rows","switches":[');
  assert.equal(JSON.stringify(settings), now);
  // Nothing that changes such a switch brings the off side in.
  const changed = [
    addMembers(settings, 1, { nodes: [9], groups: [4] }), removeMembers(settings, 1, { nodes: [8] }), renameSwitch(settings, 1, "Renamed"),
    saveValues(settings, 1, "on", [{ id: 8, values: { value: 1 } }]), removeOffMembers(settings, 1, { nodes: [8] }), moveSwitch(settings, 1, 1),
  ];
  for (const next of changed) {
    for (const entry of next.switches) assert.deepEqual(Object.keys(entry), ["id", "title", "nodes", "groups", "on", "off"]);
  }
  assert.equal(JSON.stringify(removeOffMembers(settings, 1, { nodes: [8] })), now);
  // Read from a graph: no off side, and the state is the one the nodes alone give.
  const placed = placeNodes([node(8, 0, 0, { mode: MODE_BYPASS })]);
  const [cutOut] = readSwitches(settings.switches, placed, []);
  assert.deepEqual([cutOut.offMembers, cutOut.state, cutOut.on, cutOut.total], [[], "off", 0, 1]);
  assert.deepEqual(partState([{ mode: MODE_ALWAYS }, { mode: MODE_BYPASS }]), partState([{ mode: MODE_ALWAYS }, { mode: MODE_BYPASS }], () => true, [], []));
  // The same plans, whether a row carries an empty off side or none at all.
  const a = { id: "a", mode: MODE_ALWAYS };
  const b = { id: "b", mode: MODE_BYPASS };
  const plain = { members: [a, b] };
  const empty = { members: [a, b], offMembers: [] };
  for (const on of [true, false]) {
    for (const mute of [DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, off: "mute" }]) {
      assert.deepEqual(switchPlan([empty], empty, on, mute), switchPlan([plain], plain, on, mute));
      assert.deepEqual(switchAllPlan([empty], on, mute), switchAllPlan([plain], on, mute));
    }
  }
});

test("a row with an off side is on when its own nodes run and its off side does not", () => {
  const settings = twoSided();
  const state = (pictureMode, sizeMode) => {
    const row = readOne(settings, [picture(pictureMode), latentSize(sizeMode)]);
    return [row.state, row.on, row.total];
  };
  assert.deepEqual(state(MODE_ALWAYS, MODE_BYPASS), ["on", 2, 2]);
  assert.deepEqual(state(MODE_ALWAYS, MODE_NEVER), ["on", 2, 2]); // muted is off as well
  assert.deepEqual(state(MODE_BYPASS, MODE_ALWAYS), ["off", 0, 2]);
  assert.deepEqual(state(MODE_NEVER, MODE_ALWAYS), ["off", 0, 2]);
  // Anything else is in between: both run, or both are off.
  assert.deepEqual(state(MODE_ALWAYS, MODE_ALWAYS), ["mixed", 1, 2]);
  assert.deepEqual(state(MODE_BYPASS, MODE_BYPASS), ["mixed", 1, 2]);
  const row = readOne(settings, [picture(), latentSize(MODE_BYPASS)]);
  assert.deepEqual([ids(row.members), ids(row.offMembers)], [[1], [2]]);
  // Its frame takes in both sides: the picture at the left, the size node at the right.
  assert.deepEqual(row.rect, [0, -30, 600, 130]);
  // A row of nothing but an off side reads from it alone.
  const alone = normalizeSettings({ switches: [{ id: 1, nodes_off: [2] }] });
  assert.deepEqual(readOne(alone, [latentSize(MODE_BYPASS)]).state, "on");
  assert.deepEqual(readOne(alone, [latentSize()]).state, "off");
  // An id that is gone is counted like any other.
  assert.equal(readOne(normalizeSettings({ switches: [{ nodes: [1], nodes_off: [2, 99], groups_off: [9] }] }), [picture(), latentSize()]).gone, 2);
  // Nodes that never run are no part of the reading, on the off side too.
  const note = node(3, 800, 0, { isVirtualNode: true });
  const withNote = normalizeSettings({ switches: [{ nodes: [1], nodes_off: [2, 3] }] });
  assert.deepEqual(readOne(withNote, [picture(), latentSize(MODE_BYPASS), note], [], { counts: modeMatters }).total, 2);
});

test("a group can sit on the off side, and a node is on one side only", () => {
  const nodes = () => [picture(), latentSize(MODE_BYPASS)];
  const sizeBox = group("Size", 380, -50, 300, 300, { id: 7 }); // holds Latent Size
  const everything = group("Everything", -50, -50, 900, 300, { id: 8 }); // holds both
  const sides = (extra) => {
    const row = readOne(normalizeSettings({ switches: [{ id: 1, ...extra }] }), nodes(), [sizeBox, everything]);
    return [ids(row.members), ids(row.offMembers)];
  };
  assert.deepEqual(sides({ nodes: [1], groups_off: [7] }), [[1], [2]]);
  // A node picked by hand stays on the side it was picked for, even inside a group of the other side.
  assert.deepEqual(sides({ groups: [8], nodes_off: [2] }), [[1], [2]]);
  assert.deepEqual(sides({ nodes: [2], groups_off: [8] }), [[2], [1]]);
  // Two groups that both hold a node: it stays on the normal side.
  assert.deepEqual(sides({ groups: [8], groups_off: [7] }), [[1, 2], []]);
});

test("the state of a part counts the nodes on its off side the other way round", () => {
  const run = { mode: MODE_ALWAYS };
  const bypassed = { mode: MODE_BYPASS };
  const muted = { mode: MODE_NEVER };
  const all = () => true;
  assert.deepEqual(partState([run], all, [], [bypassed]), { state: "on", on: 2, total: 2 });
  assert.deepEqual(partState([bypassed], all, [], [run]), { state: "off", on: 0, total: 2 });
  assert.deepEqual(partState([run], all, [], [run]), { state: "mixed", on: 1, total: 2 });
  assert.deepEqual(partState([bypassed, run], all, [], [muted]), { state: "mixed", on: 2, total: 3 });
  assert.deepEqual(partState([], all, [], [muted]), { state: "on", on: 1, total: 1 });
  assert.deepEqual(partState([], all, [], [run]), { state: "off", on: 0, total: 1 });
  assert.deepEqual(partState([], all, [], []), { state: "empty", on: 0, total: 0 });
  // Together with settings, every part has to agree.
  assert.deepEqual(partState([run], all, [{ now: "on" }], [bypassed]), { state: "on", on: 3, total: 3 });
  assert.deepEqual(partState([run], all, [{ now: "off" }], [bypassed]), { state: "mixed", on: 2, total: 3 });
  // Notes decide nothing, and a part of nothing but notes is read from them.
  const note = { mode: MODE_ALWAYS, note: true };
  const counts = (member) => !member.note;
  assert.deepEqual(partState([run], counts, [], [note]), { state: "on", on: 1, total: 1 });
  assert.deepEqual(partState([note], counts, [], [{ ...note, mode: MODE_BYPASS }]), { state: "on", on: 2, total: 2 });
});

test("switching a row with an off side runs one side and switches the other off", () => {
  const row = (own, off) => ({ members: [own], offMembers: [off] });
  const settings = DEFAULT_SETTINGS;
  const mute = { ...DEFAULT_SETTINGS, off: "mute" };
  // Off to on: the picture runs, and Latent Size goes off.
  let own = { id: "picture", mode: MODE_BYPASS };
  let off = { id: "size", mode: MODE_ALWAYS };
  assert.deepEqual(planned(switchPlan([row(own, off)], row(own, off), true, settings)), { picture: MODE_ALWAYS, size: MODE_BYPASS });
  assert.deepEqual(planned(switchPlan([row(own, off)], row(own, off), true, mute)), { picture: MODE_ALWAYS, size: MODE_NEVER });
  // On to off: the reverse.
  own = { id: "picture", mode: MODE_ALWAYS };
  off = { id: "size", mode: MODE_BYPASS };
  assert.deepEqual(planned(switchPlan([row(own, off)], row(own, off), false, settings)), { picture: MODE_BYPASS, size: MODE_ALWAYS });
  assert.deepEqual(planned(switchPlan([row(own, off)], row(own, off), false, mute)), { picture: MODE_NEVER, size: MODE_ALWAYS });
  // Only what changes is returned.
  assert.deepEqual(switchPlan([row(own, off)], row(own, off), true, settings), []);
  assert.deepEqual(planned(switchPlan([row(own, { id: "size", mode: MODE_ALWAYS })], row(own, { id: "size", mode: MODE_ALWAYS }), true, settings)), { size: MODE_BYPASS });
  // A row with only an off side.
  const onlyOff = { members: [], offMembers: [off] };
  assert.deepEqual(planned(switchPlan([onlyOff], onlyOff, false, settings)), { size: MODE_ALWAYS });
  assert.deepEqual(switchPlan([onlyOff], onlyOff, true, settings), []);
});

test("one at a time turns the other rows' off sides on, and the row switched on has the last word", () => {
  const node4 = (id, mode) => ({ id, mode });
  const a1 = node4("a1", MODE_ALWAYS);
  const a2 = node4("a2", MODE_BYPASS);
  const b1 = node4("b1", MODE_BYPASS);
  const b2 = node4("b2", MODE_ALWAYS);
  const first = { members: [a1], offMembers: [a2] }; // on
  const second = { members: [b1], offMembers: [b2] }; // off
  const exclusive = { ...DEFAULT_SETTINGS, exclusive: true };
  assert.deepEqual(planned(switchPlan([first, second], second, true, exclusive)), { a1: MODE_BYPASS, a2: MODE_ALWAYS, b1: MODE_ALWAYS, b2: MODE_BYPASS });
  assert.deepEqual(planned(switchPlan([first, second], second, true, { ...exclusive, off: "mute" })), { a1: MODE_NEVER, a2: MODE_ALWAYS, b1: MODE_ALWAYS, b2: MODE_NEVER });
  // Switching a row off leaves the other rows alone, and so does a card that is not one at a time.
  assert.deepEqual(planned(switchPlan([first, second], first, false, exclusive)), { a1: MODE_BYPASS, a2: MODE_ALWAYS });
  assert.deepEqual(planned(switchPlan([first, second], second, true, DEFAULT_SETTINGS)), { b1: MODE_ALWAYS, b2: MODE_BYPASS });
  // A node that one other row stops and another runs ends up running.
  const shared = node4("shared", MODE_BYPASS);
  const stops = { members: [shared] };
  const runs = { members: [], offMembers: [shared] };
  const target = { members: [node4("t", MODE_ALWAYS)] };
  assert.deepEqual(planned(switchPlan([stops, runs, target], target, true, exclusive)), { shared: MODE_ALWAYS });
  assert.deepEqual(planned(switchPlan([runs, stops, target], target, true, exclusive)), { shared: MODE_ALWAYS });
  // The row being switched on has the last word on a node it shares with another row's off side.
  const contested = node4("contested", MODE_ALWAYS);
  const other = { members: [], offMembers: [contested] }; // runs it while that row is off
  const wants = { members: [], offMembers: [contested] }; // stops it once this row is on
  assert.deepEqual(planned(switchPlan([other, wants], wants, true, exclusive)), { contested: MODE_BYPASS });
});

test("switching everything on or off puts each row in its own state, off sides included", () => {
  const node4 = (id, mode) => ({ id, mode });
  const a1 = node4("a1", MODE_ALWAYS);
  const a2 = node4("a2", MODE_BYPASS);
  const b1 = node4("b1", MODE_BYPASS);
  const b2 = node4("b2", MODE_ALWAYS);
  const rows = [{ members: [a1], offMembers: [a2] }, { members: [b1], offMembers: [b2] }];
  assert.deepEqual(planned(switchAllPlan(rows, true, DEFAULT_SETTINGS)), { b1: MODE_ALWAYS, b2: MODE_BYPASS });
  assert.deepEqual(planned(switchAllPlan(rows, false, DEFAULT_SETTINGS)), { a1: MODE_BYPASS, a2: MODE_ALWAYS });
  // Muting sets every stopped node to muted, one that was bypassed included.
  assert.deepEqual(planned(switchAllPlan(rows, true, { off: "mute" })), { a2: MODE_NEVER, b1: MODE_ALWAYS, b2: MODE_NEVER });
  assert.deepEqual(planned(switchAllPlan(rows, false, { off: "mute" })), { a1: MODE_NEVER, a2: MODE_ALWAYS, b1: MODE_NEVER });
  // A node that one row stops and another runs ends up running, whichever way.
  const shared = node4("shared", MODE_BYPASS);
  const pair = [{ members: [shared] }, { members: [], offMembers: [shared] }];
  assert.deepEqual(planned(switchAllPlan(pair, true, DEFAULT_SETTINGS)), { shared: MODE_ALWAYS });
  assert.deepEqual(planned(switchAllPlan(pair, false, DEFAULT_SETTINGS)), { shared: MODE_ALWAYS });
});

test("Edit a picture: one click runs the picture and switches Latent Size off, the next does the reverse", () => {
  const nodes = [picture(), latentSize()]; // just put on the off side: both still run
  const settings = twoSided();
  const click = (side) => {
    const row = readOne(settings, nodes);
    for (const [member, mode] of switchPlan([row], row, flipTo(row.state, side), settings)) member.mode = mode;
    return [readOne(settings, nodes).state, nodes.map((member) => member.mode)];
  };
  assert.equal(readOne(settings, nodes).state, "mixed");
  assert.deepEqual(click(true), ["on", [MODE_ALWAYS, MODE_BYPASS]]);
  assert.deepEqual(click(true), ["off", [MODE_BYPASS, MODE_ALWAYS]]);
  assert.deepEqual(click(false), ["on", [MODE_ALWAYS, MODE_BYPASS]]);
  // Switching everything does the same through the card's right-click menu.
  for (const [on, expected] of [[false, [MODE_BYPASS, MODE_ALWAYS]], [true, [MODE_ALWAYS, MODE_BYPASS]]]) {
    for (const [member, mode] of switchAllPlan([readOne(settings, nodes)], on, settings)) member.mode = mode;
    assert.deepEqual(nodes.map((member) => member.mode), expected);
    assert.equal(readOne(settings, nodes).state, on ? "on" : "off");
  }
});

test("nodes are put on the off side, moved between the sides, taken off it and taken out", () => {
  let settings = addSwitch(normalizeSettings({}), { title: "Edit a picture", nodes: [1, 2], groups: [4] }).settings;
  const start = JSON.stringify(settings);
  const picks = { nodes: [1, 2, 3, 9], groups: [4, 5] };
  // 2 and group 4 move over from the normal side; 3 is new to the switch.
  settings = addOffMembers(settings, 1, { nodes: [2, 3], groups: [4] });
  assert.deepEqual(settings.switches[0], { id: 1, title: "Edit a picture", nodes: [1], groups: [], nodes_off: [2, 3], groups_off: [4], on: {}, off: {} });
  assert.deepEqual([heldCount(settings.switches[0], picks), offHeldCount(settings.switches[0], picks), offFreshCount(settings.switches[0], picks)], [1, 3, 3]);
  // Adding to the normal side moves a node back.
  settings = addMembers(settings, 1, { nodes: [3], groups: [4] });
  assert.deepEqual(settings.switches[0], { id: 1, title: "Edit a picture", nodes: [1, 3], groups: [4], nodes_off: [2], on: {}, off: {} });
  // Taking it off the side takes it out of the switch altogether; nothing is left over.
  settings = removeOffMembers(settings, 1, { nodes: [2, 1], groups: [4] });
  assert.deepEqual(settings.switches[0], { id: 1, title: "Edit a picture", nodes: [1, 3], groups: [4], on: {}, off: {} });
  // Take out the selected works on both sides.
  settings = addOffMembers(settings, 1, { nodes: [5], groups: [6] });
  settings = removeMembers(settings, 1, { nodes: [3, 5], groups: [6] });
  assert.deepEqual(settings.switches[0], { id: 1, title: "Edit a picture", nodes: [1], groups: [4], on: {}, off: {} });
  // Putting a node on and taking it off again leaves the switch as it was.
  const before = JSON.stringify(settings);
  assert.equal(JSON.stringify(removeOffMembers(addOffMembers(settings, 1, { nodes: [7] }), 1, { nodes: [7] })), before);
  assert.equal(JSON.stringify(settings), before); // the settings handed in are left alone
  // A node whose settings the switch changes is not turned off, so it cannot go on the off side.
  let changes = addSwitch(normalizeSettings({}), { nodes: [1] }).settings;
  changes = saveValues(changes, 1, "on", [{ id: 21, values: { value: 8 } }]);
  assert.deepEqual(offFreshCount(changes.switches[0], { nodes: [21, 22] }), 1);
  assert.deepEqual(addOffMembers(changes, 1, { nodes: [21, 22] }).switches[0].nodes_off, [22]);
  // Saving a side for a node on the off side takes it off.
  const saved = saveValues(addOffMembers(changes, 1, { nodes: [22] }), 1, "off", [{ id: 22, values: { value: 5 } }]);
  assert.equal("nodes_off" in saved.switches[0], false);
  assert.equal(start, JSON.stringify(addSwitch(normalizeSettings({}), { title: "Edit a picture", nodes: [1, 2], groups: [4] }).settings));
});

test("the signature changes with anything the card shows, and only then", () => {
  const rows = [{ kind: "group", title: "1 · Load", color: "#335", state: "on", on: 3, total: 3, members: [1, 2, 3] }];
  const settings = normalizeSettings({});
  const base = rowsSignature(rows, settings);
  assert.equal(rowsSignature([{ ...rows[0] }], normalizeSettings({})), base);
  assert.equal(rowsSignature([{ ...rows[0], offMembers: [] }], settings), base);
  assert.notEqual(rowsSignature([{ ...rows[0], offMembers: [4] }], settings), base);
  assert.notEqual(rowsSignature([{ ...rows[0], state: "mixed", on: 2 }], settings), base);
  assert.notEqual(rowsSignature([{ ...rows[0], title: "1 · Models" }], settings), base);
  assert.notEqual(rowsSignature([{ ...rows[0], kind: "switch" }], settings), base);
  assert.notEqual(rowsSignature(rows, { ...settings, off: "mute" }), base);
  assert.notEqual(rowsSignature(rows, addSwitch(settings, { title: "New" }).settings), base);
});

// ---------- one pill for the whole card ----------

// Every character 6 px wide: a name's width is then easy to say in a test.
const sixPx = (text) => String(text).length * 6;
const choice = (title, state, extra = {}) => ({ kind: "switch", title, state, members: [], ...extra });

test("a card shows its rows as before unless One at a time and the pill are both on", () => {
  const rows = [choice("Say it", "on"), choice("Touch it", "off")];
  // A workflow saved by an earlier version has no `show`: rows, as it always was.
  for (const saved of [{}, { exclusive: true }, { exclusive: false, show: "pill" }, { exclusive: true, show: "rows" }]) {
    assert.deepEqual(cardView(normalizeSettings(saved), rows, sixPx), { view: "rows", width: 0 });
  }
  const pill = normalizeSettings({ exclusive: true, show: "pill" });
  assert.equal(cardView(pill, rows, sixPx).view, "pill");
  // One row alone has nothing to be picked against, and no row is the hint.
  assert.equal(cardView(pill, [rows[0]], sixPx).view, "rows");
  assert.equal(cardView(pill, [], sixPx).view, "rows");
  assert.equal(cardView(pill, undefined, sixPx).view, "rows");
});

test("up to four short names are a pill, and more or longer ones are a list", () => {
  const pill = normalizeSettings({ exclusive: true, show: "pill" });
  const named = (...titles) => titles.map((title) => choice(title, "off"));
  for (let count = 2; count <= PILL_CHOICES_MAX; count += 1) {
    assert.equal(cardView(pill, named(...Array.from({ length: count }, (_, index) => `Option ${index + 1}`)), sixPx).view, "pill");
  }
  assert.equal(cardView(pill, named("1", "2", "3", "4", "5"), sixPx).view, "list");
  assert.deepEqual(cardView(pill, named("A", "B", "C", "D", "E", "F"), sixPx), { view: "list", width: 0 });
  // The segments are equally wide, so the longest name decides the width.
  assert.equal(pillNodeWidth(["Say it", "Touch it"], sixPx), PILL_FRAME + 2 * (8 * 6 + PILL_SEGMENT_PAD));
  assert.equal(pillNodeWidth(["A", "Touch it", "B"], sixPx), PILL_FRAME + 3 * (8 * 6 + PILL_SEGMENT_PAD));
  assert.deepEqual(cardView(pill, named("Say it", "Touch it"), sixPx), { view: "pill", width: PILL_FRAME + 2 * (8 * 6 + PILL_SEGMENT_PAD) });
  // The card is never asked to be wider than PILL_NODE_WIDTH_MAX for its pill.
  const fits = Math.floor(((PILL_NODE_WIDTH_MAX - PILL_FRAME) / 2 - PILL_SEGMENT_PAD) / 6);
  assert.equal(cardView(pill, named("x".repeat(fits), "short"), sixPx).view, "pill");
  assert.equal(cardView(pill, named("x".repeat(fits + 1), "short"), sixPx).view, "list");
  assert.ok(cardView(pill, named("x".repeat(fits), "short"), sixPx).width <= PILL_NODE_WIDTH_MAX);
  // Four names leave each less room than two do.
  assert.equal(cardView(pill, named("x".repeat(fits), "a", "b", "c"), sixPx).view, "list");
  // A group nobody named still has something to read, and without a way to
  // measure there is a guess, never a throw.
  assert.equal(rowLabel({ kind: "group", title: "" }), "Group");
  assert.equal(rowLabel({ kind: "switch", title: "" }), "Switch");
  assert.equal(rowLabel({ kind: "group", title: "4 · Upscale" }), "4 · Upscale");
  assert.equal(cardView(pill, named("Say it", "Touch it")).view, "pill");
});

test("a pick-one card says honestly where it stands", () => {
  const a = choice("A", "on");
  assert.deepEqual(choiceState([a, choice("B", "off"), choice("C", "empty")]), { kind: "one", picked: a, count: 1 });
  assert.deepEqual(choiceState([choice("A", "off"), choice("B", "off")]), { kind: "none", picked: null, count: 0 });
  assert.deepEqual(choiceState([choice("A", "on"), choice("B", "on"), choice("C", "off")]), { kind: "several", picked: null, count: 2 });
  // A row that is only partly on is never the pick, alone or beside another.
  assert.deepEqual(choiceState([choice("A", "mixed"), choice("B", "off")]), { kind: "partly", picked: null, count: 1 });
  assert.deepEqual(choiceState([choice("A", "on"), choice("B", "mixed")]), { kind: "several", picked: null, count: 2 });
  assert.deepEqual(choiceState([]), { kind: "none", picked: null, count: 0 });
  assert.deepEqual(choiceState(undefined), { kind: "none", picked: null, count: 0 });
});

test("a click on a choice leaves exactly that row on, and a click on the picked one does nothing", () => {
  const settings = normalizeSettings({ exclusive: true, show: "pill" });
  const graph = () => {
    const nodes = [node(1, 0, 0), node(2, 0, 200, { mode: MODE_BYPASS }), node(3, 0, 400, { mode: MODE_BYPASS })];
    const made = normalizeSettings({
      switches: [{ id: 1, title: "Say it", nodes: [1] }, { id: 2, title: "Touch it", nodes: [2] }, { id: 3, title: "Paint it", nodes: [3] }],
    }).switches;
    return { nodes, read: () => readSwitches(made, placeNodes(nodes), []) };
  };
  const click = (g, index) => {
    const rows = g.read();
    const { modes, values } = choosePlan(rows, rows[index], settings);
    for (const [member, mode] of modes) member.mode = mode;
    return { changed: modes.length + values.length, states: g.read().map((row) => row.state) };
  };
  // Settled: the picked one does nothing, another one moves the pick.
  let g = graph();
  assert.deepEqual(click(g, 0), { changed: 0, states: ["on", "off", "off"] });
  assert.deepEqual(click(g, 2), { changed: 2, states: ["off", "off", "on"] });
  assert.deepEqual(g.nodes.map((member) => member.mode), [MODE_BYPASS, MODE_BYPASS, MODE_ALWAYS]);
  assert.deepEqual(click(g, 2), { changed: 0, states: ["off", "off", "on"] });
  // None on (an old file, or everything bypassed by hand): one click picks.
  g = graph();
  g.nodes[0].mode = MODE_BYPASS;
  assert.equal(choiceState(g.read()).kind, "none");
  assert.deepEqual(click(g, 1), { changed: 1, states: ["off", "on", "off"] });
  // Several on: a click on one of them keeps only that one.
  g = graph();
  g.nodes[1].mode = MODE_ALWAYS;
  g.nodes[2].mode = MODE_ALWAYS;
  assert.deepEqual(choiceState(g.read()).count, 3);
  assert.deepEqual(click(g, 1), { changed: 2, states: ["off", "on", "off"] });
  // It is one at a time whatever the card's own setting says, and it mutes when off means mute.
  g = graph();
  const loose = { ...settings, exclusive: false, off: "mute" };
  const rows = g.read();
  for (const [member, mode] of choosePlan(rows, rows[1], loose).modes) member.mode = mode;
  assert.deepEqual(g.nodes.map((member) => member.mode), [MODE_NEVER, MODE_ALWAYS, MODE_NEVER]);
  // Nothing to pick: no row, or a row with nothing in it.
  assert.deepEqual(choosePlan(rows, undefined, settings), { modes: [], values: [] });
  assert.deepEqual(choosePlan(rows, { state: "empty", members: [] }, settings), { modes: [], values: [] });
});

test("the pill picks between all three kinds of rows: nodes, settings and a row with an off side", () => {
  const settings = normalizeSettings({ exclusive: true, show: "pill" });
  const steps = { id: 21, pos: [0, 0], size: [200, 100], mode: MODE_ALWAYS, widgets: [{ name: "value", value: 25 }] };
  const nodes = [
    node(1, 0, 200), // "Describe" holds it
    steps, // "Fast" changes its value: 8 for on, 25 for off
    node(3, 0, 400, { mode: MODE_BYPASS }), // "Edit" runs it
    node(4, 0, 600), // and this one runs only while "Edit" is off
  ];
  const made = normalizeSettings({
    switches: [
      { id: 1, title: "Describe", nodes: [1] },
      { id: 2, title: "Fast", on: { 21: { value: 8 } }, off: { 21: { value: 25 } } },
      { id: 3, title: "Edit", nodes: [3], nodes_off: [4] },
    ],
  }).switches;
  const read = () => readSwitches(made, placeNodes(nodes), []);
  const click = (index) => {
    const rows = read();
    const { modes, values } = choosePlan(rows, rows[index], settings);
    for (const [member, mode] of modes) member.mode = mode;
    for (const [pair, side] of values) pair.control.value = pairValue(pair, side, pair.control.value);
    return read().map((row) => row.state);
  };
  const now = () => [nodes[0].mode, steps.widgets[0].value, nodes[2].mode, nodes[3].mode];
  assert.deepEqual(read().map((row) => row.state), ["on", "off", "off"]);
  assert.deepEqual(click(1), ["off", "on", "off"]);
  assert.deepEqual(now(), [MODE_BYPASS, 8, MODE_BYPASS, MODE_ALWAYS]);
  assert.deepEqual(click(2), ["off", "off", "on"]);
  assert.deepEqual(now(), [MODE_BYPASS, 25, MODE_ALWAYS, MODE_BYPASS]);
  assert.deepEqual(click(0), ["on", "off", "off"]);
  assert.deepEqual(now(), [MODE_ALWAYS, 25, MODE_BYPASS, MODE_ALWAYS]);
  // A setting changed by hand to a third value reads partly on, and a click on its row sets it.
  steps.widgets[0].value = 12;
  assert.equal(choiceState(read()).kind, "several");
  assert.deepEqual(click(1), ["off", "on", "off"]);
  assert.equal(steps.widgets[0].value, 8);
});

test("the pill view is part of what the card draws", () => {
  const rows = [choice("Say it", "on"), choice("Touch it", "off")];
  const base = rowsSignature(rows, normalizeSettings({ exclusive: true }));
  assert.notEqual(rowsSignature(rows, normalizeSettings({ exclusive: true, show: "pill" })), base);
});
