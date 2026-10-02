"""Tell when an outpaint came back unpainted.

A padded canvas carries a flat fill color in its new area (black for the LTX
outpaint LoRA, gray for most image models). When the model leaves some of
that fill alone, the stitched result simply shows plain bars, and nothing in
the graph says why. This module measures how much of the new area still
matches the untouched fill, so Stitch Inpaint can say so in plain words.

Technical details: the new area is split into 16 px blocks, and only blocks
that lie fully inside it are judged. A block counts as unpainted when it is
flat (standard deviation at most 1.5/255) and still close to the canvas fill:
within 20/255, which covers a VAE round trip and a model that hands a gray
fill back a few levels darker (Krea 2 returns 128 as a flat 114 to 118). Painted scenery has texture, even when it is
dark, so a night street does not count; the untouched fill does. The same
test runs on the source picture, and only the excess counts: a scene that
really is flat black (a night sky, a black stage) may be continued as flat
black, so its share is taken off before the limits apply. Up to nine frames
spread across a clip are checked.
"""

from __future__ import annotations

import torch

BLOCK = 16
MAX_FRAMES = 9
CLOSE_TO_FILL = 20.0 / 255.0
FLAT = 1.5 / 255.0
# Report when a quarter of the new area stayed empty on average, or when any
# checked frame lost half of it - a clip that paints early and fades back to
# the fill later is still a failed outpaint.
MEAN_LIMIT = 0.25
WORST_LIMIT = 0.5


def _frame(tensor: torch.Tensor, index: int) -> torch.Tensor:
    return tensor[index] if tensor.shape[0] > 1 else tensor[0]


def new_area_map(stitcher: dict) -> torch.Tensor | None:
    """BHW boolean map of the canvas pixels that were filled for the model, or
    None when the stitcher does not know (a Crop For Inpaint crop, where the
    masked pixels are the old picture, not a fill)."""
    canvas = stitcher.get("canvas")
    if not isinstance(canvas, torch.Tensor) or canvas.ndim != 4:
        return None
    height, width = int(canvas.shape[1]), int(canvas.shape[2])
    generated = stitcher.get("generated")
    if isinstance(generated, torch.Tensor) and generated.ndim == 3 and tuple(generated.shape[1:]) == (height, width):
        return generated >= 0.999
    bbox = stitcher.get("source_bbox")
    if bbox is None:
        return None
    x0, y0, x1, y1 = (int(value) for value in bbox)
    new = torch.ones((1, height, width), dtype=torch.bool)
    new[:, max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = False
    return new


def _blocks(tensor: torch.Tensor, rows: int, cols: int) -> torch.Tensor:
    """[H, W, C] (or [H, W]) cut into [rows, cols, BLOCK*BLOCK*C] blocks."""
    if tensor.ndim == 2:
        tensor = tensor.unsqueeze(-1)
    channels = tensor.shape[-1]
    cut = tensor[: rows * BLOCK, : cols * BLOCK]
    return cut.reshape(rows, BLOCK, cols, BLOCK, channels).permute(0, 2, 1, 3, 4).reshape(rows, cols, -1)


def unpainted_share(stitcher: dict, inpainted: torch.Tensor) -> dict | None:
    """How much of the new area came back as the untouched fill.

    Returns ``{"mean": 0..1, "worst": 0..1, "source": 0..1, "frames": n,
    "video": bool}`` over the checked frames, or None when there is nothing to judge: no fill
    area, or a canvas smaller than one block. ``source`` is the share of the
    source picture that is itself flat at the fill value. A result at another
    size is resized first, the way Stitch Inpaint pastes it.
    """
    new = new_area_map(stitcher)
    if new is None or not isinstance(inpainted, torch.Tensor) or inpainted.ndim != 4:
        return None
    canvas = stitcher["canvas"]
    height, width = int(canvas.shape[1]), int(canvas.shape[2])
    resize = tuple(inpainted.shape[1:3]) != (height, width)
    rows, cols = height // BLOCK, width // BLOCK
    if rows == 0 or cols == 0:
        return None
    frames = int(inpainted.shape[0])
    if canvas.shape[0] not in (1, frames) and canvas.shape[0] < frames:
        return None
    count = min(MAX_FRAMES, frames)
    picks = sorted({round(i * (frames - 1) / max(1, count - 1)) for i in range(count)})
    shares = []
    source_shares = []
    for index in picks:
        canvas_frame = _frame(canvas, index)[..., :3].float().cpu()
        result = inpainted[index : index + 1, ..., :3].float().cpu()
        if resize:
            # Stitch Inpaint resizes a result that came back at another size;
            # judge it the way it will be pasted.
            from ._inpaint_crop_helpers import _resize_image

            result = _resize_image(result, width, height, stitcher.get("algorithm", "bilinear"))
        result = result[0]
        new_blocks = _blocks(_frame(new, index).cpu(), rows, cols)
        inside = new_blocks.all(dim=-1)
        canvas_blocks = _blocks(canvas_frame, rows, cols)
        # Only a block the canvas really filled flat can be compared.
        judged = inside & (canvas_blocks.std(dim=-1) <= FLAT)
        total = int(judged.sum())
        if total == 0:
            continue
        result_blocks = _blocks(result, rows, cols)
        close = (result_blocks - canvas_blocks).abs().amax(dim=-1) <= CLOSE_TO_FILL
        flat = result_blocks.std(dim=-1) <= FLAT
        shares.append(float((judged & close & flat).sum()) / total)
        # The same test on the source picture, against the fill color.
        fill_value = canvas_blocks[judged].reshape(-1, 3).median(dim=0).values
        picture = ~new_blocks.any(dim=-1)
        if int(picture.sum()):
            pixels = canvas_blocks.reshape(rows, cols, -1, 3)
            near = (pixels - fill_value).abs().amax(dim=(-1, -2)) <= CLOSE_TO_FILL
            still = canvas_blocks.std(dim=-1) <= FLAT
            source_shares.append(float((picture & near & still).sum()) / int(picture.sum()))
    if not shares:
        return None
    source_share = sum(source_shares) / len(source_shares) if source_shares else 0.0
    return {
        "mean": sum(shares) / len(shares),
        "worst": max(shares),
        "source": source_share,
        "frames": len(shares),
        "video": frames > 1,
    }


def unpainted_notice(share: dict | None) -> str | None:
    """The plain-words message for a result that left too much of the fill, or None."""
    if not share:
        return None
    # Only what the new area has beyond the picture's own flat fill-colored
    # regions counts: a black night sky may be continued as black.
    baseline = share.get("source", 0.0)
    if share["mean"] - baseline < MEAN_LIMIT and share["worst"] - baseline < WORST_LIMIT:
        return None
    percent = round(100 * share["mean"])
    worst = round(100 * share["worst"])
    if share["frames"] > 1 and worst - percent >= 10:
        amount = f"{percent}% of the new area (up to {worst}% in some frames)"
    else:
        amount = f"{max(percent, worst)}% of the new area"
    advice = "Try another seed, or describe the whole wider scene in the prompt. Adding less space at a time also helps"
    if share.get("video"):
        advice += ", and a dark video paints better if you brighten it first"
    return (
        f"The model left {amount} unpainted: it still shows the plain fill color. {advice}. "
        "This check can flag intentional results. If the image looks right, "
        "you can ignore this warning."
    )


__all__ = ["new_area_map", "unpainted_notice", "unpainted_share"]
