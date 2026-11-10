# Load Image

Loads a picture and sets its size in the same node, so a workflow does not
need a resize node and a size node after its loader.

Pick a file in **Source**, press **Load** to upload one, or use the arrows
under it to step through the pictures in ComfyUI's input folder. The line
beside the arrows shows the size of the file and, when the size changes, the
size that comes out:

`912 × 1632 → 1144 × 2048`

That is the real output size, worked out before you run.

## Size

**Size** (`size`) picks how the picture is resized. Each choice shows only
the numbers it uses.

| Choice | What it does | Its number |
|---|---|---|
| **off** | The picture comes out exactly as the file has it. | none |
| **megapixels** | Brings the whole picture to a total size and keeps its shape. | **Megapixels** (`megapixels`): 1.0 is about 1024 × 1024 |
| **longest side** | Sets the longer edge; the other edge follows. | **Longest side** (`longest_side`), in pixels |
| **scale** | Multiplies both edges. | **Scale** (`scale`): 0.5 is half, 2 is double |
| **fit inside** | Makes the picture as big as it can be inside a box, with nothing cut off. | **Width** and **Height** (`width`, `height`) |
| **crop to fill** | Covers the box completely and cuts off what sticks out, evenly from both sides. | **Width** and **Height** |

**Round to** (`multiple`) rounds the new width and height to a multiple of
that number. Most models want 8 or 16. Set it to 1 to keep the numbers as
they are. It does nothing while Size is off.

## More

- **Method** (`method`): how pixels are resampled. `lanczos` is the sharpest
  for photos. `nearest` keeps pixel art crisp.
- **Enlarge** (`enlarge`): on, a small picture is made bigger to reach the
  size you asked for. Off, a picture is only ever made smaller: one that is
  already below the target comes out at its own size, and crop to fill cuts
  the box's shape out of it without growing it.

## The picture on the node

The picture under the settings is ComfyUI's own preview, the same one the
stock Load Image shows. Drop a file on the node or paste one to upload it,
and right-click the node for the mask editor and for copy and paste.

## Outputs

- `image`: the picture at its new size.
- `mask`: white where the picture is see-through and black where it is
  solid, as the stock loader gives it. A picture with no transparency gives
  an all black mask. It is always the same size as `image`.
- `width`, `height`: the size that comes out.
- `filename`: the file's name without its folder or its ending
  (`shots/hero.png` gives `hero`), ready for a save node's prefix.
- `original_width`, `original_height`: the size of the file before any
  resize. Use them to bring a result back to the size you started from.

## Which loader to use

- **Load Image** (this node): load a picture and set its size.
- **Load Image + Pad**: add empty space around a picture for outpainting.
- **Image Crop + Rotate + Pad**: turn, crop and pad a picture by hand.

## Technical details

- Every frame of an animated file comes through as a batch, all at the same
  new size. A phone photo is turned the way its EXIF data says.
- With Size off the pixels are the file's own, bit for bit, and Round to is
  not applied.
- Rounding moves each edge to the nearest multiple, so the shape can change
  by up to half a step. Fit inside rounds down instead, so the result never
  leaves its box.
- Crop to fill resizes the picture until it covers the box, then cuts the
  middle out. The mask goes through the same resize and the same cut.
- With Enlarge off, a rounded size is rounded down so it never passes the
  file's own size.
- The size line on the node uses the same arithmetic as the run. The pack's
  tests hold the two to the same answers over a table of cases.
- Files are read only from ComfyUI's input, output and temp folders. A name
  such as `photo.png [output]` loads a picture ComfyUI made.
- The node runs again when the file changes on disk or a setting changes.
