# Color Match

Copies the color statistics of a reference image onto the input. Both images
are converted to LAB, the per-channel mean and spread of the input are mapped
onto the reference's, and the result is converted back — the classic fix for
an inpainted or stitched region that came back with a slight color cast.

## Controls

- **image**: The image to correct.
- **reference**: The image whose look to copy. For a stitched inpaint, feed
  the original image here. A single reference broadcasts across a batch;
  a matched batch pairs frame to frame.
- **strength**: `0` returns the input untouched, `1` applies the full match;
  values between blend linearly.
- **mask** (optional): Restricts the match to the white area — both the
  statistics measured on the image and where the correction lands. Black
  pixels pass through **bit-identical**. Reference statistics always come
  from the whole reference frame.

## Outputs

- **image**: The color-matched image.

## Notes

- The transfer is per-channel mean/std in LAB, so it corrects overall casts
  and contrast without shifting individual hues around.
- Pair it with **Stitch Inpaint (AusBoss)**: stitch first, then match the
  blended region back to the original using the inpaint mask.
