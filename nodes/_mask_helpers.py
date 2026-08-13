"""Mask refinement helpers shared by AusBoss nodes."""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional

try:
    from scipy.ndimage import binary_fill_holes as _scipy_fill_holes
except Exception:  # scipy is optional; the torch fallback below covers it.
    _scipy_fill_holes = None


def _as_bhw(mask: torch.Tensor) -> torch.Tensor:
    if isinstance(mask, torch.Tensor) and mask.ndim == 2:
        mask = mask.unsqueeze(0)
    if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
        raise ValueError("Refine Mask expected a BHW MASK.")
    return mask.float().clamp(0.0, 1.0)


def grow_shrink_mask(mask: torch.Tensor, pixels: int) -> torch.Tensor:
    """Dilate (positive) or erode (negative) by whole pixels; soft values survive."""
    steps = abs(int(pixels))
    if steps == 0:
        return mask
    grown = mask.unsqueeze(1)
    for _ in range(steps):
        if pixels > 0:
            grown = functional.max_pool2d(grown, kernel_size=3, stride=1, padding=1)
        else:
            grown = -functional.max_pool2d(-grown, kernel_size=3, stride=1, padding=1)
    return grown.squeeze(1)


def _torch_fill_holes(solid: torch.Tensor) -> torch.Tensor:
    """Flood the border-connected background; whatever is left inside is a hole."""
    background = ~solid
    reachable = torch.zeros_like(background)
    reachable[:, 0, :] = background[:, 0, :]
    reachable[:, -1, :] = background[:, -1, :]
    reachable[:, :, 0] = background[:, :, 0]
    reachable[:, :, -1] = background[:, :, -1]
    while True:
        grown = (
            functional.max_pool2d(
                reachable.float().unsqueeze(1), kernel_size=3, stride=1, padding=1
            )
            .squeeze(1)
            .bool()
            & background
        )
        if torch.equal(grown, reachable):
            break
        reachable = grown
    return solid | (background & ~reachable)


def fill_mask_holes(mask: torch.Tensor) -> torch.Tensor:
    solid = mask >= 0.5
    if _scipy_fill_holes is not None:
        filled = torch.stack(
            [torch.from_numpy(_scipy_fill_holes(layer.cpu().numpy())) for layer in solid]
        ).to(mask.device)
    else:
        filled = _torch_fill_holes(solid)
    return torch.maximum(mask, filled.to(mask.dtype))


def blur_mask(mask: torch.Tensor, sigma: float) -> torch.Tensor:
    if sigma <= 0.0:
        return mask
    radius = max(1, int(math.ceil(float(sigma) * 3.0)))
    coords = torch.arange(-radius, radius + 1, dtype=torch.float32, device=mask.device)
    kernel = torch.exp(-(coords**2) / (2.0 * float(sigma) ** 2))
    kernel = kernel / kernel.sum()
    blurred = mask.unsqueeze(1)
    blurred = functional.pad(blurred, (radius, radius, 0, 0), mode="replicate")
    blurred = functional.conv2d(blurred, kernel.view(1, 1, 1, -1))
    blurred = functional.pad(blurred, (0, 0, radius, radius), mode="replicate")
    blurred = functional.conv2d(blurred, kernel.view(1, 1, -1, 1))
    return blurred.squeeze(1)


def smooth_mask(mask: torch.Tensor, pixels: int) -> torch.Tensor:
    """Melt staircase jaggies while keeping a hard edge.

    Binarize at 0.5, gaussian-blur with sigma ~ pixels, re-binarize at 0.5.
    Unlike blur_mask this never leaves soft values behind, so it de-jaggies
    segmentation edges without feathering them.
    """
    if int(pixels) <= 0:
        return mask
    solid = (mask >= 0.5).to(mask.dtype)
    return (blur_mask(solid, float(int(pixels))) >= 0.5).to(mask.dtype)


def refine_mask(
    mask: torch.Tensor,
    expand: int,
    blur: float,
    fill_holes: bool,
    smooth: int = 0,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Expand, fill holes, smooth, then feather; returns (mask, inverted)."""
    refined = _as_bhw(mask)
    refined = grow_shrink_mask(refined, expand)
    if fill_holes:
        refined = fill_mask_holes(refined)
    refined = smooth_mask(refined, int(smooth))
    refined = blur_mask(refined, blur).clamp(0.0, 1.0)
    return refined, 1.0 - refined


__all__ = [
    "blur_mask",
    "fill_mask_holes",
    "grow_shrink_mask",
    "refine_mask",
    "smooth_mask",
]
