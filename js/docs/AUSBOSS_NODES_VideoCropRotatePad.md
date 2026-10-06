# Video Crop + Rotate + Pad → Frame

**Outputs one frame, not a clip.** The timeline, on the node and in the
editor, is only for finding the frame; the node returns that single image,
not a re-encoded video.

Loads one exact video frame and applies the same **rotate → crop → pad**
transform as the image node. It returns the transformed `image`, its
generated-area `mask`, a `stitcher` for Stitch Inpaint, the selected
`original` frame before the transform, and the output `width` and `height`.

## Source and frame

- **Uploads**: Pick an input video (the list plays the clip under the pointer, muted, and filters as you type), click **Upload** in the compact source card, or
  drop a video file onto the node. Picking another video keeps Fill, Feather,
  **Divisible by**, the Resize settings and the lit ratio button (the new frame is
  fitted to it the way **Fit** is set); rotation, crop, padding and the playhead
  start over.
- **Canvas row** under the Fit row: fill swatch, feather amount and the Resize off | on switch on the node face; turning Resize on opens the megapixel budget and its Step. The line under the picture names each step that sets the output size, as on the image node.
- **Upload** streams to the input folder, so videos larger than the buffered image-upload limit can be selected here or dropped onto the node.
- **Uploads** / **Server file** (`source_mode`: `input folder` / `local path`): the source card's switch. Server file mode avoids copying large files.
- **local_path**: Absolute path used only in Server file mode, read in place without an
  upload copy. It must point inside ComfyUI's input, output or temp folder, for queued
  runs and the editor's live preview alike; paths anywhere else are refused.
- **Playhead**: The rail under the node's preview is the timeline: press or drag it to
  scrub, or type a frame in the **FRAME** box; the frame on the stage is the frame the
  node outputs (`frame_index`, with `frame_time` kept in step).
- **seek_mode / frame_time**: Time-based seeking for graphs that drive the position by
  link; the editor itself always works in frames.

The editor has the same rail full width, plus first/last, ±1, ±25, ±50, ±100, play/pause, keyboard arrows (one frame, 10 with Shift), Home/End and Space to play or pause. **Save & close** keeps your edits; **Cancel** or Escape puts everything back, and asks first if anything changed. Only one frame preview request remains active; stale requests are cancelled, and frames already shown are served from a small cache.

## Transform and outputs

Rotation, crop, padding, feathering, fill, **Divisible by**, the megapixel resize, gestures, `image`, and `mask` match the image node. The output batch contains one frame.

The handles work on both the node and the editor. Drag an orange corner to make
the canvas bigger or smaller in its own shape (hold **Alt**, Option on a Mac, to
change all four sides at once), and press **Center** next to Fill and Feather to
put the frame in the middle, side to side or top to bottom. Both work as on the
image node. The ratio buttons, **Fit**,
the padlock and the orientation button work as on the image node: a tap pads (or,
with Fit on crop, crops) the frame to a ratio, a lit ratio is the shape the canvas
has now, and the padlock keeps that shape while you drag (the row says **Held**).
**Reset crop** restores the full crop while keeping rotation and padding. **Reset**
clears rotation, crop and padding and turns the padlock off; fill, feather,
**Divisible by** and the playhead stay. **Divisible by** adds a few pixels of fill
on the right and bottom so the width and height divide evenly by the number you
pick. Some models need sizes divisible by 8, 16 or 32; 1 turns it off.

The appended **stitcher** output restores kept pixels after generation with a
32-pixel blend. **original** returns the chosen RGB frame before the transform,
and **width** / **height** the output size after the transform and any resize.
The existing image and mask sockets keep their positions.

Video metadata and preview routes validate extensions and return only the information needed by the editor. The node performs no remote network requests and does not rewrite the source video.
