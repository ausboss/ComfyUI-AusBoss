# Select Frame Range

Selects a contiguous run of unchanged images from an `IMAGE` batch. Frame
numbers are one-based, so a `start_frame` of `1` begins at the first frame.

## Controls

- **images**: A BHWC image batch, commonly the frame output of a video loader.
- **start_frame**: The one-based first frame of the range. An out-of-range
  value stops with the available range instead of silently clamping.
- **frame_count**: How many frames to keep. `0` keeps everything through the
  last frame; an explicit count that would run past the end stops with the
  available range, so `0` is the deliberate way to say "to the end".

## Outputs

- **images**: The selected frames as an unchanged BHWC sub-batch.
- **frame_count**: The actual number of frames returned, handy for wiring
  into nodes that need the batch length.

The node performs no network requests and writes no files.
