# Color Match

Transfers the color statistics of a reference image onto the input — the
classic fix for an inpainted or stitched region that came back with a slight
color cast. Four methods cover everything from a gentle cast fix to an exact
distribution match, and a first-frame mode matches every frame of a video
to its first, which can reduce color drift between frames.

## Controls

- **image**: The image to correct.
- **strength**: `0` returns the input untouched, `1` applies the full match;
  values between blend linearly.
- **reference** (optional): The image whose look to copy. For a stitched
  inpaint, feed the original image here. A single reference broadcasts
  across a batch; a matched batch pairs frame to frame. Required unless
  **Reference** (`reference_mode`) is `first_frame`.
- **method**: How the colors move.
  - **lab** — per-channel mean/std shift in LAB. Perceptual and the safe
    default: corrects overall casts and contrast without shifting
    individual hues around.
  - **rgb** — the same mean/std shift in raw channels.
  - **mkl** — maps the full color covariance; best when hues are rotated,
    not just shifted.
  - **hist** (`histogram`) — matches each channel's distribution exactly.
    The strongest and least subtle.
- **mask** (optional): Restricts the match to the white area — both the
  statistics measured on the image and where the correction lands. Black
  pixels pass through **bit-identical**. Reference statistics always come
  from the whole reference frame. Without a mask the whole image is
  matched.
- **invert_mask**: Treats the mask's black area as the region to correct
  instead of the white area.
- **Reference** (`reference_mode`): Where the target statistics come from.
  `reference` uses the connected reference image. `first_frame` uses the
  batch's own first frame as the target for every frame, no reference
  needed; the `reference` input is ignored. That can reduce color drift
  between frames; it does not stabilize motion.

## Outputs

- **image**: The color-matched image; pixels outside the mask are untouched.

## Notes

- The node takes a mask but outputs none on purpose: the mask only scopes
  the fix and passes through your graph unchanged — wire your original
  mask onward.
- Pair it with **Stitch Inpaint 🆎**: stitch first, then match the
  blended region back to the original using the inpaint mask.
- For video whose color drifts between frames, **Reference** set to
  `first_frame` matches every frame to the clip's opening color. It cannot
  stabilize motion, and frames whose content changes, such as a pan onto a
  darker scene, are pulled toward the first frame's colors as well.
