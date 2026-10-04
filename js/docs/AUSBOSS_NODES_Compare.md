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

- **SLIDE** (default): move the pointer across the panel. A appears on the
  left of the seam and B on the right. The outer 6% on either side snaps to
  a full image. Leaving the preview in any direction settles to the nearest
  edge, including when you leave through the top or bottom.
- **A** / **B**: turn sliding off and lock the selected preview. Clicking
  the same choice again keeps it locked; choose SLIDE to follow the pointer
  again. The three choices sit below the image.

The labels ride with the split line: **A** just left of it and **B** just right of
it, on the picture each one names. With one picture showing, its label sits alone
at the top centre. The chosen mode and locked side are
stored with the node, including support for modes from older workflows. The resolution
sits beneath the panel; differing sizes are labeled individually.

## Output

- **image_a**: The `image_a` batch, untouched.

Previews are written to ComfyUI's temp folder and vanish with it; nothing is
saved to the output folder and no network requests are made.
