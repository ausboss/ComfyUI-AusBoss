# Save Video

Encodes a frame batch to the output folder and shows the result on the node.
The current workflow is embedded in the file, so a saved video can be dragged
back into ComfyUI to restore the graph that made it.

The responsive player is owned by AusBoss rather than stacked on top of a core
preview. It reports encoded dimensions, fps, frame count, and duration, keeps
portrait video contained, and has a **LOOP** control. There is exactly one
saved-video surface per node. `gif` and `webp` are shown as images, since a
video element cannot play either.

## Controls

- **frames**: BHWC frame batch to encode. For the subsampled formats, odd
  dimensions are cropped down one pixel to the even sizes they require.
  Optional only because a connected `video` brings its own frames — connect
  one or the other.
- **fps**: Playback frame rate. Wire Load Video's `fps` output to keep the
  source timing. It steps in whole frames but stays a float, because the real
  broadcast rates are 23.976, 29.97 and 59.94 — those can be typed in, and an
  integer input would refuse Load Video's `fps` link entirely.
- **filename_prefix**: Path under the output folder; subfolders are created
  automatically.
- **crf**: Quality — lower is better and larger. `19` is visually lossless for
  h264. What it means locally depends on the codec; see the format table.
- **format**: Container and codec, see below.
- **pingpong**: Plays the clip forward then backward so it loops seamlessly.
  Roughly doubles the frame count and the encode time. The first and last
  frames are not repeated at the turnaround, so the loop does not hitch.
- **save_metadata**: On by default. Turn it off to share a file without your
  prompt and node graph embedded in it.
- **audio** (optional): A track to mux into the file, e.g. Load Video's
  `audio` output.
- **video** (optional): A core `VIDEO` handle, e.g. Load Video's `video`
  output. Connecting it supersedes the `frames` and `audio` inputs — the
  video's own frames and track are encoded instead. Core decodes it in one
  uninterruptible step; see *The one phase Cancel cannot reach* below.

## Frame rate precedence

A connected `video` brings the rate its frames were cut at, and that rate wins
over the `fps` widget: replaying those frames at a stale widget rate would
drift the picture away from the audio muxed beside it. When the two differ,
one line naming the rate actually used is written to the ComfyUI console. With
nothing connected to `video`, the widget is the only source and the console
stays quiet.

## Formats

| format | what it is | audio | crf means |
| --- | --- | --- | --- |
| `mp4 h264` | the default; plays everywhere | AAC | `crf` |
| `mp4 h265` | about half the size at the same quality, where supported | AAC | `crf` |
| `mp4 h264 nvenc` | h264 encoded on an NVIDIA GPU — much faster, slightly larger | AAC | `cq` |
| `mp4 h265 nvenc` | h265 on the GPU | AAC | `cq` |
| `webm vp9` | web delivery | Opus | `crf` |
| `webm av1` | newer, smaller than vp9 | Opus | `crf` |
| `mov prores` | ProRes HQ editing master; large | PCM | ignored |
| `mkv ffv1` | bit-exact lossless; very large | FLAC | ignored |
| `gif` | short silent loop, per-frame adaptive palette | none | ignored |
| `webp` | short silent loop, much smaller than gif | none | quality |

The nvenc formats need an NVIDIA GPU with a working driver, and refuse frames
below roughly 145x49. If the encoder cannot start, the node says so and names
a software format to use instead rather than failing with a driver stack
trace.

`gif` and `webp` have no streaming encoder, so every frame is held in memory
before the first byte is written — keep those to short clips. Neither carries
metadata, so an embedded workflow is not available for them.

## Output

One file per run. Audio and video land in a single file — there is no separate
audio-less copy. The embedded workflow survives in mp4, mov, webm and mkv;
matroska uppercases the tag names, which is only visible to tools that read
them directly.

## While it runs

Encoding happens off ComfyUI's execution thread, so the server keeps answering
while a long batch is written. The node fills its progress bar frame by frame,
and **Cancel** stops the encode within a frame instead of at the end of the
batch. Muxed audio is encoded after the picture, so the bar restarts and counts
that track's AAC frames; **Cancel** stops there within one of them.

### The one phase Cancel cannot reach

Connecting `video` adds a step this node does not control. ComfyUI core reads
the whole file — every frame, decoded to float32 — before the first frame
reaches this pack, and the core call that does it, `VideoInput.get_components()`,
takes no progress or interrupt argument to pass one in. So that phase shows no
progress and does not stop on **Cancel**: the cancel is registered right away
(the decode runs off the execution thread, so the server still answers) and
takes effect at the first frame of the encode, once control returns here.

How long that lasts scales with pixels, not with file size. Measured on one
desktop: ten seconds of 832x480 at 16 fps came back in about 0.6 s, while ten
seconds of 1080p at 30 fps took about 7 s and held 7.5 GB of frames in memory.
Minutes of high-resolution footage are the case to avoid — RAM runs out before
the wait does. Wiring Load Video's `frames` output instead of `video` keeps the
whole run interruptible and progress-tracked, since that decode is this pack's
own loop.
