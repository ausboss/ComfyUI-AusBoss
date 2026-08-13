// Name-keyed widgets_values for AusBoss nodes.
//
// Positional widgets_values arrays break the moment a widget is added or
// reordered, so these nodes serialize {widgetName: value} objects instead
// and restore by name on configure. Legacy positional arrays — every
// workflow saved before this change — keep loading through the order-based
// migration in shared/widget_kv.mjs. The queue/API path is untouched:
// graphToPrompt reads widget.value directly and never sees widgets_values.
//
// The LoRA loader is deliberately absent: its single JSON widget already
// survives reordering.

import { app } from "/scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import {
  captureWidgetDefaults,
  planWidgetRestore,
  widgetsToDict,
} from "../shared/widget_kv.mjs";

const NODE_TYPES = new Set([
  "AUSBOSS_NODES_ImageCropRotatePad",
  "AUSBOSS_NODES_VideoCropRotatePad",
  "AUSBOSS_NODES_LoadVideo",
  "AUSBOSS_NODES_SaveVideo",
]);

app.registerExtension({
  name: "ausboss.widget_kv",
  beforeRegisterNodeDef(nodeType, nodeData) {
    const nodeName = nodeData?.name;
    if (!NODE_TYPES.has(nodeName)) return;

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      // Snapshot creation defaults before configure() can overwrite them;
      // the restore plan falls back to these for values that do not fit.
      this.__ausbossWidgetDefaults ??= captureWidgetDefaults(this.widgets);
    });

    chainCallback(nodeType.prototype, "onSerialize", function (info) {
      if (!info || !Array.isArray(this.widgets)) return;
      try {
        info.widgets_values = widgetsToDict(this.widgets);
      } catch (_error) {
        // Keep the positional array the base serializer already wrote.
      }
    });

    chainCallback(nodeType.prototype, "onConfigure", function (info) {
      // Never throw during workflow load: a bad payload degrades to
      // defaults with a single warning instead of killing the graph.
      try {
        const plan = planWidgetRestore(
          this.widgets,
          info?.widgets_values,
          this.__ausbossWidgetDefaults,
        );
        if (plan.mode === "invalid") {
          console.warn(`[AusBoss] ${nodeName}: stored widget values were unreadable; using defaults.`);
        }
        for (const { name, value } of plan.assignments) {
          const widget = this.widgets?.find((item) => item.name === name);
          if (widget) widget.value = value;
        }
      } catch (error) {
        console.warn(`[AusBoss] ${nodeName}: widget restore failed (${error}); keeping current values.`);
      }
    });
  },
});
