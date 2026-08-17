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
from ._pad_helpers import _replicate_pad, _resize_image

ALIGN_MODES = ("resize", "crop", "pad")

# Which region survives a crop. Vertical names anchor the height crop, the
# horizontal pair anchors the width crop; the other axis stays centered.
CROP_POSITIONS = ("center", "top", "bottom", "left", "right")


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
    image: torch.Tensor, multiple: int, mode: str, crop_position: str = "center"
) -> tuple[torch.Tensor, int, int]:
    """Snap a BHWC batch to the multiple; returns (image, width, height).

    ``resize`` rescales to the nearest multiple (bilinear, antialiased when
    shrinking). ``crop`` crops down to the next multiple, keeping the region
    ``crop_position`` names (center by default). ``pad`` replicate-pads the
    edges up to the next multiple, split evenly. When a dimension must grow
    in crop mode — it was smaller than one multiple — the deficit is
    replicate-padded instead, so the node never errors on a small input.
    """
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Align Image expected a BHWC IMAGE batch.")
    if crop_position not in CROP_POSITIONS:
        raise ValueError(
            f"Align Image crop_position must be one of {CROP_POSITIONS}, "
            f"not '{crop_position}'."
        )
    height, width = int(image.shape[1]), int(image.shape[2])
    target_w, target_h = aligned_size(width, height, multiple, mode)
    if (target_w, target_h) == (width, height):
        return image, width, height

    if mode == "resize":
        return _resize_image(image, target_w, target_h), target_w, target_h

    aligned = image
    # Crop any excess first (only the crop mode ever has excess).
    if width > target_w or height > target_h:
        left, top = _crop_offsets(width, height, target_w, target_h, crop_position)
        if width > target_w:
            aligned = aligned[:, :, left : left + target_w, :]
        if height > target_h:
            aligned = aligned[:, top : top + target_h, :, :]
    # Replicate-pad any deficit, split evenly with the smaller half first.
    pad_w = max(0, target_w - aligned.shape[2])
    pad_h = max(0, target_h - aligned.shape[1])
    if pad_w or pad_h:
        aligned = _replicate_pad(
            aligned, pad_w // 2, pad_h // 2, pad_w - pad_w // 2, pad_h - pad_h // 2
        )
    return aligned.contiguous(), target_w, target_h


__all__ = ["ALIGN_MODES", "CROP_POSITIONS", "align_image", "aligned_size"]
