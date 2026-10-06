# Latent Size 🆎

Pick a picture size by shape and megapixels, or by dragging. Use it in place of an Empty Latent node: it gives you the width, the height and a blank latent of that size.

- **Shape:** the left button selects landscape or portrait. Ratio chips follow that choice; square retains it for the next selection. Clicking a chip uses its generated size near one megapixel. Enable **Chips keep current budget** in the gear to retain the current area.
- **Canvas:** drag a side to change one dimension; drag the corner to scale both. Shift frees the corner ratio, Alt removes snapping, and Escape cancels the drag. The bright readout shows the size, megapixels and ratio; an amber dot means the size is off the snap grid, which a typed size can be. Arrow keys nudge the focused canvas by the snap step, or by 8 px with Shift.
- **Size & budget:** scrub or type W, H, or MP. Typed dimensions are preserved exactly. The swap button exchanges dimensions. The **Sizes** chips are ready-made sizes for the current ratio, small to large. They show while the shape is one of the ratio chips; any other shape shows one greyed-out "custom" chip.
- **Gear:** set the **Snap step**, edit the **Ratio rail**, choose the **Latent family** (`latent`) and **Batch size** (`batch_size`), and hide the **Dot grid** or **MP cost curves**. **Snap step** (8, 16, 32 or 64; starts at 32) is the grid that drags, arrow keys and chips land on. The **Ratio rail** is the list of ratio chips, typed as `1:1, 21:9`. The display options apply to every Latent Size node in this browser; latent family and batch size (1 to 64) belong to this node.
- **Node size:** drag the node's corner to make it wider or taller, so it lines up with the nodes around it. The controls stretch with it, and the canvas preview takes any extra height. It can be as narrow as 320 pixels.

## Outputs and links

Outputs are **width**, **height**, and **latent**, in that order. The node has four input sockets above the panel: width, height, latent and batch_size. Linking width or height locks the controls that would change both dimensions; the other dimension remains editable. Linking latent or batch_size sets the latent family or batch size from another node, and the gear then shows that setting as linked. A linked value is read when the workflow runs, so the preview keeps showing the size stored on the node.

The **Latent family** is **16ch** (8× downsample), **4ch** (8×), or **128ch** (16×). 16ch (the default) is for SD3, Flux 1, Krea 2, Qwen Image and Z-Image. 4ch is for SD 1.5 and SDXL. 128ch is for Flux 2 Klein. A model that packs pixels differently, such as Qwen Image 2.1, still gets the size you set: ComfyUI resizes the empty latent to fit it. This is an empty *image* latent; video models should take the width and height outputs and construct their own audio/video latent.

Typed sizes need not be divisible by the latent downsample factor. The integer outputs retain the typed size, while the latent spatial dimensions round down to complete cells, matching the core empty-latent nodes. Use aligned dimensions when wiring the latent directly. Large dimensions and batches allocate correspondingly large tensors.

## Limits

Dimensions range from 64 to 8192 pixels. Extreme custom ratios may not have an exact solution inside that range at the chosen snap; they use a bounded approximation. Fine custom ratios can likewise only approximate the ratio during a snapped drag. Longer custom ratio lists scroll within the shape area.

All execution inputs are ordinary widgets, so API runs do not depend on this panel. Orientation and snap preferences are saved with the node. This node has no model downloads, network requests, or additional pip dependencies.
