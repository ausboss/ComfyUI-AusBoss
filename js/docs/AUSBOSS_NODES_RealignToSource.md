# Realign to Source (EXPERIMENTAL)

Undoes the zoom and shift an edit model adds to a broad edit. Wire the edit
into `edited` and the picture it was made from into `source`: the node
measures where the edit's content sits against the source and warps the
edit back onto the source's frame, at the source's size, in one resample.

**Experimental.** It is measured on Qwen Image 2.1 edits and planted drifts,
not yet on other edit models. Its sockets and settings keep their names from
here on; how it measures may still improve.

## Why

Qwen Image 2.1 redraws a broad edit with slightly different proportions.
Watercolor, anime and oil edits come back about 4% taller on average and up
to 12%: 30-40 px at the edges of a 1 MP picture, up to 90. It changes with
the seed and the prompt, and snapping sizes to 32, 64 or 112 does not help.
Light edits (a colour change, "keep it the same") hold within 0.4%. Sampling
on the Qwen encoder's own `latent` output matters too: a canvas of another
size makes the model shrink the whole picture to fit inside it, which is a
separate zoom this node is not meant to undo.

## What it fixes, and what it doesn't

- **Fixes:** the whole-frame zoom (separately across and down) and shift,
  so the edit sits on the source's frame again: horizons, posts and faces
  land back where they were.
- **Doesn't fix:** shapes a restyle redrew in a new place. A watercolor that
  moved a boat or widened a face keeps that change, so the result lines up
  closely, not pixel for pixel.
- **Leaves alone:** a frame it cannot measure, such as a picture with too
  little shared structure, a zoom past **Max zoom**, or an edit made on a
  canvas of another shape. That frame is only scaled to the source's size,
  its `empty_mask` is all black, and `report` says why.

## Controls

- **edited**: The edit, at any size. It is compared as if scaled to the
  source's exact size, which also undoes the Qwen 2.1 encoder's stretch to
  its 32 px grid. An alpha channel is ignored; the output is RGB.
- **source**: The picture the edit was made from, at the size the model saw
  it (in the Qwen Image 2.1 Edit + Realign example, the Image Resize
  output). One frame, or one per edited frame. The result comes out at this
  size.
- **Fit** (`fit`):
  - **zoom + shift**: a horizontal and a vertical zoom plus a shift, which
    is how Qwen edits drift. The default.
  - **affine**: also a slight rotation or shear.
- **Empty fill** (`empty_fill`): what the strip with no content shows. The
  model pushed that strip out of view, so the edit has nothing for it.
  - **edge**: stretches the nearest edge pixels. The default.
  - **source**: the original's pixels.
  - **gray**: flat `#808080`, for an inpaint pass.
- **Max zoom** (`max_zoom`): the largest zoom, in percent, it will undo;
  `20` by default. Past it the edit most likely changed the framing on
  purpose, so the frame is left as it is.

## Outputs

- **image**: The edit on the source's frame, at the source's size.
- **empty_mask**: White where the realigned edit has no content: the strip
  the model pushed out of view, along the top and bottom for a vertical
  stretch. On the style edits measured it was 4.4% of the frame at the
  median and 10.5% at the 90th percentile. Crop it off or inpaint it. All
  black for a frame that was left as it is.
- **report**: One line per frame (prefixed `frame N:` for a batch). The
  watercolor in the Qwen Image 2.1 Edit + Realign example reads
  `realigned: zoom x +0.46%, y +6.64%; shift x +0.1, y +0.9 px; worst corner 41.3 px (59 of 150 areas agree, fit error 3.3 px); empty strip 6.7% of the frame`.
  The zoom is per axis, the shift is measured at the picture's centre, and
  the worst corner is how far the worst of the four corners had moved.
  Wire it to **Show Text 🆎** to read it.

## How it measures

Both pictures become edge maps (gradient strength, normalised by its
surroundings), so a restyle, a relight or inverted tones still line up.
Blocks are compared by band-limited phase correlation: first at 256 px on
the long side to find the drift, then twice at 768 px after warping the edit
by the estimate, so the blocks are compared at the same scale. A robust fit
turns the block shifts into the zoom and shift; blocks that disagree with it
by more than a few pixels (8 at most), such as a redrawn boat or a new cloud,
are left out. It trusts the fit when at least 10 blocks, and at least a
quarter of them, agree.

It runs on the CPU in a fraction of a second per 1 MP frame. No new
dependencies, and no model.

## Tips

- Keep the sampler on the Qwen encoder's `latent` output, and feed the same
  picture the encoder saw into `source`.
- The drift changes with every seed. If the empty strip is too wide to
  crop, another seed often drifts less.
- The report is worth a glance on light edits: a zoom under 0.5% means the
  model held the frame and the node changed next to nothing.

## Measured

- **Planted drifts** (zoom up to 12% per axis, shifts, a slight rotation
  with affine, restyled copies, edits at another resolution): recovered
  within about 0.1 px at the corners.
- **166 real Qwen Image 2.1 edits** of four pictures at the Qwen 2.1 Edit
  example's settings: 164 measured. The two it left alone were sampled on a
  1024x1024 canvas for an 832x1216 picture (the wrong-canvas squeeze), and
  the report names that. Re-measured by a separate estimator after
  realigning, the worst corner of the 94 style edits went from 35.5 px to
  4.6 px (median); light edits from 2.1 px to 0.1 px.
