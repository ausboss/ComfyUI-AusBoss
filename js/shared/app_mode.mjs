// App mode and the pack's cards. Pure logic, no DOM: tested under node:test.
//
// App mode is ComfyUI's simple form view of a workflow: a saved list of
// fields (extra.linearData.inputs) and a Run button. Each field is a
// widget. A node with a card or panel hides its standard widgets and shows
// its own controls instead, and App mode reads that hidden flag too, so the
// form drew an empty row for every field on such a node.
//
// While a workflow is in App mode, the widgets its form lists are shown
// again; App mode draws its own control for each. Back in the graph they are
// hidden again, so the node's face is unchanged. Only listed widgets move.
import { hideWidget, isWidgetHidden, showWidget } from "./widget_visibility.mjs";

export const APP_MODE = "app";

// "app", "graph" or "builder:..." for the open workflow.
export function workflowMode(workflow) {
  return workflow?.activeMode ?? workflow?.initialMode ?? "graph";
}

// The form's fields as { nodeId, widget } pairs. A field is saved as
// [nodeId, widgetName] or [nodeId, widgetName, { description }].
export function appFields(linearData) {
  const inputs = Array.isArray(linearData?.inputs) ? linearData.inputs : [];
  const fields = [];
  for (const entry of inputs) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [nodeId, widget] = entry;
    if ((typeof nodeId !== "string" && typeof nodeId !== "number") || typeof widget !== "string") continue;
    fields.push({ nodeId: String(nodeId), widget });
  }
  return fields;
}

// find(nodeId, widgetName) -> { node, widget } or null
// changed(node) is called after a widget on that node changed visibility.
export function createAppModeSync({ find, changed = () => {} }) {
  const lent = new Map(); // widget -> node, shown for the form
  return function sync(mode, linearData) {
    if (mode === APP_MODE) {
      for (const { nodeId, widget: name } of appFields(linearData)) {
        const found = find(nodeId, name);
        if (!found?.widget || !isWidgetHidden(found.widget)) continue;
        showWidget(found.widget);
        // An explicit false, not a deleted flag: the frontend keeps its own
        // copy of the hidden state and only hears about a written value.
        if (found.widget.options) found.widget.options.hidden = false;
        lent.set(found.widget, found.node);
        changed(found.node);
      }
      return lent.size;
    }
    for (const [widget, node] of lent) {
      if (hideWidget(widget)) changed(node);
    }
    lent.clear();
    return 0;
  };
}
