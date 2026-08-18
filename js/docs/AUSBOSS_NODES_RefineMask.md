# Mask Refine

Cleans up a segmentation mask in one pass: grow or shrink the coverage,
optionally fill enclosed holes, melt staircase jaggies, feather the edge,
optionally snap the edge to a guide image, then remap the levels. Both the
refined mask and its inverse are returned, so no separate invert node is
needed.

The panel shows the refined mask itself once the node has run, so the effect
of a setting is visible without wiring a preview node beside it.

## The panel buttons

- **AUTO** — reads the size of the mask on the panel and sets **expand** and
  **blur** to a sensible starting point for it. A feather is a fraction of the
  picture, not a fixed pixel count: the 8 px grow that covers a watermark's
  rim on a 576-tall clip is a smear on a thumbnail and invisible on a 4K
  plate, so the values scale with the mask's short edge. They are a starting
  point to nudge, not a correct answer — how far a mask has to grow depends on
  how tight the segmentation was, which nothing can read off the picture.
  Needs one run first, since that is when the panel learns the mask's size.
- **MORE / LESS** — shows or hides the advanced controls below. The node opens
  on **expand** and **blur** alone; the rest are one click away. Hidden
  widgets keep their values, so a workflow that set them is unaffected, and
  the choice is remembered per node.

## Controls

- **mask**: BHW mask; white is the selected area.
- **expand**: Pixels to grow (`+`) or shrink (`-`). Soft input values survive.
- **blur**: Gaussian feather strength in pixels; `0` keeps hard edges.

### Advanced (behind **MORE**)

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
