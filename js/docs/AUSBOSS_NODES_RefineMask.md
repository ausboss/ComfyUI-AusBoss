# Refine Mask

Cleans up a segmentation mask in one pass: grow or shrink the coverage,
optionally fill enclosed holes, melt staircase jaggies, feather the edge,
optionally snap the edge to a guide image, then remap the levels. Both the
refined mask and its inverse are returned, so no separate invert node is
needed.

## Controls

- **mask**: BHW mask; white is the selected area.
- **expand**: Pixels to grow (`+`) or shrink (`-`). Soft input values survive.
- **blur**: Gaussian feather strength in pixels; `0` keeps hard edges.
- **fill_holes**: Fills fully enclosed gaps inside the mask before feathering.
  Gaps that touch the image border are left alone.
- **smooth**: Melts staircase jaggies by this many pixels while keeping a
  hard edge — the mask is binarized, blurred, and re-binarized, so nothing
  is feathered. `0` is off. Use this on blocky segmentation output; use
  **blur** when you actually want a soft edge.
- **black_point** / **white_point**: Levels remap applied last. Values at or
  below `black_point` become fully black and values at or above `white_point`
  become fully white; the range between rescales linearly. Raise
  `black_point` a little to clear gray haze, lower `white_point` to solidify
  the core. The defaults (`0.0` / `1.0`) change nothing.
- **edge_refine**: `off`, `guided filter`, or `matting`. Both refinements
  snap the mask edge to the connected **guide_image** and run per frame, so
  video batches stay interruptible:
  - `guided filter` — fast edge-aware filtering of the soft mask against the
    guide image. The filter radius scales with **expand**.
  - `matting` — closed-form alpha matting: the binarized mask eroded by the
    edge radius counts as definite foreground, the dilation marks where
    definite background begins, and the band between is solved against the
    guide image. Pair it with the levels remap to tidy the solved alpha.
- **guide_image** (optional input): RGB frames the mask belongs to, matching
  the mask's size; one frame is broadcast across a mask batch. Required when
  `edge_refine` is not `off`.

## Optional installs

Everything above runs on the pack's stock dependencies except the two
`edge_refine` tiers:

- `guided filter` needs opencv-contrib: `pip install opencv-contrib-python`
- `matting` needs pymatting: `pip install pymatting`

They are listed in the pack's `pyproject.toml` under
`[project.optional-dependencies]` as the `guided-filter` and `matting`
groups. Without the install, selecting that tier fails with a message naming
the missing package; the rest of the node is unaffected.

## Outputs

- **mask**: The refined BHW mask.
- **mask_inverted**: `1 - mask`, for operations that target the background.

Operations run in a fixed order — expand, fill holes, smooth, blur, edge
refine, black/white point — so feathered edges are never re-hardened by a
later step and the levels remap always cleans the final result.
