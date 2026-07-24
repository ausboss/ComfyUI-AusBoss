// Frontend for Show Text (AusBoss).
//
// The Python side returns {"ui": {"text": [...]}} from run(); ComfyUI
// delivers that payload to onExecuted() here, and we write it into a
// read-only multiline widget. Template for any "display a result on the
// node" pattern in this pack.

import { app } from "/scripts/app.js";
import { ComfyWidgets } from "/scripts/widgets.js";
import { chainCallback } from "../shared/index.mjs";

const NODE_CLASS = "AusBossShowText";
const WIDGET_NAME = "displayed_text";

function getDisplayWidget(node) {
  let widget = node.widgets?.find((w) => w.name === WIDGET_NAME);
  if (!widget) {
    widget = ComfyWidgets.STRING(
      node,
      WIDGET_NAME,
      ["STRING", { multiline: true }],
      app
    ).widget;
    // inputEl only exists in the classic canvas renderer; guard so the
    // node still works (minus the styling) in Nodes 2.0 mode.
    if (widget.inputEl) {
      widget.inputEl.readOnly = true;
      widget.inputEl.style.opacity = "0.75";
    }
  }
  return widget;
}

app.registerExtension({
  name: "ausboss.show_text",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;

    // Create the widget up front (not lazily in onExecuted) so saved
    // workflows restore their last value through the normal
    // widgets_values path with no extra code.
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      getDisplayWidget(this);
    });

    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      const lines = message?.text;
      if (!Array.isArray(lines)) return;
      const widget = getDisplayWidget(this);
      widget.value = lines.join("\n");
      this.setDirtyCanvas(true, false);
    });
  },
});
