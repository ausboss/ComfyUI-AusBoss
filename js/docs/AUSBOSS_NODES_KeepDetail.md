# Keep Detail

Puts the fine detail of your original picture back on an edited version of
it. Use it when an edit, a relight or an upscale made skin, fabric or wood
look too smooth: the edit keeps its shapes, light and colour, and the pores,
weave and grain come from the original.

The two pictures must line up, pixel for pixel. Wire the edit to **image**
and the original to **detail_from**. If an edit drifted (Qwen Image often
draws an edit a little bigger or shifted), run it through Realign to Source
first, or the detail lands in the wrong place and doubles up.

If **detail_from** is a different size from the edit, it is resized to the
edit's size first. That only helps when it is the same picture at another
size; the pictures still have to line up.

The panel under the card shows the result once the node has run. The small
**preview** switch at the right of the bar turns it off.

## Live preview

Once the node has a picture, the picture on the node redraws while you drag a
value, before you queue anything. Run the graph once to give the node its
picture (run once to get the picture); after that it changes as you drag. A small "not run yet" tag
shows while the picture is a preview and not a real result.

The **Fit | 100%** switch sits on the bar above the picture, left of Preview.
Fit shows the whole picture. 100% shows real pixels, and dragging on the
picture moves around it instead of moving the node. Fine detail is easiest to judge at 100%.


## Controls

- **Detail size** (`detail_size`): detail smaller than this many pixels
  comes from the original; anything bigger stays the edit's. `2` to `6` suits
  skin and fabric. Larger brings back more of the original, until it starts
  to bring back the old picture's light and shapes too.
- **Strength** (`strength`): `0` leaves the edit as it is, `1` puts the
  original's detail on it in place of the edit's own, above `1` makes the
  original's detail stronger.
- **Detail** (`color_detail`): **light only** brings back only how bright
  or dark the detail is, so the edit's colours never shift. **color +
  light** brings back the detail's colour too, such as freckles, stains or
  a coloured weave. Use it when the edit kept the original's colours.

### Behind **More**

- **Edge safe** (`edge_safe`): on by default. Strong edges, such as a
  jaw against a bright wall, are left as the edit has them, so no light or
  dark rim appears along them. Turn it off when the edit also blurred
  strong edges and you want those back from the original as well.

### Inputs and output

- **image**: the edited picture.
- **detail_from**: the original picture, lined up with the edit.
- **mask** (optional): detail goes back only where the mask is white, such
  as on skin alone.
- **image** (output): the edit with the original's detail, at the edit's
  size.

Both pictures can be videos. One picture on either side goes with every
frame of the other.

## Technical details

- Each picture is split into a base and detail. The base is the picture
  smoothed over `detail_size` pixels; the detail is what the smoothing took
  away. The result is the edit's base with the original's detail.
- The split is a ratio in linear light, not a difference. Detail is how much
  brighter or darker each pixel is than its base, as a factor: pores that
  are 8 % darker than the skin around them stay 8 % darker on a darker,
  relit face. A difference would carry a bright original's texture too
  strong into a dark edit and too weak into a bright one. Linear light is
  the picture with the sRGB curve taken off, where light adds up
  physically, so a factor means the same in shadows and highlights.
- With **light only** the factor comes from the luminance (Rec. 709 weights)
  and multiplies red, green and blue alike, so the colour of every pixel
  stays the edit's. With **color + light** each channel has its own factor.
- The base is a Gaussian blur with a radius of `detail_size`, or with
  **Edge safe** a guided filter (He, Sun and Tang, 2010) of the picture by
  itself over a box of the same spread: it smooths texture but follows a
  strong edge, so the detail at that edge stays near nothing. A step that
  varies the values around it by more than about `0.15` counts as an edge;
  skin, fabric and wood grain vary them less. The smoothing runs on the
  sRGB-curved values, where an edge's size matches how strong it looks.
- Strength `s` mixes the two details: the edit's own to the power `1 - s`
  (for `s` up to `1`) times the original's to the power `s`. At `0` the
  result is the edit, unchanged.
- Frames are worked on four at a time.

### Live preview

The preview runs the node's own maths in the browser: on a copy shrunk to the
size it is shown at in Fit, and on a real-pixel crop of the picture in 100%.
It is checked against the Python node on recorded values (`tests/test_live_parity.py`);
results agree to within 5e-5 on a 0 to 1 scale. The picture is the one the
last run kept, or a Load Image read through ComfyUI's own view route. When
the values match the last run, the real result is drawn instead.
