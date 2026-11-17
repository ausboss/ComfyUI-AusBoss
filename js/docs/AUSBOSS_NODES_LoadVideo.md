# Load Video

Loads a video from ComfyUI's input folder as an `IMAGE` frame batch plus its
audio. The player shows the video; the timing card under it picks the part
that comes out.

The timing card has three boxes: **Start**, **Duration** and **Ends at**.
Drag the left handle on the bar to move the start, drag the right handle or
type a Duration to change how long the clip is, or drag the middle of the
clip to slide it. **s | fr** switches every box between seconds and frames;
it only changes what you see, never a saved value. **Use as start** starts
the clip at the frame in the picture, and **Whole video** puts the clip back
to the full file. In **Source**, the list plays the clip under the pointer,
muted, and filters as you type.

The player takes the height you give the node: drag the node taller for a
bigger picture. A tall video is shown whole, never cropped. **LOOP** plays
the clip again and again; with it off, playback pauses at the clip's end.
The reload button refreshes the source.

**FRAME** turns the loader into a frame picker: only the frame at the marker
loads, as a one-image batch, ready for image workflows without a separate
frame-select node. Drag the bar to choose the frame, or type it into the
**FRAME** box. Playback runs the whole video in this mode so you can hunt for
the right moment. Picking a frame moves the clip's start there.

The boxes count real frames: the frame rate and frame count come from the
file itself, so a 4.1 s clip at 60 fps reads 247 frames, the same number
the run loads. When a box is set by another node it shows a **linked**
button that jumps to that node.

## Drop a video onto the node

Dropping a video file onto this node makes it the node's source: the file is
copied into ComfyUI's input folder (re-dropping identical content reuses the
existing copy) and selected, while the rest of your canvas stays put. If the
file is an mp4 or mov saved by Save Video 🆎, the workflow embedded in it is read too, and the
trim, `every_nth`, `max_frames`, sizing and FRAME values its Load Video node
stored are restored onto this one — the clip reopens the way it was loaded
before. The same file dropped on empty canvas keeps its old meaning: the
embedded workflow replaces the whole graph.

## Controls

- **Source** (`video`): A file in the input folder; **Upload** adds new ones.
  A video ComfyUI made, named like `clip.mp4 [output]`, loads too.
- **Start** (`start_seconds`): Skip everything before this time.
- **Duration** (`max_frames`): How many frames the clip keeps. **Whole
  video** removes the limit, so the clip runs to the end (the widget holds
  `0`). The decode stops early, so a short clip from a long video stays
  quick.
- **Ends at**: Where the clip stops. Typing it sets the Duration. A
  workflow saved with an end time (`end_seconds`) keeps it and runs the same.
- **Every nth** (`every_nth`): Keep one frame in this many; `2` halves the
  frame count. The `fps` output divides to match, so the clip still plays at
  real speed downstream.
- **LOOP**: Repeat the clip during preview. It starts on and is saved with
  the workflow.
- **FRAME** (`single_frame`): Load only the frame at the marker as a
  one-image batch; the Duration and Every nth are ignored while it is on.
- **↻**: Reload the source preview.
- **Width** / **Height** (`custom_width` / `custom_height`): `0` keeps the
  source size. Set one side only and the other follows the aspect ratio,
  rounded to an even number.

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
