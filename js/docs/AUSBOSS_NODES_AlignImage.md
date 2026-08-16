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
  - **crop** — center-crop *down* to the next multiple. No distortion; a few
    edge pixels are trimmed.
  - **pad** — replicate-pad the edges *up* to the next multiple, split
    evenly. No distortion; a few edge pixels are invented by repetition.

A side already smaller than one multiple can never be cropped legal, so it
snaps up to exactly one multiple in every mode (replicate-padded when the
mode would otherwise shrink it).

## Outputs

- **image**: The aligned batch.
- **width** / **height**: The new size as INTs — wire them into an Empty
  Latent, a resize, or conditioning nodes so the numbers can never drift
  from the actual image.

## Notes

At most `multiple - 1` pixels are added or removed per side, so the change
is invisible at 16 or 32 on normal resolutions. Batches keep their frame
count; values stay in `[0, 1]`.
