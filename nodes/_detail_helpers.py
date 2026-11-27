"""The original's fine detail on an edited picture, for Keep Detail 🆎.

Both pictures are split into a base (the picture blurred by `detail_size`
pixels: shapes, light and colour) and detail (what the blur took away:
skin, fabric, grain). The result is the edit's base with the original's
detail on it.

The split is a ratio in linear light: detail is how much brighter or darker
each pixel is than the base around it, as a factor. A factor carries over
between pictures that are lit differently: pores that are 8 % darker than the
skin around them stay 8 % darker on a relit face, where a difference would
paint the bright original's texture too strong into a dark edit, or too weak
into a bright one. Linear light (the picture's values with the sRGB curve
taken off) is where light adds up physically, so the factor means the same
in the shadows as in the highlights.

Light only puts the factor of the luminance on all three channels alike, so
each pixel only gets brighter or darker and its colour never shifts. Colour
+ light takes a factor per channel, so freckles and stains bring their
colour too.

The base is a Gaussian blur, or with `edge_safe` a guided filter (He, Sun
and Tang, 2010) of the picture by itself, which smooths texture but follows
strong edges. A plain blur spreads a strong edge into its base, and the
detail then carries a light and a dark band along the edge: a halo.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as F

from ._execution_helpers import raise_if_interrupted
from ._fit_helpers import batch_size, checked_mask, frames_at, mask_at, resized_frames

# Added to light before a ratio is taken, so a black pixel has no detail to
# give or take instead of dividing by nothing.
LIGHT_FLOOR = 2e-3
# Below this, a channel counts as black when sharing out light (keeps hue).
HUE_KEEP = 1e-6
# What the edge-safe base counts as an edge, on the sRGB-curved values: a
# step that varies the values around it by more than about this much stays in
# the base. Skin, fabric and wood grain vary them less and go to the detail;
# at 0.05 even wood grain counted as edges and only half of it came back.
EDGE_STEP = 0.15
LUMA = (0.2126, 0.7152, 0.0722)
CHUNK = 4


def srgb_to_linear(values: torch.Tensor) -> torch.Tensor:
    values = values.clamp(0.0, 1.0)
    return torch.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(values: torch.Tensor) -> torch.Tensor:
    values = values.clamp_min(0.0)
    return torch.where(values <= 0.0031308, values * 12.92, 1.055 * values.clamp_min(1e-12) ** (1.0 / 2.4) - 0.055)


def _box(values: torch.Tensor, radius: int) -> torch.Tensor:
    """Mean over a (2r+1)-square window, B x C x H x W, edges repeated."""
    if radius <= 0:
        return values
    size = 2 * radius + 1
    values = F.avg_pool2d(F.pad(values, (radius, radius, 0, 0), mode="replicate"), (1, size), stride=1)
    return F.avg_pool2d(F.pad(values, (0, 0, radius, radius), mode="replicate"), (size, 1), stride=1)


def _gaussian(values: torch.Tensor, sigma: float) -> torch.Tensor:
    """Gaussian blur, B x C x H x W, edges repeated."""
    radius = max(1, int(math.ceil(3.0 * sigma)))
    radius = min(radius, max(1, min(values.shape[-2:]) - 1))
    taps = torch.arange(-radius, radius + 1, dtype=values.dtype, device=values.device)
    kernel = torch.exp(-(taps**2) / (2.0 * sigma * sigma))
    kernel = kernel / kernel.sum()
    channels = int(values.shape[1])
    across = kernel.view(1, 1, 1, -1).repeat(channels, 1, 1, 1)
    down = kernel.view(1, 1, -1, 1).repeat(channels, 1, 1, 1)
    values = F.conv2d(F.pad(values, (radius, radius, 0, 0), mode="replicate"), across, groups=channels)
    return F.conv2d(F.pad(values, (0, 0, radius, radius), mode="replicate"), down, groups=channels)


def _box_radius(sigma: float) -> int:
    """The box radius that spreads as far as a Gaussian of this sigma (the
    same standard deviation), so both bases split detail at the same size."""
    return max(1, round(math.sqrt(3.0 * float(sigma) ** 2 + 0.25) - 0.5))


def _guided(values: torch.Tensor, radius: int) -> torch.Tensor:
    """The picture smoothed with itself as the guide: texture goes, strong edges stay."""
    mean = _box(values, radius)
    spread = (_box(values * values, radius) - mean * mean).clamp_min(0.0)
    keep = spread / (spread + EDGE_STEP**2)
    offset = mean - keep * mean
    return _box(keep, radius) * values + _box(offset, radius)


def base_light(light: torch.Tensor, detail_size: float, edge_safe: bool) -> torch.Tensor:
    """The base of linear light, B x C x H x W: what is left once the detail
    smaller than `detail_size` pixels is smoothed away. The smoothing runs on
    sRGB-curved values, where an edge's size matches how strong it looks."""
    curved = linear_to_srgb(light)
    if edge_safe:
        smooth = _guided(curved, _box_radius(detail_size))
    else:
        smooth = _gaussian(curved, max(float(detail_size), 0.5))
    return srgb_to_linear(smooth)


def _light(rgb: torch.Tensor, color_detail: bool) -> torch.Tensor:
    """B x C x H x W linear light: the three channels, or the luminance alone."""
    linear = srgb_to_linear(rgb).movedim(-1, 1)
    if color_detail:
        return linear
    return (linear * linear.new_tensor(LUMA).view(1, 3, 1, 1)).sum(1, keepdim=True)


def keep_detail(
    image: torch.Tensor,
    detail_from: torch.Tensor,
    detail_size: float = 4.0,
    strength: float = 1.0,
    color_detail: bool = False,
    edge_safe: bool = True,
    mask: torch.Tensor | None = None,
) -> tuple[torch.Tensor, bool]:
    """The edit with the original's detail, and whether `detail_from` was resized.

    Strength 0 leaves the edit as it is, 1 swaps the edit's own detail for the
    original's, and above 1 lays the original's on stronger.
    """
    for picture, name in ((image, "image"), (detail_from, "detail_from")):
        if not isinstance(picture, torch.Tensor) or picture.ndim != 4:
            raise ValueError(f"Keep Detail expected an IMAGE batch on {name}.")
    height, width = int(image.shape[1]), int(image.shape[2])
    resized = tuple(detail_from.shape[1:3]) != (height, width)
    detail_from = resized_frames(detail_from, height, width)
    if mask is not None:
        mask = checked_mask(mask, height, width, "Keep Detail")
    frames = batch_size(
        "Keep Detail", int(image.shape[0]), int(detail_from.shape[0]), int(mask.shape[0]) if mask is not None else 1
    )
    strength = max(float(strength), 0.0)
    if strength == 0.0:
        return frames_at(image, 0, frames).clone(), resized
    own = max(0.0, 1.0 - strength)
    result = torch.empty((frames, height, width, int(image.shape[3])), dtype=image.dtype, device=image.device)
    for start in range(0, frames, CHUNK):
        raise_if_interrupted()
        end = min(frames, start + CHUNK)
        edit = frames_at(image, start, end).float()
        original = frames_at(detail_from, start, end).float().to(edit.device)
        rgb = edit[..., :3]
        edit_light = _light(rgb, color_detail)
        original_light = _light(original[..., :3], color_detail)
        edit_base = base_light(edit_light, detail_size, edge_safe) + LIGHT_FLOOR
        original_detail = (original_light + LIGHT_FLOOR) / (base_light(original_light, detail_size, edge_safe) + LIGHT_FLOOR)
        edit_detail = (edit_light + LIGHT_FLOOR) / edit_base
        target = edit_base * original_detail.pow(strength) * edit_detail.pow(own)
        factor = (target / (edit_light + LIGHT_FLOOR)).movedim(1, -1)
        linear = srgb_to_linear(rgb)
        # The floor's share of light goes to each channel in proportion to it
        # when only light is kept, so a saturated colour keeps its hue (black
        # gets it evenly); the brightness reached is the same.
        share = 1.0 if color_detail else (linear + HUE_KEEP) / ((linear * linear.new_tensor(LUMA)).sum(-1, keepdim=True) + HUE_KEEP)
        lit = linear * factor + LIGHT_FLOOR * (factor - 1.0) * share
        change = linear_to_srgb(lit) - linear_to_srgb(linear)
        if mask is not None:
            change = change * mask_at(mask, start, end, height, width, edit.device).unsqueeze(-1)
        out = edit.clone()
        out[..., :3] = (rgb + change).clamp(0.0, 1.0)
        result[start:end] = out.to(image.dtype)
    return result, resized


__all__ = ["base_light", "keep_detail", "linear_to_srgb", "srgb_to_linear"]
