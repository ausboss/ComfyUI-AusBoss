# Image Resize

Resizes a picture. Choose how to set the new size: an exact width and
height, the longest or shortest edge, a megapixel budget, or a multiplier.
A mask can ride along and gets the same resize, and the new width and
height come out as numbers you can wire onward.

A new node starts on **Megapixels** at 1 MP, with **Fit** on fit,
**Multiple** 1 and the lanczos filter.

## Target modes

**Target** (`target_mode`) picks the mode. The card shows only that mode's
size row, and the other size values are ignored.

- **Width × height** (`width+height`): The two **Size** fields, W and H
  (`width`, `height`). Their input sockets sit with the node's inputs,
  under `image` and `mask`; a linked one greys its field out. `0` keeps that
  source dimension, and with only one set the other follows the source
  aspect.
- **Longest edge** / **Shortest edge** (`longest_edge`, `shortest_edge`):
  Scales until that edge equals **Edge** (`edge_length`) exactly; the other
  edge keeps the aspect. `0` keeps the source size.
- **Megapixels** (`megapixels`): Scales (aspect preserved) until width ×
  height is about **Budget** (`megapixels`) million pixels. `0` keeps the
  source size.
- **Scale factor** (`scale_factor`): Multiplies both dimensions by **Scale**
  — `0.5` halves, `2.0` doubles. `0` keeps the source size.

## Fit

**Fit** (`keep_proportion`) decides what happens when the target aspect
differs from the source. It only matters in **Width × height** mode: in the
other modes the picture always keeps its shape, whatever Fit says.

- **stretch**: Distorts straight to the target.
- **fit**: Shrinks the target box to the source aspect — the output can be
  smaller than requested, but there are never bars and nothing is cropped.
- **cover** (`cover_crop`): Fills the target completely and center-crops
  the overflow.
- **pad**: Fits inside the target and fills the rest with **Fill**
  (`fill_color`: hex, `R, G, B`, one grayscale number, or a CSS name; a
  color the node cannot read becomes mid-gray). The
  new bars are `1.0` in the mask output — the same generated-area contract
  as the pack's other pad nodes, so it feeds an inpainter directly.

## Notes

- **Multiple** (`divisible_by`) snaps each output dimension to the nearest
  multiple (never below one step) — `16` for WAN, `8` for most latent
  spaces. It wins over exact proportion, so a dimension can shift by up to
  half a step. It applies even when everything else says "keep the source".
- **Bars only appear in Width × height mode with Fit on pad.** In every
  other target mode the box is derived from the source's own aspect, so
  there is nothing to letterbox against: the proportion modes all resolve a
  `divisible_by` snap with an invisible sub-half-step resize, and the mask
  output stays black. With Fit on pad, bars (white in the mask) fill
  whatever the picture does not cover. That includes a bar a pixel or two
  wide when the size is rounded, for example a 1000×700 picture with
  **Multiple** 16 becomes 1008×704 with a 2 px bar.
- **Filter** (`interpolation`): `lanczos` (PIL, in float — the sharpest
  all-rounder), `bicubic`, `bilinear`, `nearest` (pixel art, hard masks),
  `area` (best for strong downscales). A resize that changes nothing passes
  the tensor through bit-identical.
- The mask output is the input mask through the same transform, plus the
  pad bars. With no mask wired it is black, except for pad bars, which are
  white. IMAGE is BHWC, MASK is BHW, and batches flow through frame by
  frame.

## Outputs

- **image**: the resized picture.
- **mask**: the mask, resized the same way.
- **width** / **height**: the new size in pixels.
