# Realign to Source (EXPERIMENTAL)

Undoes the zoom and shift an edit model adds to a broad edit. Wire the edit
into `edited` and the picture it was made from into `source`: the node
measures where the edit's content sits against the source and puts the edit
back on the source's frame, at the source's size. A drift that is a
whole-pixel shift is cut straight out of the edit with no resampling; any
other drift is undone in one resample.

Give it a margin for the best result: pad the picture with **Load Image +
Pad 🆎** (`mirror` fill) before the edit and wire its `stitcher` here. The
model then has room to drift, and the node returns just the picture's area,
with real picture right up to the edges instead of an empty strip.

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

Undoing a zoom-out-of-view on an edit made at the picture's own size leaves
a strip with no content: the model pushed that part of the picture past the
canvas edge. A margin gives it somewhere to go.

## What it fixes, and what it doesn't

- **Fixes:** the whole-frame zoom (separately across and down) and shift,
  so the edit sits on the source's frame again: horizons, posts and faces
  land back where they were. That includes a model that zoomed in to fill a
  padded canvas.
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
  size. With a stitcher, the picture before padding; wiring the padded
  canvas itself also works, and then the result is the picture's area of
  it.
- **Fit** (`fit`):
  - **zoom + shift**: a horizontal and a vertical zoom plus a shift, which
    is how Qwen edits drift. The default.
  - **affine**: also a slight rotation or shear.
- **Empty fill** (`empty_fill`): what the strip with no content shows. The
  model pushed that strip out of view, so the edit has nothing for it. With
  a big enough margin there is no strip.
  - **edge**: stretches the nearest edge pixels. The default.
  - **source**: the original's pixels.
  - **gray**: flat `#808080`, for an inpaint pass.
- **Max zoom** (`max_zoom`): the largest zoom, in percent, it will undo;
  `20` by default. Past it the edit most likely changed the framing on
  purpose, so the frame is left as it is. On a padded canvas, the zoom that
  just fills the canvas does not count toward it: that is the model
  reframing the picture it was given.
- **stitcher** (optional socket): the stitcher of the padded canvas the edit
  was made on, from Load Image + Pad 🆎 (Image Crop + Rotate + Pad 🆎 works
  too: its crop rectangle is the area returned). The drift is measured
  inside the picture's area only, since the padding is made up, and just
  that area comes back.

## Outputs

- **image**: The edit on the source's frame, at the source's size. Cut out
  whole when the drift is within half a pixel of a whole-pixel shift over
  the entire frame (an edit that already lines up comes back untouched),
  else warped once.
- **empty_mask**: White where the realigned edit has no content: the strip
  the model pushed out of view, along the top and bottom for a vertical
  stretch. Without a margin it was 4.4% of the frame at the median on the
  style edits measured; with a 64 px mirror margin it was 0 on all but one
  of 16. Crop it off or inpaint it. All black for a frame that was left as
  it is.
- **report**: One line per frame (prefixed `frame N:` for a batch). A
  watercolor of a 864x1184 picture, made at its own size:
  `realigned: zoom x -0.25%, y +5.24%; shift x +1.0, y +30.1 px; worst corner 61.1 px (142 of 162 areas agree, fit error 3.2 px); warped once; empty strip 5.0% of the frame; to keep real picture there, pad the source before editing: bottom 77 px`.
  The same edit on a 64 px mirror margin, with the stitcher wired:
  `realigned: zoom x -0.05%, y +5.63%; shift x +0.7, y +30.5 px; worst corner 63.8 px (120 of 128 areas agree, fit error 2.6 px); warped once; empty strip 0.0% of the frame`.
  The zoom is per axis, the shift is measured at the picture's centre, and
  the worst corner is how far the worst of the four corners had moved. When
  the edit ran out of picture, it names the margin each side needed, with
  16 px of headroom since the next seed drifts differently. Wire it to
  **Show Text 🆎** to read it.

## How it measures

Both pictures become edge maps (gradient strength, normalised by its
surroundings), so a restyle, a relight or inverted tones still line up.
Blocks are compared by band-limited phase correlation: first at 256 px on
the long side to find the drift, then twice at 768 px after warping the edit
by the estimate, so the blocks are compared at the same scale. The first
pass also tries the edit at a few zooms (0.86x to 1.28x) when it doesn't
line up as it is, so a large zoom such as a reframe is found too. A robust
fit turns the block shifts into the zoom and shift; blocks that disagree
with it by more than a few pixels (8 at most), such as a redrawn boat or a
new cloud, are left out. It trusts the fit when at least 10 blocks, and at
least a quarter of them, agree. With a stitcher, the blocks tile the
picture's area only.

It runs on the CPU in a fraction of a second per 1 MP frame. No new
dependencies, and no model.

## Tips

- Keep the sampler on the Qwen encoder's `latent` output, and feed the same
  picture the encoder saw into `source` (or its stitcher).
- **With the Qwen Image 2.1 consistency LoRA**, skip the margin: the LoRA
  keeps the frame on its own, this node trims what is left (0.06 px at the
  median on the edits below), and the strip stays thin (0.2% of the frame at
  the median, 2.7% at worst). A margin can tempt even the LoRA into
  reframing now and then.
- **Without it**, pad 64 px a side with Load Image + Pad's `mirror` fill and
  canvas multiple 32, and wire the stitcher. Mirror padding reads as more of
  the scene. Edge-pixel streaks and flat gray read as a border: the model
  zoomed in more than 8% to fill the canvas on 7 and 5 of 16 edits, against
  2 of 16 with mirror, and once painted the gray as a watercolor's paper
  margin. At 1 MP a 64 px margin is about 27% more pixels to sample.
- The drift changes with every seed. If the empty strip is too wide to
  crop, another seed often drifts less.
- The report is worth a glance on light edits: a zoom under 0.5% means the
  model held the frame, and a drift under half a pixel comes back cut out
  whole, untouched.

## Measured

- **Planted drifts** (zoom up to 12% per axis, shifts, a slight rotation
  with affine, restyled copies, edits at another resolution; with a margin,
  a reframe of 27-33% that nearly fills the canvas): recovered within about
  0.1 px at the corners, 0.2 px on the reframe. Without the coarse pass's
  zoom tries, a 30% zoom was lost (137 px off); with them it is found.
- **166 real Qwen Image 2.1 edits** of four pictures at the Qwen 2.1 Edit
  example's settings: 164 measured. The two it left alone were sampled on a
  1024x1024 canvas for an 832x1216 picture (the wrong-canvas squeeze), and
  the report names that. Re-measured by a separate estimator after
  realigning, the worst corner of the 94 style edits went from 35.5 px to
  4.6 px (median); light edits from 2.1 px to 0.1 px.
- **Margins, 16 held-out edits** (12 restyles, 4 light edits; each at one
  seed with a 64 px margin, realigned, then re-measured against the
  source):

  | setup | worst corner before (median) | after (median / worst) | frames with an empty strip |
  |---|---|---|---|
  | no margin | 40.0 px | 0.10 / 5.8 px | 13 of 16 |
  | mirror margin | 24.0 px | 0.42 / 5.6 px | 1 of 16 |
  | edge-pixel margin | 61.2 px | 0.52 / 5.5 px | 6 of 16 |
  | gray margin | 43.1 px | 0.81 / 9.1 px | 5 of 16 |
  | consistency LoRA, no margin | 1.5 px | 0.06 / 0.4 px | 10 of 16 (0.2% median, 2.7% worst) |
  | consistency LoRA + mirror margin | 1.8 px | 0.31 / 3.4 px | 0 of 16 |
