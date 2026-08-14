# Stitch Inpaint

Pastes an inpainted crop from **Crop For Inpaint (AusBoss)** back into the
original image. The crop is resized to its source window if the sampler
changed its size, blended in with the feathered mask recorded in the
stitcher, and the original frame is sliced back out.

## Guarantees

- Pixels outside the blend region are **bit-identical** to the original
  image — they never pass through a resize or blend. This holds with
  `fix_edge_halo` on as well: the toggle changes the color that is pasted,
  never how far the paste reaches.
- Feeding the crop back unchanged reproduces the original image exactly
  (with `fix_edge_halo` off; the fix rewrites the feathered band on purpose).

## Controls

- **stitcher**: The stitcher output of Crop For Inpaint. It carries the
  paste window, the blend mask, and the untouched original pixels.
- **inpainted**: The inpainted crop. A stitcher built from a single image
  broadcasts across an N-frame inpainted batch, so one still-image crop
  can stitch a whole video; matched N-to-N batches also work.
- **fix_edge_halo**: Off by default. Recovers the true color under the
  feathered seam before pasting, so half-transparent edge pixels stop
  blending their background in a second time.

## Fixing an edge halo

A feathered paste mixes each seam pixel with the original image. When the
inpainted pixel is *itself* already a mix of new content and the old
background — common after object removal, or when the mask hugged the
subject too tightly — that background gets counted twice and the seam reads
as a dark or light rim around the repair.

Turn `fix_edge_halo` on and the pasted color is re-derived first: the opaque
core's color is spread outward across the blend band, and the paste blends
toward that instead of the contaminated pixel. Leave it off when the seam
already looks clean — the estimate costs a little time per frame, and a
clean seam has nothing to gain.

The fix needs the optional [`pymatting`](https://pypi.org/project/pymatting/)
package:

```bash
pip install pymatting
```

Without it the node prints one console note and pastes exactly as it would
with the toggle off — the graph keeps running either way.

## Outputs

- **image**: The original-size image with the inpainted region blended in.

## Wiring

```text
Crop For Inpaint ── image/mask ──> LaMa Inpaint ── image ──> Stitch Inpaint ── image
        └── stitcher ────────────────────────────────────────────┘
```
