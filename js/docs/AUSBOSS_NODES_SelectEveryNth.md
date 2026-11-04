# Select Every Nth

Keeps every nth frame of an `IMAGE` batch — halve a video's frame count
before an expensive stage, or thin a long sweep down to samples.

## Controls

- **images**: The BHWC batch to thin out.
- **Every nth** (`nth`, starts at `2`): Keep one frame in every `nth`. `2`
  keeps every other frame, `1` keeps everything (useful with **Offset**
  alone to drop leading frames).
- **Offset** (`offset`, starts at `0`): Frames to skip before the first kept frame. With `nth` 2,
  offset `0` keeps frames 1, 3, 5 and offset `1` keeps frames 2, 4, 6
  (one-based, as the rest of the pack counts frames).
- **fps** (optional socket): The batch's frame rate, such as Load Video's
  `fps` output.

## Outputs

- **images**: The kept frames, in their original order.
- **fps**: The wired rate divided by `nth`, to keep playback speed;
  `0` when no fps is wired. Offset removes the start, and rounding to whole
  frames can change the duration. Five frames thinned by `2` give three
  frames at half the rate, which lasts slightly longer.

An offset at or past the end of the batch stops with the batch's size
instead of returning an empty batch, which no downstream node could use.
