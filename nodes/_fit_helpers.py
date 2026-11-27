"""Fitting a mask or a second picture to a picture batch.

Film Grain, Cut Out and Keep Detail all take a picture batch plus a mask or a
second picture that may come at another size or with another frame count.
These helpers say in plain words when the two cannot go together, and stretch
the second one to the picture when they can.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F

from ._mask_helpers import NO_MASK_PAINTED, UNPAINTED_MASK_SIZE, is_unpainted_mask


def batch_size(source: str, *counts: int) -> int:
    """The frame count of a result made from batches of these sizes.

    A batch of one goes with every frame; any other sizes must agree.
    """
    sizes = {int(count) for count in counts if int(count) != 1}
    if len(sizes) > 1:
        listed = " and ".join(str(size) for size in sorted(sizes))
        raise ValueError(
            f"{source}: the inputs have {listed} frames. Give them the same number of frames, or one frame."
        )
    return sizes.pop() if sizes else 1


def frames_at(frames: torch.Tensor, start: int, end: int) -> torch.Tensor:
    """Frames start..end of a batch, or its one frame repeated."""
    if int(frames.shape[0]) == 1:
        return frames[:1].expand(end - start, *frames.shape[1:])
    return frames[start:end]


def checked_mask(mask: torch.Tensor, height: int, width: int, source: str) -> torch.Tensor:
    """The mask as BHW floats, or a plain-words error for one that cannot be used."""
    if isinstance(mask, torch.Tensor) and mask.ndim == 2:
        mask = mask.unsqueeze(0)
    if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
        raise ValueError(f"{source} expected a MASK.")
    if is_unpainted_mask(mask) and (height, width) != UNPAINTED_MASK_SIZE:
        raise ValueError(f"{source}: {NO_MASK_PAINTED}")
    return mask


def mask_at(mask: torch.Tensor, start: int, end: int, height: int, width: int, device) -> torch.Tensor:
    """Mask frames start..end at the picture's size, as floats from 0 to 1."""
    part = mask[:1] if int(mask.shape[0]) == 1 else mask[start:end]
    part = part.to(device=device, dtype=torch.float32)
    if tuple(part.shape[-2:]) != (height, width):
        part = F.interpolate(part.unsqueeze(1), size=(height, width), mode="bilinear", align_corners=False)[:, 0]
    part = part.clamp(0.0, 1.0)
    if int(part.shape[0]) == 1 and end - start > 1:
        part = part.expand(end - start, -1, -1)
    return part


def resized_frames(frames: torch.Tensor, height: int, width: int) -> torch.Tensor:
    """A BHWC batch at another size (smooth, antialiased when it shrinks)."""
    if tuple(frames.shape[1:3]) == (height, width):
        return frames
    moved = frames.movedim(-1, 1).float()
    moved = F.interpolate(moved, size=(height, width), mode="bicubic", align_corners=False, antialias=True)
    return moved.movedim(1, -1).clamp(0.0, 1.0)


__all__ = ["batch_size", "checked_mask", "frames_at", "mask_at", "resized_frames"]
