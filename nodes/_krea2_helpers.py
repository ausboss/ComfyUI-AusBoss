"""Krea 2 reference-conditioning helpers.

Only the parts that are specific to Krea 2 live here. Padding, canvas
planning, colour parsing and the stitcher itself already exist in
``_pad_helpers`` and ``_inpaint_crop_helpers``, and are used from there
rather than reimplemented - the outpaint path and the inpaint path must
agree on what a stitcher is, or Stitch Inpaint 🆎 stops serving both.
"""

from __future__ import annotations

import torch
import torch.nn.functional as functional

from ._inpaint_crop_helpers import STITCHER_KIND

# The VAE downsamples by 8 and the DiT patchifies by 2, so a reference edge
# that is not a multiple of 16 lands on a partial patch and the token grid
# stops lining up with the canvas grid.
_PATCH_MULTIPLE = 16

# A reference is there to say "this is the picture", not to carry detail -
# the canvas latent carries that. Past a few hundred pixels the extra tokens
# cost attention without changing the result.
REFERENCE_MAX_EDGE = 384

_FULL_CANVAS = [0.0, 0.0, 1.0, 1.0]


def snap16(value: int) -> int:
    """Nearest positive multiple of 16, never below 16."""
    return max(_PATCH_MULTIPLE, int(round(value / 16.0)) * _PATCH_MULTIPLE)


def reference_size(width: int, height: int, max_edge: int = REFERENCE_MAX_EDGE) -> tuple[int, int]:
    """The /16 size a reference of ``width`` x ``height`` is fitted to.

    ``max_edge`` of 0 or less keeps the size and only snaps it.
    """
    width = max(1, int(width))
    height = max(1, int(height))
    if max_edge > 0 and max(width, height) > max_edge:
        scale = float(max_edge) / float(max(width, height))
        return snap16(int(round(width * scale))), snap16(int(round(height * scale)))
    return snap16(width), snap16(height)


def build_reference_image(
    image: torch.Tensor, max_edge: int = REFERENCE_MAX_EDGE
) -> torch.Tensor:
    """Fit a BHWC image to a /16 reference, downscaling to ``max_edge``.

    Returns a copy when nothing needs resizing, so a caller can never hand
    the same tensor to two consumers and have one of them mutate it.
    """
    if image.ndim != 4:
        raise ValueError("Krea 2 reference expected a BHWC IMAGE batch.")
    height, width = int(image.shape[1]), int(image.shape[2])
    target_width, target_height = reference_size(width, height, max_edge)
    if (target_height, target_width) == (height, width):
        return image.clone()

    moved = image.movedim(-1, 1).contiguous()
    resized = functional.interpolate(
        moved,
        size=(target_height, target_width),
        mode="bilinear",
        align_corners=False,
        # Downscaling without it aliases the reference into a different image.
        antialias=target_width < width or target_height < height,
    )
    return resized.movedim(1, -1).contiguous()


def extract_bbox_norm(stitcher: dict | None) -> list[float]:
    """Where the source sits in the canvas, as ``[x0, y0, x1, y1]`` in 0..1.

    Reads the bbox padding recorded on the stitcher. Falls back to the crop
    rectangle when the stitcher predates that field, and finally to the whole
    canvas - which is the correct answer for a stitcher whose crop *is* the
    canvas, and a harmless one otherwise, since a reference placed over the
    full frame is what an unpatched model already assumes.
    """
    if not isinstance(stitcher, dict) or stitcher.get("kind") != STITCHER_KIND:
        return list(_FULL_CANVAS)

    normalized = stitcher.get("bbox_normalized")
    if normalized is not None:
        return [float(value) for value in normalized]

    canvas = stitcher.get("canvas")
    if canvas is None or getattr(canvas, "ndim", 0) != 4:
        return list(_FULL_CANVAS)
    height, width = float(canvas.shape[1]), float(canvas.shape[2])

    pixels = stitcher.get("source_bbox")
    if pixels is not None:
        x0, y0, x1, y1 = (float(value) for value in pixels)
        return [x0 / width, y0 / height, x1 / width, y1 / height]

    crop_x, crop_y, crop_w, crop_h = stitcher.get(
        "crop_to_canvas", (0, 0, int(width), int(height))
    )
    return [
        float(crop_x) / width,
        float(crop_y) / height,
        float(crop_x + crop_w) / width,
        float(crop_y + crop_h) / height,
    ]


def source_pixel_bbox(stitcher: dict | None) -> tuple[int, int, int, int, int, int] | None:
    """``(x0, y0, x1, y1, canvas_width, canvas_height)`` in pixels, or None."""
    if not isinstance(stitcher, dict) or stitcher.get("kind") != STITCHER_KIND:
        return None
    canvas = stitcher.get("canvas")
    if canvas is None or getattr(canvas, "ndim", 0) != 4:
        return None
    height, width = int(canvas.shape[1]), int(canvas.shape[2])
    pixels = stitcher.get("source_bbox")
    if pixels is None:
        normalized = stitcher.get("bbox_normalized")
        if normalized is None:
            return None
        x0, y0, x1, y1 = normalized
        pixels = (x0 * width, y0 * height, x1 * width, y1 * height)
    x0, y0, x1, y1 = (int(round(float(value))) for value in pixels)
    return x0, y0, x1, y1, width, height


# The reference implementation places the source so it spans one whole canvas
# axis and splits anything else into two passes. One pass on a placement that
# spans neither axis is not a worse result of the same kind - it is outside
# what the weights were trained to do, and the extended region falls apart.
_SPAN_TOLERANCE_PX = 8


def placement_warning(stitcher: dict | None, tolerance_px: int = _SPAN_TOLERANCE_PX) -> str | None:
    """Warn when the source spans neither canvas axis. None when it is fine.

    Padding one side is not enough on its own: rounding the canvas up to a
    multiple leaves a sliver on the other axis, and a sliver still breaks the
    span. That is why the message reports the slack in pixels.
    """
    box = source_pixel_bbox(stitcher)
    if box is None:
        return None
    x0, y0, x1, y1, width, height = box
    slack_x = width - (x1 - x0)
    slack_y = height - (y1 - y0)
    if slack_x <= tolerance_px or slack_y <= tolerance_px:
        return None
    return (
        "[AusBoss] Krea 2 Outpaint Model Patch: the source is padded on BOTH "
        f"axes ({slack_x}px spare width, {slack_y}px spare height), so it spans "
        "neither side of the canvas. This model extends one axis at a time; a "
        "two-axis canvas in a single pass usually breaks up in the new area. "
        "Pad one axis, run it, then pad the other and run again. If you only "
        "padded one side, the canvas multiple is rounding the other axis up - "
        "lower it, or pick a multiple that already divides that dimension."
    )


__all__ = [
    "REFERENCE_MAX_EDGE",
    "build_reference_image",
    "extract_bbox_norm",
    "placement_warning",
    "reference_size",
    "snap16",
    "source_pixel_bbox",
]
