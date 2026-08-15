"""Image padding shared by AusBoss nodes.

Four fill mechanisms behind one geometry: the original always lands
bit-identical at (pad_left, pad_top), and the returned mask is 1.0 over
every padded pixel and 0.0 over the original — a ready-made outpaint
mask.

* ``color``          solid fill from a parsed color string
* ``edge``           each side takes the average color of the nearest
                     source edge; corners blend their two sides
* ``edge pixel``     the outermost rows/cols replicate outward; corner
                     quadrants take the corner pixel
* ``pillarbox blur`` the source is cover-scaled onto the canvas,
                     center-cropped, blurred and dimmed, then the sharp
                     original is pasted at its true position
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional

from ._color_helpers import parse_fill_color
from ._mask_helpers import blur_mask

PAD_MODES = ("color", "edge", "edge pixel", "pillarbox blur")

# sigma = backdrop_blur * min(canvas_h, canvas_w) / _SIGMA_DIVISOR keeps the
# pillarbox look identical across resolutions; the same knob dims the
# backdrop toward _MAX_DIM at full strength.
_SIGMA_DIVISOR = 16.0
_MAX_DIM = 0.5


def _as_image(image: torch.Tensor) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Pad Image expected a BHWC IMAGE batch.")
    return image.float()


def _fill_tensor(fill_color: object, like: torch.Tensor) -> torch.Tensor:
    rgb = [channel / 255.0 for channel in parse_fill_color(fill_color, "Pad Image fill_color")]
    channels = like.shape[3]
    if channels > len(rgb):
        rgb = rgb + [1.0] * (channels - len(rgb))
    return torch.tensor(rgb[:channels], dtype=like.dtype, device=like.device)


def _blur_image(image: torch.Tensor, sigma: float) -> torch.Tensor:
    """Gaussian-blur a BHWC image by folding channels into the mask path."""
    if sigma <= 0.0:
        return image
    batch, height, width, channels = image.shape
    flat = image.movedim(-1, 1).reshape(batch * channels, height, width)
    blurred = blur_mask(flat, sigma)
    return blurred.reshape(batch, channels, height, width).movedim(1, -1).contiguous()


def _replicate_pad(image: torch.Tensor, left: int, top: int, right: int, bottom: int) -> torch.Tensor:
    moved = image.movedim(-1, 1).contiguous()
    padded = functional.pad(moved, (left, right, top, bottom), mode="replicate")
    return padded.movedim(1, -1).contiguous()


def _resize_image(image: torch.Tensor, width: int, height: int) -> torch.Tensor:
    moved = image.movedim(-1, 1).contiguous()
    antialias = width < moved.shape[-1] or height < moved.shape[-2]
    resized = functional.interpolate(
        moved, size=(height, width), mode="bilinear", align_corners=False, antialias=antialias
    )
    return resized.movedim(1, -1).contiguous()


def _edge_color_canvas(
    image: torch.Tensor, left: int, top: int, right: int, bottom: int
) -> torch.Tensor:
    """Sides take the mean color of the nearest source edge; corners blend."""
    batch, height, width, channels = image.shape
    canvas = torch.zeros(
        (batch, height + top + bottom, width + left + right, channels),
        dtype=image.dtype,
        device=image.device,
    )
    top_color = image[:, 0, :, :].mean(dim=1).view(batch, 1, 1, channels)
    bottom_color = image[:, -1, :, :].mean(dim=1).view(batch, 1, 1, channels)
    left_color = image[:, :, 0, :].mean(dim=1).view(batch, 1, 1, channels)
    right_color = image[:, :, -1, :].mean(dim=1).view(batch, 1, 1, channels)

    x0, x1 = left, left + width
    y0, y1 = top, top + height
    canvas[:, :y0, x0:x1] = top_color
    canvas[:, y1:, x0:x1] = bottom_color
    canvas[:, y0:y1, :x0] = left_color
    canvas[:, y0:y1, x1:] = right_color
    canvas[:, :y0, :x0] = (top_color + left_color) / 2.0
    canvas[:, :y0, x1:] = (top_color + right_color) / 2.0
    canvas[:, y1:, :x0] = (bottom_color + left_color) / 2.0
    canvas[:, y1:, x1:] = (bottom_color + right_color) / 2.0
    return canvas


def _pillarbox_canvas(
    image: torch.Tensor,
    left: int,
    top: int,
    right: int,
    bottom: int,
    backdrop_blur: float,
) -> torch.Tensor:
    """Cover-scale, center-crop, then blur and dim by one strength knob."""
    height, width = image.shape[1], image.shape[2]
    canvas_h = height + top + bottom
    canvas_w = width + left + right
    scale = max(canvas_w / width, canvas_h / height)
    scaled_w = max(canvas_w, math.ceil(width * scale))
    scaled_h = max(canvas_h, math.ceil(height * scale))
    backdrop = _resize_image(image, scaled_w, scaled_h)
    crop_x = (scaled_w - canvas_w) // 2
    crop_y = (scaled_h - canvas_h) // 2
    backdrop = backdrop[:, crop_y : crop_y + canvas_h, crop_x : crop_x + canvas_w, :]

    strength = max(0.0, min(1.0, float(backdrop_blur)))
    sigma = strength * min(canvas_h, canvas_w) / _SIGMA_DIVISOR
    backdrop = _blur_image(backdrop, sigma)
    return backdrop * (1.0 - _MAX_DIM * strength)


def pad_image(
    image: torch.Tensor,
    pad_left: int,
    pad_top: int,
    pad_right: int,
    pad_bottom: int,
    mode: str,
    fill_color: object = "#808080",
    backdrop_blur: float = 0.5,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Pad a BHWC image; returns (padded image, outpaint mask).

    The mask is 1.0 over every padded pixel and 0.0 over the original,
    and the original region is bit-identical to the input in every mode.
    """
    image = _as_image(image)
    left = max(0, int(pad_left))
    top = max(0, int(pad_top))
    right = max(0, int(pad_right))
    bottom = max(0, int(pad_bottom))
    if mode not in PAD_MODES:
        raise ValueError(f"Pad Image mode must be one of {PAD_MODES}, got '{mode}'.")

    batch, height, width, _ = image.shape
    canvas_h = height + top + bottom
    canvas_w = width + left + right
    mask = torch.ones((batch, canvas_h, canvas_w), dtype=torch.float32, device=image.device)
    mask[:, top : top + height, left : left + width] = 0.0
    if left == 0 and top == 0 and right == 0 and bottom == 0:
        return image, mask

    if mode == "edge pixel":
        canvas = _replicate_pad(image, left, top, right, bottom)
        return canvas, mask
    if mode == "edge":
        canvas = _edge_color_canvas(image, left, top, right, bottom)
    elif mode == "pillarbox blur":
        canvas = _pillarbox_canvas(image, left, top, right, bottom, backdrop_blur)
    else:  # color
        fill = _fill_tensor(fill_color, image).view(1, 1, 1, -1)
        canvas = fill.expand(batch, canvas_h, canvas_w, image.shape[3]).clone()
    canvas[:, top : top + height, left : left + width, :] = image
    return canvas.contiguous(), mask


__all__ = ["PAD_MODES", "pad_image"]
