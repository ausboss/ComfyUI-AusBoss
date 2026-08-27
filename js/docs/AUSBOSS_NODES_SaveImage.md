# Save Image

Saves an `IMAGE` batch as **PNG** or **lossless JPEG XL**, with the workflow
embedded or deliberately left out — and, when you need it, under an **exact
filename with no counter suffix**, so a caption or edit pass can keep the
source file's name.

## Two naming modes

- **Classic** (default): `filename_prefix` plus a counter —
  `AusBoss/image_00001_.png` — in ComfyUI's output folder. Never overwrites,
  subfolders in the prefix work as usual.
- **Exact**: set `exact_name` and the file saves as exactly that name. An
  image extension on the value is replaced by the chosen format's own, so
  `photo123.jpg` saves as `photo123.png` and pairs with `photo123.txt`.
  Subfolders are allowed (`set1/photo123`); rooted paths and `..` are
  rejected. A batch cannot share one name, so its frames become
  `name_001`, `name_002`, …

## Controls

- **format**: `png` everywhere; `jxl lossless` keeps every pixel
  bit-identical in a smaller file. JPEG XL needs the optional
  `pillow-jxl-plugin` in ComfyUI's python (`pip install pillow-jxl-plugin`,
  also listed as the pack's `jxl` extra) and the node says so when missing.
- **save_metadata**: on embeds the prompt and workflow (PNG text chunks,
  EXIF in jxl) so the file drags back into ComfyUI; off writes a clean file
  for sharing without shipping the recipe.
- **on_existing** (exact mode): `overwrite` replaces the file — the usual
  reason to want an exact name — `skip` leaves it, `error` stops the run.
- **output_dir**: empty saves to ComfyUI's output folder; a relative path is
  a subfolder of it; an absolute path saves anywhere you can write, e.g.
  straight into a dataset folder. The on-node preview only appears for
  files inside the output folder — outside saves are reported by path.
- **caption**: when not empty, writes the text as a UTF-8 `.txt` sidecar
  with the same basename as each saved image — the image/caption pair
  training tools expect.

## Outputs

- **file_path**: absolute path of the first file saved this run (empty when
  every file was skipped), for downstream nodes that want the file itself.
- **images**: the input batch, unchanged — save first, keep wiring.

The node always re-runs on Queue (a saver's job is the side effect, so
deleting a file and queueing again saves it again), and a server launched
with `--disable-metadata` overrides the metadata toggle — the owner's call
beats the widget.
