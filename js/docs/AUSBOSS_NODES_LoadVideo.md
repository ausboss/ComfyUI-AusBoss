# Load Video

Loads a video from ComfyUI's input folder as an `IMAGE` frame batch plus its
audio. The built-in preview plays the file, and the **set start** / **set end**
buttons capture the playhead into `start_seconds` / `end_seconds`, so trimming
is: scrub, click, done.

## Controls

- **video**: A file in the input folder; the upload button adds new ones.
- **start_seconds**: Skip everything before this time.
- **end_seconds**: Stop at this time; `0` plays through to the end.
- **custom_width / custom_height**: `0` keeps the source size. Set one side
  only and the other follows the aspect ratio, rounded to an even number.

## Outputs

- **frames**: Trimmed BHWC frame batch.
- **audio**: The same trim window; a silent track when the file has no audio.
- **frame_count / fps / width / height / duration**: Ready-made wiring for
  video combine nodes and info displays. `duration` covers the returned
  frames, not the whole file.

The trim window is decoded directly — untrimmed parts of the video are never
loaded into memory.
