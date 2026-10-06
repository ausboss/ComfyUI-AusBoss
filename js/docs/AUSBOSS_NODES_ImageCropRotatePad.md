# Image Crop + Rotate + Pad

Loads a picture and lets you turn it, crop it and add empty space around it, by
dragging handles on the node. Use it to frame a picture for a model, or to add
space around a picture that the model then fills in (outpainting).

The picture is turned first, then cropped, then padded. The node also makes the
**mask** that tells the model where to paint, and a **stitcher** that puts your
original back over the result.

## Quick start

1. Pick a picture under **Image source**, or click **Upload**. Dropping a
   picture onto the node works too.
2. Drag the handles on the picture. Cyan squares crop. Orange diamonds add space
   on one side. Orange corners make the whole canvas bigger or smaller. The
   green knob turns the picture.
3. Or tap a ratio such as **16:9** to pad the picture to that shape.
4. Wire **image** and **mask** to your model, and **stitcher** to Stitch Inpaint
   after the sampler.

**Open editor** shows the same handles on a full-screen canvas, with zoom and
pan. **Save & close** keeps your edits. **Cancel** or Escape puts everything
back, and asks first if anything changed. You do not need the editor: a run
uses what the node shows.

## On the node

From top to bottom:

- **Image source**: the pictures in ComfyUI's input folder. The list shows the
  picture under the pointer and filters as you type. **Upload** adds one. The
  gear holds the node's display options.
- **The picture**, with its handles.
- **The size line**: each step that sets the output size, ending with the size
  the run gives you.
- **The ratio row**: the orientation button, the ratios (1:1, 4:3, 3:2, 16:9,
  21:9) and the padlock.
- **Fit** (crop | pad) and **Divisible by**.
- **Fill**, **Feather**, **Resize** and the two **Centre** buttons.
- **Open editor**, **Reset crop** and **Reset**.

Crop and padding have no number boxes. You set them by dragging, and the size
line shows the result. Picking another picture starts the framing over
(rotation, crop and padding); Fill, Feather, Divisible by, Resize and a lit
ratio stay.

### Ratios, Fit and the padlock

Tap a ratio under the picture to pad the picture to it: every pixel stays and
fill bands are added around it, centred. Set **Fit** to crop and the ratio trims
the picture instead. Tap the lit ratio again to go back to the whole picture.
**Fit** only acts on a lit ratio, so it is dimmed and says "pick a ratio first"
until you tap one.

- **A lit ratio is the shape the canvas has now.** Drag a handle to another
  shape and the ratio goes dark; the row says **Custom** and the size line under
  the picture gives the real ratio (`1.49:1`).
- **A picture that already has the shape gets nothing added.** Within about 1%
  counts, so a nearly 9:16 photo gets no 1 px band. The size line under the
  picture says so ("already 9:16: pick another ratio or turn it"), and while a
  ratio is lit it names it where it acted (`pad to 16:9 2532×1424`). A lit ratio
  saved in a workflow is used again on every new picture you load.
- **The padlock** at the end of the row keeps the shape while you drag: pull one
  side out and the other side's padding follows, split evenly. The row says
  **Held** while it is on. On the untouched picture (the row says **Source**)
  there is no shape to hold, so it stays off. **Reset** and tapping the lit ratio
  turn it off, and **Reset crop** also takes away the bands it added.
- **The orientation button** at the start of the row turns the shape on its side:
  16:9 becomes 9:16, padded around the picture (crop mode turns the crop box
  about its centre). The picture itself never rotates. With nothing picked it
  only turns the ratios, so the next tap goes that way.
- **Drag the picture itself** to move it inside its padding; the canvas keeps its
  size. Over the picture, the cursor and small arrows show which ways it can go.
- Rotating keeps a lit ratio: the padding follows the turned picture.

### Corner handles and Centre

The four orange corners outside the picture make the whole canvas bigger or
smaller and keep its shape: drag one out to add room on two sides at once, for
example to zoom out before an outpaint. The corner across from the one you drag
stays where it is. Hold **Alt** (Option on a Mac) while you drag to change all four
sides at once, so the picture keeps its place in the middle. You can press or let
go of Alt during the drag. A corner stops when one of its two sides has no padding
left to take away.

The two **Centre** buttons next to Fill, Feather and Resize put the picture in
the middle of the canvas: one side to side, one top to bottom. They move padding from
one side to the other, so the canvas keeps its size and a lit ratio stays lit. A
button is dimmed when the picture is already in the middle or that way has no
padding to move. On a narrow node they sit on a line of their own.

The orange diamonds move one side at a time, and the padlock works on them as
described above. The corners keep the shape with or without the padlock. The
green rotate knob moves aside when a corner handle sits where it usually goes.

### Fill, Feather and Resize

- **Fill** (`fill_color`): the colour of the added space and of the empty
  corners a turn leaves. It starts gray. Added space on the picture is drawn in
  the real fill colour with a faint hatch, and only the part the crop cuts away
  is darkened.
- **Feather** (`feather`, 24 px to start): softens the edge of the **mask** into
  the kept picture, so the model and the stitch blend the seam. The image itself
  keeps a hard edge against the fill. That solid band is what outpaint models
  and LoRAs recognise as the area to paint.
- **Resize** (`resize_to_megapixels`, off to start): resizes the finished output
  to a size budget and keeps its shape. Turning it on opens a row with
  **Megapixels** (`megapixels`, the budget) and **Step** (`resolution_steps`,
  the number each resized side rounds to; 8 or 64 suits most image models).
  **Method** (`resize_method`) is in the editor, under **Resize output**.

### Divisible by

**Divisible by** (`canvas_multiple`) adds a few pixels of fill on the right and
bottom so the width and height divide evenly by the number you pick. Some models
need sizes divisible by 8, 16 or 32. At 1 it is off. Its arrows go 1, 8, 16, 24
and so on; hold Shift to step by 1.

### The size line

The line under the picture names every step that sets the output size, in the
order the run applies them, with the size the run emits last and brightest:
`crop 2080×1170 → pad 2208×1298 → round to 64 2240×1344 → resize 1344×768`. A step
that changes nothing is left out, and "round to" is **Divisible by** at work. An
amber line warns when rounding each side to the Step stretches the picture by
more than 1% (`1.5% taller: each side rounds to 32 px`); its tooltip names a
Step that avoids it, and with Fit on pad, **Even out** adds a few pixels of
padding so nothing stretches. It also warns when the resize undoes **Divisible
by**. Hover the line for the same breakdown line by line; the editor's right
panel shows it too.

### Reset crop and Reset

**Reset crop** shows the whole picture again without changing rotation or
padding. **Reset** clears rotation, crop and padding and turns the padlock off;
Fill, Feather and **Divisible by** stay.

## Drawing a mask

Right-click the node and choose **Open in MaskEditor** to paint over the parts
you want the model to repaint. After **Save**, the picture on the node shows
them in teal, and the teal moves with the picture when you crop, turn or pad
it. The full editor shows it too. The run treats painted parts like the
padding: it fills them with the fill colour and marks them in the **mask**,
so under the teal you see the fill colour, not your picture.

See-through parts of a PNG show in teal the same way, because the node paints
them too. To hide the teal, click the gear at the top right of the image
source box and turn off **Show the mask on the picture**. The choice applies
to every Image Crop + Rotate + Pad in this browser.

## Outputs

- **image**: the turned, cropped and padded picture. Every frame of an animated
  image gets the same framing.
- **mask**: White where the model paints: the padding, the empty corners a turn leaves, and the see-through parts of your picture.
- **stitcher**: Wire to Stitch Inpaint to restore the kept canvas around an outpaint result, blended into the source by **Blend** (32 px unless changed). It follows the final resized canvas.
- **original**: your picture before rotation, crop, padding or resize, with
  see-through parts shown as white.
- **width** / **height**: The output size after the transform and any resize.
- **prompt_image**: The image again, with see-through parts shown as white instead of the fill colour. Wire it to whatever writes your prompt. It is the same as **image** for a picture with no see-through parts.

## See-through pictures

A PNG can have see-through parts: a product cutout with no background, a
photo with round corners, a picture with a hole in it. The node treats those
parts like the padding. They are filled with the fill colour, marked in the
mask, and the model paints them. Stitch Inpaint never puts them back over
the painted result.

Use **prompt_image** for the node that writes your prompt. There the
see-through parts show as white, the way a picture viewer shows them, so the
prompt describes a real backdrop. Shown the gray fill instead, a prompt
writer calls it a "gray backdrop" and the model keeps the flat gray. The
model itself still gets **image**, with the fill colour it was trained on.

A picture with no see-through parts comes out exactly as before.

### Technical details

- A pixel counts as see-through when it is less than 90% as solid (alpha)
  as the most solid pixel in the picture. Measuring against the most solid
  pixel keeps a picture saved at, say, 50% opacity throughout whole instead
  of painting it over.
- A picture that is at least 90% solid everywhere is left exactly as it was
  loaded. Generated pictures often carry alpha values of 249-254 in places,
  and those pictures do not change.
- Kept pixels are used fully solid, in their own stored colour. See-through
  pixels never reach the canvas: their stored colour (often black, or the
  old background) is what used to leave a dark or light ring round a cutout.
- Why 90%: on an oval photo whose edge stores colours darkened by their
  alpha, a 50% cut kept a rim up to half dark, the ring the model painted
  back. At 90% the kept rim is at most 10% darker, and matting noise inside
  solid subjects stays above it, so no holes open there.
- A turned picture's see-through parts turn with it, like its corners. In
  **prompt_image** they show white while the padding and the corners keep
  the fill colour.
- The MaskEditor saves its mask as see-through parts of the picture, so the
  same rule applies: a stroke more than 10% strong is painted in full,
  including one at the MaskEditor's default 70% opacity.

## The editor

**Open editor** opens the full-screen canvas. Its left side holds the node's own
controls: the same ratio row with its orientation button and padlock, the same
**Fit** switch, and the same number boxes (drag to scrub, click to type, Shift
for fine steps). The editor adds a few things the node does not show:

- **Rotate → Degrees** (`rotation_degrees`): type an exact turn, clockwise.
  Each step is 1°, or 0.1° with Shift. **Reset rotation** sets it back to 0.
- **Padding & mask → Reset padding** removes all padding. The same section has
  Fill, Feather, Divisible by and a **Centre** row.
- **Resize output → Method** (`resize_method`): how the resize samples the
  picture. `lanczos`, the default, is the sharp one.
- **More**: ratios you added in `ausboss_presets.json` that no button shows.
  The list only appears when you have some.
- **Reset view** undoes zoom and pan. **Reset transform**
  clears rotation, crop, padding, fill, feather and Divisible by; the picture,
  resize and stitch settings stay.
- **Preview**: a small picture of the finished output while you work.

A ratio replaces the existing crop and padding and keeps rotation, fill and
resize settings. **Divisible by** and the resize **Step** can slightly change
the fitted shape. The size box on the stage sits clear of the handles.

### Handles and gestures

Drag cyan squares to resize the crop, drag inside to move it, orange diamonds to add padding on one side, orange corners to make the canvas bigger or smaller in its own shape (hold `Alt`, Option on a Mac, for all four sides), and the green handle to rotate. Hold `Shift` while rotating to snap to 15 degrees. The knob turns all the way round either way: past 180° it carries on from -180°, so an upside-down picture turns back up whichever way you drag. Rotating keeps the crop's size and keeps it over the same part of the picture, whichever control turns it (knob, number box, Reset rotation); with no crop the canvas grows to hold the tilted picture. The knob keeps clear of the padding handles and crop squares. Use the wheel to zoom and middle mouse or `Alt`-drag on an empty spot to pan. The same handles work directly on the node's compact preview (fit-only there — the wheel keeps zooming the graph); zoom and pan are editor-only.

### Inpaint & Stitch

The editor's right side holds the stitcher's settings, the same as on the clip node:

- **Blend** (`stitch_blend`, default 32): the ramp, in output pixels, where generated
  pixels fade over the source. It is separate from **Feather**, which shapes the mask.
- **Show blend** tints the stage with the paste mask: the generated area (painted and
  see-through parts included), the feather, then grow and blend applied through any resize.
- **Advanced → Grow paste** (`stitch_grow`, default 0) moves the paste boundary first:
  a few positive pixels let the generation repaint the source edge when a seam still shows.

## Technical details

- **Saved values.** The handles write plain number values that save with the
  workflow and that an API workflow can set directly. None of them shows as a
  row on the node:
  - `crop_x` / `crop_y` / `crop_width` / `crop_height`: the crop, in pixels of
    the turned picture. Width and height `0` mean the full size.
  - `pad_left` / `pad_top` / `pad_right` / `pad_bottom`: the added space on
    each side, in pixels.
  - `crop_aspect_ratio`: `free`, `source` or a fixed ratio that the crop box
    keeps. It stays `free` unless Fit is on crop and the padlock is on.
  - `fill_color`: `#RGB` or `#RRGGBB`, three numbers (`R, G, B`), one gray
    number, or a colour name. Anything it cannot read becomes mid-gray.
- **Corners.** A corner follows the pointer along the canvas diagonal, and the
  shape it keeps is the canvas before **Divisible by** adds its fill. With
  Divisible by on, **Centre** counts that strip on the right and bottom, so the
  bands you see come out even.
- **Resize.** It works like core's *Scale Image to Total Pixels*: the budget is
  `megapixels × 1024 × 1024`, the shape is kept, and each side rounds to a
  multiple of **Step**. The image uses the chosen **Method**; the mask always
  resizes bilinear so feathered edges cannot ring.
- **Your own ratios.** Copy `ausboss_presets_example.json` in the pack's folder
  to `ausboss_presets.json` and edit the list, then reload the browser tab.
- Restoring a workflow or undoing a change refreshes the picture without
  resetting the saved framing.
- The node performs no network requests and writes no files beyond a normal
  user-initiated ComfyUI upload.
