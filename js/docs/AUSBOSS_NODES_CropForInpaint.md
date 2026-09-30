# Crop For Inpaint

Cuts the masked region — plus enough surrounding context — out of an image
so an inpainting model works at the region's native resolution instead of
shrinking the whole frame. Pairs with **Stitch Inpaint 🆎**, which
pastes the result back exactly where it came from. The **Extend** rows
(`extend_*`) grow the frame itself, which is how the pair outpaints.

## Controls

- **image**: BHWC image or video frames to crop around the mask.
- **mask**: White marks the area to inpaint. A multi-frame mask is unioned
  into one crop window so a whole video shares one stitcher; an empty mask
  selects the full image (and stitches back unchanged). A picture with no
  mask painted on it stops the run with "No mask painted" and how to paint
  one (core Load Image sends a small blank stand-in in that case).
- **Context** (`context_factor`): Grows the mask bounding box
  symmetrically by this factor. The grown window is shifted back inside the
  frame first. When it's bigger than the picture, **Stay in picture**
  decides what happens.
- **Stay in picture** (`keep_inside`, on by default): Keeps the crop inside
  the picture. When the context would reach past an edge (a big mask, or a
  small picture), the crop stops at that edge, so the model sees only real
  picture and, after a **Target** rescale, paints the new part larger and
  sharper. Off is the old behavior: the crop runs past the edge and the
  extra space is filled with stretched copies of the edge pixels. One catch
  with it on: the model sees more of what's around your mask and carries it
  on, so paint over leftovers at the mask's edge that you don't want kept.
- **Blend** (`blend_pixels`): Feather width used *only when pasting back*:
  the paste mask is widened by this many pixels and blurred. The sampling
  mask sent to the inpainter stays hard-edged, so feathering never weakens
  what the model sees. `0` pastes with the raw mask.
- **Multiple** (`output_multiple`): Crop and target dimensions are rounded
  up to a multiple of this so samplers accept them.
- **target_width / target_height**: Rescale the crop to a fixed size for
  the sampler. `0` keeps the native crop size; setting only one dimension
  derives the other from the crop's aspect ratio. Explicit values here
  override `target_megapixels`.

### Shaping the mask

- **Grow** (`mask_grow`): Dilate the sampling mask by this many pixels
  (negative shrinks) so the inpainter repaints past the drawn edge. This
  reshapes what gets painted, unlike `blend_pixels`, which only feathers the
  paste-back.
- **Blur** (`mask_blur`): Gaussian sigma softening the sampling mask's
  edge, for models that honor soft masks. `0` keeps the hard edge.
- **invert_mask**: Inpaint the black area instead of the white area —
  everything outside the drawn region. Applied before growing or blurring.

### Sizing the crop

On the card, the **Target size, extend** fold holds these rows,
**target_width / target_height** and the **Extend** rows.

- **Extra context** (`context_pixels`): Flat extra context in pixels added
  around the mask box after `context_factor`'s growth.
- **Target** (`target_megapixels`): Rescale the crop for the sampler so its
  area is about this many megapixels — `1.0` suits SDXL-class models, `0`
  keeps the native crop size. Explicit `target_width`/`target_height` wins.
- **Rescale** (`rescale_algorithm`): Resize filter for both directions of
  the sampler round trip. `bilinear` is the safe default, `bicubic` keeps
  upscales a touch crisper, `area` suits heavy downscales, `nearest` never
  invents pixels.

### Outpainting

- **extend_left / extend_right / extend_up / extend_down**: Grow the frame
  itself by this many pixels on that side, before anything else. The new
  bands are replicate-filled, added to the mask, and become part of the
  stitched output — draw nothing and the extended bands alone are
  inpainted.

## Outputs

- **image**: The cropped region, sized for the sampler.
- **mask**: The matching hard-edged sampling mask (soft only where
  `mask_blur` says so).
- **stitcher**: Everything Stitch Inpaint needs to put the result back.

## Wiring

```text
Load Image ── Crop For Inpaint ── image ──> LaMa Inpaint ── image ──> Stitch Inpaint
                   │  └── mask ─────────────────┘                          │
                   └── stitcher ───────────────────────────────────────────┘
```

Any inpainting sampler fits between the two nodes the same way — connect
the crop's `image` and `mask` to it, then its output to Stitch Inpaint's
`inpainted` input.
