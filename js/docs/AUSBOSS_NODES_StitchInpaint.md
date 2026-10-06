# Stitch Inpaint

Puts what the model painted back into your original picture, so everything
you did not ask it to change stays exactly as it was. Wire in the stitcher
from **Crop For Inpaint 🆎**, **Load Image + Pad 🆎** or any
**Crop + Rotate + Pad 🆎** node. If the sampler changed the size of the
result, it is resized to fit first, then joined to your picture the way
**Seam** says.

## Seam: classic or blend in

**Seam** picks how the new area joins your picture. It lives in the gear
menu: click the small gear in the card's top-right corner.

- **classic** (the default) is the paste every earlier workflow uses: the
  new area fades in over the feathered mask, and **Tone match** can shift
  its colour toward your picture. Saved workflows keep it, so they render
  exactly as before.
- **blend in** is for outpaints, turned or straight. The model redraws a
  thin strip along the edge of your picture, and its version never
  matches yours exactly. Blend in fades from the model's picture to yours
  a little way inside your picture, where the two already line up.
  With **Tone match** on, it first checks how the model changed the
  colours of that strip and takes the same change back off the new area,
  so a model that paints a little lighter, darker or warmer still meets
  your picture in tone. With Tone match at 0 the new area stays exactly as
  the model painted it. **Fix edge halo** is for classic only: under blend
  in it stays in place but dims, and a **blend in** chip shows next to the
  gear.

Blend in needs to know where your picture's edge is. Load Image + Pad and
the Crop + Rotate + Pad nodes record it; Crop For Inpaint does not, so a
Crop For Inpaint stitcher always pastes classic for now (the console says
so once).

What blend in fixes: the lighter or darker band classic's tone match can
lay over a turned outpaint, the grey haze a flat tone lift lays over a dark
new area, and the smeared strip where the two pictures were cross-faded.
What it can't fix: a pattern the model drew out of step at the edge, such as
plaid or stripes running along it, or fill the model left unpainted. Those
are in the model's own picture.

## Guarantees

- With the classic seam, pixels outside the blend region are
  **bit-identical** to the original image — they never pass through a
  resize or blend. This holds with `fix_edge_halo` on as well: the toggle
  changes the color that is pasted, never how far the paste reaches.
- With blend in, your picture is bit-identical from where the blend ends,
  a few dozen pixels inside its edge (about 35 px at common settings). At
  Tone match 0 the new area is bit-identical to what the model painted, and
  the whole stitch is the 2.4.0 blend in, pixel for pixel.
- With the classic seam, feeding the crop back unchanged reproduces the
  original image exactly (with `fix_edge_halo` off; the fix rewrites the
  feathered band on purpose). Blend in does not promise this: it keeps the
  model's version of the thin strip at your picture's edge.
- A stitcher built from one image broadcasts over any number of inpainted
  frames. A stitcher built from **more** frames than came back is trimmed to
  the leading ones with a console note - video models keep 8n+1 (LTX) or
  4n+1 (Wan) frames and drop the tail - so a long run is never thrown away
  over the count. More inpainted frames than source frames is still an error.

## Controls

- **stitcher**: The stitcher from one of the nodes above. It carries the
  paste window, the blend mask, and the untouched original pixels.
- **inpainted**: The inpainted crop. A stitcher built from a single image
  broadcasts across an N-frame inpainted batch, so one still-image crop
  can stitch a whole video; matched N-to-N batches also work.
- **Seam** (`seam`, in the gear menu): `classic` (the default) or
  `blend in`. Read "Seam: classic or blend in" above. It has no socket,
  so a link cannot drive it.
- **Fix edge halo** (`fix_edge_halo`, classic seam only): Off by default. Recovers the true
  color under the feathered seam before pasting, so half-transparent edge
  pixels stop blending their background in a second time. It costs real
  time per frame — read "What it costs" below before turning it on for a
  whole batch.
- **Tone match** (`color_match`): `0` (off) to `1`. Matches the new area's
  tone to your picture. Classic reads the drift across each seam; blend in
  reads it where the model repainted the edge of your picture. Read
  "Matching the tone" below.

## Matching the tone

An outpaint often comes back a little off the picture it extends. Klein can
darken the mid-tones of a night scene and brighten a daylight one, Krea 2
paints a touch darker, and Qwen Image 2.1 usually keeps your colours.
Tone match takes that off, in either seam.

### With blend in

Blend in compares the model's version of the strip along your picture's
edge with your picture, pixel for pixel, and works out how the model
changed each brightness level. It takes the same change back off the new
area, so dark stays dark and a mid-tone the model darkened comes back up.
It checks that the change holds up along the edge first (it tests the fit
on part of the strip it did not use), and changes nothing when it does not,
when the model kept your colours, or when there is no feather to read.

A wider feather gives it more to read. At feather 24 or more it removes
most of a model's drift; at 10 to 12 it removes part of a strong one, and
never more than the drift. A video clip is measured once for all its
frames, so the correction cannot flicker.

### With classic

An outpaint comes back a few percent off the picture it extends — Krea 2
a touch darker, Klein a touch lighter — and the padding colour makes no
difference to that. The feathered sampler mask then smears the step into
the band inside the source, so without a match the seam shows as a faded
band even though the content continues perfectly.

`color_match` reads the drift **across each padded side's seam, line by
line**: for a left or right side, every row compares the 24 generated
pixels just outside the seam with the 24 original pixels just inside it;
a top or bottom side does the same per column. Sky and water on the same
seam drift by different amounts, and one number for the whole picture
leaves one of them showing. Each line's reading is clamped to a few LAB
units around its side's average — a pier post leaving the frame is
content, not drift — and smoothed so no single line prints a stripe.
Where two padded sides meet, their curves blend by distance, so the
correction turns the corner without a crease.

The shift is subtracted from the pasted region before the blend. In the
padding that is the whole shift; inside the feathered band the paste
alpha scales it, which is exactly the share of each band pixel the
sampler painted. Source pixels stay bit-identical. A crop stitcher, which
has no source rectangle, gets a single global shift measured in its
blend band instead.

On a Crop + Rotate + Pad canvas the source rectangle is the crop, so it
can also hold the rotation's empty corners and any transparency. The
inside pixels skip those, and a line with no picture inside its seam takes
the global shift, read in the blend band along the picture's real edge.

The estimate assumes neighbouring strips depict similar content. It cannot
reliably distinguish a tone shift from a different object or shadow at the
seam, even with the clamp and smoothing.

For video, start with **Tone match at 0**. The estimate runs independently
on each frame, so moving subjects or camera motion can turn those content
differences into flickering dark or light bands across the generated area.
Compare the decoded frames before stitching with the stitched result; if
the bands appear only after stitching, disable color matching. The source
paste and feathered blend still work with it off. Blend in's Tone match is
measured once for the whole clip and every frame is blended with the same
map, so blend in adds no flicker of its own.

## Fixing an edge halo

This is for the classic seam. Blend in does not fade the new area in over
the blend mask, so no background gets counted twice, and the toggle dims
while blend in is on.

A feathered paste mixes each seam pixel with the original image. When the
inpainted pixel is *itself* already a mix of new content and the old
background — common after object removal, or when the mask hugged the
subject too tightly — that background gets counted twice and the seam reads
as a dark or light rim around the repair.

Turn `fix_edge_halo` on and the pasted color is re-derived first: the opaque
core's color is spread outward across the blend band, and the paste blends
toward that instead of the contaminated pixel. Leave it off when the seam
already looks clean — a clean seam has nothing to gain, and the estimate is
not free.

The fix needs the optional [`pymatting`](https://pypi.org/project/pymatting/)
package, installed with the Python that runs ComfyUI:

```bash
python -m pip install "pymatting>=1.1"
```

Without it the node prints one console note and pastes exactly as it would
with the toggle off — the graph keeps running either way.

### What it costs

The estimate is a CPU solve run once per frame, and it scales with the paste
window rather than with the whole image — roughly 90 ms per megapixel of that
window. Measured on a 16-thread desktop CPU with pymatting 1.1.15: about
48 ms for the 768x768 window a 1024x1024 frame produces, about the same for
the 960x544 window from 720p, and about 106 ms for the 1440x816 window from
1080p. Expect several times that on a modest laptop CPU.

Per frame, that adds up: 300 frames of 1080p is over half a minute spent in
the estimate alone. This is why the toggle ships off — it is meant for
finishing a take you have already chosen, not for a long exploratory batch.
Batches of more than one frame report per-frame progress and check for a
cancel between frames, so a run started by mistake stops at the next frame
boundary rather than playing out to the end.

## When the new area comes back empty

An outpaint model sometimes leaves part of the new area alone, and the
result shows plain bars in the fill color. Stitch Inpaint checks every
outpaint for that. When a quarter or more of the new area still shows the
plain fill (or half of it in any checked frame of a video), a message is
written to the console, without a popup. The picture is stitched as usual
either way. This check can flag intentional results. If the image looks
right, you can ignore this warning.

Try another seed, or describe the whole wider scene in the prompt. Adding
less space at a time also helps. For a video, a dark clip paints better if
you brighten it first.

## Outputs

- **image**: The original-size image with the inpainted region blended in.
- **blend_mask**: The feathered paste mask in the stitched image's own
  coordinates — white where the inpaint blended in, zero where the original
  survived untouched. Wire it into a color-match or compositing node to
  treat exactly the pasted region without rebuilding the mask by hand. It
  is batched like **image**, so a single-image stitcher broadcasting across
  a frame batch hands every frame its mask. With Seam on blend in it shows
  the blend instead: white on the new area, fading to black where your
  picture keeps its own pixels. It is still zero exactly where the stitch
  left the original alone.

## Technical details

The rest of this page is for people who want to know how blend in works
and how it was tested.

### How the empty check works

The new area is cut into 16 px blocks, and only blocks fully inside it are
judged. A block counts as unpainted when it is within 20/255 of the canvas
fill and flat. That is wide enough to catch a gray fill the model hands back
a little darker. Painted scenery has texture even when it is dark, so a
night street is not flagged. The same test runs on your picture, and only
what the new area has beyond that counts: a black night sky may be
continued as black. Up to nine frames spread across a clip are checked. Crop For Inpaint crops are not checked: their masked pixels are
the old picture, not a fill.

### How blend in works

- **Where the edge is.** A Crop + Rotate + Pad stitcher carries its
  generated-area mask; pixels at 0.98 or more are new area, so a turned
  picture's empty corners count too. A Load Image + Pad stitcher carries
  the rectangle the source sits in. From that, every pixel gets its
  distance to the picture's edge, positive inside and negative outside. A
  side of the picture that meets the frame is not an edge. The map is
  worked out once per stitcher and shared by every frame, with scipy's
  distance transform when it imports (ComfyUI requires scipy) and an exact
  torch fallback, good to 128 px, when it does not.
- **Two layers.** Both pictures are split into colour and tone (a Gaussian
  blur, sigma 8 px) and fine detail (what the blur takes away). Your
  picture's colour layer only reads pixels at least 4 px inside the edge,
  so fill that a turn or a resize mixed into the outermost pixels never
  leaks in.
- **Two hand-overs.** Detail changes over from the model's picture to yours
  across 10 px, starting at three quarters of the depth where the model's
  mask fell to 0.1: about how deep the model was free to redraw, and a
  little before its version lines up with yours (at least 8 px in; 13 px is
  assumed when the mask has no feather to read). For a Crop + Rotate + Pad
  stitcher that mask is its generated-area mask; for Load Image + Pad it is
  the feathered padding mask. Colour and tone change over slowly, on a
  smooth curve from 4 px to 14 px past the end of the detail hand-over.
- **Texture.** A straight cross-fade of two unrelated textures is weaker
  halfway across. Blend in puts 60% of the lost strength back.
- **Exactness.** Deeper than both hand-overs the result is your picture, bit
  for bit. Within 4 px of the edge and beyond it, it is the model's
  picture, bit for bit. The Crop + Rotate + Pad nodes' **Blend** and
  **Grow paste** (`stitch_blend`, `stitch_grow`) shape only the classic paste.
- **Cost.** Frames go through in chunks of about 2 MP, with a cancel check
  and progress between chunks: about 0.2 to 0.5 s per 1.5 MP frame on a
  desktop CPU.

### Tone match under blend in

- **What is compared.** Tone layers (a Gaussian blur, sigma 5 px) of your
  picture and of the model's, both read over the same picture pixels at
  least 4 px inside the edge, so the grey rim a turn or a resize leaves
  there, and the new area's own content, never enter the reading. The band
  is the picture pixels where the sampler mask is above 0.02; highlights at
  0.98 or more are left out. A clip is read through the mean of its frames.
- **The drift model.** Per RGB channel the difference is fitted as a curve
  over your picture's brightness, split into what a pinned pixel still
  drifts and what a free one does, weighted by the (equally blurred)
  sampler mask: d = A(v) + m (E(v) - A(v)). Both are piecewise linear on
  ten brightness points, denser in the shadows, with smoothness penalties,
  and fitted robustly (three reweighting passes). E is the drift in the new
  area. Klein re-renders a pinned picture, so its A is large; Krea keeps a
  pinned picture exact; Qwen redraws everything alike.
- **The check.** The band is cut into 96 px tiles in a checkerboard. The
  curves fitted on one colour must predict the other at least 15% better
  than no correction, both ways, or nothing changes. A local gain along the
  edge (sigma 48 px, at most 5%) is added only when it predicts another 5%
  better. A gain leaves black black, where an offset would lift it.
- **Taking it off.** Each value of the model's picture is taken back
  through its curve (v + drift(v) = value, three fixed-point steps), with
  the pixel's own mask mixing pinned and free, then divided by the local
  gain. The corrected picture goes through the blend in unchanged, so
  everything under "How blend in works" still holds.
- **Cost.** About 0.4 to 2 s per 1.5 MP stitch on a desktop CPU, once per
  stitch whatever the number of frames.

### Measured

Krea 2 with AnyPaint on seven outpaints at two seeds each, 1.5 MP, feather
12: six pictures turned 5 to 15 degrees (one of them also padded on two
sides) and one padded on three sides. "Colour step" is how much the stitch
changes the model's picture just inside the edge compared with just
outside it, so the scene itself does not enter it. Ranges are over the
seven pictures, each the mean of its two seeds.

| | classic, Tone match 1 | blend in |
|---|---|---|
| colour step across the seam (median dE) | 0.8 to 4.6 | 0.11 to 0.21 |
| new area moved off what the model painted (dE) | 0.9 to 3.0 | 0.00 |
| fine detail lost in the strip at the seam | 0 to 34% | 0 to 22% |
| your picture exact from (px inside the edge) | 20 to 56 | 23 to 38 |

The outer 20 to 35 px of your picture is the model's redraw either way,
about the same share as classic. Blend in changes where that strip meets
your picture, not how wide it is.

Tone match under blend in, on nine outpaints whose real continuation is
known (Klein 9B and Krea 2, straight pads, feather 16 to 64): how far the
new area's tone next to the edge is from the real photo, median dE.

| | classic, Tone match 1 | blend in, Tone match 0 | blend in, Tone match 1 |
|---|---|---|---|
| mean over the nine | 1.98 | 2.57 | 1.80 |
| Klein, feather 64 (three) | 1.78 to 2.06 | 1.42 to 2.40 | 0.73 to 1.84 |
| Krea 2, feather 32 to 64 (four) | 1.76 to 2.14 | 2.84 to 3.19 | 1.41 to 2.33 |

On 18 real runs (Qwen Image 2.1, Klein 9B and Krea 2; night, daylight and
flat backdrops; turned 5 to 15 degrees, straight pads on one, two or four
sides, 4:5 and 16:9 ratio chips) no correction showed a seam line. Qwen
drifted little: 4 of 7 runs got no correction and 3 got 0.4 to 0.6 dE.
Klein got 1.8 to 6.3 dE, taking back a darkening or brightening of its own,
and Krea 2 got 0.6 to 1.4 dE. Classic Tone match moved every one of those
new areas by 1.5 to 6.9 dE; on a turned night scene it lifted the new area
2.8 L off the grey rim, where Qwen's real drift was 0.2.

## Wiring

```text
Crop For Inpaint ── image/mask ──> LaMa Inpaint ── image ──> Stitch Inpaint ── image
        └── stitcher ────────────────────────────────────────────┘
```
