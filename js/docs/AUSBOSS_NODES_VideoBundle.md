# Video Bundle

Three nodes share one custom wire type, `AUSBOSS_VIDEO`, so a whole video —
frames, audio, and timing — travels the graph as a single connection instead
of three or four parallel wires.

A bundle carries `frames`, `audio`, and `fps`, plus `frame_count`, `width`,
`height`, and `duration`. The last four are derived from the frames tensor
and fps whenever a bundle is built or edited, so they can never drift out of
sync with the frames they describe.

## Video Bundle

Packs a video into one wire.

- **frames**: BHWC frame batch, e.g. Load Video's frames output.
- **fps**: Playback frame rate stored in the bundle. Wire Load Video's fps
  output to keep the source timing.
- **audio** (optional): A track carried alongside the frames. Leave it
  unconnected for a silent bundle.

Output: **video** — the `AUSBOSS_VIDEO` bundle.

## Video Unbundle

Unpacks a bundle back into individual wires.

Outputs, in order: **frames**, **audio**, **fps**, **frame_count**,
**width**, **height**, **duration**.

The **audio** output is empty (`None`) when the bundle was built without an
audio track, so only wire it into nodes that accept optional audio — such as
Save Video's optional audio input — unless you know the bundle carries sound.

## Video Bundle Edit

Copies a bundle, overriding only the inputs that are connected.

- **video**: The bundle to copy; it is never modified in place.
- **frames** (optional): Replaces the bundled frames; frame count, size, and
  duration follow the new batch.
- **audio** (optional): Replaces the bundled audio. There is no way to clear
  audio back to silence here — rebuild with Video Bundle for that.
- **fps** (optional, connection only): Replaces the bundled frame rate;
  duration is recomputed from the new rate.

Unconnected inputs keep the original values untouched.

None of these nodes perform network requests or write files.
