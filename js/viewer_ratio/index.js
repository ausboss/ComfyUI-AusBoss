// ComfyUI's 3D viewers with a frame (Preview 3D Advanced, Save 3D Advanced)
// size that frame with two plain width and height rows. This puts the shape
// chips from Latent Size above a W x H row instead: pick a shape, keep the
// megapixels, and the viewer's frame follows at once.
//
// The node is ComfyUI's own: its width and height widgets stay the source of
// truth (saved workflows, API prompts and links are untouched), the card only
// writes their values, and the sockets for the pair sit among the node's
// inputs, as on Image Resize.
import { app } from "../../../scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import { ratioChips } from "../shared/ratio_chips.mjs";
import { mountWidgetCard } from "../shared/widget_card.mjs";
import { hideInputsInDef } from "../shared/widget_visibility.mjs";

const VIEWERS = new Set(["Preview3DAdvanced", "Save3DAdvanced"]);
const CARD = {
  minWidth: 300,
  rows: [
    { panel: ratioChips(), height: 28 },
    { pair: ["width", "height"], label: "Size", prefixes: ["W", "H"], sep: "×", top: true, pixels: true },
  ],
};

app.registerExtension({
  name: "ausboss.viewer_ratio",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!VIEWERS.has(nodeData?.name)) return;
    hideInputsInDef(nodeData, ["width", "height"]);
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      if (this.__ausbossCard) return;
      // The viewer keeps the node's height; the card only takes its own rows.
      const size = [...(this.size ?? [0, 0])];
      mountWidgetCard(this, CARD);
      if (size[0] && size[1]) this.setSize?.([Math.max(size[0], CARD.minWidth), Math.max(size[1], this.computeSize?.()[1] ?? 0)]);
    });
  },
});
