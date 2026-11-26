"""Photographic film grain for Film Grain 🆎.

The grain is random noise shaped to look like film rather than like a
digital sensor:

- Size: the noise is drawn on a grid `size` pixels apart and smoothed up to
  the picture, so each grain is about `size` pixels across at the picture's
  own resolution. Grain smaller than a pixel averages out inside the pixel,
  so below 1 it also gets quieter, as it does on a fine film stock.
- Roughness mixes in a second, finer layer whose strength is uneven: a
  wide, slow noise decides where the fine grain bunches up.
- Color mixes one grain shared by red, green and blue (monochrome, like
  black-and-white film or a scan's luminance grain) with a separate grain
  per channel (the dye clouds of colour film).
- Grain is strongest in the midtones and gentler in deep shadows and bright
  highlights, where film has little density left to vary.

Every frame's grain comes from its own seed, worked out from the node's seed
and the frame number, so the same seed always gives the same result however
the batch is split up. Frames go through a few at a time, which keeps a long
1080p clip's working memory to a few frames' worth.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F

from ._execution_helpers import raise_if_interrupted
from ._fit_helpers import batch_size, checked_mask, frames_at, mask_at

# How far the grain moves a mid-grey pixel at amount 1, as one standard
# deviation in 0-1 picture values. 0.25, the default amount, is about 10 of
# 255: clearly visible 35 mm grain, not snow.
FULL_STRENGTH = 0.15
# How much grain the darkest and brightest pixels keep, against mid grey.
TONE_FLOOR = 0.2
# The bunching of rough grain: how much the slow noise moves the fine grain's
# strength, and how much wider it is than a grain.
CLUMP_DEPTH = 0.6
CLUMP_SCALE = 4.0
# Grain is rounded off softly past this many standard deviations, so a rare
# extreme value never shows as a lone white or black speck.
GRAIN_LIMIT = 3.0
# Frames worked on at once.
CHUNK = 8
# Spreads frame numbers over the seed range (the 64-bit golden ratio).
FRAME_STEP = 0x9E3779B97F4A7C15
SEED_RANGE = 1 << 64
LUMA = (0.2126, 0.7152, 0.0722)


def frame_seed(seed: int, frame: int, moving: bool) -> int:
    """The seed of one frame's grain: the node's seed, or with `moving` one per frame."""
    return (int(seed) + (int(frame) * FRAME_STEP if moving else 0)) % SEED_RANGE


def _field(generator: torch.Generator, height: int, width: int, size: float, channels: int) -> torch.Tensor:
    """Noise in grains about `size` pixels across, 1 x C x H x W.

    Above one pixel the grains are smoothed up from a coarser grid and keep a
    spread of 1. Below one pixel several grains share a pixel and average
    out, so the spread falls with the size.
    """
    rows = max(1, round(height / size))
    cols = max(1, round(width / size))
    noise = torch.randn((1, channels, rows, cols), generator=generator)
    if (rows, cols) == (height, width):
        return noise
    if rows > height or cols > width:
        return F.interpolate(noise, size=(height, width), mode="area")
    noise = F.interpolate(noise, size=(height, width), mode="bicubic", align_corners=False)
    return noise / noise.std().clamp_min(1e-6)


def grain_frame(seed: int, height: int, width: int, size: float, roughness: float, color: float) -> torch.Tensor:
    """One frame's grain, C x H x W with C = 1 (monochrome) or 3."""
    generator = torch.Generator().manual_seed(int(seed))
    size = max(float(size), 1e-3)
    roughness = min(max(float(roughness), 0.0), 1.0)
    color = min(max(float(color), 0.0), 1.0)
    # Drawn in a fixed order, so a setting that adds a layer never changes
    # the layers drawn before it.
    layers = [(1, _field(generator, height, width, size, 1))]
    if color > 0.0:
        layers.append((3, _field(generator, height, width, size, 3)))
    if roughness > 0.0:
        clump = _field(generator, height, width, size * CLUMP_SCALE, 1)
        weight = torch.exp(CLUMP_DEPTH * clump)
        fine = [_field(generator, height, width, size / 2.0, channels) for channels, _ in layers]
        rough = [(layer * weight) for layer in fine]
        rough = [layer / layer.std().clamp_min(1e-6) * fine_layer.std() for layer, fine_layer in zip(rough, fine)]
        mix = (1.0 - roughness) ** 2 + roughness**2
        layers = [
            (channels, ((1.0 - roughness) * smooth + roughness * uneven) / mix**0.5)
            for (channels, smooth), uneven in zip(layers, rough)
        ]
    grain = layers[0][1]
    if color > 0.0:
        grain = ((1.0 - color) * grain + color * layers[1][1]) / ((1.0 - color) ** 2 + color**2) ** 0.5
    return GRAIN_LIMIT * torch.tanh(grain[0] / GRAIN_LIMIT)


def tone_weight(rgb: torch.Tensor) -> torch.Tensor:
    """How strong the grain is at each pixel of a B x H x W x 3 batch: 1 at
    mid grey, falling to TONE_FLOOR at black and white."""
    luma = (rgb * rgb.new_tensor(LUMA)).sum(-1, keepdim=True).clamp(0.0, 1.0)
    return TONE_FLOOR + (1.0 - TONE_FLOOR) * 4.0 * luma * (1.0 - luma)


def add_film_grain(
    image: torch.Tensor,
    amount: float,
    size: float,
    roughness: float,
    color: float,
    moving: bool,
    seed: int,
    mask: torch.Tensor | None = None,
) -> torch.Tensor:
    """The picture batch with film grain, where the mask is white if there is one."""
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Film Grain expected an IMAGE batch.")
    height, width = int(image.shape[1]), int(image.shape[2])
    if mask is not None:
        mask = checked_mask(mask, height, width, "Film Grain")
    frames = batch_size("Film Grain", int(image.shape[0]), int(mask.shape[0]) if mask is not None else 1)
    if float(amount) <= 0.0:
        return frames_at(image, 0, frames).clone()
    strength = float(amount) * FULL_STRENGTH
    still = None if moving else grain_frame(frame_seed(seed, 0, False), height, width, size, roughness, color)
    result = torch.empty((frames, height, width, int(image.shape[3])), dtype=image.dtype, device=image.device)
    for start in range(0, frames, CHUNK):
        raise_if_interrupted()
        end = min(frames, start + CHUNK)
        part = frames_at(image, start, end).float()
        rgb = part[..., :3]
        if still is not None:
            grain = still.unsqueeze(0)
        else:
            grain = torch.stack(
                [grain_frame(frame_seed(seed, index, True), height, width, size, roughness, color) for index in range(start, end)]
            )
        grain = grain.movedim(1, -1).to(device=part.device)
        change = grain * tone_weight(rgb) * strength
        if mask is not None:
            change = change * mask_at(mask, start, end, height, width, part.device).unsqueeze(-1)
        out = part.clone()
        out[..., :3] = (rgb + change).clamp(0.0, 1.0)
        result[start:end] = out.to(image.dtype)
    return result


__all__ = ["add_film_grain", "frame_seed", "grain_frame", "tone_weight"]
