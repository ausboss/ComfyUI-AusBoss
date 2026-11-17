import test from "node:test";
import assert from "node:assert/strict";

import { appFields, createAppModeSync, workflowMode } from "../js/shared/app_mode.mjs";
import { hideWidget, isWidgetHidden } from "../js/shared/widget_visibility.mjs";

function graph() {
  const nodes = new Map();
  for (const [id, names] of [["256", ["image", "upload"]], ["160", ["script"]]]) {
    const node = { id, dirty: 0, widgets: names.map((name) => ({ name, value: "" })) };
    for (const widget of node.widgets) hideWidget(widget);
    nodes.set(id, node);
  }
  const find = (nodeId, name) => {
    const node = nodes.get(nodeId);
    const widget = node?.widgets.find((entry) => entry.name === name);
    return widget ? { node, widget } : null;
  };
  return { nodes, find, changed: (node) => { node.dirty += 1; } };
}

const linearData = { inputs: [["256", "image", { description: "One clear photo." }], [160, "script"], ["999", "gone"]], outputs: ["145"] };

test("fields read both saved shapes and skip broken entries", () => {
  assert.deepEqual(appFields(linearData), [
    { nodeId: "256", widget: "image" }, { nodeId: "160", widget: "script" }, { nodeId: "999", widget: "gone" },
  ]);
  assert.deepEqual(appFields({ inputs: [null, ["1"], [{}, "x"]] }), []);
  assert.deepEqual(appFields(undefined), []);
});

test("the mode falls back from the live mode to the saved one", () => {
  assert.equal(workflowMode({ activeMode: null, initialMode: "app" }), "app");
  assert.equal(workflowMode({ activeMode: "graph", initialMode: "app" }), "graph");
  assert.equal(workflowMode(undefined), "graph");
});

test("App mode shows only the listed widgets, the graph hides them again", () => {
  const g = graph();
  const sync = createAppModeSync(g);
  const image = g.find("256", "image").widget;
  const upload = g.find("256", "upload").widget;
  assert.equal(sync("app", linearData), 2);
  assert.equal(isWidgetHidden(image), false);
  assert.equal(image.options.hidden, false); // written, so the frontend hears it
  assert.equal(isWidgetHidden(upload), true); // not on the form, left alone
  assert.equal(g.nodes.get("256").dirty, 1);
  sync("graph", linearData);
  assert.equal(isWidgetHidden(image), true);
  assert.equal(image.options.hidden, true);
  assert.equal(isWidgetHidden(g.find("160", "script").widget), true);
});

test("a widget a card hides again while in App mode is shown again", () => {
  const g = graph();
  const sync = createAppModeSync(g);
  sync("app", linearData);
  const image = g.find("256", "image").widget;
  hideWidget(image); // the card's load-time re-hide
  sync("app", linearData);
  assert.equal(isWidgetHidden(image), false);
});

test("builder mode and the graph leave card widgets hidden", () => {
  const g = graph();
  const sync = createAppModeSync(g);
  for (const mode of ["graph", "builder:inputs"]) {
    assert.equal(sync(mode, linearData), 0);
    assert.equal(isWidgetHidden(g.find("256", "image").widget), true);
  }
});
