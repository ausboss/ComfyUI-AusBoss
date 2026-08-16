# Video Bundle Edit

Copies an `AUSBOSS_VIDEO` bundle, overriding only the inputs that are
connected. Part of the bundle family described in
[Video Bundle](AUSBOSS_NODES_VideoBundle.md).

## Inputs

- **video**: The bundle to copy. It is never modified in place — downstream
  branches wired to the original keep seeing the original.
- **frames** (optional): Replaces the bundled frames. Frame count, size, and
  duration are re-derived from the new batch.
- **audio** (optional): Replaces the bundled audio. There is no way to clear
  audio back to silence here — rebuild with Video Bundle for that.
- **fps** (optional, connection only): Replaces the bundled frame rate;
  duration is recomputed from the new rate.

Unconnected inputs keep the original values untouched.

## Output

- **video**: The edited copy, with `frame_count`, `width`, `height`, and
  `duration` recomputed wherever a replacement made them stale.

## Typical use

Run a bundle's frames through processing (interpolation, inpainting, color
work), then feed the original bundle plus the new frames here: timing and
audio ride through unchanged while the picture is swapped out.
