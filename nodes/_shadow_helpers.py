"""Drop-shadow compositing shared by AusBoss nodes.

The shadow is the subject mask shifted by a signed offset, optionally
grown and gaussian-feathered, scaled by opacity, and composited as a
solid color under the subject: the subject's own mask carves the shadow
away, so the subject is never darkened, and pixels the shadow does not
reach stay bit-identical to the input.
"""

from __future__ import annotations

import torch

from ._color_helpers import parse_fill_color
from ._mask_helpers import blur_mask, grow_shrink_mask


def shift_mask(mask: torch.Tensor, offset_x: int, offset_y: int) -> torch.Tensor:
    """Translate a BHW mask by whole pixels; vacated space is zero-filled."""
    offset_x = int(offset_x)
    offset_y = int(offset_y)
    if offset_x == 0 and offset_y == 0:
        return mask.clone()
    _, height, width = mask.shape
    shifted = torch.zeros_like(mask)
    src_y0, src_y1 = max(0, -offset_y), min(height, height - offset_y)
    src_x0, src_x1 = max(0, -offset_x), min(width, width - offset_x)
    if src_y0 >= src_y1 or src_x0 >= src_x1:
        return shifted  # shifted fully out of frame
    dst_y0, dst_x0 = src_y0 + offset_y, src_x0 + offset_x
    shifted[
        :, dst_y0 : dst_y0 + (src_y1 - src_y0), dst_x0 : dst_x0 + (src_x1 - src_x0)
    ] = mask[:, src_y0:src_y1, src_x0:src_x1]
    return shifted


def drop_shadow(
    image: torch.Tensor,
    mask: torch.Tensor,
    offset_x: int,
    offset_y: int,
    grow: int,
    blur: int,
    shadow_color: object = "#000000",
    opacity: float = 0.6,
) -> torch.Tensor:
    """Composite a colored drop shadow under the masked subject."""
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Drop Shadow expected a BHWC IMAGE batch.")
    image = image.float()
    if isinstance(mask, torch.Tensor) and mask.ndim == 2:
        mask = mask.unsqueeze(0)
    if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
        raise ValueError("Drop Shadow expected a BHW MASK.")
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
    mask = mask.float().clamp(0.0, 1.0)
    if mask.shape[0] == 1 and image.shape[0] > 1:
        mask = mask.expand(image.shape[0], -1, -1)

    opacity = max(0.0, min(1.0, float(opacity)))
    if opacity == 0.0:
        return image

    shadow = shift_mask(mask, offset_x, offset_y)
    shadow = grow_shrink_mask(shadow, max(0, int(grow)))
    shadow = blur_mask(shadow, float(max(0, int(blur)))).clamp(0.0, 1.0)
    # The subject's own alpha carves the shadow away: it never covers the
    # subject, and where it lands with zero weight the image passes through
    # bit-identical thanks to the where-guard below.
    alpha = (shadow * opacity * (1.0 - mask)).unsqueeze(-1)

    rgb = image[..., :3]
    color = torch.tensor(
        [channel / 255.0 for channel in parse_fill_color(shadow_color)],
        dtype=image.dtype,
        device=image.device,
    ).view(1, 1, 1, 3)
    mixed = rgb + alpha * (color - rgb)
    mixed = torch.where(alpha > 0, mixed, rgb)
    if image.shape[3] > 3:
        mixed = torch.cat([mixed, image[..., 3:]], dim=-1)
    return mixed


__all__ = ["drop_shadow", "shift_mask"]
