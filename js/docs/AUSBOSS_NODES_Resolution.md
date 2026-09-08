# Resolution Master 🆎

Choose the width and height of a canvas visually, then wire those integers or the empty latent into your workflow.

- **Shape:** the left button selects landscape or portrait. Ratio chips follow that choice; square retains it for the next selection. Clicking a chip uses its generated size near one megapixel. Enable **Chips keep current budget** in the gear to retain the current area.
- **Canvas:** drag a side to change one dimension; drag the corner to scale both. Shift frees the corner ratio, Alt removes snapping, and Escape cancels the drag. The bright readout shows dimensions and megapixels. Arrows nudge the focused canvas.
- **Size & budget:** scrub or type W, H, or MP. Typed dimensions are preserved exactly. The swap button exchanges dimensions. Size chips offer larger and smaller versions of the current ratio.
- **Gear:** choose snapping, edit the ratio list, configure the latent layout and batch size, and hide the grid or MP curves.

## Outputs and links

Outputs are **width**, **height**, and **latent**, in that order. The width and height inputs have separate sockets above the panel. Linking either locks the controls that would change both dimensions; the other dimension remains editable. Linked values are resolved during execution; the preview shows the locally stored dimensions.

The latent layout is **16ch / 8× downsample**, **4ch / 8×**, or **128ch / 16×**. Select the layout required by your model. This is an empty *image* latent; video models should take the width and height outputs and construct their own audio/video latent.

Typed sizes need not be divisible by the latent downsample factor. The integer outputs retain the typed size, while the latent spatial dimensions round down to complete cells, matching the core empty-latent nodes. Use aligned dimensions when wiring the latent directly. Large dimensions and batches allocate correspondingly large tensors.

## Limits

Dimensions range from 64 to 8192 pixels. Extreme custom ratios may not have an exact solution inside that range at the chosen snap; they use a bounded approximation. Fine custom ratios can likewise only approximate the ratio during a snapped drag. The panel stays compact at a fixed width and height; longer custom ratio lists scroll within the shape area.

All execution inputs are ordinary widgets, so API runs do not depend on this panel. Orientation and snap preferences are saved with the node. This node has no model downloads, network requests, or additional pip dependencies.
