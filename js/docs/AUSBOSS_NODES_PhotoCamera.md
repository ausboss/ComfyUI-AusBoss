# Photo Camera 🆎

Works out the camera your photo was taken with, so a 3D model of the person
lines up with the photo. With it, the 3D viewer opens on your photo's own
view: same height, same lens, the person where they stand in the photo. Move
the camera from there and the shot starts from something real instead of a
guess.

It is made for **Pixal3D**, the TRELLIS 2 model in ComfyUI that builds the
model lined up with the photo.

## How to wire it

- `image`: your photo, the one **Crop to Mask** cuts the person from.
- `mask`: the person's mask, the same one Crop to Mask uses.
- `fov`: how wide the photo is, in degrees. Wire **Get FoV from MoGe**
  (horizontal, degrees) here, run on the same photo. Without MoGe, 55 suits
  most phone photos.

Then:

- `crop_fov` goes into **Pixal3D Conditioning**'s `fov`.
- `camera_info` goes into the 3D viewer's `camera_info`
  (**Preview 3D (Advanced)**). The viewer opens on the photo's view.
- `strip_width`, `strip_x` and `strip_y` say where the photo goes on the 360
  canvas: its width (into an Image Scale) and its left and top edges (into
  the Image Composite that lays it on the canvas). The 360 then lines up
  with the camera. Turn the 360 by 90 on the viewer's Angle tab so its middle
  sits behind the model.

## Settings

- **Lens**: the photo's field of view across, in degrees.
- **Crop margin** (advanced): the margin Crop to Mask adds around the person.
  Keep it the same as Crop to Mask's `pad_factor`.
- **360 width** (advanced): the width of the 360 canvas.

## Technical details

- Pixal3D builds from a square crop around the person and the crop's field of
  view. Its model comes out with +Y up, and with the crop's camera on +Z
  looking at the middle from 0.5 / tan(crop_fov / 2) away.
- The whole photo was taken from the same point. Its centre is off the crop's
  middle, so the photo's camera is the crop's camera turned towards the
  photo's centre, with no roll. Render Mesh and the viewer can show a turn
  but not a shifted sensor, which is what a crop really is. A person near the
  middle lands to the pixel. A fifth of the frame off centre, the model's far
  edges move by up to 3% of the frame's width; up in a corner with a wide
  lens, up to 8%.
- The crop box is the one Crop to Mask cuts: the node asks ComfyUI's own crop
  helper for it, and measures it the same way itself on a ComfyUI without
  that helper.
- The photo is laid on the 360 canvas flat, at its own width in degrees, with
  its centre where the camera's axis meets the canvas.
