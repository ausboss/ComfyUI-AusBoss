import assert from "node:assert/strict";
import test from "node:test";
import {
  choicePairs, choosePlan, normalizeSettings, pairValue, placeNodes, readGroups, readSwitches,
  releaseStackGroup, releaseStackRow, stackGroupOwners, stackRowOwners, stackRows, switchPlan, valuePlan,
} from "../js/shared/workflow_switches.mjs";

const stack = (...rows) => JSON.stringify(rows);
const lora = (name, enabled = true, strength = 1, extra = {}) => ({ name, enabled, strength, ...extra });
const target = (id, name, value) => ({ id, mode: 0, pos: [0, 30], size: [100, 100], widgets: [{ name, value }] });
const choices = (...values) => normalizeSettings({ switches: values.map((value, index) => ({
  id: index + 1, title: String(index + 1), choice: true, on: { 5: { loras: value } },
})) });

test("taking over a row leaves an empty saved stack safe and preserves unrelated live rows", () => {
  const a = lora("a");
  const b = lora("b");
  const saved = { switches: [{ id: 1, on: { 5: { loras: stack(a, b), steps: 8 } }, off: { 5: { loras: stack(b), steps: 20 } } }] };
  const settings = releaseStackRow(saved, 1, 5, "loras", "b");
  const current = stack(a, b, lora("unrelated"));
  const live = target(5, "loras", current);
  live.widgets.push({ name: "steps", value: 8 });
  const rows = readSwitches(settings.switches, placeNodes([live]), []);
  for (const [pair, side] of valuePlan(rows, rows[0], false, settings)) {
    pair.control.value = pairValue(pair, side, pair.control.value);
  }
  assert.equal(live.widgets[0].value, current);
  assert.equal(live.widgets[1].value, 20);
  assert.deepEqual(stackRows("[]"), []);
});

test("settings targets remain running when either side includes their group", () => {
  for (const side of ["groups", "groups_off"]) {
    const live = target(5, "steps", 8);
    const neighbor = target(6, "steps", 12);
    const settings = normalizeSettings({ switches: [{ id: 1, [side]: [2], on: { 5: { steps: 8 } }, off: { 5: { steps: 20 } } }] });
    const placed = placeNodes([live, neighbor]);
    const groups = readGroups([{ id: 2, boundingRect: [0, 0, 300, 300] }], placed);
    const rows = readSwitches(settings.switches, placed, groups);
    for (const on of [false, true]) {
      for (const [node, mode] of switchPlan(rows, rows[0], on, settings)) node.mode = mode;
      for (const [pair, valueSide] of valuePlan(rows, rows[0], on, settings)) pair.control.value = pairValue(pair, valueSide, pair.control.value);
      assert.equal(live.mode, 0, side);
    }
    assert.deepEqual(rows[0].valueNodes, [live]);
    assert.equal(rows[0].members.includes(live), false);
    assert.equal(rows[0].offMembers.includes(live), false);
  }
});

test("three LoRA choices retain every differing field regardless of comparison order", () => {
  const saves = [stack(lora("a", true, 1)), stack(lora("a", false, 1)), stack(lora("a", true, 2))];
  for (const order of [saves, [saves[0], saves[2], saves[1]]]) {
    const settings = choices(...order);
    const live = target(5, "loras", saves[2]);
    const rows = readSwitches(settings.switches, placeNodes([live]), []);
    assert.equal(rows[0].state, "off");
    const plan = choosePlan(rows, rows[0], settings);
    for (const [pair, side] of plan.values) pair.control.value = pairValue(pair, side, pair.control.value);
    assert.deepEqual(stackRows(live.widgets[0].value), [lora("a", true, 1, { strength_clip: 1 })]);
    assert.equal(readSwitches(settings.switches, placeNodes([live]), [])[0].state, "on");
  }
});

test("ordinary JSON with object ids and titles falls back without coercion errors", () => {
  const malformed = JSON.parse('{"switches":[{"id":{"toString":null},"title":{"toString":null}},{"id":[2],"title":["oops"]},{"id":"4","title":"Valid"}]}');
  const normalized = normalizeSettings(malformed);
  assert.deepEqual(normalized.switches.map(({ id, title }) => [id, title]), [[1, "Switch 1"], [2, "Switch 2"], [4, "Valid"]]);
});

test("group chips accept hex colors and reject CSS that can load resources", () => {
  const colorOf = (color) => readGroups([{ color, boundingRect: [0, 0, 100, 100] }], [])[0].color;
  for (const color of ["#335", "#abcd", "#123456", "#12345678"]) assert.equal(colorOf(color), color);
  for (const color of ["url(https://example.invalid/pixel)", "image-set(url(//example.invalid/pixel) 1x)", "var(--external)", "#335; background:url(x)", "#12345", {}, null]) {
    assert.equal(colorOf(color), null);
  }
});

test("LoRA choices expose row locks and taking over releases every choice without changing other rows", () => {
  const settings = choices(
    stack(lora("a", true), lora("b", true)),
    stack(lora("a", false), lora("b", false)),
    stack(lora("a", true, 2), lora("b", false)),
  );
  const boards = [{ node: "card", settings }];
  const owners = stackRowOwners(boards, 5, "loras", "a");
  assert.deepEqual(owners.map(({ id }) => id), [1, 2, 3]);
  let released = settings;
  for (const { id } of owners) released = releaseStackRow(released, id, 5, "loras", "a");
  assert.deepEqual(stackRowOwners([{ node: "card", settings: released }], 5, "loras", "a"), []);
  assert.ok(choicePairs(released.switches[0], released.switches).some((pair) => pair.row === "b"));
  assert.equal(settings.switches[0].on[5].loras, stack(lora("a", true), lora("b", true)));
});

test("LoRA group choices expose locks and taking over keeps row choices intact", () => {
  const settings = choices(
    stack(lora("a", true, 1, { group: "Look" })),
    stack(lora("a", false, 1, { group: "Look", group_off: true })),
  );
  const owners = stackGroupOwners([{ node: "card", settings }], 5, "loras", "Look");
  assert.deepEqual(owners.map(({ id }) => id), [1, 2]);
  let released = settings;
  for (const { id } of owners) released = releaseStackGroup(released, id, 5, "loras", "Look");
  assert.deepEqual(stackGroupOwners([{ node: "card", settings: released }], 5, "loras", "Look"), []);
  assert.equal(stackRowOwners([{ node: "card", settings: released }], 5, "loras", "a").length, 2);
});
