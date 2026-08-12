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

### Image Crop + Rotate + Pad (AusBoss)

A Load Image-style node with a compact transformed preview and a full-screen editor for precise crop, rotation, padding, fill, mask feathering, and output-size alignment.

### Video Crop + Rotate + Pad (AusBoss)

Targets an exact video frame from an uploaded input file or local path. The full-screen editor adds a long timeline, playback, exact frame steps, and the same transform controls as the image node.

### Select Frame (AusBoss)

Returns one unchanged frame from an `IMAGE` batch using a clear one-based frame number. Out-of-range requests report the valid range instead of silently selecting the wrong image.

### LaMa Inpaint (AusBoss)

Inpaints white mask regions with a TorchScript LaMa checkpoint, preserves pixels where the mask is zero, and processes large video batches one frame at a time to keep VRAM bounded. Place `big-lama.pt` in `ComfyUI/models/lama/`; the node never performs automatic downloads.

### Load Video (AusBoss)

Loads a video as frames plus audio with `frame_count`, `fps`, `width`, `height`, and `duration` outputs. Its single responsive player includes a two-handle trim timeline: drag **IN** and **OUT**, preview exactly that window, and optionally loop it. Only the selected window is decoded. Optional custom width/height with aspect-preserving single-side mode.

### Refine Mask (AusBoss)

Grows or shrinks a mask, optionally fills enclosed holes, and feathers the edge — returning both the refined mask and its inverse from one compact node.

### Save Video (AusBoss)

Encodes frames to an H.264 mp4 with optional muxed audio and the workflow embedded, so saved files drag back into ComfyUI. The responsive in-node player previews the encoded result with loop and reload controls. Wire `fps` from Load Video to preserve source timing; audio and video land in a single file.

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

## Compatibility

- Classic V1 node definitions for broad ComfyUI compatibility
- Classic canvas and Nodes 2.0 frontend support
- API-mode execution does not require the editor to be open
- Transform editors validated on ComfyUI `0.27.1`; the pack scaffold was also validated on `0.28.0`

No minimum ComfyUI version is declared. If a frontend update changes custom-widget behavior, please include your ComfyUI and frontend versions in the issue.

## Development

```bash
python scripts/validate_nodes.py
python -m unittest discover -s tests -p "test_*.py" -v
node --test tests/transform_geometry.test.mjs
```

See [`AGENTS.md`](AGENTS.md) for compatibility rules and [`docs/adding_a_node.md`](docs/adding_a_node.md) for the node checklist.

## License

MIT. See [`LICENSE`](LICENSE).
