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

## Controls

- **video**: A file in the input folder; the upload button adds new ones.
- **IN / start_seconds**: Skip everything before this time.
- **OUT / end_seconds**: Stop at this time; `0` means the source end until a
  handle is moved.
- **LOOP**: Repeat the selected window during preview.
- **↻**: Reload the selected source preview.
- **custom_width / custom_height**: `0` keeps the source size. Set one side
  only and the other follows the aspect ratio, rounded to an even number.

## Outputs

- **frames**: Trimmed BHWC frame batch.
- **audio**: The same trim window; a silent track when the file has no audio.
- **frame_count / fps / width / height / duration**: Ready-made wiring for
  video combine nodes and info displays. `duration` covers the returned
  frames, not the whole file.
- **video**: A lazy core `VIDEO` handle for the same source trim at its native
  size. Connect it directly to core video-aware nodes without materializing a
  second frame batch. Older ComfyUI cores without the `VIDEO` API return no
  handle; the original seven outputs remain unchanged.

The trim window is decoded directly — untrimmed parts of the video are never
loaded into the `frames` output, while the `video` output stays lazy until a
downstream consumer requests it.

## While it runs

Decoding happens off ComfyUI's execution thread, so the server keeps answering
while a long trim loads. The node fills its progress bar frame by frame
whenever the source declares a frame count, and **Cancel** stops the decode
within a frame instead of at the end of the file.
