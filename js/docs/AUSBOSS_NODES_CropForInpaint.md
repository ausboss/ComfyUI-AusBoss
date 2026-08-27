# Crop For Inpaint

Cuts the masked region — plus enough surrounding context — out of an image
so an inpainting model works at the region's native resolution instead of
shrinking the whole frame. Pairs with **Stitch Inpaint 🆎**, which
pastes the result back exactly where it came from. The `extend_*` inputs
grow the frame itself, which is how the pair outpaints.

## Controls

- **image**: BHWC image or video frames to crop around the mask.
- **mask**: White marks the area to inpaint. A multi-frame mask is unioned
  into one crop window so a whole video shares one stitcher; an empty mask
  selects the full image (and stitches back unchanged).
- **context_factor**: Grows the mask bounding box symmetrically by this
  factor. The grown window is shifted back inside the frame first; only
  when it truly cannot fit is the image extended with edge-replicated
  padding.
- **blend_pixels**: Feather width used *only when pasting back*: the paste
  mask is widened by this many pixels and blurred. The sampling mask sent
  to the inpainter stays hard-edged, so feathering never weakens what the
  model sees. `0` pastes with the raw mask.
- **output_multiple**: Crop and target dimensions are rounded up to a
  multiple of this so samplers accept them.
- **target_width / target_height**: Rescale the crop to a fixed size for
  the sampler. `0` keeps the native crop size; setting only one dimension
  derives the other from the crop's aspect ratio. Explicit values here
  override `target_megapixels`.

### Shaping the mask

- **mask_grow**: Dilate the sampling mask by this many pixels (negative
  shrinks) so the inpainter repaints past the drawn edge. This reshapes
  what gets painted, unlike `blend_pixels`, which only feathers the
  paste-back.
- **mask_blur**: Gaussian sigma softening the sampling mask's edge, for
  models that honor soft masks. `0` keeps the hard edge.
- **invert_mask**: Inpaint the black area instead of the white area —
  everything outside the drawn region. Applied before growing or blurring.

### Sizing the crop

- **context_pixels**: Flat extra context in pixels added around the mask
  box after `context_factor`'s growth.
- **target_megapixels**: Rescale the crop for the sampler so its area is
  about this many megapixels — `1.0` suits SDXL-class models, `0` keeps
  the native crop size. Explicit `target_width`/`target_height` wins.
- **rescale_algorithm**: Resize filter for both directions of the sampler
  round trip. `bilinear` is the safe default, `bicubic` keeps upscales a
  touch crisper, `area` suits heavy downscales, `nearest` never invents
  pixels.

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
