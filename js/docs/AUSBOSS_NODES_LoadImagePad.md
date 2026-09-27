# Load Image + Pad

Loads an image and builds an outpaint canvas around it in one node. The
canvas drawn on the node is the control: **drag any edge of the dashed
final rect** to grow that side's padding — the whole edge is the handle,
and corners grab the nearer edge. The second output is a mask covering
exactly the padding, ready for an inpainter.

The widget card holds Source and Upload, Fill, Color or Backdrop, Feather,
Multiple, and Budget. **Exact padding** opens a separate scrub row
for each side. Every row can take a link; linked controls dim, and their
values and links save with the workflow. The canvas remains available below
the card for dragging the borders.
Linked sides are controlled upstream; dragging their borders leaves the saved
padding value unchanged.

## The on-node canvas

- Each padded side shows its **"+N px"** count on the band; when the band is
  too thin to read, the label hops inside the image onto a pill. A side that
  **Multiple** trims shows **"−N px"** instead, with the cut-off strip of the
  image shaded.
- The badge in the corner is the truth: the **final output size** after the
  canvas-multiple and megapixel math, exactly what the `width`/`height`
  outputs will say.
- **Reset padding** appears in the top-right corner while there is padding
  to clear; it sets every side a link does not drive back to 0.
- Clicks on empty canvas space fall through, so the node still drags.
- The hidden `pad_left/top/right/bottom` widgets hold the real values — the
  canvas is their remote control, so undo, save/load, and the API format all
  see plain INT widgets.

## Guarantees

- The original pixels land **bit-identical** at their position (resized
  only when a megapixel target is set — and then resized *before* padding,
  so the mask seam stays one crisp pixel wide).
- No strip is ever added along edges you did not pad; see **Multiple**.
- The mask is `1.0` over every padded pixel and `0.0` over the source,
  ramped only where **feather** says so.

## Controls

- **Source** (`image`): Choose or upload from ComfyUI's input folder; the list previews the image under the pointer and filters as you type.
- **source_image** (optional socket): Wire an image from another node here
  and it is padded instead of the file; the Source row dims while the wire
  is connected. The canvas can only show a wired picture after a run, so it
  draws an outline until then, and afterwards the last image it padded at
  its true size. The padding applies to every image that arrives, so a
  loader that feeds one image per run pads a whole folder the same way.
- **Fill** / **Color** / **Backdrop** (`mode` / `fill_color` /
  `backdrop_blur`): Four fills — `color`, `edge`, `edge pixel`,
  `pillarbox blur`. **Color** shows for `color`, **Backdrop** for
  `pillarbox blur`.
- **feather**: Ramps the mask *inward* across the image edge on each padded
  side (ramp width capped by the image size), so the sampler blends the
  seam. `0` keeps the seam hard. The padding itself always stays solid.
- **Multiple** (`canvas_multiple`): The final canvas rounds to this
  multiple. The extra pixels join a side you padded (the right or bottom one
  when you padded both). If you padded neither left nor right, or neither
  top nor bottom, nothing is added there: a strip along an edge you left
  alone would be one more edge for the model to paint, and a thin one comes
  out flat and off-tone. With a **Budget** the source is scaled to fit
  instead, keeping its shape (with no padding at all, each side snaps on
  its own); without one it loses those few pixels, evenly from both edges,
  and the rest stays bit-identical.
- **Budget** (`target_megapixels`): `0` = off. Rescales the **source** so
  the padded canvas lands on this many megapixels, then re-rounds to the
  multiple — the way to outpaint a small or huge image at a sampler-friendly
  size.

## Outputs

- **image**: The padded canvas.
- **mask**: The outpaint mask (white = padding, feathered per `feather`).
- **width / height**: The final canvas size — the badge's numbers as INTs,
  for wiring into latent nodes.
- **stitcher**: Hand to **Stitch Inpaint 🆎** with the sampled result to
  keep only the new padding and restore the original pixels bit-identically
  — whatever the sampler did inside the source area is discarded. It also
  records where the source sits on the canvas, which **Krea 2 Outpaint
  Model Patch 🆎** reads to place the reference.
- **reference**: The source alone, no padding, fitted to a small multiple
  of 16 — the reference image for **Krea 2 Encode 🆎** and other
  reference conditioning. It is built on every run; leave it unconnected
  when nothing needs it.
