# Stitch Inpaint

Pastes an inpainted crop from **Crop For Inpaint (AusBoss)** back into the
original image. The crop is resized to its source window if the sampler
changed its size, blended in with the feathered mask recorded in the
stitcher, and the original frame is sliced back out.

## Guarantees

- Pixels outside the blend region are **bit-identical** to the original
  image — they never pass through a resize or blend.
- Feeding the crop back unchanged reproduces the original image exactly.

## Controls

- **stitcher**: The stitcher output of Crop For Inpaint. It carries the
  paste window, the blend mask, and the untouched original pixels.
- **inpainted**: The inpainted crop. A stitcher built from a single image
  broadcasts across an N-frame inpainted batch, so one still-image crop
  can stitch a whole video; matched N-to-N batches also work.

## Outputs

- **image**: The original-size image with the inpainted region blended in.

## Wiring

```text
Crop For Inpaint ── image/mask ──> LaMa Inpaint ── image ──> Stitch Inpaint ── image
        └── stitcher ────────────────────────────────────────────┘
```
