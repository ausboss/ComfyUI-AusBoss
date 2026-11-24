// App mode for nodes with cards: the simple form view shows a real control
// for each field instead of an empty row. The logic is in
// js/shared/app_mode.mjs; this file watches which mode the open workflow is
// in and hands the fields over.
import { app } from "../../../scripts/app.js";
import { APP_MODE, appFields, createAppModeSync, formHostSelector, workflowMode } from "../shared/app_mode.mjs";

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

function findWidget(nodeId, name) {
  const graph = app.rootGraph ?? app.graph;
  const node = graph?.getNodeById?.(/^\d+$/.test(nodeId) ? Number(nodeId) : nodeId);
  return node?.widgets?.find((entry) => entry.name === name) ?? null;
}

// A DOM widget the form lists goes into its row, and back again if the
// graph's widget layer took it (see formHostSelector). Rows mount a little
// after the mode changes, so this looks a few times.
const REHOME_DELAYS = [0, 60, 250, 700, 1500];
function rehomeDomWidgets() {
  for (const delay of REHOME_DELAYS) {
    setTimeout(() => {
      try {
        const workflow = app.extensionManager?.workflow?.activeWorkflow;
        if (workflowMode(workflow) !== APP_MODE) return;
        for (const { nodeId, widget: name } of appFields((app.rootGraph ?? app.graph)?.extra?.linearData)) {
          const element = findWidget(nodeId, name)?.element;
          if (!(element instanceof HTMLElement)) continue;
          const host = document.querySelector(formHostSelector(nodeId, name));
          if (host && !host.contains(element)) host.replaceChildren(element);
        }
      } catch (error) {
        console.warn("[AusBoss] App mode fields:", error);
      }
    }, delay);
  }
}

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
      const mode = workflowMode(workflow);
      sync(mode, (app.rootGraph ?? app.graph)?.extra?.linearData);
      if (mode === APP_MODE) rehomeDomWidgets();
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
