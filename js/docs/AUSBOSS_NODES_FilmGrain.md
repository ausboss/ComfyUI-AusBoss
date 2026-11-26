# Film Grain

Adds film grain to a picture or a video. Use it at the end of a workflow to
give a clean render the texture of a photo shot on film, or to make a fake
look less smooth and plastic.

The grain is strongest in the midtones and gentler in deep shadows and bright
highlights, the way it is on film. On a video it moves from frame to frame
like real film grain, or stays put if you want a still texture. An optional
mask puts grain only where it is white.

The panel under the card shows the result once the node has run (the first
frame for a video). The small **preview** switch at the right of the bar
turns it off, which also skips writing the preview file.

## Controls

- **Amount** (`amount`): how strong the grain is. `0` adds none, `0.25` is a
  clearly visible film look, `1` is very heavy.
- **Size** (`size`): how big each grain is, in pixels of this picture. `1` is
  fine 35 mm grain on a picture of about 1 megapixel. Raise it on a big
  picture, or for a coarse, fast-film look. Below `1` the grain is smaller
  than a pixel, so it also gets quieter.
- **Roughness** (`roughness`): `0` is soft, even grain. Higher mixes in finer
  grain that bunches up in some places and thins out in others, like real
  film.
- **Color** (`color`): `0` is black-and-white grain, the same in red, green
  and blue. Higher gives each colour its own grain, like the dye clouds of
  colour film. A little (`0.2` to `0.4`) looks most natural on colour
  pictures.
- **Video grain** (`moving`): **moving** gives every frame of a video new
  grain, so it moves like film. **still** puts the same grain on every
  frame, which looks like a texture on the lens. A single picture looks the
  same either way.

### Behind **More**

- **Seed** (`seed`): picks the grain pattern. The same seed always gives
  the same grain, so a re-run gives the same picture. Change it for another
  pattern.

### Inputs and output

- **image**: the picture or video frames.
- **mask** (optional): grain goes only where the mask is white, and fades
  in with a soft mask. One mask can cover every frame, or give one per
  frame. A mask of another size is stretched to the picture.
- **image** (output): the picture or frames with grain, at the same size. A
  picture with a transparent background keeps its transparency.

## Technical details

- Grain is random noise drawn on a grid `size` pixels apart and smoothed up
  to the picture with a bicubic filter, then scaled back to the same
  strength. Below 1 pixel it is drawn finer and averaged down to the
  picture, so its strength falls with its size.
- Roughness adds a second layer at half the size whose strength is varied by
  a slow noise four grains wide, mixed so the total strength stays the same.
  Extreme values are rounded off softly at three standard deviations, so no
  lone white or black speck appears.
- At **Amount** `1` one standard deviation of the grain is `0.15` (on a
  `0` to `1` scale) at mid grey, falling to a fifth of that at black and
  white. The weight follows the picture's own brightness, `4 L (1 - L)`.
- Every frame's grain has its own seed, worked out from the node's seed and
  the frame number, so a frame's grain does not depend on how long the clip
  is. Frames are worked on eight at a time: 81 frames at 1920 x 1080 take
  about 12 seconds on a desktop CPU, with only a few frames' worth of extra
  memory.
