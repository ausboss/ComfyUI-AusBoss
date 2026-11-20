import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL, SIMPLE, TAB_PROPERTY, boxText, editValue, isEdited, promptTab, writtenFromOutput } from "../js/shared/h3_full_prompt_math.mjs";
import { visibleRows } from "../js/shared/widget_card_math.mjs";

const WRITTEN = "summary:\nA slow push in. One continuous shot with no cuts.";

test("an edit is kept only when it differs from what the node wrote", () => {
  assert.equal(editValue("summary:\nOne continuous shot with no cuts.", WRITTEN), "summary:\nOne continuous shot with no cuts.");
  assert.equal(editValue(WRITTEN, WRITTEN), "");
  assert.equal(editValue(`  ${WRITTEN}\n`, WRITTEN), "");
  assert.equal(editValue("   \n", WRITTEN), "");
  // Before any run there is nothing written: whatever is typed is the edit.
  assert.equal(editValue("my own prompt", ""), "my own prompt");
});

test("the box shows the edit, else the last written prompt", () => {
  assert.equal(boxText({ full_prompt: "" }, WRITTEN), WRITTEN);
  assert.equal(boxText({ full_prompt: "mine" }, WRITTEN), "mine");
  assert.equal(boxText({}, ""), "");
  assert.equal(isEdited({ full_prompt: " \n" }), false);
  assert.equal(isEdited({ full_prompt: "mine" }), true);
});

test("the tab is Simple unless the node says Full", () => {
  assert.equal(promptTab({}), SIMPLE);
  assert.equal(promptTab({ properties: { [TAB_PROPERTY]: "nonsense" } }), SIMPLE);
  assert.equal(promptTab({ properties: { [TAB_PROPERTY]: FULL } }), FULL);
});

test("the written prompt is read from a run's ui output", () => {
  assert.equal(writtenFromOutput({ written_prompt: [WRITTEN] }), WRITTEN);
  assert.equal(writtenFromOutput({ written_prompt: WRITTEN }), WRITTEN);
  assert.equal(writtenFromOutput({ text: ["other"] }), null);
  assert.equal(writtenFromOutput(null), null);
});

test("a row's when can follow a choice kept on the node", () => {
  const simple = { widget: "script", when: (values, node) => promptTab(node) !== FULL };
  const full = { panel: () => ({}), when: (values, node) => promptTab(node) === FULL };
  const node = { properties: {} };
  assert.deepEqual(visibleRows([simple, full], {}, {}, node), [simple]);
  node.properties[TAB_PROPERTY] = FULL;
  assert.deepEqual(visibleRows([simple, full], {}, {}, node), [full]);
});
