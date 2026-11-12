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
    "crop",
    "crop to ratio",
)
# Which part of the picture a crop keeps.
CROP_SIDES = (
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "top left",
    "top right",
    "bottom left",
    "bottom right",
)
# The last one takes its shape from the width and height boxes.
RATIOS = (
    "1:1",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
    "16:9",
    "9:16",
    "5:4",
    "4:5",
    "21:9",
    "9:21",
    "2:1",
    "1:2",
    "width : height",
)


def _round_half_up(value: float) -> int:
    return int(math.floor(value + 0.5))


def _multiple_below(value: int, multiple: int) -> int:
    """The largest multiple that is not above ``value``, never below one step."""
    step = max(1, int(multiple))
    return max(step, (int(value) // step) * step)


def _multiple_inside(value: int, multiple: int) -> int:
    """``value`` rounded down to a multiple, or left alone when it is smaller
    than one step: a cut never asks for more than the picture holds."""
    step = max(1, int(multiple))
    return (int(value) // step) * step if int(value) >= step else int(value)


def _crop_start(spare: int, side: str, low: str, high: str) -> int:
    """Where a cut starts along one edge with ``spare`` pixels to lose."""
    if low in side:
        return 0
    if high in side:
        return int(spare)
    return int(spare) // 2


def _ratio_terms(ratio: str, width: int, height: int) -> tuple[int, int]:
    if ratio == "width : height":
        return max(1, int(width)), max(1, int(height))
    across, _, down = str(ratio).partition(":")
    return max(1, int(across)), max(1, int(down))


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
    crop_from: str = "center",
    ratio: str = "1:1",
) -> dict[str, int]:
    """What one picture is resized to (``resize_width``/``resize_height``),
    where a crop starts in the resized picture (``crop_x``/``crop_y``) and
    the size that comes out (``width``/``height``).

    ``off`` gives the picture back as it is; ``multiple`` rounds only a size
    that is being changed. With ``enlarge`` off nothing comes out larger than
    the picture: a target above it leaves the picture at its own size, and
    ``crop to fill`` cuts the box's shape out of the picture without growing
    it. ``fit inside`` rounds down, so the result never leaves its box.

    ``crop`` cuts a width x height piece out of the picture and ``crop to
    ratio`` cuts the largest piece of a shape; neither resizes. ``crop_from``
    names the part every cut keeps.
    """
    source_w, source_h = int(source_width), int(source_height)
    if source_w <= 0 or source_h <= 0:
        raise ValueError("Load Image needs a picture larger than 0x0.")
    if size not in SIZE_MODES:
        raise ValueError(f"size must be one of {SIZE_MODES}, got '{size}'.")
    if crop_from not in CROP_SIDES:
        raise ValueError(f"crop_from must be one of {CROP_SIDES}, got '{crop_from}'.")
    if ratio not in RATIOS:
        raise ValueError(f"ratio must be one of {RATIOS}, got '{ratio}'.")
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

    def cut(resize_w: int, resize_h: int, out_w: int, out_h: int) -> dict[str, int]:
        return {
            "resize_width": resize_w,
            "resize_height": resize_h,
            "crop_x": _crop_start(resize_w - out_w, crop_from, "left", "right"),
            "crop_y": _crop_start(resize_h - out_h, crop_from, "top", "bottom"),
            "width": out_w,
            "height": out_h,
        }

    if size == "crop":
        out_w = _multiple_inside(min(max(1, int(width)), source_w), step)
        out_h = _multiple_inside(min(max(1, int(height)), source_h), step)
        return cut(source_w, source_h, out_w, out_h)

    if size == "crop to ratio":
        across, down = _ratio_terms(ratio, width, height)
        if source_w * down >= source_h * across:
            out_h = source_h
            out_w = min(source_w, max(1, _round_half_up(source_h * across / down)))
        else:
            out_w = source_w
            out_h = min(source_h, max(1, _round_half_up(source_w * down / across)))
        return cut(source_w, source_h, _multiple_inside(out_w, step), _multiple_inside(out_h, step))

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
        return cut(plan["resize_width"], plan["resize_height"], canvas_w, canvas_h)

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


__all__ = ["CROP_SIDES", "RATIOS", "SIZE_MODES", "apply_load_size", "frames_to_image_and_mask", "plan_load_size"]
