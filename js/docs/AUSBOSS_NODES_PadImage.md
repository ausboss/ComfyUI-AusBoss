# Pad Image

Extends the canvas outward on any side and fills the new space four different
ways. The second output is a mask covering exactly the padding — wire it
straight into an inpainter as the outpaint mask, no extra mask node needed.

## The on-node canvas

The stage drawn on the node is the control: **drag any edge of the dashed
final rect** to grow that side's padding — the whole edge is the handle, and
the badge always shows the final output size. Because the source arrives on
an IMAGE wire, the stage previews the real pixels after the first run
("Run once to preview"); until then it shows the geometry as a wireframe.
The hidden `pad_left/top/right/bottom` widgets hold the real values, so
undo, save/load, and the API format are unchanged.

## Guarantees

- The original pixels land **bit-identical** at their position in every mode.
- The mask is `1.0` over every padded pixel and `0.0` over the original.

## Controls

- **pad_left / pad_top / pad_right / pad_bottom**: Pixels added per side.
- **mode**:
  - `color` — solid fill with **fill_color**.
  - `edge` — each side becomes a flat band of the average color of the
    nearest image edge; corners blend their two adjoining sides. Clean and
    quiet, good under diffusion outpainting.
  - `edge pixel` — the outermost rows and columns smear outward; corner
    quadrants continue the corner pixel. Streaky, keeps local color context.
  - `pillarbox blur` — the image itself is stretched to cover the canvas,
    center-cropped, blurred and dimmed, and the sharp original sits on top.
    The classic vertical-video backdrop.
- **fill_color**: Used by the `color` mode only. Accepts `#RGB`/`#RRGGBB`
  hex, `R, G, B` (0-255 or 0..1 floats), one grayscale number, or a CSS
  color name; unparseable values fall back to mid-gray.
- **backdrop_blur**: Pillarbox only — one knob that scales both the blur and
  the dimming. The blur sigma is proportional to the canvas size, so the
  same value produces the same look at any resolution.

## Outputs

- **image**: The padded image.
- **mask**: The ready-made outpaint mask (white = padding).

## Notes

For outpainting, pad with `edge` or `edge pixel`, then feather the mask a
little with **Refine Mask 🆎** if the sampler leaves a visible seam.
