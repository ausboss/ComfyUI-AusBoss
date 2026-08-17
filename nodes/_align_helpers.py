"""Alignment math for snapping image sizes to a multiple.

Diffusion backbones and VAEs work on fixed-size latent cells, so many
samplers and conditioning nodes want widths and heights that divide cleanly
by 8, 16, 32, or a model-specific number. The pure size math lives here so
tests can sweep it without tensors.
"""

from __future__ import annotations

import torch

# Two copies of the BHWC resize/pad plumbing already exist (a known cleanup);
# importing one of them beats adding a third.
from ._pad_helpers import _fill_tensor, _replicate_pad, _resize_image

ALIGN_MODES = ("resize", "crop", "pad")

# Which region survives a crop. Vertical names anchor the height crop, the
# horizontal pair anchors the width crop; the other axis stays centered.
CROP_POSITIONS = ("center", "top", "bottom", "left", "right")

# Where the image sits while padding: the growth lands on the opposite side.
# Same vocabulary as CROP_POSITIONS so the two anchors read as one idea.
PAD_POSITIONS = CROP_POSITIONS

# What fills the padded area: stretch the edge pixels out, or a solid color.
PAD_FILLS = ("replicate", "color")


def _pad_amounts(
    pad_w: int, pad_h: int, position: str
) -> tuple[int, int, int, int]:
    """(left, top, right, bottom) padding for an image anchored at ``position``."""
    left = pad_w // 2
    top = pad_h // 2
    if position == "left":
        left = 0
    elif position == "right":
        left = pad_w
    elif position == "top":
        top = 0
    elif position == "bottom":
        top = pad_h
    return left, top, pad_w - left, pad_h - top


def _color_pad(
    image: torch.Tensor,
    left: int,
    top: int,
    right: int,
    bottom: int,
    pad_color: object,
) -> torch.Tensor:
    """Pad with a solid parsed color instead of replicated edges."""
    batch, height, width, channels = image.shape
    fill = _fill_tensor(pad_color, image).view(1, 1, 1, -1)
    if channels > fill.shape[-1]:
        # Alpha (or extra) channels pad fully opaque.
        extra = torch.ones(
            (1, 1, 1, channels - fill.shape[-1]),
            dtype=image.dtype,
            device=image.device,
        )
        fill = torch.cat([fill, extra], dim=-1)
    canvas = fill.expand(
        batch, height + top + bottom, width + left + right, channels
    ).clone()
    canvas[:, top : top + height, left : left + width, :] = image
    return canvas


def _crop_offsets(
    width: int, height: int, target_w: int, target_h: int, position: str
) -> tuple[int, int]:
    """(left, top) of the kept window for a crop anchored at ``position``."""
    excess_w = max(0, width - target_w)
    excess_h = max(0, height - target_h)
    left = excess_w // 2
    top = excess_h // 2
    if position == "left":
        left = 0
    elif position == "right":
        left = excess_w
    elif position == "top":
        top = 0
    elif position == "bottom":
        top = excess_h
    return left, top


def _round_to_multiple(value: int, multiple: int, mode: str) -> int:
    """One dimension snapped to the multiple; never below one multiple."""
    if mode == "crop":
        snapped = (value // multiple) * multiple
    elif mode == "pad":
        snapped = ((value + multiple - 1) // multiple) * multiple
    else:  # resize: nearest, ties go up
        snapped = ((value + multiple // 2) // multiple) * multiple
    return max(multiple, snapped)


def aligned_size(width: int, height: int, multiple: int, mode: str) -> tuple[int, int]:
    """The (width, height) an image will have after aligning.

    ``crop`` rounds down, ``pad`` rounds up, ``resize`` rounds to nearest —
    each mode implies its own direction, so there is no separate rounding
    widget to keep in sync. A dimension already smaller than one multiple
    snaps up to exactly one, whatever the mode: nothing can crop below the
    smallest legal size.
    """
    if mode not in ALIGN_MODES:
        raise ValueError(f"Align Image mode must be one of {ALIGN_MODES}, not '{mode}'.")
    step = max(1, int(multiple))
    return (
        _round_to_multiple(int(width), step, mode),
        _round_to_multiple(int(height), step, mode),
    )


def align_image(
    image: torch.Tensor,
    multiple: int,
    mode: str,
    crop_position: str = "center",
    pad_position: str = "center",
    pad_fill: str = "replicate",
    pad_color: object = "#000000",
) -> tuple[torch.Tensor, int, int, int, int]:
    """Snap a BHWC batch to the multiple.

    Returns ``(image, width, height, offset_x, offset_y)`` where the offsets
    locate the original image's top-left corner inside the output: positive
    after padding, negative after cropping, zero after a resize. They are
    what an un-align crop after sampling needs.

    ``resize`` rescales to the nearest multiple (bilinear, antialiased when
    shrinking). ``crop`` crops down to the next multiple, keeping the region
    ``crop_position`` names (center by default). ``pad`` grows to the next
    multiple with the image anchored at ``pad_position`` and the new area
    filled by ``pad_fill`` — replicated edge pixels, or ``pad_color`` as a
    solid. When a dimension must grow in crop mode — it was smaller than
    one multiple — the deficit is replicate-padded evenly, so the node
    never errors on a small input.
    """
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Align Image expected a BHWC IMAGE batch.")
    if crop_position not in CROP_POSITIONS:
        raise ValueError(
            f"Align Image crop_position must be one of {CROP_POSITIONS}, "
            f"not '{crop_position}'."
        )
    if pad_position not in PAD_POSITIONS:
        raise ValueError(
            f"Align Image pad_position must be one of {PAD_POSITIONS}, "
            f"not '{pad_position}'."
        )
    if pad_fill not in PAD_FILLS:
        raise ValueError(
            f"Align Image pad_fill must be one of {PAD_FILLS}, not '{pad_fill}'."
        )
    height, width = int(image.shape[1]), int(image.shape[2])
    target_w, target_h = aligned_size(width, height, multiple, mode)
    if (target_w, target_h) == (width, height):
        return image, width, height, 0, 0

    if mode == "resize":
        return _resize_image(image, target_w, target_h), target_w, target_h, 0, 0

    aligned = image
    offset_x = offset_y = 0
    # Crop any excess first (only the crop mode ever has excess).
    if width > target_w or height > target_h:
        left, top = _crop_offsets(width, height, target_w, target_h, crop_position)
        if width > target_w:
            aligned = aligned[:, :, left : left + target_w, :]
            offset_x = -left
        if height > target_h:
            aligned = aligned[:, top : top + target_h, :, :]
            offset_y = -top
    pad_w = max(0, target_w - aligned.shape[2])
    pad_h = max(0, target_h - aligned.shape[1])
    if pad_w or pad_h:
        if mode == "pad":
            left, top, right, bottom = _pad_amounts(pad_w, pad_h, pad_position)
            if pad_fill == "color":
                aligned = _color_pad(aligned, left, top, right, bottom, pad_color)
            else:
                aligned = _replicate_pad(aligned, left, top, right, bottom)
        else:
            # A crop-mode deficit (input smaller than one multiple): keep the
            # old even replicate split.
            left, top = pad_w // 2, pad_h // 2
            aligned = _replicate_pad(aligned, left, top, pad_w - left, pad_h - top)
        if pad_w:
            offset_x += left
        if pad_h:
            offset_y += top
    return aligned.contiguous(), target_w, target_h, offset_x, offset_y


__all__ = [
    "ALIGN_MODES",
    "CROP_POSITIONS",
    "PAD_FILLS",
    "PAD_POSITIONS",
    "align_image",
    "aligned_size",
]
