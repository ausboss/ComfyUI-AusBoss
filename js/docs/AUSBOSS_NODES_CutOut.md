# Cut Out

Turns a picture and a mask into a cut-out with a see-through background.
Use it to save a subject as a transparent PNG, or to lay it on a new
background. It goes after the node that makes the mask, such as Mask by
Name or Mask by Touch. In a Qwen Image cut-out workflow, where SAM 3 finds a
thing and Qwen paints it out of the picture, Cut Out turns the same mask and
the original picture into the transparent PNG.

**Clean edges** fixes the rim of old background colour that a cut-out
usually carries in hair and soft edges, so it sits cleanly on any new
background. Parts of the picture that are fully kept stay exactly as they
were.

Save Image keeps the transparency when it saves a PNG (or WebP). JPEG has no
transparency, so a JPEG shows the clear parts black.

The panel under the card shows the cut-out over a checkerboard once the
node has run (the first frame for a video). The small **preview** switch at
the right of the bar turns it off.

## Live preview

Once the node has a picture, the picture on the node redraws while you drag a
value, before you queue anything. Run the graph once to give the node its
picture (run once to get the picture and the mask); after that it changes as you drag. A small "not run yet" tag
shows while the picture is a preview and not a real result.

The **Fit | 100%** switch sits on the bar above the picture, left of Preview.
Fit shows the whole picture. 100% shows real pixels, and dragging on the
picture moves around it instead of moving the node. The cut-out shows over a checker, so see-through parts read as see-through.


## Controls

- **Keep** (`keep`): **white part** keeps what is under the white of the
  mask, **black part** keeps what is under the black. Pick black part when
  your mask covers the background rather than the subject.
- **Grow** (`grow`): grows the kept part by this many pixels, or shrinks it
  with a negative number. Shrink by 1 or 2 when a thin line of old
  background shows around the edge.
- **Feather** (`feather`): how soft the edge is, in pixels. `0` keeps the
  mask's own edge. `1` takes the jagged steps off a hard mask.
- **Clean edges** (`clean_edges`): on by default. Works out the subject's
  own colour where the edge is see-through (hair, fur, motion blur) and
  puts it back, so the old background does not show as a halo. Turn it off
  to keep the picture's colours everywhere.

### Behind **More**

- **Clear haze** (`clear_haze`): parts this see-through or more become fully
  clear. Raise it a little (`0.05`) when a faint haze surrounds the cut-out.
- **Solid above** (`solid_above`): parts at least this solid become fully
  solid. Lower it a little (`0.95`) to fill thin see-through spots inside
  the subject.
- **Smooth video** (`smooth_frames`): for a video, blends each frame's edge
  with this many frames before and after it, which calms an edge that
  flickers from frame to frame. `0` is off. Keep it low (`1` or `2`) on
  fast motion, or the edge lags behind the subject.

### Inputs and outputs

- **image**: the picture or video frames.
- **mask**: what to keep. One mask can cover every frame, or give one per
  frame. A mask of another size is stretched to the picture.
- **image** (output): the cut-out as an RGBA picture with straight (not
  premultiplied) alpha. If the input already had a transparent background,
  both are kept.
- **alpha** (output): how solid each pixel is, as a mask: white is kept,
  black is clear. Wire it to any node that wants the final mask.

## Technical details

- The alpha is made in a fixed order: pick the white or black part, grow or
  shrink (whole pixels), feather (a Gaussian blur of that many pixels),
  average over neighbouring frames, then the levels (Clear haze and Solid
  above). Values within 0.0001 of solid or clear are made exactly solid or
  clear.
- Clean edges uses blur-fusion foreground estimation (Forte and Pitie,
  "Approximate Fast Foreground Colour Estimation", ICIP 2021), written in
  torch for this pack and shared with Mask by Touch's fine edges: around
  each pixel it averages the subject's colour and the background's from the
  pixels nearby, corrects the subject's by what the pixel shows, and does
  this once wide and once narrow. The widths follow the picture's size. It
  needs no extra package. Pixels with an alpha of exactly 1 keep their
  original colours to the bit.
- Frames are worked on eight at a time.

### Live preview

The preview runs the node's own maths in the browser: on a copy shrunk to the
size it is shown at in Fit, and on a real-pixel crop of the picture in 100%.
It is checked against the Python node on recorded values (`tests/test_live_parity.py`);
results agree to within 5e-5 on a 0 to 1 scale. The picture is the one the
last run kept, or a Load Image read through ComfyUI's own view route. When
the values match the last run, the real result is drawn instead.
