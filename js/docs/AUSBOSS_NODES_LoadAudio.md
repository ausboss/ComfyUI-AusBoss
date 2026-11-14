# Load Audio

Loads a sound file and hands on only the part you pick. Use it for a voice
clip, a song or any sound a video model or a save node takes, when you want
one part of the file and not the whole thing.

The node shows the whole file as a wave, so you can see where the loud parts
are. The part that comes out is bright. Under the wave are three boxes:
**Start**, **Duration** and **Ends at**, in seconds. Drag the left handle to
move the start, drag the right handle or type a Duration to change how long
the sound is, or drag the bright part to slide it. Click somewhere else on
the wave to move it there. Typing **Ends at** sets the Duration for you.

Press **▶** to hear only the part that comes out. **LOOP** plays it again and
again.

Set the Duration to the length the next step needs, such as the length of
the video you are making. An empty Duration runs to the end of the file.

A box set by another node, such as Float 🆎, shows a **linked** button that
jumps to that node, and the wave shows the part that number picks.

## Controls

- **Source** (`audio`): a sound file in ComfyUI's input folder. **Upload**
  adds one. Videos are listed as well, for their sound.
- **Start** (`start_seconds`): where the sound starts.
- **Duration** (`max_seconds`): how long the sound is, in seconds. Empty, or
  `0`, runs to the end of the file.
- **Ends at**: where the sound stops. Typing it sets the Duration.
  A workflow saved with an end time (`end_seconds`) keeps it and runs the
  same.

## Outputs

- `audio`: the part you picked, for any node that takes `AUDIO`.
- `seconds`: how long that sound is.

## Technical details

- Only the picked part is decoded: decoding stops once the window is full,
  so a short pick from a long recording stays quick.
- The sound keeps its own sample rate and channels.
- A start past the end of the file stops the run with a message that says so.
- The wave is drawn in the browser from the file itself; nothing extra is
  stored with the workflow besides the node's own values.
