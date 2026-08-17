# Load Image + Pad

Loads an image and builds an outpaint canvas around it in one node. The
canvas drawn on the node is the control: **drag any edge of the dashed
final rect** to grow that side's padding — the whole edge is the handle,
and corners grab the nearer edge. The second output is a mask covering
exactly the padding, ready for an inpainter.

## The on-node canvas

- Each padded side shows its **"+N px"** count on the band; when the band is
  too thin to read, the label hops inside the image onto a pill.
- The badge in the corner is the truth: the **final output size** after the
  canvas-multiple and megapixel math, exactly what the `width`/`height`
  outputs will say.
- Clicks on empty canvas space fall through, so the node still drags.
- The hidden `pad_left/top/right/bottom` widgets hold the real values — the
  canvas is their remote control, so undo, save/load, and the API format all
  see plain INT widgets.

## Guarantees

- The original pixels land **bit-identical** at their position (resized
  only when a megapixel target is set — and then resized *before* padding,
  so the mask seam stays one crisp pixel wide).
- The mask is `1.0` over every padded pixel and `0.0` over the source,
  ramped only where **feather** says so.

## Controls

- **image**: Choose or upload from ComfyUI's input folder.
- **mode / fill_color / backdrop_blur**: The same four fills as
  **Pad Image 🆎** — `color`, `edge`, `edge pixel`, `pillarbox blur`.
- **feather**: Ramps the mask *inward* across the image edge on each padded
  side (ramp width capped by the image size), so the sampler blends the
  seam. `0` keeps the seam hard. The padding itself always stays solid.
- **canvas_multiple**: The final canvas rounds up to this multiple; the
  remainder joins the right and bottom padding.
- **target_megapixels**: `0` = off. Rescales the **source** so the padded
  canvas lands on this many megapixels, then re-rounds to the multiple —
  the way to outpaint a small or huge image at a sampler-friendly size.

## Outputs

- **image**: The padded canvas.
- **mask**: The outpaint mask (white = padding, feathered per `feather`).
- **width / height**: The final canvas size — the badge's numbers as INTs,
  for wiring into latent nodes.
