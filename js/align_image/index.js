import { app } from "/scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import { setWidgetVisible } from "../shared/widget_visibility.mjs";

const NODE_CLASS = "AUSBOSS_NODES_AlignImage";

// crop_position only means something while mode is "crop"; the widget hides
// otherwise so the node face stays as compact as before the option existed.
function syncCropPosition(node) {
  const mode = node.widgets?.find((widget) => widget.name === "mode");
  const position = node.widgets?.find((widget) => widget.name === "crop_position");
  if (!mode || !position) return;
  if (!setWidgetVisible(position, mode.value === "crop")) return;
  const width = node.size?.[0] ?? 0;
  const height = node.computeSize()[1];
  node.setSize([Math.max(width, node.computeSize()[0]), height]);
  node.graph?.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "AusBoss.AlignImage",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const mode = this.widgets?.find((widget) => widget.name === "mode");
      if (mode) {
        const previous = mode.callback;
        const node = this;
        mode.callback = function (...args) {
          const result = previous?.apply(this, args);
          syncCropPosition(node);
          return result;
        };
      }
      syncCropPosition(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Restored widget values land after creation; re-sync to the loaded
      // mode without disturbing the size the workflow saved.
      queueMicrotask(() => syncCropPosition(this));
    });
  },
});
