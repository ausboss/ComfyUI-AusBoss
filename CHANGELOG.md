# Changelog

All notable changes to ComfyUI-AusBoss are documented here.

## Unreleased

- Added `AUSBOSS_NODES_LaMaInpaint` with explicit `models/lama` checkpoint discovery and bounded-memory batch processing.
- Added `AUSBOSS_NODES_SelectFrame` with one-based, range-checked batch selection.

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
