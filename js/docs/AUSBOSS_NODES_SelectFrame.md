# Select Frame

Selects one unchanged image from an `IMAGE` batch. Frame numbers are one-based,
so `1` is the first frame and the last valid value is the batch size. Negative
numbers count from the end: `-1` is the last frame, `-2` the one before it —
handy when the batch length varies, as a video's often does. `0` is invalid in
both directions.

## Controls

- **frames**: A BHWC image batch, commonly the frame output of a video loader.
- **frame_number**: The one-based frame to return; negative counts from the
  end (`-1` is the last frame). An out-of-range value stops with the
  available range instead of silently clamping.

## Output

- **image**: The selected frame as a one-image BHWC batch.

## Preview

The panel shows the frame that was selected, so a picked frame can be checked
without a separate preview node. It updates when the graph runs — changing
**frame_number** does not re-render it on its own, because the frame's pixels
only exist on the server.

The node performs no network requests. It writes one preview PNG per run into
ComfyUI's temp folder, the same place `PreviewImage` writes, which is cleared
with the rest of the session's scratch files.
