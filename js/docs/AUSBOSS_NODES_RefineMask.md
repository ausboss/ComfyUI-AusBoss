# Refine Mask

Cleans up a segmentation mask in one pass: grow or shrink the coverage,
optionally fill enclosed holes, then feather the edge. Both the refined mask
and its inverse are returned, so no separate invert node is needed.

## Controls

- **mask**: BHW mask; white is the selected area.
- **expand**: Pixels to grow (`+`) or shrink (`-`). Soft input values survive.
- **blur**: Gaussian feather strength in pixels; `0` keeps hard edges.
- **fill_holes**: Fills fully enclosed gaps inside the mask before feathering.
  Gaps that touch the image border are left alone.

## Outputs

- **mask**: The refined BHW mask.
- **mask_inverted**: `1 - mask`, for operations that target the background.

Operations run in a fixed order — expand, fill holes, blur — so feathered
edges are never re-hardened by a later step.
