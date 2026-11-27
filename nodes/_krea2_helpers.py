"""Krea 2 reference-conditioning helpers.

Only the parts that are specific to Krea 2 live here. Padding, canvas
planning, colour parsing and the stitcher itself already exist in
``_pad_helpers`` and ``_inpaint_crop_helpers``, and are used from there
rather than reimplemented - the outpaint path and the inpaint path must
agree on what a stitcher is, or Stitch Inpaint 🆎 stops serving both.
"""

from __future__ import annotations

import math

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


def fill_reference_holes(image: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Paint the area ``mask`` marks with the median colour of the rest.

    AnyPaint was trained on references whose new area is a flat patch of the
    picture's own median colour, and it paints such a patch. A fixed fill
    that looks nothing like the picture - the #808080 gray pad next to a dark
    or saturated photo - reads to it as real content instead, and it paints
    it back as a gray frame or a gray corner. Refilling the reference here
    gives it the patch it knows, whatever colour the canvas was padded with.

    ``image`` is a BHWC batch, ``mask`` a MASK (HW or BHW, 1 = new area),
    resized to the image when the sizes differ. The new area is where the
    mask is above 0.5. Returns a copy; pixels outside the new area are left
    exactly as they were, and an item with nothing marked is left alone.
    """
    if image.ndim != 4:
        raise ValueError("Krea 2 reference expected a BHWC IMAGE batch.")
    if not isinstance(mask, torch.Tensor):
        raise ValueError("Krea 2 reference mask expected a MASK tensor.")
    batch, height, width, _channels = image.shape
    holes = mask.detach().to(device=image.device, dtype=torch.float32)
    if holes.ndim == 2:
        holes = holes.unsqueeze(0)
    elif holes.ndim == 4 and holes.shape[1] == 1:
        holes = holes[:, 0]
    if holes.ndim != 3:
        raise ValueError("Krea 2 reference mask expected an HW or BHW MASK.")
    if tuple(holes.shape[1:]) != (height, width):
        holes = functional.interpolate(
            holes.unsqueeze(1), size=(height, width), mode="bilinear", align_corners=False
        ).squeeze(1)

    out = image.clone()
    for index in range(batch):
        hole = holes[index % holes.shape[0]] > 0.5
        if not bool(hole.any()):
            continue
        known = out[index][~hole]
        if known.shape[0] == 0:
            # Nothing of the picture is left to take a colour from; mid-gray
            # is AnyPaint's own answer for an empty source.
            colour = torch.full((out.shape[3],), 0.5, dtype=out.dtype, device=out.device)
        else:
            colour = known.float().median(dim=0).values.to(out.dtype)
        out[index][hole] = colour
    return out


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

    A sliver on the other axis, a few pixels of padding left over from a
    drag, still breaks the span. That is why the message reports the slack
    in pixels.
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
        "meant to pad one axis, the other still has a few pixels of padding, "
        "often left over from a drag - set them to 0."
    )


__all__ = [
    "REFERENCE_MAX_EDGE",
    "build_reference_image",
    "extract_bbox_norm",
    "fill_reference_holes",
    "placement_warning",
    "reference_size",
    "snap16",
    "source_pixel_bbox",
]


# ---------------------------------------------------------------------------
# Reference strength over the run
#
# A reference reaches Krea 2 as extra tokens that every canvas token can
# attend to. Its strength is how much attention those tokens get: adding
# log(s) to the attention scores of the reference keys multiplies their
# softmax weight by s before the weights are renormalised. s = 1 leaves the
# model untouched, s = 0 gives the reference no weight at all (the canvas
# then computes exactly as it would with no reference), and values between
# fade it. The bias is one row of numbers per step, shared by every query
# and every block, so it costs no memory worth counting.
# ---------------------------------------------------------------------------

REFERENCE_STRENGTH_KEY = "ausboss_reference_strength"


def reference_key_bias(key_count: int, reference_count: int, strength: float,
                       dtype: torch.dtype, device: torch.device) -> torch.Tensor | None:
    """Additive attention bias (1, 1, 1, keys) that scales the last ``reference_count`` keys by ``strength``.

    None when it would change nothing: strength 1, or no reference keys.
    """
    strength = max(0.0, float(strength))
    if reference_count <= 0 or abs(strength - 1.0) < 1e-6:
        return None
    reference_count = min(int(reference_count), int(key_count))
    bias = torch.zeros(1, 1, 1, int(key_count), dtype=dtype, device=device)
    bias[..., key_count - reference_count:] = math.log(strength) if strength > 0 else torch.finfo(dtype).min
    return bias


def combine_attention_mask(mask: torch.Tensor | None, bias: torch.Tensor | None) -> torch.Tensor | None:
    """``mask`` with ``bias`` added. A boolean mask (True = attend) becomes additive first."""
    if bias is None:
        return mask
    if mask is None:
        return bias
    if mask.dtype == torch.bool:
        mask = torch.zeros(mask.shape, dtype=bias.dtype, device=mask.device).masked_fill(
            ~mask, torch.finfo(bias.dtype).min)
    return mask.to(bias.dtype) + bias


class ReferenceStrength:
    """Attention patch that scales the reference tokens by the current keyframe strength.

    Core's Krea 2 appends the references after the canvas and records their
    token counts in ``reference_image_num_tokens``; the patch biases those
    keys. Krea 2 Outpaint Model Patch 🆎 feeds cached reference keys instead,
    and reads this object from transformer_options under
    REFERENCE_STRENGTH_KEY to bias them itself (_krea2_core._attn_kv).
    """

    def __init__(self, keyframes):
        self.keyframes = keyframes

    @property
    def strength(self) -> float:
        return max(0.0, float(self.keyframes.strength))

    def __call__(self, q, k, v, pe=None, attn_mask=None, extra_options=None):
        counts = (extra_options or {}).get("reference_image_num_tokens")
        if not counts:
            return {}
        bias = reference_key_bias(k.shape[-2], sum(int(n) for n in counts), self.strength, q.dtype, q.device)
        if bias is None:
            return {}
        return {"attn_mask": combine_attention_mask(attn_mask, bias)}


def reference_strength_hooks(schedule: list[float]):
    """A core hook group that carries the reference strength schedule on a conditioning."""
    import comfy.hooks

    from ._curve_helpers import hook_keyframes

    keyframes = hook_keyframes(schedule)
    patch = ReferenceStrength(keyframes)
    hook = comfy.hooks.TransformerOptionsHook(
        transformers_dict={"patches": {"attn1_patch": [patch]}, REFERENCE_STRENGTH_KEY: patch},
        hook_scope=comfy.hooks.EnumHookScope.HookedOnly,
    )
    hook.hook_keyframe = keyframes
    group = comfy.hooks.HookGroup()
    group.add(hook)
    return group
