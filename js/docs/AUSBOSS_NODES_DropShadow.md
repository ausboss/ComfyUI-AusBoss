# Drop Shadow

Casts a colored shadow from a subject mask and composites it beneath the
original image. The subject itself is protected from the shadow, while pixels
outside the shadow remain unchanged.

## Controls

- **image**: The image containing the subject.
- **mask**: White identifies the subject that casts the shadow. One mask can
  broadcast across an image batch.
- **offset_x / offset_y**: Signed pixel offset for the cast direction.
- **grow**: Expands the shadow before softening it.
- **blur**: Gaussian edge softness in pixels; `0` keeps a hard edge.
- **shadow_color**: Hex, RGB, grayscale, or CSS color name.
- **opacity**: Shadow strength from `0` to `1`; `0` is an exact pass-through.

## Output

- **image**: The input image with the colored shadow composited beneath the
  masked subject.
