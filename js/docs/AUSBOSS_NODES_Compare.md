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

- **Slide** (default): move the pointer across the panel. B is revealed up
  to the pointer with a thin seam marking the split.
- **Hold**: press and hold anywhere on the panel to see B in full; release
  to snap back to A.

The button in the panel's corner switches between the two modes, and the
choice is stored with the node.

## Output

- **image_a**: The `image_a` batch, untouched.

Previews are written to ComfyUI's temp folder and vanish with it; nothing is
saved to the output folder and no network requests are made.
