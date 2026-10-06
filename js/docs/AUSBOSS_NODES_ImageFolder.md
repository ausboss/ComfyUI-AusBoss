# Image Folder

Pick a folder, tick the pictures you want, and run the workflow on each one.

Use it when the same job has to be done on many pictures: change one thing in
all of them, caption them, resize them, make pairs for training.

## How to use it

1. Bring your folder in. Drop it on the node from your file explorer. Or
   press **Browse**, then **Copy a folder from your computer**, and choose
   it. Its pictures are copied into ComfyUI's `input` folder and show as
   tiles.
2. A folder that is already inside ComfyUI's `input` or `output` folder is
   chosen with **Browse**.
3. Click a tile to take a picture out or put it back. **Shift + click** does
   every tile from the last one you clicked to this one. **All** and **None**
   do the whole folder.
4. Wire **image** into your workflow, and **filename** into Save Image's
   `filename` so each result keeps its picture's name.
5. Press **Run**.

## A folder from anywhere on your computer

The node only reads folders inside ComfyUI's own `input` and `output`
folders. A folder from anywhere else is copied in:

- **Drop it on the node**, or choose it with **Browse → Copy a folder from
  your computer** or **Add → A whole folder**. Your file explorer opens for
  the last two.
- **Your browser asks first** when you choose a folder in the file explorer.
  It shows its own question, such as "Upload 74 files to this site?". The
  site is your ComfyUI, and the upload is the copy into its input folder.
  The node cannot change those words. A folder dropped on the node is
  copied without that question.
- Its pictures go into `input/<the folder's name>`, folders inside it too,
  and the node moves to that copy.
- **A really big folder asks first.** With more than 300 pictures or more
  than 1 GB, the node says how many and how much, and waits for your yes.
  Copying takes that much disk space again.
- Bringing the same folder in again writes over its copies. It does not
  pile up doubles.
- A path typed or pasted into **Folder** works when it lies inside ComfyUI's
  input or output folder. For any other path the node says so, with a
  button that opens the file explorer.

## One run, or one picture per run

**Run** decides how the pictures go through.

- **all in one run**: one press of Run does every picked picture, one after
  the other. If one picture stops the workflow, the ones after it are not
  done.
- **one per run**: each run loads one picture, and **Picture** moves on by
  one when the run is queued. Set ComfyUI's run count to the number of
  pictures and they are all queued at once. A picture that fails only skips
  itself. The tile with the white ring is the next one, and a double click on
  a tile makes it the next.

After the last picture, **At the end** either stops the run with a message
or starts over at the first.

## The card

- **From** (`source`): ComfyUI's **input** folder, or its **output** folder
  for pictures you made.
- **Folder** (`folder`): the folder inside it. Empty is the input or output
  folder itself. **Browse** lists the folders there.
- **Subfolders** (`subfolders`): also take the pictures in the folders inside.
- **Order** (`sort`): by name, or newest or oldest first.
- **Run** (`run`): see above.
- **Picture** (`position`): with one per run, the picked picture the next
  run loads, counted from 1.
- **After a run** (`after_run`): **next** moves Picture on, **stay** keeps
  loading the same one, **random** jumps to any of the picked ones.
- **At the end** (`at_the_end`): **stop the run** or **start over**.

## The tiles

- The line above them says how many are picked, and with one per run which
  one is next.
- A picked tile is bright with a tick and its number. The others are dim.
- A number on teal means that picture went through since you opened the
  workflow.
- **Add** copies pictures, or a whole folder, from your computer into
  ComfyUI's input folder.
- **↻** looks in the folder again.

## Outputs

- **image**: each picked picture, one at a time. What comes after runs once
  for each.
- **mask**: white where the picture is see-through. A picture with no
  see-through part gives the same empty mask Load Image does.
- **filename**: the file name without its ending.
- **index**: the picture's number among the picked ones, from 1.
- **count**: how many pictures are picked.

## Technical details

- **Only ComfyUI's own folders.** The node reads folders inside ComfyUI's
  input or output folder and nothing else. A path that leads anywhere else is
  refused, and so is a link inside those folders that points out of them.
  There is no setting that changes this.
- The picked pictures are saved in the workflow as a list of names
  (`pictures`). Empty means every picture, so a picture added to the folder
  later is in too. A name that is no longer in the folder is skipped.
- Pictures are PNG, JPG, WebP, BMP, GIF (first frame) and TIFF. A photo that
  was taken turned comes out upright. Files whose names start with a dot are
  skipped.
- By name means the way a person sorts: `photo_2` before `photo_10`.
- With **Subfolders** on, a picture's `filename` carries its folder in
  front (`trips/beach.png` gives `trips_beach`), so two files with one name
  never save over each other.
- **image**, **mask**, **filename** and **index** are lists. Pictures keep
  their own sizes. They are not resized or stacked into one batch.
- Moving Picture on is done by the editor when a run is queued. A workflow
  sent through the API loads exactly the picture `position` names.
- The node runs again when a picked file is added, removed or rewritten.
- A folder lists up to 5,000 pictures, and a folder that is brought in is
  copied up to 3,000.
- Bringing a folder in is done by your browser through ComfyUI's own upload.
  The server never opens a path outside ComfyUI's input and output folders.
- A mask painted in the MaskEditor is not part of a folder picture. Use Mask
  by Name, or load that one picture with a single-picture loader.
