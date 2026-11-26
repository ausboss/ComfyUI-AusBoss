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

## Auto

Switch **Auto** on and the node picks the grain for the picture. The grain
looks the same on a small picture and on a big one, and it matches the grain
the picture already has. A clean render, with no grain of its own, starts at
the normal amount of `0.25`.

With Auto on, **Amount** and **Size** become multipliers. `1 ×` is Auto's
pick, `1.5 ×` is half as much again, `2 ×` is twice as big. The small number
beside each box is what you get ("= 0.27", "= 1.0 px"). It shows once the
node knows the picture: right away from a Load Image, or after one run when
the picture comes from another node. Until then it shows a dash.

Auto on and Auto off each keep their own numbers, so switching back loses
nothing. Auto starts off, so workflows saved before it behave as they did.

## Controls

- **Auto** (`auto`): off uses the Amount and Size you set. On, the node
  picks them for the picture.
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

- Auto's size is `1` pixel at 1 megapixel and follows the square root of the
  picture's megapixels, so a 4 MP picture gets `2` px (kept between 0.5 and
  16 px). Its amount is `0.25` plus the picture's own grain divided by
  `0.15`, kept between `0.05` and `1`.
- The picture's own grain is measured in its flat areas: a Laplacian-
  difference filter (Immerkaer, 1996) removes shapes and leaves fine noise,
  and the median of what is left, read from a histogram, gives the noise as
  one standard deviation. Edges and texture are a small part of a picture, so
  the median ignores them. Below `0.0015` (what 8-bit rounding alone
  measures) counts as no grain. A clip is measured on up to four frames.
  The browser measures a Load Image's picture with the same filter, so the
  note beside the boxes agrees with the node's result.
- `auto_amount` and `auto_size` are separate inputs from `amount` and
  `size`, which is why each mode keeps its own numbers.

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
