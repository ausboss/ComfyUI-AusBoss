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
input image — nothing outside the crop ever round-trips a resize. The
optional edge-halo spread only swaps the color that gets blended in, so
that guarantee holds with the toggle on as well.
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


# --- optional edge-halo spread -----------------------------------------------

# The spread estimates against the exact mask the composite uses - never a
# dilated one. Measured on flat, gradient, noisy and hard-edged backgrounds:
# each pixel of dilation throws away roughly half of the remaining correction
# (1px leaves ~45% of the halo, 2px leaves ~75%), and the opposite-sign rim
# dilation would guard against never showed up above the noise floor.

_PYMATTING_HINT = (
    "Stitch Inpaint: fix_edge_halo needs the optional 'pymatting' package "
    "(pip install pymatting); pasting the edge pixels unchanged."
)

_warned: set[str] = set()


def _warn_once(message: str) -> None:
    """Print an ASCII console note at most once per process."""
    if message in _warned:
        return
    _warned.add(message)
    print(f"[AusBoss] {message}")


def _foreground_estimator():
    """pymatting's multi-level foreground estimator, or None when absent."""
    try:
        from pymatting import estimate_foreground_ml
    except Exception:
        return None
    return estimate_foreground_ml


def _raise_if_interrupted() -> None:
    try:
        from comfy.model_management import throw_exception_if_processing_interrupted
    except ImportError:  # Offline tests run without ComfyUI.
        return
    throw_exception_if_processing_interrupted()


def _progress_bar(total: int):
    try:
        from comfy.utils import ProgressBar
    except ImportError:  # Offline tests run without ComfyUI.
        return None
    return ProgressBar(total)


def spread_edge_colors(patch: torch.Tensor, alpha: torch.Tensor) -> torch.Tensor:
    """True foreground color of ``patch``, spread across the blend band.

    A semi-transparent seam pixel carries a mix of the inpainted color and
    the background it was generated against. Blending that mix in a second
    time multiplies the background contribution twice and reads as a dark
    or light halo along the seam. Estimating the unmixed color first and
    compositing *that* keeps the seam neutral.

    Returns ``patch`` untouched when pymatting is missing (one warning), when
    the estimate fails, or when the mask has no semi-transparent pixels to
    fix. Only the pasted color changes: the caller still weights with the
    ungrown mask, so zero-weight pixels stay bit-identical.

    The solve runs on the CPU, one frame at a time, and reports progress and
    honors a cancel between frames.
    """
    if not bool(((alpha > 0.0) & (alpha < 1.0)).any()):
        return patch
    estimate = _foreground_estimator()
    if estimate is None:
        _warn_once(_PYMATTING_HINT)
        return patch

    matte_alpha = alpha
    if matte_alpha.shape[0] == 1 and patch.shape[0] > 1:
        matte_alpha = matte_alpha.expand(patch.shape[0], -1, -1)

    # Cost, measured on a 16-thread desktop CPU with pymatting 1.1.15: about
    # 90 ms per megapixel of paste window, per frame - 48 ms for the 768x768
    # window a 1024x1024 frame produces, 106 ms for the 1440x816 window from
    # 1080p. That is why the toggle ships off: it is meant for finishing a
    # chosen take, not for a long exploratory batch, where 300 frames of 1080p
    # is over half a minute of solving. The per-frame cancel check and progress
    # update keep such a batch stoppable at the next frame boundary.
    total = patch.shape[0]
    progress = _progress_bar(total) if total > 1 else None
    spread = torch.empty_like(patch)
    for index in range(total):
        _raise_if_interrupted()
        # pymatting solves in float32 and casts whatever it is handed, so
        # feeding float32 drops a float64 temporary of twice the size for a
        # bit-identical estimate.
        image = patch[index].detach().to(torch.float32).cpu().contiguous().numpy()
        matte = (
            matte_alpha[index].detach().to(torch.float32).clamp(0.0, 1.0).cpu().contiguous().numpy()
        )
        try:
            foreground = estimate(image, matte)
        except Exception as exc:  # A failed estimate must never fail the paste.
            detail = str(exc).encode("ascii", "replace").decode("ascii")
            _warn_once(f"Stitch Inpaint: edge-halo spread failed ({detail}).")
            return patch
        spread[index] = torch.as_tensor(foreground)  # copy_ handles dtype/device
        if progress is not None:
            progress.update_absolute(index + 1, total)

    torch.nan_to_num_(spread, nan=0.0, posinf=1.0, neginf=0.0)
    # The spread redistributes colors the patch already holds; clamping to its
    # own range keeps the fix from inventing a brighter ring than it removes.
    low = float(torch.nan_to_num(patch.min(), nan=0.0))
    high = float(torch.nan_to_num(patch.max(), nan=1.0))
    return spread.clamp_(low, high)


# --- the crop / stitch pair --------------------------------------------------


def build_crop(
    image: torch.Tensor,
    mask: torch.Tensor,
    context_factor: float,
    blend_pixels: int,
    output_multiple: int,
    target_width: int = 0,
    target_height: int = 0,
    mask_grow: int = 0,
    mask_blur: float = 0.0,
    invert_mask: bool = False,
    context_pixels: int = 0,
) -> tuple[torch.Tensor, torch.Tensor, dict]:
    """Crop the masked region plus context; return (image, mask, stitcher).

    ``invert_mask`` flips the selection before anything else; ``mask_grow``
    dilates (or erodes, negative) the sampling mask and ``mask_blur``
    softens its edge — both reshape the region the inpainter paints, unlike
    ``blend_pixels`` which only feathers the paste-back. ``context_pixels``
    adds flat pixels of context on top of the ``context_factor`` growth.
    An empty mask selects the full image without context growth, so the
    graph keeps running; its blend mask is empty, so stitching returns
    the original untouched.
    """
    image = _as_image(image)
    mask = _as_mask(mask, image)
    if invert_mask:
        mask = 1.0 - mask
    grow_px = int(mask_grow)
    if grow_px:
        mask = grow_shrink_mask(mask, grow_px)
    blur_sigma = max(0.0, float(mask_blur))
    if blur_sigma > 0.0:
        mask = blur_mask(mask, blur_sigma).clamp(0.0, 1.0)
    height, width = image.shape[1], image.shape[2]
    multiple = max(1, int(output_multiple))
    blend_px = max(0, int(blend_pixels))
    context_px = max(0, int(context_pixels))
    target_w = max(0, int(target_width))
    target_h = max(0, int(target_height))
    use_target = target_w > 0 or target_h > 0

    bbox = mask_bbox(mask)
    if bbox is None:
        rect = (0, 0, width, height)
    else:
        rect = grow_rect(bbox, max(1.0, float(context_factor)))
        if context_px:
            rect = (
                rect[0] - context_px,
                rect[1] - context_px,
                rect[2] + 2 * context_px,
                rect[3] + 2 * context_px,
            )
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


def apply_stitch(
    stitcher: dict, inpainted: torch.Tensor, fix_edge_halo: bool = False
) -> torch.Tensor:
    """Blend the inpainted crop back and return the original-size image.

    Guarantees: pixels where the blend mask is zero are bit-identical to
    the original image, and passing the crop back unchanged reproduces
    the original exactly. A stitcher built from a single image legally
    broadcasts across an N-frame inpainted batch.

    ``fix_edge_halo`` swaps the blended-in color for the spread foreground
    color from :func:`spread_edge_colors`; it never widens the blend, so
    the zero-weight guarantee is unaffected. Identity round trips are only
    exact with the toggle off, since the spread deliberately rewrites the
    feathered band.
    """
    if not isinstance(stitcher, dict) or stitcher.get("kind") != STITCHER_KIND:
        raise ValueError(
            "Stitch Inpaint needs the stitcher output of Crop For Inpaint."
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

    alpha = blend[:, cy : cy + ch, cx : cx + cw].to(out.device)
    if fix_edge_halo:
        patch = spread_edge_colors(patch, alpha)
    weights = alpha.unsqueeze(-1)
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
    "spread_edge_colors",
]
