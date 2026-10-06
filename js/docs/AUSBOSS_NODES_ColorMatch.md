# Color Match

Makes one picture's colors match another's. Use it when an inpainted or
stitched area comes back a little too warm, cool, dark or bright next to the
original. Four methods go from a gentle fix to an exact match, and a
first-frame mode matches every frame of a video to its first, which can
reduce color drift between frames.

## Controls

- **image**: The image to correct.
- **Strength** (`strength`, starts at `1`): `0` returns the input untouched,
  `1` applies the full match; values between blend linearly.
- **reference** (optional): The image whose look to copy. For a stitched
  inpaint, feed the original image here. A single reference broadcasts
  across a batch; a matched batch pairs frame to frame. Required unless
  **Reference** (`reference_mode`) is **first frame**.
- **Method** (`method`): How the colors move.
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
  matched. A mask of another size than the image stops the run.
- **Invert mask** (`invert_mask`): Treats the mask's black area as the region
  to correct instead of the white area.
- **Reference** (`reference_mode`): Where the target statistics come from.
  **reference** uses the connected reference image. **first frame**
  (`first_frame`) uses the batch's own first frame as the target for every frame, no reference
  needed; the `reference` input is ignored. That can reduce color drift
  between frames; it does not stabilize motion.

## Outputs

- **image**: The color-matched image; pixels outside the mask are untouched.

## Notes

- The node takes a mask but outputs none on purpose: the mask only scopes
  the fix and passes through your graph unchanged — wire your original
  mask onward.
- Pair it with **Stitch Inpaint 🆎**: stitch first, then wire Stitch
  Inpaint's `blend_mask` into **mask** and the original picture into
  **reference**. That matches exactly the pasted area back to the original.
- For video whose color drifts between frames, **Reference** set to
  **first frame** matches every frame to the clip's opening color. It cannot
  stabilize motion, and frames whose content changes, such as a pan onto a
  darker scene, are pulled toward the first frame's colors as well.
