"""Color helpers shared by AusBoss nodes: fill-color parsing and LAB
statistics matching.

Fill-color precedence (keep in sync with js/shared/fill_color.mjs):
  1. Hex: #RGB / #RRGGBB, and bare hex when unambiguous (6 digits, or a
     3-char form containing a-f). A bare 3-digit number like "128" is
     grayscale, not short hex.
  2. Numbers: "R, G, B" (commas or spaces) or one bare grayscale value.
     When every value is <= 1 they read as 0..1 floats, otherwise 0-255.
  3. CSS color names via PIL.ImageColor.
  4. Anything else warns once (ASCII) and falls back to mid-gray.
"""

from __future__ import annotations

import math
import re

import torch
from PIL import ImageColor

FALLBACK_RGB = (128, 128, 128)

_HEX_PATTERN = re.compile(r"^#?([0-9a-f]{3}|[0-9a-f]{6})$")
_NUMBER_PATTERN = re.compile(r"^-?\d+(\.\d+)?$")

_warned_values: set[str] = set()


def _warn_once(text: str, source: str) -> None:
    # Keyed by widget as well as value: the same unparseable color typed into
    # two different nodes is two different mistakes to go and fix, and one
    # node staying silent because another already complained is worse than a
    # repeated line.
    key = f"{source}\x00{text}"
    if key in _warned_values:
        return
    if len(_warned_values) > 256:
        _warned_values.clear()
    _warned_values.add(key)
    safe = text.encode("ascii", "backslashreplace").decode("ascii")
    print(f"[AusBoss] {source}: could not parse '{safe}'; using mid-gray 128,128,128.")


def _channels_from_numbers(numbers: list[float]) -> tuple[int, int, int]:
    if all(number <= 1.0 for number in numbers):
        numbers = [number * 255.0 for number in numbers]
    if len(numbers) == 1:
        numbers = numbers * 3
    # floor(x + 0.5) matches JavaScript's Math.round, keeping the editor
    # preview and the backend byte-identical on .5 boundaries.
    return tuple(max(0, min(255, math.floor(number + 0.5))) for number in numbers)


def parse_fill_color(value: object, source: str = "Transform fill_color") -> tuple[int, int, int]:
    """Parse a fill color leniently; never raises, falls back to mid-gray.

    ``source`` names the node and widget in the console note, so a colour the
    parser could not read is reported against the control the user actually
    typed it into rather than against whichever node happened to be first to
    call this."""
    text = str("" if value is None else value).strip()
    lowered = text.lower()

    match = _HEX_PATTERN.match(lowered)
    if match:
        digits = match.group(1)
        unambiguous = lowered.startswith("#") or len(digits) == 6 or any(
            character in "abcdef" for character in digits
        )
        if unambiguous:
            if len(digits) == 3:
                digits = "".join(character * 2 for character in digits)
            return tuple(int(digits[index : index + 2], 16) for index in (0, 2, 4))

    parts = [part for part in lowered.replace(",", " ").split() if part]
    if len(parts) in (1, 3) and all(_NUMBER_PATTERN.match(part) for part in parts):
        return _channels_from_numbers([float(part) for part in parts])

    if text:
        try:
            rgb = ImageColor.getrgb(text)
            return tuple(int(channel) for channel in rgb[:3])
        except ValueError:
            pass

    _warn_once(text, source)
    return FALLBACK_RGB


# --- pure-torch sRGB <-> CIELAB ----------------------------------------------
#
# D65 white point, float32 throughout, BHWC in and out. No cv2 or numpy —
# the conversions run on whatever device the tensors already live on.

_D65 = (0.95047, 1.0, 1.08883)
_DELTA = 6.0 / 29.0

_RGB_TO_XYZ = (
    (0.4124564, 0.3575761, 0.1804375),
    (0.2126729, 0.7151522, 0.0721750),
    (0.0193339, 0.1191920, 0.9503041),
)
_XYZ_TO_RGB = (
    (3.2404542, -1.5371385, -0.4985314),
    (-0.9692660, 1.8760108, 0.0415560),
    (0.0556434, -0.2040259, 1.0572252),
)


def _matrix(rows, like: torch.Tensor) -> torch.Tensor:
    return torch.tensor(rows, dtype=like.dtype, device=like.device)


def rgb_to_lab(rgb: torch.Tensor) -> torch.Tensor:
    """BHWC sRGB in [0, 1] to BHWC CIELAB (L in [0, 100], a/b signed)."""
    rgb = rgb.clamp(0.0, 1.0)
    linear = torch.where(
        rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4
    )
    xyz = linear @ _matrix(_RGB_TO_XYZ, rgb).T
    scaled = xyz / _matrix([_D65], rgb)
    f = torch.where(
        scaled > _DELTA**3,
        scaled.clamp_min(1e-12) ** (1.0 / 3.0),
        scaled / (3.0 * _DELTA**2) + 4.0 / 29.0,
    )
    fx, fy, fz = f.unbind(-1)
    return torch.stack(
        [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)], dim=-1
    )


def lab_to_rgb(lab: torch.Tensor) -> torch.Tensor:
    """BHWC CIELAB back to BHWC sRGB, clamped to [0, 1]."""
    lightness, a, b = lab.unbind(-1)
    fy = (lightness + 16.0) / 116.0
    f = torch.stack([fy + a / 500.0, fy, fy - b / 200.0], dim=-1)
    scaled = torch.where(
        f > _DELTA, f**3, 3.0 * _DELTA**2 * (f - 4.0 / 29.0)
    )
    xyz = scaled * _matrix([_D65], lab)
    linear = (xyz @ _matrix(_XYZ_TO_RGB, lab).T).clamp_min(0.0)
    srgb = torch.where(
        linear <= 0.0031308,
        linear * 12.92,
        1.055 * linear ** (1.0 / 2.4) - 0.055,
    )
    return srgb.clamp(0.0, 1.0)


# --- LAB statistics matching -------------------------------------------------


def _weighted_lab_stats(
    lab: torch.Tensor, weights: torch.Tensor | None
) -> tuple[torch.Tensor, torch.Tensor]:
    """Per-frame, per-channel (mean, std) over H and W, optionally weighted."""
    if weights is None:
        mean = lab.mean(dim=(1, 2), keepdim=True)
        std = lab.std(dim=(1, 2), keepdim=True, unbiased=False)
        return mean, std
    w = weights.unsqueeze(-1)
    total = w.sum(dim=(1, 2), keepdim=True).clamp_min(1e-8)
    mean = (lab * w).sum(dim=(1, 2), keepdim=True) / total
    var = (((lab - mean) ** 2) * w).sum(dim=(1, 2), keepdim=True) / total
    return mean, var.clamp_min(0.0).sqrt()


def match_colors(
    image: torch.Tensor,
    reference: torch.Tensor,
    strength: float,
    mask: torch.Tensor | None = None,
) -> torch.Tensor:
    """Transfer the reference's per-channel LAB mean/std onto the image.

    With a mask, both the measured statistics and the applied correction
    are restricted to the white region; pixels where the mask is zero are
    returned bit-identical. ``strength`` lerps between the original (0)
    and the fully matched image (1). A batch-1 reference broadcasts
    across an image batch.
    """
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Color Match expected a BHWC IMAGE batch.")
    if not isinstance(reference, torch.Tensor) or reference.ndim != 4:
        raise ValueError("Color Match expected a BHWC reference IMAGE.")
    if reference.shape[0] not in (1, image.shape[0]):
        raise ValueError(
            f"Reference batch {reference.shape[0]} cannot broadcast across "
            f"image batch {image.shape[0]}."
        )
    image = image.float()
    reference = reference.float()
    strength = max(0.0, min(1.0, float(strength)))
    if strength == 0.0:
        return image

    if mask is not None:
        if mask.ndim == 2:
            mask = mask.unsqueeze(0)
        if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
            raise ValueError("Color Match expected a BHW MASK.")
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

    rgb = image[..., :3]
    lab = rgb_to_lab(rgb)
    img_mean, img_std = _weighted_lab_stats(lab, mask)
    ref_mean, ref_std = _weighted_lab_stats(rgb_to_lab(reference[..., :3]), None)

    gain = ref_std / img_std.clamp_min(1e-6)
    matched = lab_to_rgb((lab - img_mean) * gain + ref_mean)

    if mask is None:
        blend = torch.full(
            (image.shape[0], 1, 1, 1), strength, dtype=image.dtype, device=image.device
        ).expand(image.shape[0], image.shape[1], image.shape[2], 1)
    else:
        blend = (mask * strength).unsqueeze(-1)
    mixed = rgb + blend * (matched - rgb)
    # The where-guard pins zero-blend pixels bit-exactly, whatever the
    # LAB round trip produced there.
    mixed = torch.where(blend > 0, mixed, rgb)
    if image.shape[3] > 3:
        mixed = torch.cat([mixed, image[..., 3:]], dim=-1)
    return mixed


__all__ = [
    "FALLBACK_RGB",
    "lab_to_rgb",
    "match_colors",
    "parse_fill_color",
    "rgb_to_lab",
]
