# Video Crop + Rotate + Pad → Clip

**Outputs the whole clip.** One **rotate → crop → pad** transform is applied to
every frame of the trim window; the editor's timeline only picks the frame you
adjust it on.

Use it to cut a border, a logo corner, or a tilt out of a video, or to grow
fill-color bands around it for a **video outpaint**: the `mask` output marks the
bands (and rotation corners), ready for Crop For Inpaint or an in-context video
model that paints black regions.

## Source and window

- **Uploads**: Pick an existing input video, click **Upload**, or drop a video file
  onto the node. The old source widgets remain compatible with saved workflows, but
  are now driven by this compact card. Choosing another video keeps the canvas
  settings - fill, feather, resize budget, Snap, Limit - and pads the new clip to the
  lit format chip; only rotation, crop and the trim window start over.
- **Canvas row** (under the format chips): the fill swatch, the feather amount and
  the resize budget, right on the node. These are what a video outpaint model keys
  on - the LTX IC-LoRA paints **pure black** with a **hard edge** (feather 0) at
  sizes rounded to 32 - so a wrong value shows here before a render is wasted.
  A fresh clip node starts with that pair (black, feather 0) and the editor's
  **Reset all** returns to it; the image nodes keep their soft grey canvas.
- **Local path**: Read a file on the ComfyUI server in place without copying it. By
  default only ComfyUI's own input, output and temp folders are readable, for queued
  runs and the editor's live preview alike; starting ComfyUI with
  `AUSBOSS_TRANSFORM_LOCAL_PREVIEW=1` opens the rest of the disk.
- **Timeline**: The rail on the node and in the editor is one timeline. Press or
  drag anywhere on it to scrub the **playhead**; the stage shows that frame. Drag the
  **IN** or **OUT** handle to trim: the playhead rides on the handle, so what you see
  is the first (IN) or last (OUT) frame the run keeps, and it stays there when you let
  go. IN and OUT are frames, snapped to the source's frame grid; the boxes under the
  rail take a frame number, and `start_seconds` / `end_seconds` are derived from them
  (OUT is exclusive, 0 means the end of the source). Arrow keys on a handle move one
  second, Shift one frame. The bright part of the selection is what the run outputs
  after the frame limit and Snap; a dim tail means those frames are dropped. In the
  editor, **Set IN** / **Set OUT** (or the **I** / **O** keys) put a trim point at the
  playhead, and **Full clip** resets the window.
- **every_nth / max_frames**: Thin the batch or cap it. The `fps` output divides to match every_nth, so the clip keeps real-time downstream.
- **Snap** (`frame_snap`): Drop trailing frames so the count is one a video model keeps:
  **8n+1** for LTX (49, 97, 121), **4n+1** for Wan. Free keeps every frame in the window.
  With it on, `frame_count`, `duration`, the audio window and the stitcher all match the
  clip the sampler hands back, so wiring `frame_count` into the empty latent's length
  never leaves the stitch with more source frames than generated ones.
- **frame_index / frame_time**: The playhead. It is a preview position, not a trim
  point: scrubbing it never invalidates the queued clip, and it is still saved with the
  workflow.

Crop squares, padding diamonds and the rotation handle also work directly on the
node preview. The graph still owns wheel zoom and middle-button pan. The format chips
right under the preview (16:9, 9:16, 1:1, 4:3 ...) pad the whole clip to that aspect
with centered fill bands in one tap - the editor's **Pad to aspect** without opening
it. Tap the lit chip again to **lock** the format (a padlock appears): crop and
padding drags then keep the canvas at that aspect, the padding on the other axis
following along - pull the top band up and the side bands widen to match, crop a
strip off and it comes back as fill. A third tap clears the bands and the lock. The
editor's **Lock aspect** box is the same switch.

Choose **Target aspect**, then **Crop to aspect** to center the largest crop inside
the rotated source, or **Pad to aspect** to keep the entire source and add centered
fill-color bands. Both replace the old crop and padding, keeping rotation and resize
settings. Changing the target alone does nothing. Padding unlocks the inner crop
(`crop_aspect_ratio = free`); the target choice is retained separately in the editor.
Pixel rounding can differ by one pixel between opposite bands. Canvas multiple and
resize steps can slightly change the final aspect ratio.

## Transform and outputs

Rotation, crop, padding, feathering, fill, canvas multiple, and the editor's handles
match the image node. **Resize output** in the editor scales the finished frames to a
megapixel budget with a resolution step (32 keeps LTX and Wan sizes), the same trio as
the core Scale Image to Total Pixels node.

Outputs: `frames` (BHWC), `mask` (BHW, one per frame), `audio` for the same window
(silent when the source has none), `frame_count`, `fps`, `width`, `height`, `duration`,
and a `stitcher`.

## Inpaint & Stitch

The `stitcher` output goes straight into **Stitch Inpaint 🆎**: after a video model has
painted the padded bands (or rotation corners), Stitch puts the source frames back
bit-for-bit and takes the generation only inside the generated area, so no separate
Crop For Inpaint node is needed. The editor's right sidebar holds the settings:

- **Blend**: the ramp, in output pixels, where generated pixels fade over the source.
  It is separate from the padding **Feather**, which shapes the mask the model sees -
  a black-band outpaint wants feather 0 and a blend of a few dozen pixels.
- **Show blend** tints the stage with the paste mask itself: the generated area (padding, rotation corners), the transform feather, then grow and blend applied in output pixels through any resize - the backend's mask math run at preview resolution.
- **Advanced → Grow paste** moves the paste boundary first: a few positive pixels let
  the generation repaint the source edge when a seam still shows.

The stitcher is built from the final resized frames, so it lines up with what the
sampler returns at this node's `width` × `height`.
Frames are transformed a few at a time so long clips do not double in memory, and the
queue's progress bar and cancel work throughout.

The node performs no remote network requests and does not rewrite the source video.
