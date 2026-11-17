// App mode for nodes with cards: the simple form view shows a real control
// for each field instead of an empty row. The logic is in
// js/shared/app_mode.mjs; this file watches which mode the open workflow is
// in and hands the fields over.
import { app } from "../../../scripts/app.js";
import { createAppModeSync, workflowMode } from "../shared/app_mode.mjs";

const sync = createAppModeSync({
  find(nodeId, name) {
    const graph = app.rootGraph ?? app.graph;
    const node = graph?.getNodeById?.(/^\d+$/.test(nodeId) ? Number(nodeId) : nodeId);
    const widget = node?.widgets?.find((entry) => entry.name === name);
    return widget ? { node, widget } : null;
  },
  changed(node) {
    node.setDirtyCanvas?.(true, true);
  },
});

let queued = false;
// After the current task: a card hides its widgets in a microtask once the
// node has loaded, and the form's fields are shown after that.
function schedule() {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    try {
      const workflow = app.extensionManager?.workflow?.activeWorkflow;
      sync(workflowMode(workflow), (app.rootGraph ?? app.graph)?.extra?.linearData);
    } catch (error) {
      console.warn("[AusBoss] App mode fields:", error);
    }
  }, 0);
}

app.registerExtension({
  name: "ausboss.app.mode",
  setup() {
    app.extensionManager?.workflow?.$subscribe?.(schedule);
  },
  afterConfigureGraph() {
    schedule();
  },
});
