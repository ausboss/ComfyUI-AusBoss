# Stitch Inpaint

Pastes an inpainted crop from **Crop For Inpaint 🆎** back into the
original image. The crop is resized to its source window if the sampler
changed its size, blended in with the feathered mask recorded in the
stitcher, and the original frame is sliced back out.

## Guarantees

- Pixels outside the blend region are **bit-identical** to the original
  image — they never pass through a resize or blend. This holds with
  `fix_edge_halo` on as well: the toggle changes the color that is pasted,
  never how far the paste reaches.
- Feeding the crop back unchanged reproduces the original image exactly
  (with `fix_edge_halo` off; the fix rewrites the feathered band on purpose).
- A stitcher built from one image broadcasts over any number of inpainted
  frames. A stitcher built from **more** frames than came back is trimmed to
  the leading ones with a console note - video models keep 8n+1 (LTX) or
  4n+1 (Wan) frames and drop the tail - so a long run is never thrown away
  over the count. More inpainted frames than source frames is still an error.

## Controls

- **stitcher**: The stitcher output of Crop For Inpaint. It carries the
  paste window, the blend mask, and the untouched original pixels.
- **inpainted**: The inpainted crop. A stitcher built from a single image
  broadcasts across an N-frame inpainted batch, so one still-image crop
  can stitch a whole video; matched N-to-N batches also work.
- **fix_edge_halo**: Off by default. Recovers the true color under the
  feathered seam before pasting, so half-transparent edge pixels stop
  blending their background in a second time. It costs real time per frame
  — read "What it costs" below before turning it on for a whole batch.
- **color_match**: `0` (off) to `1`. Shifts the pasted region's tone onto
  the original's before blending. For an outpaint the shift is read across
  each seam — the model's new pixels just outside the source against the
  true pixels just inside it — so it measures the model's own drift, not
  the mixed band. Read "Matching the tone" below.

## Matching the tone

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

The estimate assumes neighbouring strips depict similar content. It cannot
reliably distinguish a tone shift from a different object or shadow at the
seam, even with the clamp and smoothing.

For video, start with **color_match at 0**. The estimate runs independently
on each frame, so moving subjects or camera motion can turn those content
differences into flickering dark or light bands across the generated area.
Compare the decoded frames before stitching with the stitched result; if
the bands appear only after stitching, disable color matching. The source
paste and feathered blend still work with it off.

## Fixing an edge halo

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
package:

```bash
pip install pymatting
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

## Outputs

- **image**: The original-size image with the inpainted region blended in.
- **blend_mask**: The feathered paste mask in the stitched image's own
  coordinates — white where the inpaint blended in, zero where the original
  survived untouched. Wire it into a color-match or compositing node to
  treat exactly the pasted region without rebuilding the mask by hand. It
  is batched like **image**, so a single-image stitcher broadcasting across
  a frame batch hands every frame its mask.

## Wiring

```text
Crop For Inpaint ── image/mask ──> LaMa Inpaint ── image ──> Stitch Inpaint ── image
        └── stitcher ────────────────────────────────────────────┘
```
