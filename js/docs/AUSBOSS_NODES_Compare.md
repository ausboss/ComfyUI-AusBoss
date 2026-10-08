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

- **SLIDE** (default): the panel shows the result. Move the pointer across
  it to compare: A appears on the left of the line and B on the right. Move
  the pointer away and the result is back. Every new run shows its result
  too.
- **A** / **B**: turn sliding off and lock the selected preview. Clicking
  the same choice again keeps it locked; choose SLIDE to follow the pointer
  again. The three choices sit below the image.

The labels ride with the split line: **A** just left of it and **B** just right of
it, on the picture each one names. With one picture showing, its label sits alone
at the top centre. The chosen mode and locked side are
stored with the node, including support for modes from older workflows. The resolution
sits under the picture, beside the three mode buttons; differing sizes are
labeled individually.

## Which picture is the result

B, the "after" picture. If your graph makes A out of B's picture (B is the
picture you loaded and A is the edited one), the result is A. To keep one
picture up whatever happens, use the **A** or **B** button.

## Output

- **image_a**: The `image_a` batch, untouched.

Previews are written to ComfyUI's temp folder and vanish with it; nothing is
saved to the output folder and no network requests are made.

## Technical details

- While sliding, the outer 6% on either side snaps to a full image.
- The result is found from the links: when the node that feeds `image_b` is
  somewhere upstream of the node that feeds `image_a`, A was made from B and
  A is the result. When both pictures come out of one subgraph, the same
  check is made inside it. In every other case it is B: two unrelated
  pictures, both pictures out of one plain node, or a link the node cannot
  follow (a Set and Get pair, for example).
- Settings → AusBoss → Image Compare → **Rest on the result** switches this
  off. The panel then stays on the picture nearest to where the pointer
  left, and a new run does not change it.
