# Changelog

All notable changes to ComfyUI-AusBoss are documented here.

## Unreleased

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
