"""The pack's brush on the server: a round core with a soft edge.

Image Compare A/B's saved mix and Mask by Touch's soft paint are both built
from strokes the browser kept, at the picture's full size. A stroke has a
size (the brush's width in pixels of the picture), a softness (0 to 1) and a
path. The core is drawn first, then blurred. js/shared/brush.mjs holds the
same numbers, and the nodes' faces draw their previews from them.
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageFilter

# Below this blur the edge is drawn hard.
SOFT_FROM = 0.25


def brush_core(size: float, soft: float) -> float:
    """Radius of the brush's solid middle. ``soft`` runs 0 to 1."""
    return (size / 2.0) * (1.0 - soft / 2.0)


def brush_sigma(size: float, soft: float) -> float:
    """How far the edge is blurred: 0 for a hard brush, an eighth of the size at full soft."""
    return soft * size / 8.0


def core_cover(points, core: float, left: int, top: int, right: int, bottom: int) -> np.ndarray:
    """How much of each pixel the brush's solid middle covers along a path.

    The box is in picture pixels and may reach outside the picture. A pixel
    counts by its centre: fully covered a half pixel inside the brush's rim,
    not at all a half pixel outside it.
    """
    cover = np.zeros((bottom - top, right - left), dtype=np.float32)
    reach = core + 1.0
    last = len(points) - 1
    for index in range(max(1, last)):
        x0, y0 = points[index]
        x1, y1 = points[min(index + 1, last)]
        box_left = max(left, int(math.floor(min(x0, x1) - reach)))
        box_right = min(right, int(math.ceil(max(x0, x1) + reach)))
        box_top = max(top, int(math.floor(min(y0, y1) - reach)))
        box_bottom = min(bottom, int(math.ceil(max(y0, y1) + reach)))
        if box_right <= box_left or box_bottom <= box_top:
            continue
        xs = np.arange(box_left, box_right, dtype=np.float32) + 0.5 - x0
        ys = (np.arange(box_top, box_bottom, dtype=np.float32) + 0.5 - y0)[:, None]
        dx, dy = x1 - x0, y1 - y0
        span = dx * dx + dy * dy
        if span > 0:
            along = np.clip((xs * dx + ys * dy) / span, 0.0, 1.0)
            distance = np.hypot(xs - along * dx, ys - along * dy)
        else:
            distance = np.hypot(xs, ys)
        part = cover[box_top - top:box_bottom - top, box_left - left:box_right - left]
        np.maximum(part, np.clip(core - distance + 0.5, 0.0, 1.0), out=part)
    return cover


def stroke_cover(points, size: float, soft: float, width: int, height: int):
    """One stroke of the brush on a picture: ``(left, top, cover)``.

    ``cover`` is how much of each pixel the stroke covers (float32, 0 to 1),
    cut to the part of the stroke that lies on the picture; ``left`` and
    ``top`` say where that part starts. None when the stroke misses the
    picture.
    """
    core = brush_core(size, soft)
    sigma = brush_sigma(size, soft)
    blur = sigma >= SOFT_FROM
    # Room for the blur to see the brush where it runs off the picture.
    margin = int(math.ceil(3 * sigma)) + 2 if blur else 0
    reach = core + margin + 1
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    left = max(-margin, int(math.floor(min(xs) - reach)))
    right = min(width + margin, int(math.ceil(max(xs) + reach)))
    top = max(-margin, int(math.floor(min(ys) - reach)))
    bottom = min(height + margin, int(math.ceil(max(ys) + reach)))
    if right <= left or bottom <= top:
        return None
    cover = core_cover(points, core, left, top, right, bottom)
    if blur:
        soft_cover = Image.fromarray(np.round(cover * 255.0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma))
        cover = np.asarray(soft_cover, dtype=np.float32) / 255.0
    # The part of the box that lies on the picture.
    in_left, in_right = max(left, 0), min(right, width)
    in_top, in_bottom = max(top, 0), min(bottom, height)
    if in_right <= in_left or in_bottom <= in_top:
        return None
    return in_left, in_top, cover[in_top - top:in_bottom - top, in_left - left:in_right - left]
