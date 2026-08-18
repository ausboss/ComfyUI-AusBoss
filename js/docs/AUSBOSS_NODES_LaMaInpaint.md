# LaMa Inpaint

Removes masked content with a TorchScript LaMa checkpoint. It processes video
frames one at a time to keep VRAM bounded and composites the result through the
input mask so pixels where the mask is zero remain unchanged.

## Model setup

Place `big-lama.pt` in:

```text
ComfyUI/models/lama/big-lama.pt
```

The node never downloads a model. After adding or replacing a checkpoint,
refresh the browser or restart ComfyUI so the model list is updated.

## Controls

- **image**: BHWC images or video frames.
- **mask**: BHW mask where white identifies content to replace. One mask is
  broadcast across the batch; otherwise supply one mask per image.
- **model**: A `.pt` or `.pth` TorchScript checkpoint from `models/lama`.

## Output

- **image**: A finite BHWC image batch with the original batch size, dimensions,
  data type, extra channels, and unmasked pixels preserved.

## Preview

The panel shows the inpainted result, and before a run it falls back to a
thumbnail of whatever feeds the **image** input. A video inpaint streams each
finished frame to the panel as it goes, so a long run shows its progress
rather than sitting blank.

There is one preview surface: ComfyUI's own result preview for this node is
stood down so the picture does not appear twice, once in the panel and again
underneath the node.

The node performs no network requests. It writes one preview PNG per run into
ComfyUI's temp folder, alongside what `PreviewImage` writes.
