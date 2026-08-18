# Changelog

All notable changes to ComfyUI-AusBoss are documented here.

## Unreleased

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
