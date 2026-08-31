<div align="center">
  <h1>ComfyUI-AusBoss</h1>
  <p><strong>Polished nodes for the workflows I use most.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License">
    <!-- Dynamic: shields.io reads the version out of pyproject.toml on main
         at view time, so this badge can never go stale. release_preflight.py
         checks it stays the dynamic kind. -->
    <img src="https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fausboss%2FComfyUI-AusBoss%2Fmain%2Fpyproject.toml&query=%24.project.version&label=release&color=00b4aa&style=flat-square" alt="Release">
  </p>
</div>

ComfyUI-AusBoss is a curated collection of polished nodes designed to streamline the ComfyUI workflows I use most. Each node replaces repetitive setup with focused controls, compact graph footprints, and only the outputs needed downstream. Larger visual tasks open into dedicated full-screen editors, while experiments and one-off utilities stay out of the public pack.

## Nodes

### Image Crop + Rotate + Pad 🆎

A Load Image-style node with a compact transformed preview and a full-screen editor for precise crop, rotation, padding, fill, mask feathering, and output-size alignment. The preview is itself a live stage — drag the crop handles, padding diamonds, and rotate knob directly on the node, and open the editor when you want zoom, pan, and the numeric sidebar.

### Video Crop + Rotate + Pad → Frame 🆎

Picks **one frame** out of a video from an uploaded input file or local path, and applies the same transform controls as the image node. The output is a single image, not a clip — the full-screen editor's long timeline, playback and exact frame steps are there to *find* the frame, not to trim a range.

### Select Frame 🆎

Returns one unchanged frame from an `IMAGE` batch using a clear one-based frame number. Out-of-range requests report the valid range instead of silently selecting the wrong image, and the panel shows the frame you picked so you can check it without a separate preview node.

### LoRA Loader 🆎

A stacked multi-LoRA node. Each row has an on/off pill, a searchable picker (type to filter, arrow keys + Enter to pick; browse view groups by folder and hovering shows the preview image), and strengths you can **drag left/right to scrub** (Shift for fine steps), click to type, or nudge with the little step arrows. A **center-zero strength bar** rides behind each row's name — teal for positive, red for negative, scaled to the stack's largest magnitude — and the name itself is a scrub surface too. The stack-wide toggle (which remembers the mixed setup an accidental click destroys), count, templates, reconnect and settings ride the empty band between the node's input and output slots, and **+ LoRA** stays pinned to the stack's bottom edge however tall you drag the node. A gear-menu action **absorbs every LoRA loader wired into the model chain** — core, rgthree, Pixaroma — into the stack and bypasses the originals; **moved LoRA files resolve by name at run time** and a genuinely missing one warns and skips its row instead of failing the run. The per-row info card shows the LoRA's preview image, base model, trigger words from its file metadata, a one-click Civitai lookup saved beside the model as `<model>.civitai.info`, or your own saved words — click words to toggle them into the deduplicated `triggers` output — plus an optional suggested strength range that tints out-of-range values. The bar's ▤ button saves and applies named templates of the whole stack, and a LoRA that patches nothing on the connected model — the usual sign it was built for a different base model — logs a console warning naming it. CLIP input is optional.

### Align Image 🆎

Snaps width and height to a clean multiple of a number you pick — 16, 32, whatever the model wants. Qwen image models, VAEs, and many samplers behave best on cleanly divisible sizes. `resize` rescales to the nearest multiple, `crop` center-crops down, `pad` replicate-pads up, and the new size comes out as INTs for wiring into latent nodes — plus `offset_x`/`offset_y` for cropping back after sampling.

### Image Size 🆎

Reads an image's dimensions as INTs — width, height, longest edge, shortest edge — so resizes and latents key off the actual image instead of retyped numbers that drift.

### LM Studio Chat 🆎

Sends a prompt (and optionally an image) to a local LM Studio server — or any OpenAI-compatible endpoint — and returns the reply as text. Empty model name means "whatever the server has loaded", reasoning comes out on a separate output so the text stays clean for conditioning — both inline `<think>` blocks and the `reasoning_content` field servers return for hybrid models — and the seed doubles as the re-roll knob. Give reasoning models a generous `max_tokens`: they spend tokens thinking *before* answering, and if the budget runs out mid-thought the node tells you so by name rather than handing back an empty string. Chain the `history` output into another chat node's `history` input for multi-turn conversations, or fill `json_schema` to force a structured JSON reply. Errors are actionable: a refused connection says how to start the server.

### Color Match 🆎

Harmonizes an image against a reference by transferring per-channel LAB mean and standard deviation — the fix for an inpainted or upscaled region that comes back slightly brighter or cooler than the plate it sits in. Optional mask restricts the correction to just that region, and `strength` blends it back toward the original. For video, `reference_mode: first_frame` locks every frame to the batch's own first frame — the one-node flicker fix.

### Load Image + Pad 🆎

A Load Image that opens straight into an outpaint canvas: drag any edge of the final rect drawn on the node to grow that side's padding — the whole edge is the handle, per-side pixel counts ride the bands, and the badge always shows the true output size. The mask covers exactly the padding with an optional **feather** ramped inward across the seam, the canvas rounds up to a clean multiple, and a **megapixel target** rescales the source *before* padding so the mask seam stays crisp at sampler-friendly sizes. Outputs the canvas, the mask, the final width/height as INTs, a `stitcher` for Stitch Inpaint 🆎 that restores the original pixels bit-identically after sampling, and a `reference` — the unpadded source fitted to a small multiple of 16 for reference conditioning.

### Krea 2 Encode 🆎

Encodes a Krea 2 prompt pair and attaches reference latents in one node. Wire a VAE and a reference image and the reference is encoded onto the positive conditioning; leave them unwired and it is a plain two-prompt encoder. The negative comes out of the same node, so a turbo graph at CFG 1.0 is not carrying a second text encode that does nothing. References are fitted to a 384px long edge and a multiple of 16 — the VAE downsamples by 8 and the DiT patchifies by 2, so an odd edge lands on a partial patch.

### Krea 2 Outpaint Model Patch 🆎

Tells Krea 2 **where** the reference sits. Reference latents normally arrive with no position, so the model treats them as a loose style hint and reinvents the content; this registers them into the target grid at the rectangle Load Image + Pad 🆎 records on the `stitcher`, which is what makes an outpaint continue the source instead of painting something adjacent to it. Place it after any LoRA loader and before the sampler. It patches comfy's flux attention internals, so it imports them when you run it rather than at startup — a core change that moves them surfaces as an error on this node instead of quietly dropping it from the menu.

**Extend one axis at a time.** The source has to span one whole canvas axis: pad left/right and it spans the full height, pad top/bottom and it spans the full width. Padding both at once puts the placement outside what the weights do and the new region breaks up — hard cuts at the old edge, mangled content. Do it in two runs instead. A rounding sliver counts too, so if `canvas_multiple` rounds the other axis up by even a few pixels, lower it or pick one that divides that dimension. The node prints exactly this, with the spare pixels on each axis, when it sees a placement that spans neither.

### Frame Interpolate 🆎

Retimes a clip by **frames per second rather than a whole-number multiple**, so 24 to 30 works as naturally as doubling. Choose a fast `blend` crossfade or optical flow for real motion. Hard cuts are detected and held rather than interpolated across, avoiding the smeared morph other interpolators produce at a scene change. Memory is bounded by planning the work first and streaming results back to the CPU.

### LaMa Inpaint 🆎

Inpaints white mask regions with a TorchScript LaMa checkpoint, preserves pixels where the mask is zero, and processes large video batches one frame at a time to keep VRAM bounded. Its panel streams each finished frame during a video run and holds the result afterwards — one preview surface, not ComfyUI's stacked underneath as well. Place `big-lama.pt` in `ComfyUI/models/lama/`; the node never performs automatic downloads.

### Crop For Inpaint / Stitch Inpaint 🆎

Inpaint only where it matters: Crop For Inpaint grows the mask's bounding box by a context factor and emits the crop, the raw sampling mask, and a stitcher; Stitch Inpaint pastes the result back with a separately feathered blend so every pixel outside the blend region stays **bit-identical** to the original. The stitcher broadcasts across a video batch, so one crop serves a whole clip. An optional `fix_edge_halo` toggle removes the rim that appears when a feathered seam gets blended twice. `target_megapixels` rescales the crop to a sampler-friendly area with a selectable `rescale_algorithm`, and the `extend_*` inputs grow the frame itself for outpainting — the new bands become part of the stitched output.

### Load Video 🆎

Loads a video as frames plus audio with `frame_count`, `fps`, `width`, `height`, and `duration` outputs, plus a lazy core `VIDEO` handle so the clip chains straight into ComfyUI's own video nodes. Its single responsive player includes a two-handle trim timeline: drag **IN** and **OUT** (shown as `h:mm:ss.s` timecodes you can type into), preview exactly that window, and optionally loop it. Only the selected window is decoded, with a memory guard that reports oversized trims instead of exhausting RAM; audio is extracted lazily only when consumed. Optional custom width/height with aspect-preserving single-side mode; `every_nth` thins long clips (the fps output divides to match) and `max_frames` caps the decode outright.

### Mask Refine 🆎

Grows or shrinks a mask, fills enclosed holes, melts jagged edges with a `smooth` control that does not feather, feathers, and rescales the extremes with black/white points — returning both the refined mask and its inverse. Optional `guided filter` and `matting` tiers refine the edge against a guide image when you install the matching extra. The panel previews the refined mask itself, so you can see what a setting did. It opens on `expand` and `blur` alone with the rest behind **MORE**, and **AUTO** sets both from the mask's size — a feather is a fraction of the picture, so what covers a watermark rim at 576px is a smear on a thumbnail.

### Save Video 🆎

Encodes frames — or a connected core `VIDEO` — to mp4 (h264/h265, CPU or NVENC), webm (vp9/av1), ProRes mov, bit-exact lossless ffv1 mkv, gif or webp. The video formats are tagged bt709 (so platforms don't shift your colors), take optional muxed audio, and embed the workflow, so a saved mp4 dragged back onto the canvas restores its graph — `save_metadata` turns that off when you'd rather not ship your prompts. `pingpong` bounces the clip for a seamless loop without repeating the turnaround frames. The responsive in-node player previews the encoded result. Wire `fps` from Load Video to preserve source timing; a connected video brings its own rate and overrides the widget. Encoding runs off the executor thread with per-frame progress, so a long export never freezes the UI.

### Image Compare A/B 🆎

A/B any two images: slide mode sweeps B over A under your pointer with a seam line, or flip the whole panel with the A/B toggle — the button says which one you're looking at, and flicking between them in place is how you catch a small change. Nothing is drawn over the picture; the resolution sits centred beneath it. Passes image A through, so it sits mid-graph without rewiring.

The two transform nodes return exactly:

1. `image` — transformed ComfyUI `IMAGE`
2. `mask` — generated-area `MASK`, including source transparency, rotation corners, and padding

The operation order is always **rotate → crop → pad**. New sources start with zero rotation, full crop, zero padding, and a canvas multiple of `1`.

## Install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ausboss/ComfyUI-AusBoss.git
```

Restart ComfyUI, then search for `AusBoss`. There are no additional Python dependencies; the pack uses Pillow, NumPy, Torch, and PyAV already distributed with ComfyUI. LaMa Inpaint additionally needs a TorchScript `big-lama.pt` checkpoint in `ComfyUI/models/lama/`.

## Model Links

**lama**

- [big-lama.pt](https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt)

## Model Storage Location

```text
📂 ComfyUI/
└── 📂 models/
    └── 📂 lama/
        └── big-lama.pt
```

After updating frontend files, hard-refresh the browser with `Ctrl+Shift+R`.

## Quick start

1. Add either transform node.
2. Pick or upload a source. For very large videos, switch the video node to `local path` mode.
   Queued workflows always read local paths, but the editor's live preview of paths outside
   ComfyUI's own folders is opt-in: start ComfyUI with `AUSBOSS_TRANSFORM_LOCAL_PREVIEW=1`
   to enable it. This keeps the preview routes from exposing arbitrary files to anything
   that can reach your ComfyUI server (for example on `--listen`).
3. Click **Open editor**.
4. Drag cyan crop handles, orange padding handles, or the green rotation handle.
5. Close the editor and connect `image` and `mask` downstream.

Use the matching examples in [`example_workflows`](example_workflows) as small starting graphs.

## Editor controls

- Eight crop handles with generous hit targets
- Four visually distinct padding handles
- Rotation handle with alignment grid and `Shift` snapping to 15 degrees
- Free or ratio-locked crop
- Mouse-wheel zoom; middle-mouse or `Alt`-drag pan
- Reset view, reset padding, and reset all
- Video first/last, ±1, ±25, ±50, ±100, playback, and timeline scrubbing

## Settings

Under **Settings → 🆎 AusBoss** you can pick an **AusBoss node color** scheme
(Graphite, Slate, Teal, Moss, Plum, Rust, Navy, or **Custom** with your own
picked tint). It recolors every AusBoss
node in the open workflow immediately and applies to nodes you add later.
Nodes you have colored by hand keep their own colors, and **Theme default**
returns everything to the stock look. Right-click any AusBoss node for a
per-node **AusBoss color** override, and press **Alt+E** (rebindable in
Settings → Keybindings) to open the selected transform node's editor.

Custom crop aspect-ratio presets live in an optional `ausboss_presets.json`
next to the pack — copy `ausboss_presets_example.json` to start; your file is
gitignored and survives updates.

Under **Chrome**: the browser tab's icon and title can show rendering state
and queue depth (on by default), **live status badges** report progress on the
node itself while it works — `frame 43/120` through a video inpaint — (on by
default), and optional **node runtime badges** stamp each node with its seconds
after a run (off by default).

## Compatibility

- Classic V1 node definitions for broad ComfyUI compatibility
- Classic canvas and Nodes 2.0 frontend support
- API-mode execution does not require the editor to be open
- Transform editors validated on ComfyUI `0.27.1`; the pack scaffold was also validated on `0.28.0`

The declared minimum is ComfyUI `0.27.1` (`requires-comfyui` under `[tool.comfy]` in `pyproject.toml`, which ComfyUI-Manager enforces at install time). If a frontend update changes custom-widget behavior, please include your ComfyUI and frontend versions in the issue.

## Development

```bash
python scripts/validate_nodes.py
python scripts/release_preflight.py
python -m unittest discover -s tests -p "test_*.py" -v
node --test tests/*.test.mjs
```

See [`AGENTS.md`](AGENTS.md) for compatibility rules and [`docs/adding_a_node.md`](docs/adding_a_node.md) for the node checklist.

## License

MIT. See [`LICENSE`](LICENSE).
