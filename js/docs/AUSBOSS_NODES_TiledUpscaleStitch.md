# Tiled Upscale Stitch

Puts the tiles back together after your model has redrawn them and gives
you the finished picture, at the size you asked for in
**Tiled Upscale 🆎**.

Wire the redrawn tiles into `tiles` and the `stitcher` from Tiled
Upscale into `stitcher`. That is all it needs.

## Keep colors

**Keep colors** (`keep_colors`) matches each tile to the same tile of your
picture before the tiles are joined.

- **1** keeps your picture's colors. It also makes the tiles agree with
  each other, so no tile comes out a shade lighter than its neighbour.
- Lower lets the model's own colors through.
- **0** turns it off. Use that when the model was asked to change the
  colors.

Grain and color noise in an old photo do not throw it off, and a faded
photo comes back faded.

## Technical details

- Neighbouring tiles are blended across the strip they share, fading from
  one into the other, so a join has no hard line.
- A tile that came back at another size is fitted to its place first.
- A see-through channel on a tile is dropped: the result is plain RGB.
- The tiles can arrive one after another or as one batch in the same
  order. A different number of tiles than the stitcher expects stops the
  run and says how many it got.
- When the picture was redrawn smaller than the size you asked for (a
  small picture, see Redraw limit on Tiled Upscale), the joined redraw
  is enlarged the plain way to that size.
- Keep colors compares each redrawn tile with its own source tile on small
  averaged copies and fits lightness and the two color channels (LAB) with
  a straight line each. A fit follows what both pictures share, so noise in
  the source does not count as color. On eleven noisy test photos with
  known originals the result's color spread stayed within 3% of the
  original's; matching the spread itself, as **Color Match 🆎** does for a
  reference that shows something else, was 47% over on average.
