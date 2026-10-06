# Mask Refine

Cleans up a mask in one node: grow or shrink it, fill holes, smooth blocky
edges and soften the edge. Use it on a mask from a segmentation node or a
quick brush before the mask goes to an inpainter. It can also snap the edge
to a guide image and adjust the mask's levels. Both the refined mask and its
inverse are returned, so no separate invert node is needed.

The panel shows the refined mask itself once the node has run, so the effect
of a setting is visible without wiring a preview node beside it. With a batch
or a video it shows the first mask. The small
**preview** switch at the right of the bar above the picture turns it off:
the picture's box disappears, the node is that much shorter, and no preview
file is written. Turn it back on and the node returns to its height with the
last result in it; if the node ran while the switch was off, it asks you to
run the workflow again. The switch is the node's optional `preview` input.

## The buttons

- **AUTO** — reads the size of the mask on the panel and sets **Expand** and
  **Blur** to a sensible starting point for it. A feather is a fraction of the
  picture, not a fixed pixel count: the 8 px grow that covers a watermark's
  rim on a 576-tall clip is a smear on a thumbnail and invisible on a 4K
  plate, so the values scale with the mask's short edge. They are a starting
  point to nudge, not a correct answer — how far a mask has to grow depends on
  how tight the segmentation was, which nothing can read off the picture.
  Needs one run first, since that is when the panel learns the mask's size.
- **MORE** — the fold on the card under **Blur** shows or hides the advanced
  rows. The node opens on **Expand** and **Blur** alone; the rest are one
  click away. Hidden rows keep their values, so a workflow that set them is
  unaffected, and the choice is remembered per node.

## Controls

- **mask**: BHW mask; white is the selected area.
- **Expand** (`expand`): Pixels to grow (`+`) or shrink (`-`). Soft input values survive.
- **Blur** (`blur`): Gaussian feather strength in pixels; `0` keeps hard edges.

### Advanced (behind **MORE**)

- **Fill holes** (`fill_holes`): Fills fully enclosed gaps inside the mask before feathering.
  Gaps that touch the image border are left alone.
- **Max hole size** (`max_hole_size`): The biggest hole **Fill holes** fills,
  as a percent of the picture. Use it when you paint around something you
  want to keep: at `2`, the small gaps a quick brush leaves still fill, but a
  person, pet or object you left unpainted stays as it is. `0`, the default,
  fills every hole whatever its size. It only matters while **Fill holes** is
  on.
- **Smooth** (`smooth`): Melts staircase jaggies by this many pixels while keeping a
  hard edge — the mask is binarized, blurred, and re-binarized, so nothing
  is feathered. `0` is off. Use this on blocky segmentation output; use
  **Blur** when you actually want a soft edge.
- **Black point** / **White point** (`black_point` / `white_point`): Levels remap applied last. Values at or
  below `black_point` become fully black and values at or above `white_point`
  become fully white; the range between rescales linearly. Raise
  `black_point` a little to clear gray haze, lower `white_point` to solidify
  the core. The defaults (`0.0` / `1.0`) change nothing.
- **Edge** (`edge_refine`): `off`, **guided** (`guided filter`), or
  `matting`. Both refinements snap the mask edge to the connected
  **guide_image** and run per frame, so video batches stay interruptible:
  - `guided filter` — fast edge-aware filtering of the soft mask against the
    guide image. The filter radius scales with **Expand**.
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

- `guided filter` needs opencv-contrib: `python -m pip install opencv-contrib-python`
- `matting` needs pymatting: `python -m pip install "pymatting>=1.1"`

Run them with the Python that runs ComfyUI (for the Windows portable build,
`python_embeded\python.exe -m pip install ...`).

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

## Technical details

**Max hole size** measures each hole after **Expand** has moved the mask,
as a share of that picture's whole area, so the same setting works at any
resolution; in a batch every picture is judged on its own. A hole exactly
at the limit is filled. `100` and above fill every hole, the same as `0`.
An unpainted area that touches the picture's edge is never a hole, at any
setting, because the mask does not close around it.

On the test masks, at 0.25 to 16 megapixels, the gaps a quick brush left
between strokes and the spots it missed were at most 1.3% of the picture,
and the subjects left unpainted (a person, a dog, a shoe, a cat) at least
18%. A face kept on its own was 2.1% to 5.3%: `2` keeps a face from a
three-quarter shot or closer, while a face in a full-length shot is smaller
and would still fill. A very loose hand with a big brush can leave long
bands between strokes that pass 2%: raise the setting, or paint over them.
