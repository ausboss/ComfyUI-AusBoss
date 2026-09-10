# Video Crop + Rotate + Pad → Frame

**Outputs one frame, not a clip.** The timeline in the editor is for finding
the frame; the node returns that single image and its mask.

Loads one exact video frame and applies the same **rotate → crop → pad** transform as the image node. It outputs an image and generated-area mask, not a re-encoded video.

## Source and frame

- **Uploads**: Pick an input video, click **Upload** in the compact source card, or
  drop a video file onto the node. Another video keeps the fill, feather and resize
  settings and the lit format chip (the new frame is padded to it); rotation, crop and
  the playhead start over.
- **Canvas row** under the format chips: fill swatch, feather amount and resize
  budget on the node face.
- **source_mode**: `input folder` or `local path`. Local path mode avoids copying large files.
- **local_path**: Absolute path used only in local path mode. The video's folder must
  be ComfyUI's input, output or temp folder or one approved on the ComfyUI computer:
  **Browse…** beside the field opens the system file dialog there, and the folder of
  the video chosen in it stays approved. A server with no screen approves folders by
  hand in `<ComfyUI user folder>/ausboss/folder_access.json`. Folders that hold ComfyUI
  itself are never read.
- **Playhead**: The rail under the node's preview is the timeline: press or drag it to
  scrub, or type a frame in the **Frame** box; the frame on the stage is the frame the
  node outputs (`frame_index`, with `frame_time` kept in step).
- **seek_mode / frame_time**: Time-based seeking for graphs that drive the position by
  link; the editor itself always works in frames.

The editor has the same rail full width, plus first/last, ±1, ±25, ±50, ±100, play/pause, keyboard arrows and Home/End. Only one frame preview request remains active; stale requests are cancelled, and frames already shown are served from a small cache.

## Transform and outputs

Rotation, crop, padding, feathering, fill, canvas multiple, gestures, `image`, and `mask` match the image node. The output batch contains one frame.

The crop, padding and rotation handles work on the node preview as well as in the
editor, and the format chips right under the preview (16:9, 9:16, 1:1, 4:3 ...) pad
the whole frame to that aspect with centered fill bands in one tap. Tap the lit chip
again to lock the format (a padlock appears): crop and padding drags then keep the
canvas at that aspect with the other axis's padding following; a third tap clears
both. The editor's **Lock aspect** box is the same switch. Choose a **Target aspect**, then **Crop to aspect** to trim a centered crop,
or **Pad to aspect** to preserve the full source and add centered fill-color bands.
Both actions replace existing crop/padding and retain rotation. The target selection
alone does not alter the transform. Padding unlocks the inner crop so it keeps every
source pixel; canvas/resize rounding may slightly change the final aspect.

Video metadata and preview routes validate extensions and return only the information needed by the editor. The node performs no remote network requests and does not rewrite the source video.
