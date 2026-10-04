# Video Crop + Rotate + Pad → Clip

**Outputs the whole clip.** One **rotate → crop → pad** transform is applied to
every frame of the trim window. The timeline selects that window and the
playhead picks the frame you adjust the transform on.

Use it to cut a border, a logo corner, or a tilt out of a video, or to grow
fill-color bands around it for a **video outpaint**: the `mask` output marks the
bands (and rotation corners), ready for Crop For Inpaint or an in-context video
model that paints black regions.

## Source and window

- **Uploads**: Pick an existing input video (the list plays the clip under the pointer, muted, and filters as you type), click **Upload**, or drop a video file
  onto the node. The old source widgets remain compatible with saved workflows, but
  are now driven by this compact card. Choosing another video keeps the canvas
  settings - fill, feather, resize budget, Frames for, Length - and pads the new clip to
  the lit format chip; only rotation, crop and the trim window start over.
- **Canvas row** (under the format chips): the fill swatch, the feather amount and
  the Resize off | on switch, right on the node; turning Resize on opens the megapixel
  budget and its **Step**. These are what a video outpaint model keys on - the LTX IC-LoRA paints
  **pure black** at sizes rounded to 32 - so a wrong value shows here before a
  render is wasted. Feather only softens the mask and the stitch; the frames always
  meet the fill with a hard edge. The line under the picture names each step that
  sets the size (`576×1024 → pad 1821×1024 → resize 1280×704`) and warns in amber
  when the Step stretches the picture by more than 1% (`2.2% wider: each side rounds
  to 32 px`); the tooltip names a Step that avoids it, and in pad mode **Even out**
  adds a few pixels of padding so nothing stretches. The bands are drawn in the real
  fill colour with a faint hatch, so black bands show on the black stage. A fresh clip node starts
  with black and feather 0 and the editor's **Reset transform** returns to them;
  the image nodes keep their grey fill and feathered mask.
- **Server file** (`source_mode` / `local_path`): Read a video on the ComfyUI server in
  place without an upload copy. It must sit inside ComfyUI's input, output or temp
  folder, for queued runs and the editor's live preview alike; paths anywhere else are
  refused.
- **Timeline**: The rail on the node and in the editor is one timeline. Press or
  drag anywhere on it to scrub the **playhead**, with Length on or off; the stage shows
  that frame. Drag the **IN** or **OUT** handle to trim: the playhead rides on the handle, so what you see
  is the first (IN) or last (OUT) frame the run keeps, and it stays there when you let
  go. IN and OUT are frames, snapped to the source's frame grid; the boxes under the
  rail take a frame number, and `start_seconds` / `end_seconds` are derived from them
  (OUT is exclusive, 0 means the end of the source). Arrow keys on a handle move one
  second, Shift one frame. **OUT always sits on the last frame the run outputs**, so
  the handle and the bright bar end together; with Every nth or Frames for it steps to the
  frames the run keeps, and a dim tail marks frames the window holds but the run
  drops. In the editor, **Set IN** / **Set OUT** (or the **I** / **O** keys) put a
  trim point at the playhead, and **Full clip** resets the window.
- **Length** (`max_frames`): the one other way to set how long the clip is. **Off**
  (the default): OUT ends the clip. **On**: a number of output frames from IN; OUT
  sits that many frames after IN and follows it when you drag IN, and dragging OUT or
  typing the number changes the Length. To move the whole clip, drag IN or the small
  grip in the middle of the kept part (the grip also slides a trimmed window with
  Length off). When the Length is the whole clip there is nowhere to move it, and the
  row says so: "= the whole clip. Shorten it to move IN." The Length stays when you
  swap the video, so a workflow built for 97 frames keeps taking 97. Turning it on or
  off never moves anything: the count becomes the OUT, or the OUT the count. If the
  source ends first, the footer says how many frames are left. **To start** moves IN
  to the start of the source.
- **Every nth** (`every_nth`): Thin the batch. The `fps` output divides to match
  every_nth, so the clip keeps real-time downstream; a Length counts the frames kept.
- **Frames for** (`frame_snap`): Keep a frame count a video model takes:
  **LTX (8n+1)** (49, 97, 121) or **Wan (4n+1)**. **Any** keeps every frame in the window.
  OUT drags and the Length step through those counts.
  With it on, `frame_count`, `duration`, the audio window and the stitcher all match the
  clip the sampler hands back, so wiring `frame_count` into the empty latent's length
  never leaves the stitch with more source frames than generated ones.
- **frame_index / frame_time**: The playhead. It is a preview position, not a trim
  point: scrubbing it never invalidates the queued clip, and it is still saved with the
  workflow.

Crop squares, padding diamonds, the orange corners and the rotation handle also
work directly on the node preview. A corner makes the canvas bigger or smaller in
its own shape, for example to zoom out evenly before a video outpaint; hold **Alt**
(Option on a Mac) to change all four sides at once. **Centre**, next to Fill and
Feather, puts the clip in the middle of the canvas side to side or top to bottom
without changing the canvas size. The graph still owns wheel zoom and middle-button
pan. Tap a ratio
to pad the clip to it (or crop it, with **Fit** on crop); tap the lit ratio again to
go back to the whole frame. A lit ratio is the shape the canvas has now: drag a
handle to another shape and it goes dark and the row says **Custom**, and a new
clip is then no longer padded to it. A clip that already has the lit shape (within
about 1%) gets nothing added, and the size line says so ("already 9:16: pick another
ratio or turn it"); otherwise it names the lit ratio where it acted (`pad to 16:9
1821×1024`). The padlock keeps the shape while
you drag, with new bands split evenly, and the row says **Held**; Reset and tapping
the lit ratio turn it off, and it does nothing on the untouched clip. **Fit** is
dimmed until a ratio is lit. The orientation button turns the shape on its side
(16:9 to 9:16), and dragging the picture itself moves it inside its padding: the
cursor and small arrows show which ways it can go.
**Reset crop** restores the full crop without changing rotation, padding or trim;
with the padlock on it also takes away the bands the lock added.
**Reset** on the node clears rotation, crop and padding and turns the padlock off;
fill, feather, **Divisible by** and the timeline stay.
**Reset transform** in the editor resets rotation, crop, padding, fill, feather and
**Divisible by**; it keeps the source, current frame, trim, Length, resize and stitch
settings. **Divisible by** adds a few pixels of fill on the right and bottom so the
width and height divide evenly by the number you pick. Some models need sizes
divisible by 8, 16 or 32; 1 turns it off.

Video Upload and file drop use a streaming route into ComfyUI's input folder,
so the buffered image-upload size limit does not prevent long-video uploads.

The editor's sidebar uses the node's own ratio row, padlock and **Fit** switch, and
the rotation is a number box (Shift for 0.1°). A ratio replaces the old crop and
padding, keeping rotation and resize settings.
Pixel rounding can differ by one pixel between opposite bands. **Divisible by** and
the resize **Step** can slightly change the final aspect ratio.

## Transform and outputs

Rotation, crop, padding, feathering, fill, canvas multiple, and the editor's handles
match the image node. **Resize output** in the editor scales the finished frames to a
megapixel budget with a resolution step (32 keeps LTX and Wan sizes), the same trio as
the core Scale Image to Total Pixels node.

Outputs: `frames` (BHWC), `mask` (BHW, one per frame), `audio` for the same window
(silent when the source has none), `frame_count`, `fps`, `width`, `height`, `duration`,
a `stitcher`, and `original`: the same selected source frames before the spatial
transform and resize. Existing output socket positions are preserved.

## Inpaint & Stitch

The `stitcher` output goes straight into **Stitch Inpaint 🆎**: after a video model has
painted the padded bands (or rotation corners), Stitch puts the source frames back
bit-for-bit and takes the generation only inside the generated area, so no separate
Crop For Inpaint node is needed. The editor's right sidebar holds the settings:

- **Blend** (`stitch_blend`): the ramp, in output pixels, where generated pixels fade
  over the source. It is separate from the padding **Feather**, which shapes the mask
  output - a black-band outpaint does well with feather 0 and a blend of a few dozen
  pixels.
- **Show blend** tints the stage with the paste mask itself: the generated area (padding, rotation corners), the transform feather, then grow and blend applied in output pixels through any resize - the backend's mask math run at preview resolution.
- **Advanced → Grow paste** (`stitch_grow`) moves the paste boundary first: a few
  positive pixels let the generation repaint the source edge when a seam still shows.

The stitcher is built from the final resized frames, so it lines up with what the
sampler returns at this node's `width` × `height`.
Frames are transformed a few at a time so long clips do not double in memory, and the
queue's progress bar and cancel work throughout.

The node performs no remote network requests and does not rewrite the source video.


## Connected timing inputs

Five optional sockets sit on the left, above the editor:

| Input | Meaning |
| --- | --- |
| `force_rate` | Sample at this fps before Every nth. 0 keeps the source rate. Drops or repeats frames to keep playback speed. Accepts FLOAT or INT. |
| `start_frame` | Zero-based source start frame. Overrides timeline IN. |
| `end_frame` | Exclusive source end frame. 0 means the end of the source. Overrides timeline OUT. |
| `fixed_frames` | Exact output frames from IN; the source must be long enough. Connected, it sets the length: OUT and Length step aside. |
| `frame_load_cap` | Maximum frames after rate conversion and Every nth, before Frames for. 0 means unlimited. Connected, it sets the length in place of Length. |

Frame bounds use the source's frame-rate grid, independent of `force_rate`.
The footer labels **Source fps** separately from **Output fps**. A direct
numeric rate connection (including a reroute) can be shown before running;
calculated rates are labeled as determined at run time. `force_rate` is the
requested sampling rate before Every nth: 24 with Every nth 2 outputs 12 fps.
Connect the node's `fps` output to `CreateVideo.fps` or `Save Video.fps` so
the next node uses the actual rate rather than changing playback speed.
For example, start 24 and end 72 select two seconds from a 24 fps source.
A 12 fps forced rate returns 24 frames; a cap of 10 then keeps only the first
10 of those. Audio and duration follow the returned batch.

A connected start or end locks that handle and its IN/OUT field on both
the node and fullscreen editor. Hover to see why. Disconnect to restore
local control. While timing inputs are connected, the preview shows the local
trim as a reference and avoids claiming an output count before the linked
values are evaluated at run time.

**A connected length input takes over the length.** Connect a count to
`fixed_frames` (exact) or `frame_load_cap` (at most) and the OUT handle goes
away, OUT and Length grey out, and only IN is left to set: the clip starts at
IN and the input decides where it ends. Literal Integer/Float nodes (including
AusBoss cards and reroutes) show the resulting frames on the rail before
running; calculated counts show "at run time". An older workflow that saved a
Fixed frames number without a connection reads as a Length; the first change
here turns it into one.
