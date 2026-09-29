# Realign to Source (EXPERIMENTAL)

Lines an edited picture back up with the original.

Qwen Image 2.1 often draws an edit slightly zoomed in or shifted, especially
style changes like watercolor or anime. Lay the edit over the original and
it no longer matches: the horizon sits lower, a face is a little bigger.
This node measures how far the edit moved and moves it back.

## Quick start

1. Wire the edit into `edited` and the original picture into `source`.
2. For the best result, add a margin before editing: pad the picture with
   **Load Image + Pad 🆎** (`mirror` fill, 64 px a side), edit the padded
   picture, and plug its `stitcher` in here. The edit then has room to move,
   and you get your picture back with real picture all the way to the
   edges.
3. Wire `report` into **Show Text 🆎** to see what it found.

Using the Qwen Image 2.1 consistency LoRA? Skip the margin: the LoRA already
keeps the edit in place, and this node trims what's left.

**Experimental:** tested on Qwen Image 2.1 edits. The settings keep their
names from here on; how it measures may still improve.

## What it fixes, and what it doesn't

- **Fixes:** the whole picture drawn zoomed in or shifted. Horizons, posts
  and faces land back where they were.
- **Doesn't fix:** things the edit redrew in a new spot. A watercolor that
  moved a boat keeps the boat where it drew it, so the result lines up
  closely, not pixel for pixel.
- **Leaves alone:** a picture it can't measure, or a zoom bigger than
  **Max zoom**. That picture only comes out resized, and the report says
  why.

## Controls

- **edited**: the edited picture.
- **source**: the original picture you edited, at the size the edit model
  saw it (in the Qwen Image 2.1 Edit + Realign example, the Image Resize
  output). The result comes out at this size.
- **stitcher** (optional): from Load Image + Pad 🆎 when you padded the
  picture before editing. Image Crop + Rotate + Pad 🆎 works too.
- **Fit**: `zoom + shift` (the default) fixes the usual Qwen drift.
  `affine` also fixes a slight tilt.
- **Empty fill**: when the edit slid past the edge, a thin strip ends up
  with nothing in it. `edge` (the default) stretches the nearest pixels
  into it, `source` fills it from the original, `gray` fills it flat gray
  for inpainting. With a big enough margin there is no strip.
- **Max zoom**: the biggest zoom it will undo, in percent (20 by default).
  Anything bigger is treated as a change you meant and left alone.

## Outputs

- **image**: the edit, lined up with the original and at its size.
- **empty_mask**: white where the lined-up edit has nothing (a strip that
  slid off the edge), black everywhere else. Crop the strip off or inpaint
  it.
- **report**: one line on what it found, for example
  `realigned: zoom x -0.25%, y +5.24%; shift x +1.0, y +30.1 px; worst corner 61.1 px (142 of 162 areas agree, fit error 3.2 px); warped once; empty strip 5.0% of the frame; to keep real picture there, pad the source before editing: bottom 77 px`
  - **zoom** and **shift**: how much bigger the edit was drawn, and how far
    it had moved.
  - **worst corner**: how far the corner that moved most had moved, in
    pixels.
  - `cut out whole, no resampling`: the edit only needed sliding back, so
    its pixels are untouched. `warped once`: it also needed resizing, done
    in one step.
  - **empty strip**: how much of the picture ended up with nothing in it.
    When it names a side and pixels, pad that side by that much next time.

## Why it happens

Qwen Image 2.1 redraws a broad edit with slightly different proportions.
Watercolor, anime and oil edits come back about 4% taller on average and up
to 12%: 30-40 px at the edges of a 1 MP picture, up to 90. It changes with
the seed and the prompt, and snapping sizes to 32, 64 or 112 does not help.
Light edits (a colour change, "keep it the same") hold within 0.4%. Keep the
sampler on the Qwen encoder's own `latent` output too: a canvas of another
size makes the model shrink the whole picture to fit, which is a separate
zoom this node is not meant to undo.

## Tips

- Feed `source` the same picture the edit model saw (or plug in its
  stitcher), and keep the sampler on the Qwen encoder's own `latent` output.
- **With the consistency LoRA:** no margin needed.
- **Without it:** pad 64 px a side with Load Image + Pad's `mirror` fill
  and plug in the stitcher. Mirror padding looks like more of the scene;
  flat gray or stretched edge pixels look like a border, and the model is
  more likely to zoom in to fill it. A 64 px margin costs about 27% more
  render time at 1 MP.
- Every seed drifts differently. If the empty strip is too wide, another
  seed often drifts less.
- On light edits (a colour change, a small fix), a zoom under 0.5% in the
  report means the model held still.

## Technical details

The rest of this page is for people who want to know how it works and how
it was tested.

### How it measures

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

### Measured

- **Planted drifts** (zoom up to 12% per axis, shifts, a slight rotation
  with affine, restyled copies, edits at another resolution; with a margin,
  a reframe of 27-33% that nearly fills the canvas): recovered within about
  0.1 px at the corners, 0.2 px on the reframe. Without the coarse pass's
  zoom tries, a 30% zoom was lost (137 px off); with them it is found.
- **166 real Qwen Image 2.1 edits** of four pictures: 164 measured. The
  two it left alone were sampled on a 1024x1024 canvas for an 832x1216
  picture (the wrong-canvas squeeze), and the report names that. Re-measured
  by a separate estimator after realigning, the worst corner of the 94 style
  edits went from 35.5 px to 4.6 px (median); light edits from 2.1 px to
  0.1 px.
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

  Mirror padding made the model zoom in more than 8% to fill the canvas on
  2 of 16 edits, against 7 with edge pixels and 5 with gray (it once painted
  the gray as a watercolor's paper margin). With the LoRA, a margin still
  tempted one edit into zooming, and the unpadded LoRA path is the most
  precise, which is why the Tips say no margin with the LoRA.
