import { app } from "/scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import { setWidgetVisible } from "../shared/widget_visibility.mjs";

const NODE_CLASS = "AUSBOSS_NODES_AlignImage";

// Each anchor/fill widget only means something in its own mode, so the node
// face stays as compact as before the options existed:
//   crop_position          -> mode == "crop"
//   pad_position, pad_fill -> mode == "pad"
//   pad_color              -> mode == "pad" AND pad_fill == "color"
function syncOptionWidgets(node) {
  const widget = (name) => node.widgets?.find((item) => item.name === name);
  const mode = widget("mode");
  const padFill = widget("pad_fill");
  if (!mode) return;
  const wants = {
    crop_position: mode.value === "crop",
    pad_position: mode.value === "pad",
    pad_fill: mode.value === "pad",
    pad_color: mode.value === "pad" && padFill?.value === "color",
  };
  let changed = false;
  for (const [name, visible] of Object.entries(wants)) {
    const target = widget(name);
    if (target && setWidgetVisible(target, visible)) changed = true;
  }
  if (!changed) return;
  const width = node.size?.[0] ?? 0;
  node.setSize([Math.max(width, node.computeSize()[0]), node.computeSize()[1]]);
  node.graph?.setDirtyCanvas?.(true, true);
}

function watchWidget(node, name) {
  const widget = node.widgets?.find((item) => item.name === name);
  if (!widget) return;
  const previous = widget.callback;
  widget.callback = function (...args) {
    const result = previous?.apply(this, args);
    syncOptionWidgets(node);
    return result;
  };
}

app.registerExtension({
  name: "AusBoss.AlignImage",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      watchWidget(this, "mode");
      watchWidget(this, "pad_fill");
      syncOptionWidgets(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Restored widget values land after creation; re-sync to the loaded
      // mode without disturbing the size the workflow saved.
      queueMicrotask(() => syncOptionWidgets(this));
    });
  },
});
