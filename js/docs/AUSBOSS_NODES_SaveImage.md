# Save Image

Saves an `IMAGE` batch as **PNG**, **lossless WebP** or **lossless JPEG XL**,
with the workflow embedded or deliberately left out. The name is either
composed on the node from a prefix plus the tags you switch on, or supplied
exactly by the `filename` input, so a caption or edit pass keeps the source
file's name. A caption on the `caption_text` input writes the paired `.txt`.

## The card

- **Folder**: empty saves to ComfyUI's output folder; a relative path is a
  subfolder of it. **Browse** walks the subfolders of the output folder, and
  its **Choose another folder…** opens the system folder dialog on the ComfyUI
  computer: a folder chosen there stays approved for saving. Any other folder
  is refused until it is approved that way - a workflow alone never chooses
  where on the disk the server writes. A server with no screen approves
  folders by hand in `<ComfyUI user folder>/ausboss/folder_access.json`
  (`"approved": ["D:/Datasets"]`, or `"any_folder": true`). Folders that hold
  ComfyUI itself - its install, custom node and model folders - are never
  used.
- **Filename**: the local name, subfolders allowed (`sets/shot`). While the
  `filename` input is linked the field reads `{{filename}}` and the tags fold
  away - an exact name is never decorated. A workflow saved with the old
  `exact_name` shows that name tagged *exact*; clear it to compose locally.
- **Path preview**: the name this save will produce, in the order the tags
  are appended: `prefix[_YYYY-MM-DD][_HH-mm-ss][_WIDTHxHEIGHT][_#####][_b###]`.
  After a run it shows the first file actually written.
- **Tags**: **Counter** (on by default) appends the next free five-digit
  number for that stem in that folder, so a save never collides. **Date**
  and **Time** stamp the local clock. **Size** appends `1024x1536`.
  **Batch #** appends `b001, b002...` across an image batch, which then
  shares one counter; without it each frame takes the next number. With the
  counter off a single image reuses the same path and replaces the file - the
  dataset replacement case - and a batch still numbers its frames.
- **Format**: PNG saves everywhere and keeps alpha. WebP lossless is usually
  smaller than PNG, keeps alpha, and carries the workflow in EXIF. JPEG XL
  lossless is the most compact; it needs the optional `pillow-jxl-plugin` in
  ComfyUI's python (also the pack's `jxl` extra) and few browsers preview it.
- **Embed workflow**: on stores the prompt and workflow in the file (PNG text
  chunks, EXIF in webp and jxl) so it drags back into ComfyUI; off writes a
  clean file for sharing or datasets. `--disable-metadata` on the server wins.

## Inputs

- **filename** (STRING, link only): the exact name from upstream - a Load
  Image name, a caption tool's id. Its image extension is swapped for the
  chosen format's (`photo123.jpg` -> `photo123.png`); a batch appends
  `_001`, `_002`... A linked but empty value stops the run instead of saving
  under a made-up name.
- **caption_text** (STRING, link only): saved as a UTF-8 `.txt` beside every
  image with the same name (`portrait.png` -> `portrait.txt`). Empty writes
  no sidecar. The old `caption` box still works underneath; a linked caption
  wins.

Rooted paths and `..` in names are rejected before the run. `on_existing`
from older workflows is still honored wherever a save can land on an
existing file (counter off, exact or linked names).

## Outputs

- **file_path**: absolute path of the first file saved this run (empty when
  every file was skipped), for downstream nodes that want the file itself.
- **images**: the input batch, unchanged — save first, keep wiring.

The node always re-runs on Queue (a saver's job is the side effect, so
deleting a file and queueing again saves it again), and a server launched
with `--disable-metadata` overrides the metadata toggle — the owner's call
beats the widget.
