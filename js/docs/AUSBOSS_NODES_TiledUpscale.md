# Tiled Upscale

Sets how big the finished picture should be and cuts your picture into
tiles a model can redraw one at a time. Use it to take a picture past the
size your model can redraw in one go.

Wire it like this: **Tiled Upscale 🆎** → your encode, sampler and decode
→ **Tiled Upscale Stitch 🆎**. Plug `stitcher` straight across. The nodes
in between run once for each tile by themselves.

## Megapixels

**Megapixels** (`megapixels`) is the size of the finished picture. It moves
in half steps, and you can type any number. `0` keeps the picture's own
size, for a light pass over a picture that is already big.

- A picture that fits in one tile stays whole: one pass, no joins.
- A bigger one is cut into the fewest tiles that fit, as square as they
  can be.
- A small picture is not redrawn far past the detail it has. It is redrawn
  at up to 8 times its own megapixels and enlarged the plain way from
  there. **Redraw limit** under More changes that.

The `report` output says what was done with your picture, for example
`736 x 1308 px (0.96 MP) to 2112 x 3776 px (7.97 MP): redrawn at 7.97 MP in
4 tiles of 1120 x 1952 px.` Wire it to **Show Text 🆎** to read it. It also
says when the size you asked for is too close to your picture's own size
to show a difference, and when your picture is made smaller.

A size under your picture's own makes the picture smaller first. That is
the way to restore a big photo that is noisy or soft: set 2, run, then load
the result and set the size you want. Cut at its own size, such a photo's
tiles can come back grainy.

## More

Click **More** for the rest. The defaults are the ones that held in tests.

- **Tile size** (`tile_megapixels`): the most your model redraws at once.
  2 suits Qwen Image 2.1 and Krea 2. Use 1 for SDXL.
- **Overlap** (`overlap`): how many pixels neighbouring tiles share.
  Tiled Upscale Stitch blends the join across this strip.
- **Multiple** (`multiple`): every tile's width and height is a multiple of
  this. 32 works with every model tried, and Qwen Image 2.1 needs it.
- **Redraw limit** (`max_growth`): how many times its own megapixels a
  picture may be redrawn at. Raise it to redraw a tiny picture at a big
  size anyway.

## Upscale model

`upscale_model` is optional. Plug in ComfyUI's **Load Upscale Model** and
the picture is enlarged with that model before it is cut. Unplugged, it is
enlarged the plain way. Use a model when the pass after it is a light one
that keeps what it is given, such as a low denoise.

## Outputs

- **tiles**: the tiles, one after another.
- **stitcher**: what Tiled Upscale Stitch 🆎 needs to put them back together.
- **before**: your picture enlarged the plain way to the finished size, for
  a before and after.
- **width**, **height**: the finished size in pixels.
- **report**: what was done with your picture.

## Technical details

- The finished size follows the same rule as **Image Resize 🆎** in
  megapixels mode with the same Multiple: each side is scaled, then snapped
  to the nearest multiple. A megapixel here is 1,000,000 pixels.
- One tile may run up to about 16% over Tile size before the picture is
  cut, so a "2 megapixel" picture on a 32 px grid stays whole.
- Tiles are all the same size. The plan uses the fewest that fit under
  that limit and avoids tiles more than 2.2 times as long as they are wide.
  They are spread evenly, so neighbours share at least the Overlap you set.
- When the redraw limit still reaches 90% of the size you asked for, the
  picture is redrawn at the full size.
- A picture of a megapixel or more showed little change in tests unless it
  grew about 1.6 times per side. The report says so and names a size to ask
  for.
- A batch of pictures is cut the same way: every tile holds the whole
  batch. A see-through channel is dropped, so tiles are plain RGB.
- With an upscale model, ComfyUI's own Upscale Image (using Model) node
  runs as often as it takes to cover the redraw size, then the picture is
  brought to the exact size. The `before` picture never uses the model.
- The plan stops at 144 tiles and says so.
- A big worn photo, seen on one 8 megapixel test picture with noise and
  JPEG damage: kept at its size in four tiles the skin came back grainy;
  set to 2 megapixels first and then taken to 8 in tiles it came back
  clean. A sharp 13.5 megapixel picture kept at its size hardly changed.
- Measured on an RTX 5090 with Qwen Image 2.1 at 8 steps: a 1 megapixel
  phone photo to 8 megapixels in four tiles took about 37 seconds.
