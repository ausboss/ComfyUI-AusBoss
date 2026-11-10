"""Load Image: the size a picture comes out at, as plain numbers.

``plan_load_size`` turns the node's size choice into what the picture is
resized to and what is cut from it. It holds no tensors, so it is tested as
numbers, and ``js/shared/load_size.mjs`` repeats it for the size the node
shows before a run (``tests/fixtures/load_size_cases.json`` holds both to the
same answers). ``apply_load_size`` runs a plan on a picture and its mask.
"""

from __future__ import annotations

import math

import numpy as np
import torch

from ._resize_helpers import plan_resize, resample_batch, resolve_target, snap_to_multiple

SIZE_MODES = (
    "off",
    "megapixels",
    "longest side",
    "scale",
    "fit inside",
    "crop to fill",
)


def _round_half_up(value: float) -> int:
    return int(math.floor(value + 0.5))


def _multiple_below(value: int, multiple: int) -> int:
    """The largest multiple that is not above ``value``, never below one step."""
    step = max(1, int(multiple))
    return max(step, (int(value) // step) * step)


def plan_load_size(
    source_width: int,
    source_height: int,
    size: str = "off",
    megapixels: float = 1.0,
    longest_side: int = 1024,
    scale: float = 1.0,
    width: int = 1024,
    height: int = 1024,
    multiple: int = 1,
    enlarge: bool = True,
) -> dict[str, int]:
    """What one picture is resized to (``resize_width``/``resize_height``),
    where a crop starts in the resized picture (``crop_x``/``crop_y``) and
    the size that comes out (``width``/``height``).

    ``off`` gives the picture back as it is; ``multiple`` rounds only a size
    that is being changed. With ``enlarge`` off nothing comes out larger than
    the picture: a target above it leaves the picture at its own size, and
    ``crop to fill`` cuts the box's shape out of the picture without growing
    it. ``fit inside`` rounds down, so the result never leaves its box.
    """
    source_w, source_h = int(source_width), int(source_height)
    if source_w <= 0 or source_h <= 0:
        raise ValueError("Load Image needs a picture larger than 0x0.")
    if size not in SIZE_MODES:
        raise ValueError(f"size must be one of {SIZE_MODES}, got '{size}'.")
    if size == "off":
        return {
            "resize_width": source_w,
            "resize_height": source_h,
            "crop_x": 0,
            "crop_y": 0,
            "width": source_w,
            "height": source_h,
        }
    step = max(1, int(multiple))

    if size == "crop to fill":
        box_w, box_h = max(1, int(width)), max(1, int(height))
        if not enlarge:
            grow = max(box_w / source_w, box_h / source_h)
            if grow > 1.0:
                # The box keeps its shape and shrinks to what the picture holds.
                box_w = max(1, int(math.floor(box_w / grow + 1e-6)))
                box_h = max(1, int(math.floor(box_h / grow + 1e-6)))
            canvas_w = min(_multiple_below(box_w, step), max(step, source_w))
            canvas_h = min(_multiple_below(box_h, step), max(step, source_h))
        else:
            canvas_w = snap_to_multiple(box_w, step)
            canvas_h = snap_to_multiple(box_h, step)
        plan = plan_resize(source_w, source_h, canvas_w, canvas_h, "cover_crop", 1)
        return {
            "resize_width": plan["resize_width"],
            "resize_height": plan["resize_height"],
            "crop_x": plan["crop_x"],
            "crop_y": plan["crop_y"],
            "width": canvas_w,
            "height": canvas_h,
        }

    if size == "megapixels":
        target_w, target_h = resolve_target(source_w, source_h, "megapixels", megapixels=megapixels)
    elif size == "longest side":
        target_w, target_h = resolve_target(source_w, source_h, "longest_edge", edge_length=longest_side)
    elif size == "scale":
        target_w, target_h = resolve_target(source_w, source_h, "scale_factor", scale_factor=scale)
    else:  # fit inside
        fit = min(max(1, int(width)) / source_w, max(1, int(height)) / source_h)
        target_w = max(1, _round_half_up(source_w * fit))
        target_h = max(1, _round_half_up(source_h * fit))
    if not enlarge and (target_w > source_w or target_h > source_h):
        target_w, target_h = source_w, source_h

    def rounded(target: int, source: int, box: int) -> int:
        value = snap_to_multiple(target, step)
        if size == "fit inside" and value > box:
            value = _multiple_below(box, step)
        if not enlarge and value > source:
            value = _multiple_below(source, step)
        return value

    out_w = rounded(target_w, source_w, max(1, int(width)))
    out_h = rounded(target_h, source_h, max(1, int(height)))
    return {
        "resize_width": out_w,
        "resize_height": out_h,
        "crop_x": 0,
        "crop_y": 0,
        "width": out_w,
        "height": out_h,
    }


def frames_to_image_and_mask(frames) -> tuple[torch.Tensor, torch.Tensor]:
    """RGBA PIL frames to a BHWC RGB batch and a BHW mask.

    The mask is what ComfyUI's own Load Image gives: white where the picture
    is see-through, black where it is solid, and all black for a picture
    with no transparency (here at the picture's own size).
    """
    images, masks = [], []
    for frame in frames:
        array = np.asarray(frame.convert("RGBA"), dtype=np.float32) / 255.0
        images.append(torch.from_numpy(array[..., :3].copy()))
        masks.append(torch.from_numpy(1.0 - array[..., 3]))
    return torch.stack(images, dim=0), torch.stack(masks, dim=0)


def apply_load_size(
    image: torch.Tensor, mask: torch.Tensor, plan: dict[str, int], method: str
) -> tuple[torch.Tensor, torch.Tensor]:
    """Run a plan on a BHWC picture and its BHW mask. A plan that changes
    nothing hands both back untouched."""
    resize_w, resize_h = int(plan["resize_width"]), int(plan["resize_height"])
    out_w, out_h = int(plan["width"]), int(plan["height"])
    if (int(image.shape[2]), int(image.shape[1])) != (resize_w, resize_h):
        image = resample_batch(image, resize_w, resize_h, method)
        mask = resample_batch(mask.unsqueeze(-1), resize_w, resize_h, method).squeeze(-1).clamp(0.0, 1.0)
    if (resize_w, resize_h) != (out_w, out_h):
        x0, y0 = int(plan["crop_x"]), int(plan["crop_y"])
        image = image[:, y0 : y0 + out_h, x0 : x0 + out_w, :].contiguous()
        mask = mask[:, y0 : y0 + out_h, x0 : x0 + out_w].contiguous()
    return image, mask


__all__ = ["SIZE_MODES", "apply_load_size", "frames_to_image_and_mask", "plan_load_size"]
