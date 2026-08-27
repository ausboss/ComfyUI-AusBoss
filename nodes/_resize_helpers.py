"""Resize planning and resampling shared by AusBoss nodes.

The math is split from the tensors so it can be tested as numbers:
``resolve_target`` turns one of five target modes into a pixel size (0 keeps
the source, the pack-wide convention from ``output_size`` in
``_video_load_helpers``), ``plan_resize`` reconciles that size with the
source aspect (stretch / fit / cover_crop / pad) and ``divisible_by``, and
``resample_batch`` does the actual interpolation -- lanczos through PIL in
float, everything else through torch.
"""

from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn.functional as functional
from PIL import Image

from ._color_helpers import parse_fill_color
from ._pad_helpers import pad_image

TARGET_MODES = (
    "width+height",
    "longest_edge",
    "shortest_edge",
    "megapixels",
    "scale_factor",
)
PROPORTION_MODES = ("stretch", "fit", "cover_crop", "pad")
INTERPOLATION_MODES = ("lanczos", "bicubic", "bilinear", "nearest", "area")

_TORCH_MODES = {
    "bicubic": "bicubic",
    "bilinear": "bilinear",
    "nearest": "nearest-exact",
    "area": "area",
}


def _round_half_up(value: float) -> int:
    """Round half-up; Python's round banker-rounds .5 toward even."""
    return int(math.floor(value + 0.5))


def snap_to_multiple(value: int, multiple: int) -> int:
    """Nearest multiple, never below one step, so a snapped dimension can
    neither collapse to zero nor drift more than half a step away."""
    step = max(1, int(multiple))
    return max(step, _round_half_up(int(value) / step) * step)


def resolve_target(
    source_width: int,
    source_height: int,
    target_mode: str,
    width: int = 0,
    height: int = 0,
    edge_length: int = 0,
    megapixels: float = 0.0,
    scale_factor: float = 0.0,
) -> tuple[int, int]:
    """The requested output size before proportion handling.

    Every mode treats its 0 as "keep the source". width+height with one
    value set derives the other from the source aspect; the scaling modes
    (longest_edge / shortest_edge / megapixels / scale_factor) preserve
    aspect by construction.
    """
    source_w, source_h = int(source_width), int(source_height)
    if source_w <= 0 or source_h <= 0:
        raise ValueError("Image Resize needs a source larger than 0x0.")
    if target_mode not in TARGET_MODES:
        raise ValueError(
            f"target_mode must be one of {TARGET_MODES}, got '{target_mode}'."
        )

    def scaled(scale: float) -> tuple[int, int]:
        return (
            max(1, _round_half_up(source_w * scale)),
            max(1, _round_half_up(source_h * scale)),
        )

    if target_mode == "width+height":
        target_w, target_h = max(0, int(width)), max(0, int(height))
        if target_w <= 0 and target_h <= 0:
            return source_w, source_h
        if target_w > 0 and target_h > 0:
            return target_w, target_h
        if target_w > 0:
            return target_w, max(1, _round_half_up(source_h * target_w / source_w))
        return max(1, _round_half_up(source_w * target_h / source_h)), target_h
    if target_mode == "longest_edge":
        edge = int(edge_length)
        if edge <= 0:
            return source_w, source_h
        target_w, target_h = scaled(edge / max(source_w, source_h))
        # The chosen edge lands exactly on the request; only the other one
        # is rounded.
        return (edge, target_h) if source_w >= source_h else (target_w, edge)
    if target_mode == "shortest_edge":
        edge = int(edge_length)
        if edge <= 0:
            return source_w, source_h
        target_w, target_h = scaled(edge / min(source_w, source_h))
        return (edge, target_h) if source_w <= source_h else (target_w, edge)
    if target_mode == "megapixels":
        target = float(megapixels)
        if target <= 0.0:
            return source_w, source_h
        return scaled(math.sqrt(target * 1e6 / (source_w * source_h)))
    # scale_factor
    factor = float(scale_factor)
    if factor <= 0.0:
        return source_w, source_h
    return scaled(factor)


def plan_resize(
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
    keep_proportion: str,
    divisible_by: int = 1,
) -> dict[str, int]:
    """Geometry for one resize as plain numbers.

    resize_width/height is what the source is interpolated to and
    canvas_width/height the final output. cover_crop resizes past the
    canvas and crops back (crop_x/crop_y, centered); pad resizes inside it
    and fills the rest (offset_x/offset_y, centered). divisible_by snaps
    every canvas dimension to the nearest multiple (never below one step)
    and wins over exact proportion: in fit mode the snap may nudge a
    dimension by up to half a step.
    """
    source_w, source_h = int(source_width), int(source_height)
    target_w, target_h = int(target_width), int(target_height)
    if source_w <= 0 or source_h <= 0 or target_w <= 0 or target_h <= 0:
        raise ValueError("Image Resize needs source and target sizes above zero.")
    if keep_proportion not in PROPORTION_MODES:
        raise ValueError(
            f"keep_proportion must be one of {PROPORTION_MODES}, got '{keep_proportion}'."
        )

    plan = {"crop_x": 0, "crop_y": 0, "offset_x": 0, "offset_y": 0}

    if keep_proportion == "fit":
        # The output IS the fitted size -- no letterbox -- so the snap
        # applies to the fitted dimensions, not the requested box.
        scale = min(target_w / source_w, target_h / source_h)
        canvas_w = snap_to_multiple(max(1, _round_half_up(source_w * scale)), divisible_by)
        canvas_h = snap_to_multiple(max(1, _round_half_up(source_h * scale)), divisible_by)
        plan.update(
            resize_width=canvas_w,
            resize_height=canvas_h,
            canvas_width=canvas_w,
            canvas_height=canvas_h,
        )
        return plan

    canvas_w = snap_to_multiple(target_w, divisible_by)
    canvas_h = snap_to_multiple(target_h, divisible_by)
    plan.update(canvas_width=canvas_w, canvas_height=canvas_h)

    if keep_proportion == "stretch":
        plan.update(resize_width=canvas_w, resize_height=canvas_h)
    elif keep_proportion == "cover_crop":
        scale = max(canvas_w / source_w, canvas_h / source_h)
        # The epsilon keeps an exact scale (say 0.5) from ceiling one pixel
        # past the canvas on floating-point noise.
        resize_w = max(canvas_w, math.ceil(source_w * scale - 1e-6))
        resize_h = max(canvas_h, math.ceil(source_h * scale - 1e-6))
        plan.update(
            resize_width=resize_w,
            resize_height=resize_h,
            crop_x=(resize_w - canvas_w) // 2,
            crop_y=(resize_h - canvas_h) // 2,
        )
    else:  # pad
        scale = min(canvas_w / source_w, canvas_h / source_h)
        resize_w = min(canvas_w, max(1, _round_half_up(source_w * scale)))
        resize_h = min(canvas_h, max(1, _round_half_up(source_h * scale)))
        plan.update(
            resize_width=resize_w,
            resize_height=resize_h,
            offset_x=(canvas_w - resize_w) // 2,
            offset_y=(canvas_h - resize_h) // 2,
        )
    return plan


def _lanczos_resize(batch: torch.Tensor, width: int, height: int) -> torch.Tensor:
    """Per-channel PIL lanczos in float mode, so masks and images resample
    without a round trip through uint8."""
    device = batch.device
    array = batch.detach().cpu().numpy().astype(np.float32, copy=False)
    frames = []
    for frame in array:
        channels = [
            np.asarray(
                Image.fromarray(
                    np.ascontiguousarray(frame[:, :, index]), mode="F"
                ).resize((width, height), Image.LANCZOS),
                dtype=np.float32,
            )
            for index in range(frame.shape[-1])
        ]
        frames.append(np.stack(channels, axis=-1))
    result = torch.from_numpy(np.stack(frames, axis=0))
    # Lanczos rings past the value range; images live in 0..1.
    return result.clamp_(0.0, 1.0).to(device)


def resample_batch(
    batch: torch.Tensor, width: int, height: int, interpolation: str
) -> torch.Tensor:
    """Resize a BHWC float batch; masks ride through as BHW1.

    Returns the input tensor untouched when the size already matches, so a
    no-op resize stays bit-identical. lanczos and bicubic can overshoot and
    are clamped back to 0..1; bilinear and bicubic antialias when shrinking.
    """
    if not isinstance(batch, torch.Tensor) or batch.ndim != 4:
        raise ValueError("Image Resize expected a BHWC batch to resample.")
    if interpolation not in INTERPOLATION_MODES:
        raise ValueError(
            f"interpolation must be one of {INTERPOLATION_MODES}, got '{interpolation}'."
        )
    width, height = int(width), int(height)
    if width <= 0 or height <= 0:
        raise ValueError("Image Resize cannot resample to a zero-sized output.")
    if batch.shape[2] == width and batch.shape[1] == height:
        return batch
    batch = batch.float()
    if interpolation == "lanczos":
        return _lanczos_resize(batch, width, height)
    moved = batch.movedim(-1, 1).contiguous()
    kwargs = {}
    if interpolation in ("bilinear", "bicubic"):
        downscale = width < moved.shape[-1] or height < moved.shape[-2]
        kwargs = {"align_corners": False, "antialias": downscale}
    resized = functional.interpolate(
        moved, size=(height, width), mode=_TORCH_MODES[interpolation], **kwargs
    )
    if interpolation == "bicubic":
        resized = resized.clamp_(0.0, 1.0)
    return resized.movedim(1, -1).contiguous()


def apply_resize(
    image: torch.Tensor,
    mask: torch.Tensor | None,
    target_mode: str,
    width: int,
    height: int,
    edge_length: int,
    megapixels: float,
    scale_factor: float,
    keep_proportion: str,
    fill_color: object,
    divisible_by: int,
    interpolation: str,
) -> tuple[torch.Tensor, torch.Tensor, int, int]:
    """Run the full plan on a BHWC image and optional BHW mask.

    The mask travels through the identical geometry. In pad mode the new
    padding is 1.0 in the returned mask -- the generated-area contract the
    pack's other pad nodes keep -- and the source region carries the
    resized input mask (0.0 when none is wired). Without padding the mask
    is the resized input mask, or all zeros when none is wired.
    """
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Image Resize expected a BHWC IMAGE batch.")
    image = image.float()
    source_h, source_w = int(image.shape[1]), int(image.shape[2])
    target_w, target_h = resolve_target(
        source_w, source_h, target_mode, width, height, edge_length, megapixels, scale_factor
    )
    # In every mode but width+height the target box is derived from the
    # source's own aspect, so there is nothing to letterbox or crop against —
    # the proportion modes would only be acting on divisible_by's snap, and
    # pad would answer it by inventing pixels nobody asked for. Fit resolves
    # the snap with a sub-half-step resize instead, so those modes collapse
    # to fit: pixels are only ever invented when the user explicitly sets a
    # width+height box that disagrees with the source.
    if target_mode != "width+height":
        keep_proportion = "fit"
    plan = plan_resize(source_w, source_h, target_w, target_h, keep_proportion, divisible_by)
    resize_w, resize_h = plan["resize_width"], plan["resize_height"]
    canvas_w, canvas_h = plan["canvas_width"], plan["canvas_height"]

    output = resample_batch(image, resize_w, resize_h, interpolation)
    if mask is not None:
        if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
            raise ValueError("Image Resize expected a BHW MASK.")
        mask = mask.float()
        if (int(mask.shape[2]), int(mask.shape[1])) != (resize_w, resize_h):
            mask = resample_batch(mask.unsqueeze(-1), resize_w, resize_h, interpolation)
            mask = mask.squeeze(-1).clamp(0.0, 1.0)

    def zeros_mask() -> torch.Tensor:
        return torch.zeros(
            (output.shape[0], canvas_h, canvas_w), dtype=torch.float32, device=output.device
        )

    if (resize_w, resize_h) == (canvas_w, canvas_h):
        return output, mask if mask is not None else zeros_mask(), canvas_w, canvas_h

    if resize_w >= canvas_w and resize_h >= canvas_h:  # cover_crop
        x0, y0 = plan["crop_x"], plan["crop_y"]
        output = output[:, y0 : y0 + canvas_h, x0 : x0 + canvas_w, :].contiguous()
        if mask is not None:
            mask = mask[:, y0 : y0 + canvas_h, x0 : x0 + canvas_w].contiguous()
        return output, mask if mask is not None else zeros_mask(), canvas_w, canvas_h

    # pad
    left, top = plan["offset_x"], plan["offset_y"]
    right = canvas_w - resize_w - left
    bottom = canvas_h - resize_h - top
    # Parsed here so an unreadable color is reported against this node's
    # widget, then handed to pad_image as unambiguous hex.
    red, green, blue = parse_fill_color(fill_color, "Image Resize fill_color")
    output, pad_mask = pad_image(
        output, left, top, right, bottom, "color", f"#{red:02x}{green:02x}{blue:02x}"
    )
    if mask is None:
        mask = pad_mask
    else:
        canvas_mask = torch.ones(
            (mask.shape[0], canvas_h, canvas_w), dtype=torch.float32, device=mask.device
        )
        canvas_mask[:, top : top + resize_h, left : left + resize_w] = mask
        mask = canvas_mask
    return output, mask, canvas_w, canvas_h


__all__ = [
    "INTERPOLATION_MODES",
    "PROPORTION_MODES",
    "TARGET_MODES",
    "apply_resize",
    "plan_resize",
    "resample_batch",
    "resolve_target",
    "snap_to_multiple",
]
