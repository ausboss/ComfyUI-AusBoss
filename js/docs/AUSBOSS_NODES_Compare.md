# Image Compare A/B

Shows two images on one panel so differences pop out instead of hiding in a
side-by-side. The first frame of each batch is previewed; `image_a` passes
through the output unchanged, so the node can sit in the middle of a graph
without breaking anything downstream.

## Inputs

- **image_a**: The baseline batch. Its first frame is preview A, and the
  whole batch is what the output carries.
- **image_b**: The comparison batch. Its first frame is preview B.
- **filename** (optional): a name for the files that **Erase** saves, such
  as the source picture's file name. Leave it unwired to type the name on
  the node.

## Panel

Run the workflow once to load the previews. The switch under the picture
picks what the panel does, and its marker slides to your choice:

- **Slide** (default): the panel shows the result. Move the pointer across
  it to compare: A appears on the left of the line and B on the right. Move
  the pointer away and the result is back. Every new run shows its result
  too.
- **A** / **B**: show that picture and hold it, whatever the pointer does.
- **Erase**: mix the two pictures by hand. One picture is on top; paint on
  it and it rubs away, so the other one shows through. Then save the mix.
  See **Erase** below.

The labels ride with the split line: **A** just left of it and **B** just right of
it, on the picture each one names. With one picture showing, its label sits alone
at the top centre. The chosen mode and locked side are
stored with the node, including support for modes from older workflows. The resolution
sits under the picture, beside the switch; differing sizes are
labeled individually.

## Several pictures

Give the node a list of pictures, such as a folder of images, and it shows
arrows under the picture (‹ 2 / 5 ›). Click them to step through the pairs:
A and B change together. **Erase** saves the pair you are looking at.

A batch still shows its first frame only.

## Erase

Use it when you want part of one picture and part of the other: the edit
is good but it changed the hands, so you paint the old hands back. Or you
only want the new sky.

Pick **Erase** on the switch. A row of tools opens above the picture:

- **Erase | Restore**: what the brush does. Erase rubs the top picture
  away. Restore paints it back. Holding **Ctrl**, or using the right
  mouse button, does the other one for as long as you hold it.
- **Size** is the brush's width, in pixels of the picture.
- **Soft** is the brush's edge: 0 is a hard edge, 100 fades all the way
  from the middle.
- Drag left and right on **Size** or **Soft**, on the word, the number or
  the unit, to change the value. Click the number to type one.
- **On top: A | B** is the picture you start from. Pick the other and it
  goes on top instead. Your paint stays where it is.
- **ALIGN** lines B up with A. Edit models often draw the picture a few
  pixels to the side or a little zoomed in, so the edges of your paint
  show a step. Click it and B is moved back over A; Save and Copy use the
  lined-up B. Click it again to go back to B as it came. It fixes a shift
  and a zoom, not a picture that bent or changed shape. Where B was moved
  off its edge, A fills the gap.
- **UNDO** takes back the last stroke, or a Clear. **CLEAR** takes all the
  paint off.

The brush shows around the pointer in teal: a ring at its full size, and
its shape inside, solid in the middle and fading where the edge is soft.
It turns coral while it paints back.

Set the brush without leaving the picture, with the same keys as in
Photoshop:

- **E** erases and **B** paints back, as with Photoshop's eraser and
  brush.
- **[** and **]** make it smaller and larger.
- **Shift + [** and **Shift + ]** make the edge softer and harder.
- Hold **Alt** and the **right mouse button**, then drag: left and right
  for the size, up and down for the edge (up is softer). The brush stays
  where you pressed and changes as you drag, with its size and softness
  written under it; the dashed ring is where its solid middle ends. One
  drag can do both: go across for the size, then turn up or down for the
  edge. On a Mac, hold Control and Option and drag.

These keys only work while the pointer is on the picture. ComfyUI's own
shortcuts are left alone.

A second row opens under the switch, for saving:

- **Name**: what the files are called. `compare` is used when it is empty.
  Letters, digits, spaces, dots, dashes and underscores are kept; a folder
  cannot be part of the name. With the **filename** input wired, the name
  comes from there and the field only shows it.
- **PSD off | on**: on makes Save write two more files (see below).
- **Copy** puts the mix on the clipboard at full size, to paste into an
  editor or a chat. Nothing is saved. Browsers only allow this when
  ComfyUI is opened as `localhost` or over `https`; from another computer
  on a plain address, use Save.
- **Save**, at the right end, writes the mix to ComfyUI's output folder as
  a PNG, such as `compare_00001.png`. Nothing is run again, and every save
  takes the next number, so nothing is written over.

With **PSD** on, Save also writes:

- `compare_00001.psd`: both pictures as layers, with your paint as a
  layer mask on the top one. Open it in Photoshop, GIMP or another
  editor that reads PSD files, and keep working on the mask there.
- `compare_00001_mask.png`: the mask alone. White is where the picture
  underneath shows.

After a save, the line under the picture says **Saved** with a link for
each file. Click one to download it, which helps when ComfyUI runs on
another computer.

Your paint is kept with the workflow. A new run keeps it while the picture
keeps its size, so you can change a seed and look again; press **CLEAR**
to start over. Pictures of another size start clean.

## Which picture is the result

B, the "after" picture. If your graph makes A out of B's picture (B is the
picture you loaded and A is the edited one), the result is A. To keep one
picture up whatever happens, use the **A** or **B** button.

## Output

- **image_a**: The `image_a` batch, untouched.

Previews are written to ComfyUI's temp folder and vanish with it. Nothing
is saved to the output folder until you press **SAVE** in Erase, and no
network requests are made.

## Technical details

- While sliding, the outer 6% on either side snaps to a full image.
- The result is found from the links: when the node that feeds `image_b` is
  somewhere upstream of the node that feeds `image_a`, A was made from B and
  A is the result. When both pictures come out of one subgraph, the same
  check is made inside it. In every other case it is B: two unrelated
  pictures, both pictures out of one plain node, or a link the node cannot
  follow (a Set and Get pair, for example).
- Settings → AusBoss → Image Compare → **Rest on the result** switches this
  off. The panel then stays on the picture nearest to where the pointer
  left, and a new run does not change it.
- **Erase works on the first picture of each batch**, at its full size.
  The mix is always A's size: a B of another size is resized to fit A.
- **What is kept is the strokes**, not a painted picture. The panel draws
  them for you, and Save draws them again on the server at full size, so
  the saved edge is as sharp as the picture however small the node is.
  Copy draws them at full size in the browser.
- **Erase never changes the node's size.** On a narrow node its rows wrap
  onto a second line and the picture gets shorter instead.
- **The brush** is a solid middle with a blurred edge. At Soft 100 the
  middle is half the brush wide and the blur is an eighth of the size.
- **Save mixes the two pictures of the node's last run**, which ComfyUI
  keeps in its temp folder. After a restart of ComfyUI they are gone: run
  the workflow once more, then save. The browser sends the strokes, a key
  for that run and the name: it never names a file to read, and the name
  is checked again on the server.
- **A wired name is tidied**: its folder and extension are dropped, and
  anything a file name cannot hold becomes an underscore
  (`sets/a/photo 12.jpg` saves `photo 12_00001.png`).
- **The saved files carry no workflow.** A mix is made by hand, so there
  is nothing a workflow could make again.
- **The PSD** is 8-bit RGB and not compressed: about 12 bytes for each
  pixel, so 50 MB for a 2048 x 2048 picture. It carries no colour profile,
  like the PNG.
- **Limits**: 400 strokes in one mix. The node says so when it is full.
