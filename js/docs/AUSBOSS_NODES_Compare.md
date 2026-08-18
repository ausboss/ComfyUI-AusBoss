# Image Compare A/B

Shows two images on one panel so differences pop out instead of hiding in a
side-by-side. The first frame of each batch is previewed; `image_a` passes
through the output unchanged, so the node can sit in the middle of a graph
without breaking anything downstream.

## Inputs

- **image_a**: The baseline batch. Its first frame is preview A, and the
  whole batch is what the output carries.
- **image_b**: The comparison batch. Its first frame is preview B.

## Panel

Run the workflow once to load the previews, then compare:

- **SLIDE** (default): move the pointer across the panel. B is revealed up
  to the pointer with a thin seam marking the split.
- **A / B**: a toggle. Each click swaps the whole panel between the two, and
  the button's label says which one you are looking at. Clicking it from
  slide mode selects it and lands on B, since seeing the other one is the
  reason to reach for it. Flicking back and forth in place is the way to
  catch a small change; the eye spots it far better than a moving seam does.

The chosen mode is stored with the node. Nothing is drawn over the picture —
the compared resolution sits in a caption centred beneath the panel, and if
the two sides are different sizes both are named there, since the panel
scales them to fit and nothing else on screen would reveal it.

## Output

- **image_a**: The `image_a` batch, untouched.

Previews are written to ComfyUI's temp folder and vanish with it; nothing is
saved to the output folder and no network requests are made.
