# Load Audio

Loads a sound file and hands on only the part you pick. Use it for a voice
clip, a song or any sound a video model or a save node takes, when you want
one part of the file and not the whole thing.

The node shows the whole file as a wave, so you can see where the loud parts
are. The part that comes out is bright. Drag the white **IN** and **OUT**
handles to set where it starts and stops, drag the bright part to slide it,
or click somewhere else on the wave to move it there. You can also type a time
under the wave, in seconds (`12.5`) or minutes and seconds (`1:02.5`).

Press **▶** to hear only the part that comes out. **LOOP** plays it again and
again.

## Max length

Set **Max length** to the longest sound the next step can take, such as the
length of the video you are making. The start stays where it is, and anything
past the limit turns red with a dashed line where it is cut. Next to OUT,
the node shows how long the sound that comes out is, such as `15.0 s`. It
turns red when part of your pick is cut; hold the mouse over it to see how
much, and click it to move OUT to the cut. Play stops at the cut, so what you
hear is what comes out. `0` means no limit.

Max length can be wired. When the wire comes from a number node such as
Float 🆎, the wave shows the cut for that number; otherwise the length's tooltip says
`max wired` and the run still cuts the sound to the wired length.

## Controls

- **Source** (`audio`): a sound file in ComfyUI's input folder. **Upload**
  adds one. Videos are listed as well, for their sound.
- **Max length** (`max_seconds`): the longest the sound may be, in seconds.
  `0` means no limit.
- **IN** (`start_seconds`): where the sound starts.
- **OUT** (`end_seconds`): where the sound stops. `0` means the end of the
  file.

## Outputs

- `audio`: the part you picked, for any node that takes `AUDIO`.
- `seconds`: how long that sound is.

## Technical details

- Only the picked part is decoded: decoding stops once the window is full,
  so a short pick from a long recording stays quick.
- The sound keeps its own sample rate and channels.
- A start past the end of the file stops the run with a message that says so.
- The wave is drawn in the browser from the file itself; nothing extra is
  stored with the workflow besides the four values above.
