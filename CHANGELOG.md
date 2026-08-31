# Changelog

All notable changes to ComfyUI-AusBoss are documented here.

## 1.3.0 - 2026-08-31

- **LoRA Loader: strength bars you can grab.** Every named row paints a
  center-zero bar behind its name — teal right of center for positive model
  strength, muted red left for negative, a brighter cap at the value's edge —
  on one shared scale (the stack's largest magnitude, floored at 1.0) so the
  everyday 0..1 range reads absolutely and one strong row rescales the whole
  stack instead of clipping. The name is also a scrub surface: drag it to
  change the strength, bar riding along; a plain click still opens the
  picker. Both have gear-menu off switches.

- **LoRA Loader: absorb the loader chain.** A gear-menu action walks the
  model chain on both sides of the node and lifts every recognized loader —
  core `LoraLoader` / `LoraLoaderModelOnly`, rgthree's Power Lora Loader,
  Pixaroma's loader, another AusBoss loader; Reroutes walked through — into
  the stack, appended below your existing rows in chain order, then
  bypasses the originals, so an old
  workflow's loader daisy-chain collapses into one node without changing
  what the graph computes. Names resolve against this install's list,
  duplicates are skipped not doubled, a fan-out stops the downstream walk,
  and a row imported with unequal model/CLIP strengths flips that node into
  separate-strengths mode so the difference stays visible.

- **LoRA Loader: moved and missing files just work.** A row whose file
  moved folders resolves by name at run time (exact → unique
  case-insensitive path → unique basename, one console note) and shows a
  dashed border naming the file the run will use; a genuinely missing LoRA
  warns once and skips its row instead of failing the whole run, and
  validation no longer blocks the queue over a missing file. The bar's new
  reconnect button — and ComfyUI's own R refresh, quietly — re-checks the
  list and rewrites repaired rows in place. Thumbnails, the info card, and
  range lookups all use the resolved name.

- **LoRA Loader: row awareness.** Rows show just the file name by default
  (full path in the tooltip, folders kept in the picker; gear switch to
  restore), and any LoRA loaded on two rows wears an amber duplicate ring —
  same basename under different folders is deliberately not flagged, since
  the stack would truly load both files.

- **LoRA Loader: the master pill remembers.** It now cycles mixed → all on
  → all off → back to the mixed setup it destroyed; every hand-made row
  toggle refreshes the memory, so an accidental master click is always one
  more click from home.

- **LoRA Loader: the control bar rides the slot band.** The
  templates/master/reconnect/gear cluster moved up into the empty middle of
  the output-slot band, cutting ~52px of dead space from every node; slot
  dots stay wirable beside it. The add button is now **+ LoRA** and lives
  inside the stack container, pinned to its bottom edge. Strengths are
  unified by default on every new node — the separate-strengths switch is
  per-node and no longer leaks into the stored default.

- **The README stops advertising a stale release.** The front-page badge
  said 1.0.0 through two releases; it is now a dynamic shields.io badge
  that reads the version out of `pyproject.toml` on main at view time, so
  it can never go stale, and `release_preflight.py` gained a third check
  that keeps it the dynamic kind (a hardcoded badge fails preflight). The
  README also names the real ComfyUI-floor key (`requires-comfyui`), and
  AGENTS.md's release steps now cover the two failure modes that were
  silently eating releases: a failed push-triggered publish run (re-run
  via workflow_dispatch) and registry versions parked in
  `NodeVersionStatusFlagged` — invisible in Manager's version picker
  until the Comfy team reviews them.

- **Image Crop + Rotate + Pad: resize the output to a megapixel budget.**
  A new resize block (off by default) scales the transformed result to a
  pixel budget with core Scale Image to Total Pixels semantics — megapixels
  × 1024², aspect preserved, each dimension rounded to `resolution_steps` —
  using the chosen filter (lanczos, area, bicubic, bilinear, nearest-exact);
  the mask always resizes bilinear so feathered edges cannot ring. The big
  editor gains a Resize output section and its status names the exact
  resized size; appended after the stable V1 widgets, so saved workflows
  keep loading.

- **Image Crop + Rotate + Pad: a quick row under the canvas.** Reset
  (rotation, crop, and padding in one click), a Feather on/off that
  remembers the amount it turns off, and the Resize toggle with its
  megapixel box — the everyday knobs without opening the editor.

- **Image Crop + Rotate + Pad: the size readout moved off the pixels.**
  The output dimensions now sit centered just below the image (flipping
  above when the bottom edge leaves the stage) instead of overlapping the
  corner of the picture being judged, and they show the resize target too:
  `576 x 1024 → 768 x 1344`.

- **Scrubbable numbers become a pack standard.** The LoRA loader's strength
  box grew into a shared control (`js/shared/scrub_input.mjs`): drag the
  value to scrub it, click to type an exact value, chevron arrows step,
  Shift is always the fine step. First adopters are the Image Crop + Rotate
  + Pad megapixel boxes (quick row and editor) and the editor's resolution
  steps; new numeric fields use it by convention.

- **LoRA Loader: drag-to-reorder actually drops now.** The row preview
  reparents the row mid-drag, and a reparent silently releases pointer
  capture — so the pointerup never landed, the drop never committed, and the
  row rode the cursor until a re-render snapped it back. The gesture now
  listens on the window for its whole lifetime instead of trusting capture.

- **LoRA Loader: step arrows on every strength box.** A third way to set a
  strength next to scrubbing and typing: small up/down chevrons step by the
  configured step (default 0.05); Shift steps by 0.01. Out-of-range tinting
  and the suggested-range tooltip carry over to the new box.

- **LoRA Loader: layout matches the hand.** The templates, stack toggle,
  on-count and settings now sit together in one bordered cluster directly on
  top of the row stack, and **+ Add LoRA** is pinned to the node's bottom
  edge, where it stays however tall the node is dragged — the row stack
  flexes in between. The third output was renamed `trigger_words` →
  `triggers` for a narrower slot label; output links ride slot indices, so
  saved workflows reconnect unchanged.

- **LoRA Loader: Civitai lookup actually completes.** The fetch read the
  response with a single `StreamReader.read(n)`, which returns whatever the
  buffer holds — the first ~1KB TCP chunk — not the full body. A real hit is
  ~150KB of JSON, so every successful lookup died mid-parse as "Civitai
  lookup failed" while only the 404 path worked. The body is now accumulated
  to EOF with the size cap enforced per chunk.

- **LoRA Loader: calmer picker hover.** Moving the mouse down the LoRA list
  used to rebuild the whole list on every row crossed — repositioning the
  popup, blinking the hover thumbnail, and risking the click landing on a
  detached row. The highlight now moves by class swap only.

- **Fixed the clipped flat edge under the LoRA stack — and the same latent
  bug pack-wide.** The frontend mounts every DOM widget's element inside a
  ~10px frame, so the element gets ~20 fewer CSS pixels of height than the
  layout allocates; the LoRA panel demanded its exact pixel sum with only
  10px of slack, so the stack's rounded bottom border was clipped flat on
  every render. The panel now follows the node's height (`fillNodeHeight`)
  with a floor that carries the frame allowance — now a shared
  `WIDGET_FRAME` constant — and the same allowance fixed Load Video's trim
  strip (clipped by 22px at minimum height) and Compare's caption row
  (shaved by 2px). The Video Crop + Rotate + Pad fallback panel also gained
  the width guards every other panel already had.

- **New: Replace with AusBoss nodes 🆎 (prototype).** A canvas-menu and
  command-palette action that finds third-party nodes in the open workflow —
  missing-node placeholders and installed types alike — and offers to swap
  the ones this pack can stand in for: VHS Load Video/Video Combine, KJNodes
  ColorMatch and GrowMaskWithBlur, LayerStyle LaMa, and the easy/Derfuu
  image-size nodes. Nothing changes silently: a preview lists every
  candidate with a per-node opt-out, widget values translate across (VHS
  format ids to Save Video 🆎 formats, KJ color methods to lab/mkl/histogram,
  frame trims to seconds where the rate is known), and anything that cannot
  carry losslessly is flagged in the preview instead of guessed — a
  frame-index trim without a known fps stays at the default with a "check
  trim" note. Each swap remaps links by declared name/slot mapping, rolls
  back on failure, and the whole apply is one undo step. Nodes with no
  equivalent (model loaders, WanVideo pipeline nodes, controlnet
  preprocessors) are listed with the reason they are refused; multi-node
  swaps are declared but wait for phase 2. The map and its widget
  translators live in `js/shared/replace_map.mjs` under node:test coverage.

- **New node: Image Resize 🆎.** The single most common reason a shared
  workflow drags in a heavy pack, as one dependency-free node: target an
  exact width+height, a longest or shortest edge, a megapixel budget, or a
  scale factor, then stretch, fit, cover-crop, or pad when the aspect
  changes — pad fills with a color and marks the new bars as 1.0 in the
  mask output, the pack's usual generated-area contract. `divisible_by`
  snaps the result to a clean multiple (16 for WAN), 0 in a size widget
  keeps the source, an optional mask rides through the identical
  transform, and resampling is lanczos (PIL, in float), bicubic, bilinear,
  nearest, or area.

- **Added the Utility group** — nine small nodes for the gaps that used to
  mean installing a 200-node pack for a text box: **Text 🆎**, **Integer 🆎**
  and **Float 🆎** (typed constants on their own wires), **Show Text 🆎**
  (shows the string it receives on the node face — selectable for copying,
  saved with the workflow — and passes it through), **Math Expression 🆎**
  (arithmetic over a/b/c with FLOAT and INT outputs, parsed with `ast`
  against a whitelist and never `eval`'d, so a shared workflow cannot
  smuggle code through it), **Select Every Nth 🆎**, **Split Batch 🆎** and
  **Merge Batches 🆎** (IMAGE-batch thinning, splitting and joining, with an
  explicit resize policy instead of a silent one when sizes differ), and
  **Free Memory 🆎** (a wildcard passthrough that unloads comfy's models and
  empties the CUDA cache between heavy stages — every step fail-soft and
  imported at run time, so a core API move skips the step instead of
  deleting the node).

- **Video I/O polish: format-aware Save Video, drop-to-restore, an honest
  Load Video label.** Save Video's face now follows the chosen format —
  `crf` hides for `mov prores`, `mkv ffv1` and `gif`, which ignore it, and
  `save_metadata` hides for `gif` and `webp`, which cannot carry it; hidden
  widgets keep their position and value, so saved workflows are untouched
  and switching back restores the number. Dropping a video onto a Load
  Video node (as opposed to onto empty canvas, which still restores the
  whole embedded workflow) makes it that node's source — copied into the
  input folder, identical re-drops reusing the existing file — and an
  AusBoss save also restores the trim, `every_nth`, `max_frames`, sizing
  and FRAME values its embedded workflow stored. And since the preview
  cannot re-render frame drops, its label now reports what one Run will
  actually load — `0:04.0 of 0:10.0 · 48 frames @ 12 fps`, or
  `1 frame at 0:05.2` in FRAME mode — computed from the source's probed
  frame rate with `every_nth` and `max_frames` applied, and omitted rather
  than guessed when a deciding value arrives over a link.

- **LoRA Loader: rows drag to reorder.** Every row grew a dotted grip; drag it
  and the stack shuffles live under the pointer, committing to the serialized
  widget only on drop — an abandoned drag never dirties the workflow. LoRAs
  apply in row order, so order is part of the recipe; the right-click Move
  up/down items remain for one-step moves.

- **LoRA Loader: hover thumbnails on rows, not just in the picker.** Hovering
  a row's name floats the LoRA's sidecar preview image beside the cursor, the
  same way the picker list already did; both now share one floating element
  that follows the pointer and flips sides at the screen edge. It appears only
  once the image has actually loaded, so a LoRA with no preview file shows
  nothing instead of an empty bordered box, and nothing on the node ever
  shifts.

- **LoRA Loader: the info card states the file's size and modified date**,
  read from disk by the same route that serves its trigger words — quick
  ground truth for "which of these two 143 MB epochs is the newer one".

- **New node: Save Image 🆎.** PNG or lossless JPEG XL (optional
  `pillow-jxl-plugin`, listed as the pack's `jxl` extra), workflow
  embedding on or off — and an `exact_name` mode that saves under exactly
  that filename with no counter suffix, so a caption or edit pass keeps
  the source file's name: `photo123.jpg` in, `photo123.png` out, paired
  with the `photo123.txt` sidecar the optional `caption` input writes.
  `on_existing` decides overwrite/skip/error, `output_dir` accepts a
  subfolder of ComfyUI's output or an absolute dataset path, and the node
  returns the saved `file_path`. Classic prefix+counter saving that never
  overwrites remains the default.

- **The registry description now names the nodes.** Manager search matches
  against the description text, so "a curated collection of polished
  nodes" told searchers nothing — it now lists every node family, and the
  keywords grew to match.

- **Image Resize never invents pixels unless explicitly asked.** In every
  target mode except `width+height` the box is derived from the source's
  own aspect, so there is nothing to letterbox against — yet `pad` used to
  answer a `divisible_by` snap by inventing a sliver of bar (one bottom
  row on an 855×480 source at longest_edge 512, /16). All scale-derived
  modes now resolve the snap the way `fit` always has: an invisible
  sub-half-step resize, a black mask, nothing for the user to think
  about. Bars — and white in the mask — can only appear when a
  `width+height` box that disagrees with the source is combined with
  `pad`, which is the one place they are the explicit request.

- **Added `example_workflows/ausboss_node_tour.json`** — a model-free tour
  that wires 17 node types into one runnable graph: load and thin a clip,
  split and rejoin the batch, pad-resize with the bars masked, de-flicker
  against the first frame everywhere except those bars, retime back to
  double rate, free VRAM, and save — with the fps, frame budget, filename
  prefix, and CRF all arriving over wires from Math Expression, Image Size,
  Text, and Integer nodes, the saved path landing in Show Text, and first
  vs last frame in the A/B panel. Pick any video and Queue; nothing else
  is required.

- **The flagship node color deepened to slate-teal.** The pack-wide default
  scheme now pairs a deep slate-teal title (`#14424d`) with a softly lifted
  near-black body (`#161f21`) — quieter on a busy canvas than the original
  bright teal. Nodes in saved workflows still wearing the old pair upgrade
  automatically on load (`LEGACY_SCHEME_PAIRS`); colors a user picked by
  hand are untouched, as ever.

- **An optional completion chime.** A new off-by-default setting
  (🆎 AusBoss → Notifications → Completion sound) plays a soft two-note
  WebAudio chime when the prompt queue empties, so a long video render can
  run unwatched in another window. No audio asset ships; the tone is
  synthesized on the spot.

- **Stale text and metadata cleaned up across the pack.** Image Compare
  A/B's description and tooltip now describe the A/B toggle instead of the
  removed hold mode; Krea 2 Outpaint Model Patch gained the `RETURN_NAMES`
  its socket label was missing; `seek_mode`, `crop_x`/`crop_y`, and the four
  `pad_*` inputs gained the tooltips the pack's own rules require; Frame
  Interpolate no longer answers a "rife" search it cannot honor; and LaMa
  Inpaint moved into the Inpaint category beside its crop/stitch companions.

- **Four nodes gained the outputs real workflows kept asking for.** Stitch
  Inpaint now also returns `blend_mask` — the feathered paste band in
  original-image coordinates, so the docs' own stitch-then-Color-Match loop
  wires directly. Save Video, which had no outputs at all, returns the saved
  file's absolute path for chaining. Select Frame accepts negative frame
  numbers counting from the end (`-1` is the last frame — the
  feed-the-last-frame-to-I2V move). Image Size adds a `count` output for the
  batch size. All outputs are appended, so saved workflows load unchanged.

- **Six help pages caught up with their nodes.** Color Match's page (which
  still described a single-method node), Align Image, Crop For Inpaint (ten
  undocumented inputs), Load Image + Pad (the Krea 2 outputs), LM Studio
  Chat (the history output and gear-menu controls), and Load Video
  (every_nth / max_frames) now match what ships.

- Fixed `tests/test_inpaint_crop_helpers.py` ending its direct run at a
  mid-file `unittest.main()`: the two canvas-stitcher test classes defined
  below it never executed. The block moved to the end of the file; all 68
  tests (up from 57) run and pass.

- **Load Video can pick a single frame.** A FRAME button on the preview turns
  the trim strip into a frame picker: only the frame at the marker loads, as a
  one-image batch ready for image workflows. Click or drag the rail to scrub,
  or type an exact time into the AT field; playback runs the whole source
  freely while picking, and the trim window comes back untouched when the
  toggle turns off. Backed by a `single_frame` widget appended after the
  existing inputs, so saved workflows keep loading unchanged.

- **Image Compare A/B: nothing is drawn over the picture any more.** The
  status chip that sat in the top-left corner carried the resolution and a
  hint about how to use the panel; it covered part of the image to say
  something you only need once. The resolution moved to a caption centred
  under the panel, and when the two sides are different sizes both are named
  there - the panel scales them to fit, so nothing else on screen would show
  it. The empty and error states still use the middle of the stage.

- **Image Compare A/B's HOLD became an A/B toggle.** Press-and-hold meant the
  comparison only existed while a mouse button was down. Each click now swaps
  the whole panel and the button says which side you are looking at, so you
  can flick between them - which is how a small difference actually becomes
  visible. A workflow saved on `hold` opens on the toggle it became rather
  than dropping back to slide.

- Updated `example_workflows/simple_video_watermark_remover.json`: the
  overview still credited `SimpleWatermarkRemover` (the deprecated
  compatibility id) rather than LaMa Inpaint 🆎, still called the node Refine
  Mask, and its GitHub link pointed at `github.com/auboss`, which does not
  exist. It also gained model-setup and requirements sections, consistent
  node titles, and the mask settings its single-frame test was missing - that
  path shipped with every Mask Refine control at zero, so the frame it
  previewed was not the result the full run would produce.

- **Renamed Refine Mask 🆎 to Mask Refine 🆎.** The mapping key
  (`AUSBOSS_NODES_RefineMask`) is unchanged, so saved workflows are unaffected,
  and "refine mask" is now a search alias. ComfyUI's node search cuts at 64
  results and only ranks a name that STARTS with what you typed near the top -
  as "Refine Mask" this node came 121st for "mask" and was never on screen.
  It is 15th now. Search aliases cannot fix this on their own: the frontend
  indexes them but drops them from that ranking because they are a list rather
  than a string, so they decide whether a node is found at all, not where.

- **Mask Refine, LaMa Inpaint and Select Frame preview their own result**, in
  a panel that now follows the node's height like every other stage in the
  pack. It was pinned at 140px, correctly, while it showed a small thumbnail
  of the node's INPUT; showing the result makes it a viewport onto a picture,
  and the guard that classifies panels as growing or fixed has been updated to
  match - moving a panel between those two sets is now explicitly the call to
  review whenever what a panel displays changes, not only when one is added.
  The panel used to show whatever fed the node's input, which is nothing at
  all when a segmentation node is upstream - Mask Refine's panel was blank
  however the mask turned out. Each now returns its result as a preview and
  the panel shows that, falling back to the input thumbnail before the first
  run. ComfyUI's own preview for these nodes is stood down, so the picture
  appears once, in the panel, instead of also underneath the node.

- **Fixed: LaMa Inpaint finished a single image with an empty panel.** Frame
  previews were only attached when the batch had more than one frame, on the
  assumption that one image would preview through the output path - which
  does not exist for a node that is not an output node.

- **Mask Refine opens on `expand` and `blur`**, with `fill_holes`, `smooth`,
  `black_point`, `white_point` and `edge_refine` behind a **MORE** button.
  Hidden widgets keep their values and their saved order, so nothing changes
  for a workflow that set them. A new **AUTO** button sets `expand` and `blur`
  from the mask's size, scaled off the 8/4 that was hand-tuned for the video
  watermark workflow at 576px: a feather is a fraction of the picture, not a
  fixed pixel count.

- **Save Video gained formats, pingpong and a metadata switch.** Alongside
  mp4 h264/h265 and webm vp9 there are now `mp4 h264 nvenc` and
  `mp4 h265 nvenc` (GPU encoding), `webm av1`, `mov prores` (ProRes HQ),
  `mkv ffv1` (bit-exact lossless), `gif` and `webp`. `pingpong` bounces the
  clip for a seamless loop without repeating the turnaround frames, and
  `save_metadata` turns off embedding the prompt and workflow. Both are
  appended after `format`, where positional widget values cannot shift.
  `fps` steps in whole frames now but stays a FLOAT - an INT would refuse
  Load Video's `fps` link and would round 29.97 to 30, drifting picture away
  from audio. `mov` files now carry the embedded workflow too; they silently
  did not before.

- Removed Save Video's **↻** reload button. It only ever re-fetched the
  preview already on screen, and after a page reload there was no saved file
  in memory for it to fetch at all.

- **Frame Chooser 🆎 moved to the lab** (`AUSBOSS_NODES_FrameChooser` is gone;
  it is `AUSBOSS_LAB_FrameChooser` there now). Pausing the graph for an
  interactive pick is a bigger surface than the rest of the pack - a server
  route, a resumable pause, a panel that has to survive a reload - and it has
  open issues that are not worth holding a release for. It keeps working from
  ComfyUI-AusBoss-Lab; a saved workflow using the public id will report it as
  missing. Its `/ausboss/frame_chooser` routes moved to `/ausboss_lab/` so both
  packs can be installed at once.

- Renamed **Video Crop + Rotate + Pad 🆎** to **Video Crop + Rotate + Pad →
  Frame 🆎**. The old name reads like it transforms a clip; it takes one frame
  out of a video and returns a single image, and the editor's timeline is there
  to *find* that frame rather than to trim a range. "grab frame", "extract
  frame" and "frame from video" join the search aliases. The mapping key
  `AUSBOSS_NODES_VideoCropRotatePad` is untouched — it is the
  workflow-compatibility contract — so saved workflows are unaffected.

- Video Crop + Rotate + Pad 🆎: the preview no longer stretches when the node is
  resized. Its canvas is CSS-stretched to whatever box the panel is given, but
  the backing store is only re-sized when something draws — and the panel's
  resize observer sat inside an `image`-only branch next to the interactive drag
  handlers, so the image node redrew on resize and the video node, a passive
  preview with no other reason to redraw, kept painting its last frame into a
  box that had changed shape. Latent until panels started taking the node's
  leftover height, because before that the box could not change shape without a
  width change forcing a relayout. A test now fails if the observer is gated on
  node kind again, or if a canvas-painting panel ships without one.

- Added **Krea 2 Encode 🆎** and **Krea 2 Outpaint Model Patch 🆎**, promoted
  from the lab. Together they make Krea 2 outpaint the source instead of
  painting something next to it: the encode attaches reference latents to the
  positive conditioning (and emits the negative from the same node, so a turbo
  graph at CFG 1.0 stops carrying a second text encode that does nothing), and
  the patch registers those reference tokens into the target grid at the
  rectangle the stitcher records. Reference latents with no position are only
  a style hint — the model borrows the look and reinvents the content, which
  is the failure this pair fixes.

  The patch reaches into comfy's flux attention layers, so it imports them when
  you run it rather than at startup: a core release that moves one surfaces as
  an error on that node instead of deleting it from the menu and leaving saved
  workflows reporting it missing.

- Krea 2 Outpaint Model Patch 🆎 warns when the source is padded on **both**
  axes. The model places the source spanning one whole canvas axis; the
  reference pipeline splits anything else into two passes, and doing it in one
  is not a slightly worse result — the extended region breaks up. The warning
  reports the spare pixels on each axis, because the usual cause is not a
  deliberate second pad but `canvas_multiple` rounding the other axis up by a
  few pixels, which breaks the span just as completely.

- Load Image + Pad 🆎 gained a `reference` output — the unpadded source, fitted
  to a 384px long edge and a multiple of 16, ready for reference conditioning.
  It is **appended** after `stitcher`, not inserted, because a workflow stores
  links by output slot index and anything else would silently rewire every
  saved graph.

- The stitcher now records where the source sits on the canvas, as
  `source_bbox` in pixels and `bbox_normalized` in 0..1. Padding knows the
  rectangle exactly, so it rides along with the canvas rather than on a
  parallel wire that can be left unplugged. Stitching itself never reads
  either key, so an older stitcher still stitches identically.

- Removed **Drop Shadow 🆎** (`AUSBOSS_NODES_DropShadow`). The result never
  looked like a real cast shadow — a mask offset, grown and blurred has no
  contact darkening and no perspective, so it read as a sticker halo rather
  than something in the scene, and that is a limit of the approach rather than
  a tuning problem. A saved workflow containing the node will report it as
  missing on load; delete it, or composite the shadow in an image editor.

- Removed **Pad Image 🆎** (`AUSBOSS_NODES_PadImage`). Load Image + Pad 🆎 does
  the same job from the same stage and starts from the file, so keeping a
  second node whose only difference was taking an IMAGE wire earned its slot in
  the menu twice over from one idea. A saved workflow containing it will report
  it as missing on load. The padding helpers, the modes and the mask are
  unchanged — they were always shared, and Load Image + Pad keeps all of them
  plus feather, canvas rounding and the megapixel target.

- Load Image + Pad gained a `stitcher` output, so an outpaint can
  put the source back exactly. Feed it to the existing **Stitch Inpaint 🆎**
  with the sampled result and every pixel outside the padded band comes back
  bit-identical to the input — only the new padding is the model's work, which
  is what stops a full-canvas sample from quietly resoftening the whole photo.
  No new node: padding now builds the same stitcher shape Crop For Inpaint
  emits (the crop is simply the whole canvas), so one stitch node serves both.
  The output is appended last, so saved workflows keep their existing links.

- Compare: the A/B stage now grows when you drag the node **taller**, not only
  wider. Its panel declared a `computeSize`, and the widget layout gives any
  widget that defines one a fixed height and leaves it out of the leftover-space
  split — so the stage was sized purely from the node's width (capped at 520px)
  and extra height became dead space under the image. It now declares only a
  minimum, which puts it in the split and lets it take the height that is left.
  The node also opens at a 16:9-ish default instead of inheriting one from the
  removed calculation; saved workflows keep their own size.

- LoRA Loader: the "wrong base model" warning now *measures* the result instead
  of guessing from names. It compares comfy's applied-patch count across the
  model and CLIP before and after each row, and warns — naming the LoRA — when
  a row patched nothing, which is what a mismatched LoRA actually does. The old
  check keyed off comfy's model *class name* against a hardcoded table that
  covered 8 of the 81 classes comfy ships, so on anything newer than Flux
  (Krea 2, Qwen, WAN, LTXV, Z-Image, Chroma, HiDream, …) it read "unknown" and
  silently skipped the check; an SD 1.5 LoRA on Krea 2 did nothing to the image
  and said nothing about it. The new check needs no table, no LoRA metadata,
  and works on every model family.
- LoRA Loader: a LoRA's declared base model is read only from the declarative
  metadata keys. `ss_sd_model_name` is the trainer's source *filename*, and
  mining it for substrings labelled any `..._v1.safetensors` as SD1.5 and
  anything with `xl` in the name as SDXL — a wrong label on a working LoRA.
  Families newer than the known-name table now show what the file declares
  (`krea2`) instead of nothing.
- LM Studio Chat: reasoning that the server returns in its own
  `reasoning_content` field now reaches the `thinking` output. Reasoning models
  report two ways — inline `<think>` tags inside the content, or that sibling
  field (what LM Studio sends for gemma/qwen-style hybrids) — and only the
  first was read, so with those models the entire reply landed in a field the
  node never looked at and `text` came back silently blank.
- LM Studio Chat: an empty answer now says why instead of returning "". When
  the model produced reasoning but no answer, the node reports whether it ran
  out of tokens mid-thought (naming the max_tokens budget it hit) or simply
  answered nothing, and points at the fix. A reasoning model can spend an
  entire small token budget thinking, which read as "the node is broken".
  instead of magic numbers. Each of Top-p, Top-k, Min-p, Repeat penalty and
  Presence penalty has a checkbox, a reset button that appears once you change
  it, and — for the 0-1 ones — a slider beside the number. Ticking one on
  starts from LM Studio's own default (top-p 0.95, top-k 40, min-p 0.05,
  repeat 1.1) rather than the value that means "off", and ticking it back on
  returns the value you had before. Unticked still sends nothing, so the
  payload, the widgets, and existing workflows are byte-for-byte unchanged;
  what changed is that "off" now looks off instead of requiring you to know
  that top-p 1 happens to mean off.
- Settings menus: editing one row no longer reverts the others. The menu seeds
  from the open node's values, but each save handed back a value set rebuilt
  from stored defaults, so changing any one setting silently replaced every
  other row with whatever the stored default was — visible as a value quietly
  reverting on a node whose saved workflow differed from those defaults.
- LoRA Loader: fixed the templates popover — a blanket `.ausboss-lora-menu
  button` rule outranked the specialized buttons inside it, forcing them to
  `width: 100%`, which clipped **Save** off the panel edge and stretched each
  saved row's delete `×` across the whole row. The rule now targets only the
  menu's direct children, which are the plain list rows. Action buttons also
  read as buttons: matching 26px height with the name field, a border, and
  pressed/keyboard-focus states.

## 1.1.1

- Registry metadata only; no node behaviour changes. The ComfyUI version floor
  now actually reaches the registry: comfy-cli reads it from a `[tool.comfy]`
  key named `requires-comfyui`, and the pack had been declaring
  `supported_comfyui_version`, which is silently ignored - so 1.1.0 published
  with an empty floor and Manager would not have refused an install on an
  incompatible core.
- Declared `Operating System :: OS Independent` so the registry records the
  supported-OS list. Accelerator classifiers are deliberately omitted rather
  than asserting untested hardware.
- License publishes as a readable name instead of the literal string
  `{"file": "LICENSE"}`. The LICENSE file itself is unchanged, still MIT.


## 1.1.0

- Image Crop + Rotate + Pad: the node's compact preview is now the editor stage in miniature — grab the crop squares, pad diamonds, and rotate knob (with a live degree readout) right on the node, and the panel grows with the node. Fit-only there, so the wheel keeps zooming the graph; the full editor keeps zoom, pan, and the sidebars, and both surfaces run the same hit-test and drag code, so they cannot drift. The video node's panel stays a passive preview.
- Added `AUSBOSS_NODES_LoadImagePad`: a Load Image with an on-node outpaint canvas — drag any edge of the final rect to set that side's padding (the whole edge is the handle; the badge shows the true output size after rounding), with the four Pad Image fills, a mask feathered inward across the seam, canvas-multiple rounding, and a megapixel target that rescales the source *before* padding so the mask seam stays crisp. Outputs image, mask, and the final width/height as INTs.
- Pad Image: the same on-node handle canvas — drag the final rect's edges to set the padding over a live preview of the input image (fed by execution, so it fills in after the first run; a wireframe stands in before that). Widgets, outputs, and saved workflows are unchanged.
- Drop Shadow: a `blend` choice — normal (the old mix toward the color) or multiply, which darkens the backdrop by the color and keeps its texture — plus a `shadow_mask` output carrying the effective shadow alpha for compositing downstream.
- Align Image: `offset_x`/`offset_y` INT outputs locate the original's top-left inside the aligned output (positive after pad, negative after crop, 0 after resize), so an un-align crop after sampling needs no manual math.
- Color Match: `reference_mode: first_frame` matches every frame of a batch to the batch's own first frame — the one-node video flicker fix; the reference input is optional in that mode.
- Crop For Inpaint: `target_megapixels` rescales the crop to a sampler-friendly area (explicit target_width/height still wins), `rescale_algorithm` picks the resize filter for both directions of the round trip (recorded in the stitcher), and `extend_left/right/up/down` grow the frame itself for outpainting — the new bands are replicate-filled, masked for painting, and become part of the stitched output.
- Save Video: a `format` choice — mp4 h264 (default, unchanged), mp4 h265, or webm vp9 with Opus audio (resampled to 48 kHz when needed). CRF applies to all three; bt709 tagging and the embedded workflow ride along.
- Load Video: `every_nth` keeps one frame in N (the fps output divides to match, so real time survives downstream), and `max_frames` stops the decode after that many kept frames instead of loading and discarding — long clips no longer have to fit in memory.
- LoRA Loader: the bar's ▤ button saves and applies named templates of the whole stack (browser-persisted, case-insensitive replace, sorted menu). A LoRA whose metadata names a different base-model family than the connected checkpoint now logs one clear console warning at apply time.
- LM Studio Chat: a `history` input/output pair (`AUSBOSS_CHAT_HISTORY`) chains multi-turn conversations across chat nodes — reasoning blocks and image payloads are deliberately not replayed — and a `json_schema` widget forces structured JSON replies via LM Studio's response_format.
- Cleanup: the dead module-level `NODE_ID` variables left over from before the literal-mapping-key convention are gone from every node file.
- Removed: `AUSBOSS_NODES_SelectFrameRange` and the Video Bundle family (`AUSBOSS_NODES_VideoBundle`, `AUSBOSS_NODES_VideoUnbundle`, `AUSBOSS_NODES_VideoBundleEdit`). Core ComfyUI's `ImageFromBatch` covers contiguous-range selection, and the core `VIDEO` wire (`CreateVideo` / `GetVideoComponents`) is now the ecosystem-standard way to move a whole video on one connection, which is what `AUSBOSS_VIDEO` existed for. Workflows using the removed keys keep their other nodes; replace those four with the core equivalents. Select Frame and Image Size stay.
- Display names traded the " (AusBoss)" suffix for the pack's 🆎 signature — "LoRA Loader 🆎", "Color Match 🆎". Typing "ausboss" still surfaces everything through the 🆎 AusBoss category, the AUSBOSS_NODES_ id prefix, and each node's search aliases; mapping keys are untouched, so saved workflows load exactly as before.
- Fixed: the LM Studio Chat endpoint toolbar rendered as a sliver that clipped its buttons — the DOM-widget wrapper takes its height from the getMinHeight option, which the toolbar never declared.

- Every AusBoss node now wears the brand look out of the box: the teal-title scheme the video nodes shipped with became the "AusBoss" row in the appearance table and the pack-wide default, and Load/Save Video stopped hard-painting themselves so the appearance setting (and the per-node color menu) governs them like everyone else. "Theme default" remains available for anyone who wants uncolored nodes.
- Every AusBoss node grew a quiet "?" badge in the title bar; clicking it opens a card built from the node's own DESCRIPTION and input/output tooltips, so the docs on screen are exactly the docs in the source.
- New gear-settings menus, persisted in the browser: the LoRA Loader's gear holds default strength, strength step, separate model/CLIP strengths, the trigger-word separator, hide-extension, thumbnail, and Civitai-lookup preferences; LM Studio Chat's gear holds the advanced sampling knobs (top-p, top-k, min-p, repeat and presence penalty), thinking control with custom reasoning tags, LM Studio idle-unload TTL, and a free-ComfyUI-VRAM-first switch. The LM Studio values ride hidden standard widgets, so they save with the workflow and reach the API like any widget.
- LoRA Loader restyle: one control language — a full-width filled Add button, a master-toggle bar with the gear, and the rows inside an inset stack container with a dashed empty state; the serif "i" is gone.
- Align Image: crop mode gained `crop_position` (center/top/bottom/left/right) choosing which part of the frame survives; the widget only shows while mode is crop.
- Color Match: a `method` choice — `lab` (the old behavior), `rgb`, `mkl` (full covariance mapping), and `histogram` (exact per-channel distribution) — plus `invert_mask`, and tooltips that spell out the mask contract (it scopes the fix and passes through unchanged, which is why there is no mask output).
- Crop For Inpaint: the selection can now be inverted (`invert_mask`), grown or shrunk (`mask_grow`), and edge-softened (`mask_blur`) before cropping, and `context_pixels` adds flat margin on top of `context_factor`'s growth.
- Fixed: A/B Compare could get stuck in HOLD — in hold mode the stage captured the pointer on press, which retargeted the release and ate the mode button's click. The modes are now two dedicated SLIDE/HOLD buttons, and presses that start on the toolbar never reach the stage behaviors.

- Fixed the LoRA panel (and every DOM panel) overflowing after a node was resized narrower: the frontend sizes a panel's wrapper as `widget.width ?? node.width`, and LiteGraph's layout plants `widget.width` during draws - once planted, it outranks the node width forever, so the wrapper kept an old, wider width and parked the row's controls outside the border. All six panels now discard those writes (`keepDomWidgetWidthAuto`), so the wrapper tracks the node in both directions. Diagnosed from a live browser measurement and verified end-to-end against a planted stale width.

- Fixed: the LoRA Loader's strength box and info button could hang past the node's right edge. The panel now sizes its padding inside the widget's box, clips anything oversized, and declares its minimum width to the layout so the node cannot be resized out from under the row. A pack-wide test now requires every DOM panel to carry the same guards.
- The same containment sweep covered every DOM panel: Frame Chooser gained the resize floor older frontends read (`minNodeSize`), the input-preview thumbnail clips at its root, and the pack-wide test now requires the full guard set - border-box, an overflow clip, and a minimum width on both frontend layout paths - of every panel.
- Added `AUSBOSS_NODES_AlignImage`: snap an image's width and height to a clean multiple (16, 32, ...) by nearest-resize, center-crop, or replicate-pad, with the new size as INT outputs — for Qwen image models and anything else that wants cleanly divisible sizes.
- Added `AUSBOSS_NODES_ImageSize`: width, height, longest edge, and shortest edge as INT outputs.
- Added `AUSBOSS_NODES_LmStudioChat`: prompt + optional image to a local LM Studio (or any OpenAI-compatible) server. Empty model uses whatever is loaded, `<think>` blocks land on their own output, the seed re-rolls the cached reply, and every error names what to fix. Stdlib HTTP - no new dependencies.

- Performance: mask dilation and erosion run as one separable pass instead of one 3x3 pool per pixel of growth - bit-identical, measured 6-7x at 32 px, and it feeds Drop Shadow's grow, Refine Mask's expand, and the matting trimap. The trimap's morphology is also built once per batch instead of once per frame (27x on that stage: 11.0 s -> 0.4 s for 48 frames of 832x480). Pad Image's pillarbox backdrop blurs at quarter resolution when the blur is heavy (6-7x on the stage that was ~90% of the node; mean difference ~0.001 in a backdrop that is then dimmed - light blurs keep the exact full-resolution path). Frame Interpolate estimates optical flow exactly once per source pair however small batch_size is, where a batch_size of 1 used to re-solve each pair once per output frame (4x the RAFT work at 24 -> 120 fps); the guide-image batch is no longer duplicated up front, and the scene-cut scan drops a full-chunk temporary.

- Fixed: a Frame Chooser pause survived being cancelled by an ordinary workflow load. LiteGraph clears the graph by removing every node, so undo, switching workflow tabs, Clear Workflow and opening another file all fired the teardown that a deleted node uses to release its pause - silently interrupting a run that was still going, with no way to get it back.
- Fixed: answering "keep all" wrote the whole batch out as `1,2,...,N` into `pick_list`, pinning a batch-size-independent answer to one batch. The next run then dropped any frames past the end of that list, or failed outright on a shorter clip. It now writes the empty answer it was given.
- Fixed: `pick_list` is only written back under `keep last selection`. It pre-answers the node, so filling it in automatically meant a chooser left at the default `always pause` paused exactly once and never again.
- Fixed: Refine Mask's `smooth` no longer flattens a mask that is already soft; it applies only the change it made to the jaggy edge. Binary masks are bit-identical to before.
- Fixed: Refine Mask's `blur` now reaches the `matting` edge-refine solve instead of being thresholded back out of the trimap.
- Fixed: Frame Interpolate's copy path honours `batch_size`. It gathered every copied frame at once, which on a long clip at an integer multiple was a multi-gigabyte allocation on the frames device that no setting could bound.
- Fixed: live status and runtime badges appear for nodes inside a subgraph, and a subgraph pause renders on the node that actually paused. Colon-prefixed execution ids are resolved by walking the subgraph chain rather than by stripping the prefix, which could match an unrelated node with the same number.
- Fixed: choosing the Custom node colour scheme while the stored colour is unreadable no longer strips the colour off every AusBoss node.
- Fixed: an unreadable colour in Drop Shadow or Pad Image names its own node and widget in the console instead of blaming Transform, and one node's warning no longer silences another's.
- Fixed: a malformed Frame Chooser answer returns 400 rather than 500 - a non-ASCII token and a JSON body that is not an object both used to throw out of the route and strand the pause.
- Fixed: `pick_list` rejects Unicode digits. `²` raised a bare `ValueError` during validation and `٣` was silently read as frame 3.
- Fixed: `scripts/validate_nodes.py` parses `NODE_MODULES` instead of matching it anywhere in the text, and an unregistered node module is now an error rather than a warning - it used to exit 0 with no output at all. It also refuses mapping keys declared outside `nodes/`, which is how the registry test fixtures came to be advertised to ComfyUI-Manager as installable nodes; they are now `.py.txt`.

- Added `AUSBOSS_NODES_ColorMatch`: LAB mean/std transfer that harmonizes an inpainted or stitched region against its source, with optional mask and strength.
- Added `AUSBOSS_NODES_PadImage` with color, edge, edge-pixel, and pillarbox-blur fills, returning a mask over exactly the new padding for outpainting.
- Added `AUSBOSS_NODES_DropShadow` for padded and reframed compositions.
- Added `AUSBOSS_NODES_FrameInterpolate`: fps-based interpolation (24 to 30 works, not just whole multiples) with blend and optical-flow methods, bounded memory, and scene-cut detection that holds across hard cuts instead of morphing.
- Refine Mask gained a jaggy-melting `smooth` control, black/white point levels, and optional `guided filter` and `matting` edge-refine tiers.
- Stitch Inpaint gained an optional `fix_edge_halo` toggle that removes the rim left by compositing a feathered seam twice; pixels outside the blend stay bit-identical either way.
- Frame Chooser gained a countdown with timeout policies, reload recovery, a `pick_list` pre-answer for headless reruns with automatic writeback, stale-answer rejection, a keyboard map, and a notice when a pause begins out of sight. A pause now resolves exactly once: whichever of a keep, a cancel, an expiring countdown or a second tab gets there first decides it, and the ones that lose are refused instead of overwriting the decision or reporting a success they did not have.
- Load Video exposes a lazy core `VIDEO` output and Save Video accepts a core `VIDEO` input, so the pack interoperates with ComfyUI's own video nodes; a connected video's frame rate wins over the fps widget.
- Video decode and encode now run off the executor thread with per-frame progress, so long jobs no longer block the UI.
- Added a live per-node status badge (`frame i/N` during a LaMa video inpaint), About-page badges, a toast for the stale-frontend warning, and a Custom node color scheme.
- Fixed registry discovery: mapping keys are now string literals, so ComfyUI-Manager can see the pack's nodes and offer to install it for a shared workflow. `scripts/validate_nodes.py` now enforces the whole registry contract - each mapping assigned exactly once at module level to a non-empty dictionary literal with string-literal keys, its name never used again (no `update()`, no `del`, no aliasing it into a variable that mutates it later), matching keys across the two mappings, and no key claimed by two modules. Permanent public ids are checked against the keys parsed out of those literals rather than any mention of the id in the file.

- Added `AUSBOSS_NODES_FrameChooser`: pause the graph on a clickable filmstrip and keep only the frames you pick, with a no-pause "keep last selection" mode.
- Added `AUSBOSS_NODES_CropForInpaint` + `AUSBOSS_NODES_StitchInpaint`: native-resolution masked inpainting with a bit-exact paste-back contract and video batch broadcasting.
- Added the `AUSBOSS_VIDEO` bundle wire (`Video Bundle` / `Unbundle` / `Bundle Edit`) carrying frames, audio, fps, and derived info on one connection.
- Added `AUSBOSS_NODES_Compare`: slide or hold A/B image comparison that passes A through.
- LoRA Loader: master on/off pill with a mixed state, folder-grouped picker with hover preview thumbnails and shared-prefix stripping, and per-LoRA suggested strength ranges that tint out-of-range values.
- Load Video: trim IN/OUT are typed timecodes (`h:mm:ss.s`), decodes are memory-guarded with a clear oversized-trim error, seeks respect stream start time, and audio extraction is lazy.
- Save Video: output is tagged bt709 with a matching conversion matrix, and dropping a saved mp4 onto the canvas restores its embedded workflow.
- Widget values for the transform and video nodes now serialize by name with validated migration from older positional workflows.
- New Chrome settings: favicon/tab-title queue status and per-node runtime badges.

- Added `AUSBOSS_NODES_LoadVideo` with a single responsive player, draggable IN/OUT trim range, bounded playback, matched audio, and info outputs.
- Added `AUSBOSS_NODES_RefineMask` with expand/shrink, hole filling, feathering, and an inverted output.
- Added `AUSBOSS_NODES_SaveVideo` writing H.264 mp4 with muxed audio, embedded workflow metadata, and a responsive loopable result viewer.
- Added `AUSBOSS_NODES_SelectFrame` with one-based, range-checked batch selection.
- Added `AUSBOSS_NODES_LaMaInpaint` with bounded-VRAM video processing and explicit `models/lama` checkpoint discovery.
- Added a compatibility alias for the published `SimpleWatermarkRemover` workflow contract.
- Added the repaired Simple Video Watermark Remover example workflow.
- Added an `AusBoss node color` setting (Settings → 🆎 AusBoss) with curated schemes that recolor every AusBoss node live; hand-colored nodes keep their own colors.
- Added `AUSBOSS_NODES_LoraLoader`: a stacked multi-LoRA node with drag-to-scrub strengths, a keyboard-first searchable picker, per-row trigger words (file metadata, one-click Civitai fetch, and your own saved words), and a `trigger_words` output.
- Added `AUSBOSS_NODES_SelectFrameRange` returning a one-based sub-batch plus its actual frame count.
- Added a right-click `Recreate node (AusBoss)` utility that rebuilds a node from the current definition, preserving values and links, with full rollback.
- Added adaptive title ink, a per-node right-click `AusBoss color` override, and subgraph-aware color sweeps.
- Added live previews: LaMa video inpaints stream each finished frame to the node face, and Refine Mask / LaMa Inpaint show their upstream input before the graph runs.
- Added `%date:...%`-style filename tokens to Save Video, tolerant `fill_color` parsing (hex, CSV, floats, CSS names), an `Alt+E` open-editor command, and user-editable aspect presets via `ausboss_presets.json`.
- DOM panel edits now register with ComfyUI's undo/modified tracking, and a console warning fires when the browser runs stale cached pack JavaScript.
- Added `scripts/release_preflight.py` catching pyproject BOMs and JS/Python version drift.

## 1.0.0

- Added `AUSBOSS_NODES_ImageCropRotatePad`.
- Added `AUSBOSS_NODES_VideoCropRotatePad`.
- Added a shared full-screen rotate, crop, and pad editor with compact node previews.
- Added exact video-frame preview routes and input-folder/local-path modes.
- Added generated-area masks covering transparency, rotation voids, and padding.
- Added rich node help, example workflows, automated backend/frontend tests, and Registry metadata.
- Editor rotated-size math now matches Pillow's `expand=True` output exactly at every angle.
- Video frame preview uses keyframe seeking with a sequential fallback, so scrubbing long videos stays fast.
- Editor previews of local paths outside ComfyUI's folders are opt-in via `AUSBOSS_TRANSFORM_LOCAL_PREVIEW=1`; queued workflows are unaffected.
- Timeline scrubbing now renders immediately with a latest-wins request pump and reduced-size scrub frames, landing a full-resolution frame on release; playback and held arrow keys use the same light path. Server caches per-file video metadata so each scrub frame opens the container once.
- Video decodes run off the web server's event loop in persistent per-file decoder sessions (with an idle reaper that releases file locks), so a slow decode can never stall the ComfyUI UI and stepping forward decodes only the frames in between.
- A keyframe storyboard builds in the background after a video is selected; dragging the timeline shows the nearest storyboard tile with zero network latency, then the exact decoded frame replaces it.
- The rotation handle moved to the source's top-right corner, drawn with a crisp vector rotate glyph, clear of the top padding handle.
