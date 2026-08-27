# Load Video

Loads a video from ComfyUI's input folder as an `IMAGE` frame batch plus its
audio. One responsive player shows the source and previews the selected trim.
Drag the high-contrast **IN** and **OUT** handles below it, drag the selected
range to move the whole window, or type exact seconds into the two fields.
The playhead follows each edit, so the frame at either boundary is visible
while trimming.

Playback is constrained to the selected window. **LOOP** repeats it; turn loop
off and playback pauses at OUT. The reload button refreshes the source without
creating a second preview. Tall videos use `object-fit: contain`, and the player
height follows the node width with a compact lower bound.

**FRAME** switches the loader into a frame picker: the trim strip becomes a
single scrub rail, and only the frame at the marker loads — a one-image batch,
ready for image workflows without a separate frame-select node. Click or drag
anywhere on the rail to choose the frame, or type an exact time into the AT
field. Playback runs the whole source freely in this mode so you can hunt for
the right moment; the trim window returns untouched when you toggle back.

The label between IN and OUT reports what one Run will actually load — e.g.
`0:04.0 of 0:10.0 · 48 frames @ 12 fps`, or `1 frame at 0:05.2` while FRAME
is on. The preview cannot re-render `every_nth` frame drops or a `max_frames`
cap, so it counts them instead: the frame total and playback rate come from
the source's real frame rate (probed from the file, since the browser's
player never exposes it) with `every_nth` and `max_frames` applied. When a
deciding value arrives over a link, or the rate cannot be probed, the count
drops out rather than guessing.

## Drop a video onto the node

Dropping a video file onto this node makes it the node's source: the file is
copied into ComfyUI's input folder (re-dropping identical content reuses the
existing copy) and selected, while the rest of your canvas stays put. If the
file is an AusBoss save, the workflow embedded in it is read too, and the
trim, `every_nth`, `max_frames`, sizing and FRAME values its Load Video node
stored are restored onto this one — the clip reopens the way it was loaded
before. The same file dropped on empty canvas keeps its old meaning: the
embedded workflow replaces the whole graph.

## Controls

- **video**: A file in the input folder; the upload button adds new ones.
- **IN / start_seconds**: Skip everything before this time.
- **OUT / end_seconds**: Stop at this time; `0` means the source end until a
  handle is moved.
- **every_nth**: Keep one frame in this many — `2` halves the frame count.
  The `fps` output divides to match, so the clip still plays at real speed
  downstream.
- **max_frames**: Stop after this many kept frames; `0` loads the whole trim
  window. Caps memory on long clips — the decode ends early instead of
  loading and discarding.
- **LOOP**: Repeat the selected window during preview.
- **FRAME / single_frame**: Load only the frame at the IN time as a one-image
  batch; `end_seconds`, `every_nth`, and `max_frames` are ignored while it is
  on.
- **↻**: Reload the selected source preview.
- **custom_width / custom_height**: `0` keeps the source size. Set one side
  only and the other follows the aspect ratio, rounded to an even number.

## Outputs

- **frames**: Trimmed BHWC frame batch.
- **audio**: The same trim window; a silent track when the file has no audio.
- **frame_count / fps / width / height / duration**: Ready-made wiring for
  video combine nodes and info displays. `fps` is the source rate divided by
  `every_nth`; `duration` covers the returned frames, not the whole file.
- **video**: A lazy core `VIDEO` handle for the same source trim at its native
  size. Connect it directly to core video-aware nodes without materializing a
  second frame batch. `every_nth` does not apply to it — the `VIDEO` wire
  carries the source as-is — though a `max_frames` cap shortens its window
  to match the kept frames. Older ComfyUI cores without the `VIDEO` API return no
  handle; the original seven outputs remain unchanged.

The trim window is decoded directly — untrimmed parts of the video are never
loaded into the `frames` output, while the `video` output stays lazy until a
downstream consumer requests it.

## While it runs

Decoding happens off ComfyUI's execution thread, so the server keeps answering
while a long trim loads. The node fills its progress bar frame by frame
whenever the source declares a frame count, and **Cancel** stops the decode
within a frame instead of at the end of the file.
