# Video Crop + Rotate + Pad → Frame

**Outputs one frame, not a clip.** The timeline in the editor is for finding
the frame; the node returns that single image, not a re-encoded video.

Loads one exact video frame and applies the same **rotate → crop → pad**
transform as the image node. It returns the transformed `image`, its
generated-area `mask`, a `stitcher` for Stitch Inpaint, and the selected
`original` frame before the transform.

## Source and frame

- **Uploads**: Pick an input video, click **Upload** in the compact source card, or
  drop a video file onto the node. Another video keeps the fill and feather
  settings and the lit format chip (the new frame uses its Crop / Pad mode); rotation, crop and
  the playhead start over.
- **Canvas row** under the format chips: fill swatch and feather amount on the node face.
- **Upload** streams to the input folder, so videos larger than the buffered image-upload limit can be selected here or dropped onto the node.
- **Uploads** / **Local path** (`source_mode`: `input folder` / `local path`): the source card's switch. Local path mode avoids copying large files.
- **local_path**: Absolute path used only in local path mode, read in place without an
  upload copy. It must point inside ComfyUI's input, output or temp folder, for queued
  runs and the editor's live preview alike; paths anywhere else are refused.
- **Playhead**: The rail under the node's preview is the timeline: press or drag it to
  scrub, or type a frame in the **Frame** box; the frame on the stage is the frame the
  node outputs (`frame_index`, with `frame_time` kept in step).
- **seek_mode / frame_time**: Time-based seeking for graphs that drive the position by
  link; the editor itself always works in frames.

The editor has the same rail full width, plus first/last, ±1, ±25, ±50, ±100, play/pause, keyboard arrows and Home/End. Only one frame preview request remains active; stale requests are cancelled, and frames already shown are served from a small cache.

## Transform and outputs

Rotation, crop, padding, feathering, fill, canvas multiple, gestures, `image`, and `mask` match the image node. The output batch contains one frame.

The handles work on both the node and the editor. **Crop / Pad** below the
format chips chooses between trimming to a locked ratio without padding and
preserving the whole source with fill bands. In Pad mode, tap the active ratio
again to lock the outer canvas; the next tap clears it. **Reset crop** restores the
full crop while keeping rotation and padding. **Align** sets the canvas pixel
multiple, with 1 disabling alignment padding.

The appended **stitcher** output restores kept pixels after generation with a
32-pixel blend. **original** returns the chosen RGB frame before the transform.
The existing image and mask sockets keep their positions.

Video metadata and preview routes validate extensions and return only the information needed by the editor. The node performs no remote network requests and does not rewrite the source video.
