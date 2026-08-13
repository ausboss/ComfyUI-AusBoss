"""Crop-for-inpaint geometry and stitching shared by AusBoss nodes.

The contract is a two-rect canvas:

* ``canvas`` is the original image, edge-replicate padded only when the
  grown context rect truly cannot fit inside the frame.
* ``canvas_to_original`` locates the untouched original inside the canvas.
* ``crop_to_canvas`` locates the crop handed to the sampler inside the
  canvas.

Stitching blends the (possibly resized) inpainted crop into the canvas
with a feathered blend mask, then slices ``canvas_to_original`` back out.
Because the original pixels sit verbatim in the canvas and the blend is
applied as ``canvas + blend * (inpainted - canvas)`` with a hard zero
guard, every pixel outside the blend region is bit-identical to the
input image — nothing outside the crop ever round-trips a resize.
"""

from __future__ import annotations

import torch
import torch.nn.functional as functional

from ._mask_helpers import blur_mask, grow_shrink_mask

STITCHER_KIND = "ausboss_inpaint_stitcher"
STITCHER_VERSION = 1

Rect = tuple[int, int, int, int]  # (x, y, w, h)


# --- pure geometry -----------------------------------------------------------


def round_up_to_multiple(value: int, multiple: int) -> int:
    """Smallest multiple of ``multiple`` that is >= ``value``."""
    multiple = max(1, int(multiple))
    value = max(1, int(value))
    return ((value + multiple - 1) // multiple) * multiple


def mask_bbox(mask: torch.Tensor) -> Rect | None:
    """Tight bounding box of all nonzero pixels, unioned across the batch.

    Returns ``None`` for an empty mask.
    """
    covered = mask > 0
    if not bool(covered.any()):
        return None
    rows = covered.any(dim=2).any(dim=0)
    cols = covered.any(dim=1).any(dim=0)
    row_idx = torch.nonzero(rows).flatten()
    col_idx = torch.nonzero(cols).flatten()
    y0, y1 = int(row_idx[0]), int(row_idx[-1]) + 1
    x0, x1 = int(col_idx[0]), int(col_idx[-1]) + 1
    return (x0, y0, x1 - x0, y1 - y0)


def grow_rect(rect: Rect, factor: float) -> Rect:
    """Grow a rect symmetrically so each side scales by ``factor``."""
    x, y, w, h = rect
    new_w = max(1, round(w * float(factor)))
    new_h = max(1, round(h * float(factor)))
    return (x - (new_w - w) // 2, y - (new_h - h) // 2, new_w, new_h)


def expand_rect_to_multiple(rect: Rect, multiple: int) -> Rect:
    """Grow a rect symmetrically until both sides are multiples."""
    x, y, w, h = rect
    new_w = round_up_to_multiple(w, multiple)
    new_h = round_up_to_multiple(h, multiple)
    return (x - (new_w - w) // 2, y - (new_h - h) // 2, new_w, new_h)


def fit_rect(rect: Rect, bounds_w: int, bounds_h: int) -> Rect:
    """Shift a rect fully into bounds; center it when it cannot fit.

    The size is never changed: a rect wider or taller than the bounds is
    centered so its overflow splits evenly — that overflow becomes the
    replicate-padded canvas margin.
    """
    x, y, w, h = rect
    if w <= bounds_w:
        x = min(max(x, 0), bounds_w - w)
    else:
        x = -((w - bounds_w) // 2)
    if h <= bounds_h:
        y = min(max(y, 0), bounds_h - h)
    else:
        y = -((h - bounds_h) // 2)
    return (x, y, w, h)


def rect_margins(rect: Rect, bounds_w: int, bounds_h: int) -> tuple[int, int, int, int]:
    """(left, top, right, bottom) overflow of a rect past the bounds."""
    x, y, w, h = rect
    return (max(0, -x), max(0, -y), max(0, x + w - bounds_w), max(0, y + h - bounds_h))


# --- tensor plumbing ---------------------------------------------------------


def _as_image(image: torch.Tensor) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Crop For Inpaint expected a BHWC IMAGE batch.")
    return image.float()


def _as_mask(mask: torch.Tensor, image: torch.Tensor) -> torch.Tensor:
    if isinstance(mask, torch.Tensor) and mask.ndim == 2:
        mask = mask.unsqueeze(0)
    if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
        raise ValueError("Crop For Inpaint expected a BHW MASK.")
    if mask.shape[1:] != image.shape[1:3]:
        raise ValueError(
            f"Mask size {tuple(mask.shape[1:])} does not match "
            f"image size {tuple(image.shape[1:3])}."
        )
    if mask.shape[0] not in (1, image.shape[0]):
        raise ValueError(
            f"Mask batch {mask.shape[0]} cannot broadcast across "
            f"image batch {image.shape[0]}."
        )
    return mask.float().clamp(0.0, 1.0)


def _resize_image(image: torch.Tensor, width: int, height: int) -> torch.Tensor:
    moved = image.movedim(-1, 1).contiguous()
    antialias = width < moved.shape[-1] or height < moved.shape[-2]
    resized = functional.interpolate(
        moved, size=(height, width), mode="bilinear", align_corners=False, antialias=antialias
    )
    return resized.movedim(1, -1).contiguous()


def _resize_mask(mask: torch.Tensor, width: int, height: int) -> torch.Tensor:
    resized = functional.interpolate(
        mask.unsqueeze(1), size=(height, width), mode="nearest-exact"
    )
    return resized.squeeze(1)


def _replicate_pad_image(
    image: torch.Tensor, left: int, top: int, right: int, bottom: int
) -> torch.Tensor:
    moved = image.movedim(-1, 1).contiguous()
    padded = functional.pad(moved, (left, right, top, bottom), mode="replicate")
    return padded.movedim(1, -1).contiguous()


# --- the crop / stitch pair --------------------------------------------------


def build_crop(
    image: torch.Tensor,
    mask: torch.Tensor,
    context_factor: float,
    blend_pixels: int,
    output_multiple: int,
    target_width: int = 0,
    target_height: int = 0,
) -> tuple[torch.Tensor, torch.Tensor, dict]:
    """Crop the masked region plus context; return (image, mask, stitcher).

    An empty mask selects the full image without context growth, so the
    graph keeps running; its blend mask is empty, so stitching returns
    the original untouched.
    """
    image = _as_image(image)
    mask = _as_mask(mask, image)
    height, width = image.shape[1], image.shape[2]
    multiple = max(1, int(output_multiple))
    blend_px = max(0, int(blend_pixels))
    target_w = max(0, int(target_width))
    target_h = max(0, int(target_height))
    use_target = target_w > 0 or target_h > 0

    bbox = mask_bbox(mask)
    if bbox is None:
        rect = (0, 0, width, height)
    else:
        rect = grow_rect(bbox, max(1.0, float(context_factor)))
        rect = fit_rect(rect, width, height)
    if not use_target:
        # Native sizing: the crop itself must satisfy the sampler multiple.
        rect = expand_rect_to_multiple(rect, multiple)
        rect = fit_rect(rect, width, height)

    left, top, right, bottom = rect_margins(rect, width, height)
    if left or top or right or bottom:
        canvas = _replicate_pad_image(image, left, top, right, bottom)
    else:
        canvas = image
    canvas_h = height + top + bottom
    canvas_w = width + left + right
    canvas_to_original: Rect = (left, top, width, height)
    crop_to_canvas: Rect = (rect[0] + left, rect[1] + top, rect[2], rect[3])

    canvas_mask = torch.zeros(
        (mask.shape[0], canvas_h, canvas_w), dtype=torch.float32, device=mask.device
    )
    canvas_mask[:, top : top + height, left : left + width] = mask

    if blend_px > 0:
        blend = grow_shrink_mask(canvas_mask, blend_px)
        blend = blur_mask(blend, blend_px / 3.0).clamp(0.0, 1.0)
    else:
        blend = canvas_mask.clone()

    cx, cy, cw, ch = crop_to_canvas
    cropped = canvas[:, cy : cy + ch, cx : cx + cw, :].clone()
    sampling = canvas_mask[:, cy : cy + ch, cx : cx + cw].clone()

    scale = None
    if use_target:
        if target_w <= 0:
            target_w = max(1, round(cw * target_h / ch))
        if target_h <= 0:
            target_h = max(1, round(ch * target_w / cw))
        target_w = round_up_to_multiple(target_w, multiple)
        target_h = round_up_to_multiple(target_h, multiple)
        if (target_w, target_h) != (cw, ch):
            cropped = _resize_image(cropped, target_w, target_h)
            sampling = _resize_mask(sampling, target_w, target_h)
        scale = (target_w / cw, target_h / ch)

    stitcher = {
        "kind": STITCHER_KIND,
        "version": STITCHER_VERSION,
        "canvas": canvas,
        "canvas_to_original": canvas_to_original,
        "crop_to_canvas": crop_to_canvas,
        "blend": blend,
        "scale": scale,
    }
    return cropped, sampling, stitcher


def apply_stitch(stitcher: dict, inpainted: torch.Tensor) -> torch.Tensor:
    """Blend the inpainted crop back and return the original-size image.

    Guarantees: pixels where the blend mask is zero are bit-identical to
    the original image, and passing the crop back unchanged reproduces
    the original exactly. A stitcher built from a single image legally
    broadcasts across an N-frame inpainted batch.
    """
    if not isinstance(stitcher, dict) or stitcher.get("kind") != STITCHER_KIND:
        raise ValueError(
            "Stitch Inpaint needs the stitcher output of Crop For Inpaint (AusBoss)."
        )
    inpainted = _as_image(inpainted)
    canvas = stitcher["canvas"]
    blend = stitcher["blend"]
    cx, cy, cw, ch = stitcher["crop_to_canvas"]
    ox, oy, ow, oh = stitcher["canvas_to_original"]

    frames = inpainted.shape[0]
    batch = canvas.shape[0]
    if batch == frames:
        out = canvas.clone()
    elif batch == 1:
        out = canvas.expand(frames, -1, -1, -1).clone()
    else:
        raise ValueError(
            f"Cannot stitch {frames} inpainted frame(s) into a stitcher "
            f"built from {batch} image(s); batches must match or the "
            "stitcher must come from a single image."
        )
    if inpainted.shape[3] != canvas.shape[3]:
        raise ValueError(
            f"Inpainted channels ({inpainted.shape[3]}) do not match the "
            f"cropped image ({canvas.shape[3]})."
        )
    if blend.shape[0] not in (1, frames):
        raise ValueError(
            f"Blend mask batch {blend.shape[0]} cannot broadcast across "
            f"{frames} inpainted frame(s)."
        )

    patch = inpainted.to(dtype=out.dtype, device=out.device)
    if (patch.shape[1], patch.shape[2]) != (ch, cw):
        patch = _resize_image(patch, cw, ch)

    weights = blend[:, cy : cy + ch, cx : cx + cw].unsqueeze(-1).to(out.device)
    region = out[:, cy : cy + ch, cx : cx + cw, :]
    # canvas + blend * (inpainted - canvas): identical input reproduces the
    # canvas bitwise; the where-guard pins the zero-blend region regardless
    # of what the sampler returned.
    mixed = region + weights * (patch - region)
    mixed = torch.where(weights > 0, mixed, region)
    out[:, cy : cy + ch, cx : cx + cw, :] = mixed
    return out[:, oy : oy + oh, ox : ox + ow, :].contiguous()


__all__ = [
    "STITCHER_KIND",
    "STITCHER_VERSION",
    "apply_stitch",
    "build_crop",
    "expand_rect_to_multiple",
    "fit_rect",
    "grow_rect",
    "mask_bbox",
    "rect_margins",
    "round_up_to_multiple",
]
