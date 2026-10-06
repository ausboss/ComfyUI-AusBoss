# Crop For Inpaint

Cuts out the part of a picture you masked, with some of what is around it, so
the model repaints just that part at full detail instead of the whole picture
shrunk down. Use it with **Stitch Inpaint 🆎**, which pastes the result back
exactly where it came from. The **Extend** rows (`extend_*`) add new space on a
side of the picture, which is how the pair outpaints.

## Controls

- **image**: BHWC image or video frames to crop around the mask.
- **mask**: White marks the area to inpaint. A multi-frame mask is unioned
  into one crop window so a whole video shares one stitcher; an empty mask
  selects the full image (and stitches back unchanged). A picture with no
  mask painted on it stops the run with "No mask painted" and how to paint
  one (core Load Image sends a small blank stand-in in that case). A mask
  of another size than the picture also stops the run, and the message
  gives both sizes.
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
- **Target width / Target height** (`target_width` / `target_height`, in
  the **Target size, extend** fold): Rescale the crop to a fixed size for
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
- **Invert mask** (`invert_mask`): Inpaint the black area instead of the
  white area — everything outside the drawn region. Applied before growing
  or blurring.

### Sizing the crop

On the card, the **Target size, extend** fold holds these rows,
**Target width / Target height** and the **Extend** rows.

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

- **Extend left / Extend right / Extend up / Extend down** (`extend_left` /
  `extend_right` / `extend_up` / `extend_down`): Grow the picture itself by
  this many pixels on that side. The new bands are filled with stretched
  copies of the edge pixels, are always painted (even with **Invert mask**
  on), and become part of the stitched output — draw nothing and the
  extended bands alone are inpainted.

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

## Technical details

- Starting values: Context `1.2`, Blend `16` px, Multiple `8`; Grow, Blur,
  Extra context, the Target rows and the Extend rows start at `0`.
- With no Target size set, the crop is still rounded up to **Multiple**, so
  with **Stay in picture** on it can still reach a few pixels (at most
  Multiple - 1) past an edge.
