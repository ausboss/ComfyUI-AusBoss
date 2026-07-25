# Video Crop + Rotate + Pad

Loads one exact video frame and applies the same **rotate → crop → pad** transform as the image node. It outputs an image and generated-area mask, not a re-encoded video.

## Source and frame

- **video**: Video inside ComfyUI's input folder. Use **Upload video** on the node to add one.
- **source_mode**: `input folder` or `local path`. Local path mode avoids copying large files.
- **local_path**: Absolute path used only in local path mode.
- **seek_mode**: Exact zero-based frame index or time in seconds.
- **frame_index / frame_time**: Saved timeline position.

The editor includes first/last, ±1, ±25, ±50, ±100, play/pause, keyboard arrows, and a full-width timeline. Only one frame preview request remains active; stale requests are cancelled.

## Transform and outputs

Rotation, crop, padding, feathering, fill, canvas multiple, gestures, `image`, and `mask` match the image node. The output batch contains one frame.

Video metadata and preview routes validate extensions and return only the information needed by the editor. The node performs no remote network requests and does not rewrite the source video.

