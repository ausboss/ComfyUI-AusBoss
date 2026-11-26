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

## Copy the grain of another picture

Wire a picture whose grain you like into **grain_from** and switch Auto on.
Its switch now reads **match**: the node reads how strong, how big and how
colourful that picture's grain is, and adds grain like it. A film scan, a
still from a film or a photo you like all work.

- **Amount**, **Size** and **Color** count from the match, the same way as
  Auto's pick: `1 ×` is the match, and the small number beside each box is
  what you get. **Roughness** stays yours; the match does not read it.
- Grain is matched at the same viewing size. The picture to copy from is
  scaled to your picture's size first, so grain from a big photo comes out
  finer on a small picture, as it would look side by side on screen.
- Only the plainest patches are read: a sky, a wall, skin. A picture that is
  all busy texture (gravel, leaves, a tiled floor) reads stronger grain than
  it has; turn **Amount** down, or copy from a plainer picture.
- Grain your picture already has counts. A grainy picture gets only the
  grain it is missing, and a reference with less grain than yours adds none.
- The match is worked out when the node runs. Until the first run the
  numbers show a dash and the picture asks for a run; after it, the live
  preview uses the match while you drag. A video is read from its first
  frame, and so is a video wired in to copy from.
- Without a picture on grain_from, Auto picks the grain as above. Auto off
  ignores grain_from.

## Live preview

Once the node has a picture, the picture on the node redraws while you drag a
value, before you queue anything. Run the graph once to give the node its
picture (an image connected is enough once it has run; a Load Image shows at once); after that it changes as you drag. A small "not run yet" tag
shows while the picture is a preview and not a real result.

The **Fit | 100%** switch sits on the bar above the picture, left of Preview.
Fit shows the whole picture. 100% shows real pixels, and dragging on the
picture moves around it instead of moving the node. At 100% you see the grain at the size it will have in the saved picture.


## Controls

- **Auto** (`auto`): off uses the Amount and Size you set. On, the node
  picks them for the picture, or reads **match** and copies the grain of the
  picture on grain_from.
- **Amount** (`amount`): how strong the grain is. `0` adds none, `0.25` is a
  clearly visible film look, `1` is very heavy.
- **Size** (`size`): how big each grain is, in pixels of this picture. `1` is
  fine 35 mm grain on a picture of about 1 megapixel. Raise it on a big
  picture, or for a coarse, fast-film look. Below `1` the grain is smaller
  than a pixel, so it also gets quieter.
- **Roughness** (`roughness`): `0` is soft, even grain. Higher mixes in finer
  grain that bunches up in some places and thins out in others, like real
  film.
- **Color** while matching (`auto_color`): a multiplier of the matched
  colour. `0` turns the copied grain black-and-white.
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
- **grain_from** (optional): a picture whose grain to copy while Auto is
  on. It can be any size and shape.
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
- The grain match (`nodes/_grain_match_helpers.py`) scales the picture to
  copy from to the target's megapixels, its shape kept, and reads both
  pictures' first frames. Each is shrunk by 1 to 12 times; at each size the
  fine detail (mean absolute Laplacian, as a standard deviation) of the
  plainest fifth of the mid-tone 16 px blocks gives the brightness grain, and
  the same blocks of two colour-difference channels give the colour grain.
  The target's own grain at each size is taken off (in quadrature). How the
  grain falls off over the sizes is fitted, in log space, to a stored table
  of Film Grain's own grain at sizes 1 to 16 px and colours 0 to 1
  (`nodes/_grain_match_table.py`), with a mild pull toward size 1; grain
  smaller than a pixel reads as size 1 and a lower amount, which looks the
  same. The colour comes from the colour grain against the brightness grain,
  and the amount is checked twice by adding the grain to the target and
  correcting it. On Film Grain's own grain the match reads back its settings
  (0.40 / 2.0 px / 0.3 reads 0.41 / 2.0 px / 0.3); a 1 MP pair takes about
  a third of a second on the CPU.

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

### Live preview

The preview runs the node's own maths in the browser: on a copy shrunk to the
size it is shown at in Fit, and on a real-pixel crop of the picture in 100%.
It is checked against the Python node on recorded values (`tests/test_live_parity.py`);
results agree to within 5e-5 on a 0 to 1 scale. The picture is the one the
last run kept, or a Load Image read through ComfyUI's own view route. When
the values match the last run, the real result is drawn instead.
