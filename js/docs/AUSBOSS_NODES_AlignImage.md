# Align Image

Snaps an image's width and height to a clean multiple of a number you pick —
8, 16, 32, 64, whatever the model downstream wants. Qwen image models, VAEs,
and plenty of samplers behave best (or only work) on sizes that divide
cleanly; this node makes any input legal without hand-typing resolutions.

## Controls

- **image**: BHWC batch to align; every frame is treated the same.
- **multiple**: Both output sides come out divisible by this. `16` or `32`
  suits most diffusion models; latent nodes generally want at least `8`.
- **mode**: How the multiple is reached. Each mode implies its own rounding
  direction, so there is no separate rounding widget:
  - **resize** — rescale to the *nearest* multiple. A slight stretch, but
    every pixel's content survives. The default.
  - **crop** — crop *down* to the next multiple. No distortion; a few edge
    pixels are trimmed.
  - **pad** — pad the edges *up* to the next multiple. No distortion; the
    new pixels are filled per **pad_fill**.
- **crop_position**: Crop mode only — which part of the frame survives.
  `center` trims both edges evenly; `top`, `bottom`, `left`, or `right`
  pin that edge and trim the opposite one. Ignored by resize and pad.
- **pad_position**: Pad mode only — where the image sits on the grown
  canvas; the new pixels land on the opposite side. `center` splits them
  evenly. Same vocabulary as `crop_position`.
- **pad_fill**: Pad mode only — what fills the new area. `replicate`
  stretches the edge pixels out; `color` uses **pad_color** as a solid.
- **pad_color**: The solid fill for `pad_fill: color`. Hex, `R,G,B`
  numbers, or a CSS color name.

A side already smaller than one multiple can never be cropped legal, so it
snaps up to exactly one multiple in every mode (in crop mode the deficit is
replicate-padded evenly).

## Outputs

- **image**: The aligned batch.
- **width** / **height**: The new size as INTs — wire them into an Empty
  Latent, a resize, or conditioning nodes so the numbers can never drift
  from the actual image.
- **offset_x** / **offset_y**: Where the original's left/top edge sits in
  the output: positive after padding, negative after cropping, `0` after a
  resize — wire into a crop to un-align after sampling.

## Notes

At most `multiple - 1` pixels are added or removed per side, so the change
is invisible at 16 or 32 on normal resolutions. Batches keep their frame
count; values stay in `[0, 1]`.
