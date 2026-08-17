<div align="center">
  <h1>ComfyUI-AusBoss</h1>
  <p><strong>Polished nodes for the workflows I use most.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License">
    <img src="https://img.shields.io/badge/release-1.0.0-00b4aa?style=flat-square" alt="Release 1.0.0">
  </p>
</div>

ComfyUI-AusBoss is a curated collection of polished nodes designed to streamline the ComfyUI workflows I use most. Each node replaces repetitive setup with focused controls, compact graph footprints, and only the outputs needed downstream. Larger visual tasks open into dedicated full-screen editors, while experiments and one-off utilities stay out of the public pack.

## Nodes

### Image Crop + Rotate + Pad 🆎

A Load Image-style node with a compact transformed preview and a full-screen editor for precise crop, rotation, padding, fill, mask feathering, and output-size alignment. The preview is itself a live stage — drag the crop handles, padding diamonds, and rotate knob directly on the node, and open the editor when you want zoom, pan, and the numeric sidebar.

### Video Crop + Rotate + Pad 🆎

Targets an exact video frame from an uploaded input file or local path. The full-screen editor adds a long timeline, playback, exact frame steps, and the same transform controls as the image node.

### Select Frame 🆎

Returns one unchanged frame from an `IMAGE` batch using a clear one-based frame number. Out-of-range requests report the valid range instead of silently selecting the wrong image.

### Frame Chooser 🆎

Pauses the graph and shows the incoming batch as a clickable filmstrip: pick the frames to keep, or Keep all / Cancel — with digits, `A`/`N`, `Enter` and `Escape` on the keyboard. A countdown can auto-answer with the policy you choose, a reload mid-pause restores the panel, and filling `pick_list` skips the pause entirely so a chosen take reruns headlessly (your interactive picks are written back there for you). Outputs the kept sub-batch, its count, and the one-based indices.

### LoRA Loader 🆎

A stacked multi-LoRA node. Each row has an on/off pill, a searchable picker (type to filter, arrow keys + Enter to pick; browse view groups by folder and hovering shows the preview image), and strengths you can **drag left/right to scrub** (Shift for fine steps) or click to type. A header pill toggles the whole stack. The per-row info card shows the LoRA's preview image, base model, trigger words from its file metadata, a one-click Civitai lookup, or your own saved words — click words to toggle them into the deduplicated `trigger_words` output — plus an optional suggested strength range that tints out-of-range values. The bar's ▤ button saves and applies named templates of the whole stack, and a LoRA trained for a different base model than the connected checkpoint logs a console warning. CLIP input is optional.

### Align Image 🆎

Snaps width and height to a clean multiple of a number you pick — 16, 32, whatever the model wants. Qwen image models, VAEs, and many samplers behave best on cleanly divisible sizes. `resize` rescales to the nearest multiple, `crop` center-crops down, `pad` replicate-pads up, and the new size comes out as INTs for wiring into latent nodes — plus `offset_x`/`offset_y` for cropping back after sampling.

### Image Size 🆎

Reads an image's dimensions as INTs — width, height, longest edge, shortest edge — so resizes and latents key off the actual image instead of retyped numbers that drift.

### LM Studio Chat 🆎

Sends a prompt (and optionally an image) to a local LM Studio server — or any OpenAI-compatible endpoint — and returns the reply as text. Empty model name means "whatever the server has loaded", reasoning-model `<think>` blocks come out on a separate output so the text stays clean for conditioning, and the seed doubles as the re-roll knob. Chain the `history` output into another chat node's `history` input for multi-turn conversations, or fill `json_schema` to force a structured JSON reply. Errors are actionable: a refused connection says how to start the server.

### Color Match 🆎

Harmonizes an image against a reference by transferring per-channel LAB mean and standard deviation — the fix for an inpainted or upscaled region that comes back slightly brighter or cooler than the plate it sits in. Optional mask restricts the correction to just that region, and `strength` blends it back toward the original. For video, `reference_mode: first_frame` locks every frame to the batch's own first frame — the one-node flicker fix.

### Pad Image 🆎

Pads an image with a solid color, replicated edges, replicated edge pixels, or a **pillarbox blur** (a blurred, dimmed copy of the frame behind the sharp original — the standard look for reframing video to a new aspect). Also returns a mask covering exactly the new padding, ready to wire straight into an outpaint. The stage on the node is the control: drag any edge of the final rect to set that side's padding over a live preview of the input (run once to fill it in).

### Load Image + Pad 🆎

A Load Image that opens straight into an outpaint canvas: drag any edge of the final rect drawn on the node to grow that side's padding — the whole edge is the handle, per-side pixel counts ride the bands, and the badge always shows the true output size. The mask covers exactly the padding with an optional **feather** ramped inward across the seam, the canvas rounds up to a clean multiple, and a **megapixel target** rescales the source *before* padding so the mask seam stays crisp at sampler-friendly sizes. Outputs the canvas, the mask, and the final width/height as INTs.

### Drop Shadow 🆎

Drops a soft shadow behind a masked subject with signed offset, grow, blur, color, and opacity — what sells a padded or reframed composition as deliberate. A multiply blend mode keeps the backdrop's texture, and the `shadow_mask` output hands the effective shadow alpha to downstream compositing.

### Frame Interpolate 🆎

Retimes a clip by **frames per second rather than a whole-number multiple**, so 24 to 30 works as naturally as doubling. Choose a fast `blend` crossfade or optical flow for real motion. Hard cuts are detected and held rather than interpolated across, avoiding the smeared morph other interpolators produce at a scene change. Memory is bounded by planning the work first and streaming results back to the CPU.

### LaMa Inpaint 🆎

Inpaints white mask regions with a TorchScript LaMa checkpoint, preserves pixels where the mask is zero, and processes large video batches one frame at a time to keep VRAM bounded. Place `big-lama.pt` in `ComfyUI/models/lama/`; the node never performs automatic downloads.

### Crop For Inpaint / Stitch Inpaint 🆎

Inpaint only where it matters: Crop For Inpaint grows the mask's bounding box by a context factor and emits the crop, the raw sampling mask, and a stitcher; Stitch Inpaint pastes the result back with a separately feathered blend so every pixel outside the blend region stays **bit-identical** to the original. The stitcher broadcasts across a video batch, so one crop serves a whole clip. An optional `fix_edge_halo` toggle removes the rim that appears when a feathered seam gets blended twice. `target_megapixels` rescales the crop to a sampler-friendly area with a selectable `rescale_algorithm`, and the `extend_*` inputs grow the frame itself for outpainting — the new bands become part of the stitched output.

### Load Video 🆎

Loads a video as frames plus audio with `frame_count`, `fps`, `width`, `height`, and `duration` outputs, plus a lazy core `VIDEO` handle so the clip chains straight into ComfyUI's own video nodes. Its single responsive player includes a two-handle trim timeline: drag **IN** and **OUT** (shown as `h:mm:ss.s` timecodes you can type into), preview exactly that window, and optionally loop it. Only the selected window is decoded, with a memory guard that reports oversized trims instead of exhausting RAM; audio is extracted lazily only when consumed. Optional custom width/height with aspect-preserving single-side mode; `every_nth` thins long clips (the fps output divides to match) and `max_frames` caps the decode outright.

### Refine Mask 🆎

Grows or shrinks a mask, fills enclosed holes, melts jagged edges with a `smooth` control that does not feather, feathers, and rescales the extremes with black/white points — returning both the refined mask and its inverse. Optional `guided filter` and `matting` tiers refine the edge against a guide image when you install the matching extra.

### Save Video 🆎

Encodes frames — or a connected core `VIDEO` — to an H.264/H.265 mp4 or VP9 webm (all CRF-controlled) tagged bt709 (so platforms don't shift your colors), with optional muxed audio and the workflow embedded, so a saved mp4 dragged back onto the canvas restores its workflow. The responsive in-node player previews the encoded result with loop and reload controls. Wire `fps` from Load Video to preserve source timing; a connected video brings its own rate and overrides the widget. Encoding runs off the executor thread with per-frame progress, so a long export never freezes the UI.

### Compare 🆎

A/B any two images: slide mode sweeps B over A under your pointer with a seam line, hold mode shows B while pressed. Passes image A through, so it sits mid-graph without rewiring.

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

The declared minimum is ComfyUI `0.27.1` (`supported_comfyui_version` in `pyproject.toml`, which ComfyUI-Manager enforces at install time). If a frontend update changes custom-widget behavior, please include your ComfyUI and frontend versions in the issue.

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
