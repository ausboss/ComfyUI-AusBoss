# Crop For Inpaint

Cuts the masked region — plus enough surrounding context — out of an image
so an inpainting model works at the region's native resolution instead of
shrinking the whole frame. Pairs with **Stitch Inpaint (AusBoss)**, which
pastes the result back exactly where it came from.

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
  derives the other from the crop's aspect ratio.

## Outputs

- **image**: The cropped region, sized for the sampler.
- **mask**: The matching hard-edged sampling mask.
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
