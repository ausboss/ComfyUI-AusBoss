# Image Resize

One resize node for the jobs that usually pull in a whole pack: hit an
exact **width+height**, scale until the **longest** or **shortest edge**
lands on a number, meet a **megapixel** budget, or multiply by a **scale
factor**. An optional mask rides through the identical geometry, and the
output width/height come back as INTs ready to wire onward.

## Target modes

Each mode reads only its own widget(s); the others are ignored.

- **width+height**: The two size widgets. `0` keeps that source dimension,
  and with only one set the other follows the source aspect.
- **longest_edge** / **shortest_edge**: Scales until that edge equals
  `edge_length` exactly; the other edge keeps the aspect. `0` keeps the
  source size.
- **megapixels**: Scales (aspect preserved) until width × height is about
  `megapixels` million pixels. `0` keeps the source size.
- **scale_factor**: Multiplies both dimensions — `0.5` halves, `2.0`
  doubles. `0` keeps the source size.

## Keep proportion

Decides what happens when the target aspect differs from the source:

- **stretch**: Distorts straight to the target.
- **fit**: Shrinks the target box to the source aspect — the output can be
  smaller than requested, but there are never bars and nothing is cropped.
- **cover_crop**: Fills the target completely and center-crops the
  overflow.
- **pad**: Fits inside the target and fills the rest with `fill_color`
  (hex, `R, G, B`, one grayscale number, or a CSS name). The new bars are
  `1.0` in the mask output — the same generated-area contract as the
  pack's other pad nodes, so it feeds an inpainter directly.

## Notes

- **divisible_by** snaps each output dimension to the nearest multiple
  (never below one step) — `16` for WAN, `8` for most latent spaces. It
  wins over exact proportion, so a dimension can shift by up to half a
  step. It applies even when everything else says "keep the source".
- **Pixels are only ever invented on explicit request.** In every target
  mode except `width+height` the box is derived from the source's own
  aspect, so there is nothing to letterbox against: the proportion modes
  all resolve a `divisible_by` snap with an invisible sub-half-step
  resize, and the mask output stays black. Bars — and white in the mask —
  can only appear when you set a `width+height` box that disagrees with
  the source and choose `pad`.
- **interpolation**: `lanczos` (PIL, in float — the sharpest all-rounder),
  `bicubic`, `bilinear`, `nearest` (pixel art, hard masks), `area` (best
  for strong downscales). A resize that changes nothing passes the tensor
  through bit-identical.
- The mask output is the input mask through the same transform, plus the
  pad bars; all zeros when no mask is wired. IMAGE is BHWC, MASK is BHW,
  and batches flow through frame by frame.
