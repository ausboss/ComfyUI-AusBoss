# Video Crop + Rotate + Pad → Frame

**Outputs one frame, not a clip.** The timeline in the editor is for finding
the frame; the node returns that single image and its mask.

Loads one exact video frame and applies the same **rotate → crop → pad** transform as the image node. It outputs an image and generated-area mask, not a re-encoded video.

## Source and frame

- **Uploads**: Pick an input video, click **Upload** in the compact source card, or
  drop a video file onto the node.
- **source_mode**: `input folder` or `local path`. Local path mode avoids copying large files.
- **local_path**: Absolute path used only in local path mode. Queued workflows always
  read it; the editor's live preview of paths outside ComfyUI's own folders requires
  starting ComfyUI with `AUSBOSS_TRANSFORM_LOCAL_PREVIEW=1`.
- **seek_mode**: Exact zero-based frame index or time in seconds.
- **frame_index / frame_time**: Saved timeline position.

The editor includes first/last, ±1, ±25, ±50, ±100, play/pause, keyboard arrows, and a full-width timeline. Only one frame preview request remains active; stale requests are cancelled.

## Transform and outputs

Rotation, crop, padding, feathering, fill, canvas multiple, gestures, `image`, and `mask` match the image node. The output batch contains one frame.

The crop, padding and rotation handles work on the node preview as well as in the
editor, and the format chips right under the preview (16:9, 9:16, 1:1, 4:3 ...) pad
the whole frame to that aspect with centered fill bands in one tap; tap the lit chip
to clear the bands again. Choose a **Target aspect**, then **Crop to aspect** to trim a centered crop,
or **Pad to aspect** to preserve the full source and add centered fill-color bands.
Both actions replace existing crop/padding and retain rotation. The target selection
alone does not alter the transform. Padding unlocks the inner crop so it keeps every
source pixel; canvas/resize rounding may slightly change the final aspect.

Video metadata and preview routes validate extensions and return only the information needed by the editor. The node performs no remote network requests and does not rewrite the source video.
