// Image Size 🆎 shows what it measured beside its outputs: "width: 1024".
//
// The node has no panel: the numbers go into the labels of the outputs they
// belong to, so the node stays the size it was and a workflow's layout does
// not move.
//
// ComfyUI only reports a node that really ran. A second run with the same
// picture takes this node's answer from its cache and says nothing, so the
// numbers are kept in node.properties, which are saved with the workflow:
// a workflow opened again shows its last numbers, as Show Text shows its
// last text. The labels themselves are never saved, so an older version of
// the pack shows the plain names.

import { app } from "/scripts/app.js";
import { isForeignRun } from "../shared/prompt_scope.mjs";
import { chainCallback } from "../shared/index.mjs";
import { savedLabel, sizeLabel, sizesFromExecuted } from "../shared/image_size.mjs";

const NODE_CLASS = "AUSBOSS_NODES_ImageSize";
const SIZE_PROPERTY = "ausboss_image_size";
// Where each output's own label is kept while a size is shown.
const KEPT = "__ausbossSizeLabel";

function showSizes(node, sizes) {
  (node.outputs ?? []).forEach((output, index) => {
    // The label a user gave the output is kept and comes back when there is
    // nothing to show.
    if (!output[KEPT]) output[KEPT] = { own: output.label };
    const name = output[KEPT].own ?? output.localized_name ?? output.name;
    output.label = sizes ? sizeLabel(name, sizes[index]) : output[KEPT].own;
    if (!sizes) delete output[KEPT];
  });
  // Nodes 2.0 redraws a slot's label on this event; the classic view on the
  // next frame.
  node.graph?.trigger?.("node:slot-label:changed", { nodeId: node.id, slotType: globalThis.LiteGraph?.OUTPUT ?? 2 });
  node.setDirtyCanvas?.(true, true);
}

function remember(node, sizes) {
  node.properties ??= {};
  if (sizes) node.properties[SIZE_PROPERTY] = sizes;
  else delete node.properties[SIZE_PROPERTY];
  showSizes(node, sizes);
}

app.registerExtension({
  name: "ausboss.image_size",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      if (isForeignRun()) return;
      remember(this, sizesFromExecuted(message, this.outputs?.length ?? 5));
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // The saved properties are in place once configure has finished.
      queueMicrotask(() => {
        const sizes = sizesFromExecuted({ ausboss_size: this.properties?.[SIZE_PROPERTY] }, this.outputs?.length ?? 5);
        if (sizes) showSizes(this, sizes);
      });
    });
    chainCallback(nodeType.prototype, "onConnectionsChange", function (type, slot) {
      // Another picture on the wire, or none: the old numbers are not its size.
      // A workflow being opened makes its wires again, which is no change.
      if (app.configuringGraph) return;
      if (type !== (globalThis.LiteGraph?.INPUT ?? 1) || slot !== 0) return;
      if (this.properties?.[SIZE_PROPERTY] || this.outputs?.some((output) => output[KEPT])) remember(this, null);
    });
    chainCallback(nodeType.prototype, "onSerialize", function (data) {
      (data?.outputs ?? []).forEach((saved, index) => {
        const kept = this.outputs?.[index]?.[KEPT];
        const label = savedLabel({ shown: Boolean(kept), own: kept?.own }, saved.label);
        if (label === undefined) delete saved.label;
        else saved.label = label;
        delete saved[KEPT];
      });
    });
  },
});
