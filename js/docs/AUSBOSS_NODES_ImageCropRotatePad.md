# Image Crop + Rotate + Pad

Loads an image and applies one reusable **rotate → crop → pad** transform. Click **Open editor** for the full-screen canvas; normal queued and API execution use the saved widget values without needing the editor.

## Controls

- **Image source**: Pick an existing input image or click **Upload** in the compact
  source card. Dropping an image onto the node still works. The original `image`
  widget remains the saved/API value; the old picker and upload rows are hidden.
- **rotation_degrees**: Clockwise rotation before crop and padding.
- **crop_aspect_ratio**: Free crop, source ratio, or a fixed ratio.
- **crop_x / crop_y / crop_width / crop_height**: Crop in rotated-image pixels. Width and height `0` mean the full available dimension.
- **pad_left / pad_top / pad_right / pad_bottom**: New pixels around the crop.
- **feather**: Feathers the mask into kept pixels and fades the image edge into the fill color, so outpaints blend instead of ending at a hard seam.
- **canvas_multiple**: Rounds the final canvas up by adding the minimum extra pixels to the right and bottom.
- **fill_color**: `#RRGGBB` or three RGB values used for generated pixels.
- **resize_to_megapixels / megapixels / resize_method / resolution_steps**: Optional resize of the finished output to a pixel budget, with core *Scale Image to Total Pixels* semantics — the budget is `megapixels × 1024 × 1024`, aspect is preserved, and each dimension rounds to a multiple of `resolution_steps` (8 or 64 keeps VAE-friendly sizes). The image uses the chosen filter; the mask always resizes bilinear so feathered edges cannot ring.

## Quick row (on the node)

Right under the compact canvas, the format chips (16:9, 9:16, 1:1, 4:3 ...) pad the whole image to that aspect with centered fill bands in one tap - the editor's **Pad to aspect** without opening it; tap the lit chip to clear the bands. Below the Open editor button: **Reset** zeroes rotation, crop, and padding in one click (resize settings are output options and survive); **Feather** toggles feathering on and off, remembering the amount it turned off; **Resize** enables the megapixel budget and reveals its number box. The full method/steps controls live in the editor's **Resize output** section, and the status panel there names the exact resized size.

The output pixel size is drawn centered just below the image — outside the pixels being judged — and shows the resize target when one is active (`576 x 1024 → 768 x 1344`).

Feather and Resize stay synchronized with the editor. Changing the resize budget
updates the size readout immediately. Restoring a workflow or undoing a change
refreshes the source card and preview without resetting the saved framing.

## Outputs

- **image**: BHWC float image batch. Animated image frames receive the identical transform.
- **mask**: BHW generated-area mask combining source transparency, empty rotation corners, and padding.

## Editor gestures

Choose **Target aspect**, then **Crop to aspect** to trim the largest centered crop,
or **Pad to aspect** to keep the full rotated source and add centered fill-color bands.
Both replace existing crop and padding. The target selection alone does not change
the transform. Padding unlocks the inner crop; its target choice stays in the editor.
Canvas multiple and resize steps can slightly change the fitted aspect.

Drag cyan squares to resize the crop, drag inside to move it, orange diamonds to add padding, and the green handle to rotate. Hold `Shift` while rotating to snap to 15 degrees. Use the wheel to zoom and middle mouse or `Alt`-drag to pan. The same handles work directly on the node's compact preview (fit-only there — the wheel keeps zooming the graph); zoom and pan are editor-only.

The node performs no network requests and writes no files beyond a normal user-initiated ComfyUI upload.
