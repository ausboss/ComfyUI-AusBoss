# Save Video

Encodes a frame batch to an H.264 mp4 in the output folder and shows the
result on the node. The current workflow is embedded in the file, so a saved
video can be dragged back into ComfyUI to restore the graph that made it.

The responsive player is owned by AusBoss rather than stacked on top of a core
preview. It reports encoded dimensions, fps, frame count, and duration, keeps
portrait video contained, and includes **LOOP** and **↻** controls. There is
exactly one saved-video surface per node.

## Controls

- **frames**: BHWC frame batch to encode. Odd dimensions are cropped down one
  pixel to the even sizes H.264 requires.
- **fps**: Playback frame rate. Wire Load Video's `fps` output to keep the
  source timing, including fractional rates like 29.97.
- **filename_prefix**: Path under the output folder; subfolders are created
  automatically.
- **crf**: H.264 quality — lower is better and larger. `19` is visually
  lossless for most content.
- **audio** (optional): A track to mux into the file, e.g. Load Video's
  `audio` output.
- **video** (optional): A core `VIDEO` handle, e.g. Load Video's `video`
  output. Connecting it supersedes the `frames` and `audio` inputs — the
  video's own frames and track are encoded instead.

## Frame rate precedence

A connected `video` brings the rate its frames were cut at, and that rate wins
over the `fps` widget: replaying those frames at a stale widget rate would
drift the picture away from the audio muxed beside it. When the two differ,
one line naming the rate actually used is written to the ComfyUI console. With
nothing connected to `video`, the widget is the only source and the console
stays quiet.

## Output

One `.mp4` file per run. Audio and video land in a single file — there is no
separate audio-less copy.

## While it runs

Encoding happens off ComfyUI's execution thread, so the server keeps answering
while a long batch is written. The node fills its progress bar frame by frame,
and **Cancel** stops the encode within a frame instead of at the end of the
batch.
