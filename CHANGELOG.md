# Changelog

All notable changes to ComfyUI-AusBoss are documented here.

## Unreleased

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
