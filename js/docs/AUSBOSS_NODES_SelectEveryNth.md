# Select Every Nth

Keeps every nth frame of an `IMAGE` batch — halve a video's frame count
before an expensive stage, or thin a long sweep down to samples.

## Controls

- **images**: The BHWC batch to thin out.
- **nth**: Keep one frame in every `nth`. `2` keeps every other frame, `1`
  keeps everything (useful with **offset** alone to drop leading frames).
- **offset**: Frames to skip before the first kept frame. With `nth` 2,
  offset `0` keeps frames 1, 3, 5 and offset `1` keeps frames 2, 4, 6
  (one-based, as the rest of the pack counts frames).

## Output

- **images**: The kept frames, in their original order.

An offset at or past the end of the batch stops with the batch's size
instead of returning an empty batch, which no downstream node could use.
