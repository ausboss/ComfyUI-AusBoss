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
// graph's widget layer took it (see formHostSelector). Rows mount whenever
// the form draws, which can be well after the mode changes, so while a
// workflow is in App mode the page is watched and an empty row is filled
// on the next frame.
function rehomeDomWidgets() {
  const workflow = app.extensionManager?.workflow?.activeWorkflow;
  if (workflowMode(workflow) !== APP_MODE) return;
  for (const { nodeId, widget: name } of appFields((app.rootGraph ?? app.graph)?.extra?.linearData)) {
    const element = findWidget(nodeId, name)?.element;
    if (!(element instanceof HTMLElement)) continue;
    const host = document.querySelector(formHostSelector(nodeId, name));
    if (!host || host.contains(element)) continue;
    // Something that keeps taking it back: stop rather than fight.
    const now = Date.now();
    moves = moves.filter((at) => now - at < 3000);
    if (moves.length >= 30) return;
    moves.push(now);
    host.replaceChildren(element);
  }
}

let moves = [];
let watcher = null;
let framed = false;
function watchForm(on) {
  if (!on) {
    watcher?.disconnect();
    watcher = null;
    return;
  }
  if (!watcher) {
    watcher = new MutationObserver(() => {
      if (framed) return;
      framed = true;
      requestAnimationFrame(() => {
        framed = false;
        try { rehomeDomWidgets(); } catch (error) { console.warn("[AusBoss] App mode fields:", error); }
      });
    });
    watcher.observe(document.body, { childList: true, subtree: true });
  }
  rehomeDomWidgets();
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
      watchForm(mode === APP_MODE);
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
