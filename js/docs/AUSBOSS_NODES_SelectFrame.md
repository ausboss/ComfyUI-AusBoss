# Select Frame

Selects one unchanged image from an `IMAGE` batch. Frame numbers are one-based,
so `1` is the first frame and the last valid value is the batch size.

## Controls

- **frames**: A BHWC image batch, commonly the frame output of a video loader.
- **frame_number**: The one-based frame to return. An out-of-range value stops
  with the available range instead of silently clamping.

## Output

- **image**: The selected frame as a one-image BHWC batch.

The node performs no network requests and writes no files.
