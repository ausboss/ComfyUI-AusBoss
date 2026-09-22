# Workflow review for 2.1.0

Reviewed the 17 public examples on 2026-09-22 for changes that should carry
across related graphs. Nine workflows were updated.

| Example | Change |
| --- | --- |
| Krea 2 Outpaint | Describe the unpadded reference with its existing Krea text encoder; join the description with editable outpaint direction. |
| Klein 9B Outpaint | Add a Qwen3-VL source description after the existing PixaOutpaint trigger and replacement instruction. |
| MiniMax H3 Image to Video | Join a source description with the separately editable motion, camera and audio instructions. |
| MiniMax H3 First + Last Frame | Describe both references separately, retain the transition instructions, and replace the hardcoded ending timestamp with opening/final composition language. |
| LTX 2.3 Video Outpaint | Feed the first frame from the new original output to the captioner, excluding the padded bands; adjust spacing and explain the new Fixed frames control. |
| Krea 2 Studio | Connect LoRA trigger words to the prompt shared by both sampling passes. |
| Krea 2 Text to Image + LoRA Stack | Use AusBoss Save Image and save the assembled prompt as a matching text sidecar. |
| Krea 2 Prompt from Image | Retain its working caption encoder/settings; document the sampling requirement and make room for the current core widgets. |
| Image and Video Transform | Compare each result with its original source using the new outputs; explain Crop/Pad, Reset crop, Align and stitcher. |

The text-to-image examples have no source to caption. Edit and inpaint
examples retain explicit change instructions: a description of the old scene
is not a substitute for the requested edit. The node tour, watermark remover
and Resolution Master need no generated prompt.

## Caption checks

Krea's saved sampling settings produced a useful description. A greedy
probe returned empty text, so Krea keeps sampling enabled and reuses its
existing encoder. H3's conditioning encoder produced punctuation with both
greedy and sampled decoding in this installation. H3 and Klein therefore
use the tested Qwen3-VL 8B INT8 caption model with a separate download row;
their own conditioning encoders remain connected to the renderer.

The LTX caption describes one source frame. It does not observe motion over
the full clip. The H3 motion and audio instructions remain authored text.

## Verification

Canvas exports and API execution records are in
`_scratch/workflow_refresh/`. Full runs cover Krea Outpaint, Klein Outpaint,
Krea Prompt from Image, both H3 image-guided examples, the LoRA Stack
example and the transform example. The Studio prompt assembly and LTX
caption branches were run separately. The LoRA prompt sidecar was checked
against the displayed prompt; both H3 outputs contain an audio stream.

After the LTX transformer and outpaint LoRA were restored, the complete
LTX example passed a fresh run with its saved settings: 97 frames at 24 fps,
1280 × 704, with source audio. The first, middle and last frames were visually
checked. The caption describes the unpadded source and the output fills the
added side bands. Execution and media checks are in `_scratch/release_ltx_*`.

## Fixed-frame clip window

The Clip node now exposes `fixed_frames` separately from the existing maximum
frame cap. Its five-second window was checked with 120 frames at 24 fps on a
ten-second source: real mouse drags on both handles and the selection band,
end clamping, live linked count changes, save/reload, fullscreen editor parity,
linked IN anchoring, unknown upstream values and return to free trim. Backend
checks cover exact output and audio duration after rate conversion and thinning,
overrides of Limit/Snap/OUT, and a clear error for a source that is too short.
The LTX example keeps its original free-trim defaults and documents fixed length
as an optional mode. Its enlarged Clip card and source group have no overlaps.

A queued Integer → Clip → Save Video graph exported exactly 120 frames at
24 fps from a 2.5-second source offset. The saved video and audio streams both
measure 5.000 seconds. Clip/backend tests (62) and frontend tests (471) pass,
as do node validation and the 2.1.0 release preflight.

## Release usability review

A further review found that LoRA absorption skipped repeated filenames and
moved upstream rows behind the current stack. It now preserves each application
and the original order. It also checks shared MODEL and CLIP paths (including
reroutes), connected auxiliary outputs, bypassed destinations and linked stack
values before changing the graph. Loaders without a CLIP input import with
CLIP strength 0. Browser checks preserved three applications at strengths
0.2, 0.4 and 0.7, and a real click on Absorb left a shared branch unchanged.

The transform editor’s Reset all label implied a wider reset than it performs.
It now says Reset transform, with a tooltip that names the retained settings.
A browser check confirmed that trim, Fixed frames and resize survive while
rotation and padding reset. Reset also keeps the selected preview frame; it
previously reset the frame widget without updating the timeline readout. The README now lists the Clip node’s original
output. Frontend regression checks pass (473 tests); node validation and release
preflight also pass. Review screenshots are in `_scratch/node_screenshots/`.

Final release checks: 698 backend tests across 31 files and 473 frontend tests
pass. README local links, the 17-example count, node validation and release
preflight pass. The README reflects ComfyUI 0.37.0 / frontend 1.53.6 and the
new transform outputs, Crop/Pad controls and LoRA absorption behavior.
