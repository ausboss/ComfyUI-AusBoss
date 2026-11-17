"""Edit Lock Restore's tint fix: take out the even tint an edit model adds to the whole picture.

MiniMax H3 Image gives every edit one even color shift: a little lighter,
pinker and bluer (Lab L +1 to +3, a +2 to +7, b -1 to -6 at 16 MP). Edit
Lock removes it wherever it locks, because those parts are your picture
again. When the lock steps aside (new hair color, new background, rain) the
shift stays. Here it is read from the part of the picture the edit left
alone and subtracted from every pixel.

A shift is only taken out when it looks like that tint. An edit that is
meant to recolor everything (golden hour, red light, a restyle) moves the
colors much further or the other way, or leaves too little of the picture
alone to read anything, and passes through untouched.

Pure torch, no ComfyUI imports.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as F

from ._realign_helpers import measure, warp_to_source

# The pictures are compared at this long side; the fit is sub-pixel there.
WORK = 1536
# Cells closer than this to the running estimate count as "left alone".
NEAR = 4.0
# The tint as measured on 57 edits: lighter, pinker, bluer, within these
# bounds (Lab units). Smaller than MIN_A is not worth touching.
MIN_A = 0.5
MAX_A = 10.0
MAX_B = 0.0
MIN_B = -8.0
MIN_L = -1.0
MAX_L = 6.0
# At least this share of the picture must be left alone to read the tint.
MIN_SHARE = 0.15

_D65 = (0.95047, 1.0, 1.08883)
_TO_XYZ = ((0.4124564, 0.3575761, 0.1804375),
           (0.2126729, 0.7151522, 0.0721750),
           (0.0193339, 0.1191920, 0.9503041))
_TO_RGB = ((3.2404542, -1.5371385, -0.4985314),
           (-0.9692660, 1.8760108, 0.0415560),
           (0.0556434, -0.2040259, 1.0572252))


def rgb_to_lab(rgb: torch.Tensor) -> torch.Tensor:
    """sRGB in 0..1, [..., 3] -> CIE Lab, float64."""
    x = rgb.double().clamp(0.0, 1.0)
    linear = torch.where(x > 0.04045, ((x + 0.055) / 1.055) ** 2.4, x / 12.92)
    xyz = linear @ torch.tensor(_TO_XYZ, dtype=torch.float64).T / torch.tensor(_D65, dtype=torch.float64)
    f = torch.where(xyz > 0.008856, xyz.clamp(min=1e-9) ** (1.0 / 3.0), 7.787 * xyz + 16.0 / 116.0)
    return torch.stack([116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]),
                        200.0 * (f[..., 1] - f[..., 2])], -1)


def lab_to_rgb(lab: torch.Tensor) -> torch.Tensor:
    """CIE Lab, [..., 3] -> sRGB in 0..1, float64."""
    fy = (lab[..., 0] + 16.0) / 116.0
    f = torch.stack([fy + lab[..., 1] / 500.0, fy, fy - lab[..., 2] / 200.0], -1)
    xyz = torch.where(f > 0.206893, f ** 3, (f - 16.0 / 116.0) / 7.787) * torch.tensor(_D65, dtype=torch.float64)
    linear = (xyz @ torch.tensor(_TO_RGB, dtype=torch.float64).T).clamp(0.0, 1.0)
    return torch.where(linear > 0.0031308, 1.055 * linear ** (1.0 / 2.4) - 0.055, 12.92 * linear).clamp(0.0, 1.0)


def _fit(image: torch.Tensor, long_side: int) -> torch.Tensor:
    """HWC float at most long_side px on its long side."""
    height, width = int(image.shape[0]), int(image.shape[1])
    scale = long_side / max(height, width)
    if scale >= 1.0:
        return image.float()
    size = (max(1, round(height * scale)), max(1, round(width * scale)))
    return F.interpolate(image.movedim(-1, 0)[None].float(), size=size, mode="bilinear",
                         align_corners=False, antialias=True)[0].movedim(0, -1)


def measure_tint(result: torch.Tensor, source: torch.Tensor) -> tuple[list[float] | None, float]:
    """The even shift in (L, a, b) from source to result, read where the edit left the picture alone.

    result, source: HWC float in 0..1, any sizes. Returns (shift or None, the
    share of the picture it was read on). The result is lined up with the
    source first, since edits often come back slightly zoomed or moved.
    """
    src = _fit(source[..., :3], WORK)
    edit = _fit(result[..., :3], WORK)
    fit = measure(src, edit, mode="zoom + shift")
    if not fit.reliable:
        return None, 0.0
    height, width = int(src.shape[0]), int(src.shape[1])
    scaled = F.interpolate(edit.movedim(-1, 0)[None], size=(height, width), mode="bilinear",
                           align_corners=False)[0].movedim(0, -1)
    try:
        warped = warp_to_source(scaled, fit.matrix, width, height)
        warped = warped[0] if isinstance(warped, tuple) else warped
    except Exception:
        warped = scaled
    # coarse cells of about 8 px at 1 MP, so grain and small detail drop out
    cell = max(4, round(8 / math.sqrt(1e6 / (width * height))))

    def cells(img: torch.Tensor) -> torch.Tensor:
        return F.avg_pool2d(img.movedim(-1, 0)[None], cell, stride=cell)[0].movedim(0, -1)

    diff = rgb_to_lab(cells(warped)) - rgb_to_lab(cells(src))
    margin = max(1, int(diff.shape[0]) // 12)  # the edges carry the warp's filled strip
    diff = diff[margin:-margin, margin:-margin].reshape(-1, 3)
    if diff.shape[0] < 50:
        return None, 0.0
    centre = diff.median(0).values
    share = 1.0
    # start at the median change, then keep only the cells near it: a new
    # background or new hair is a big change, but not the same one everywhere
    for _ in range(5):
        near = (diff - centre).norm(dim=1) < NEAR
        if int(near.sum()) < 50:
            break
        centre = diff[near].mean(0)
        share = float(near.double().mean())
    return [float(v) for v in centre], share


def looks_like_tint(shift: list[float] | None, share: float) -> bool:
    """True for the model's own lighter-pinker-bluer shift; False for an intended recolor."""
    if shift is None or share < MIN_SHARE:
        return False
    light, a, b = shift
    return MIN_A <= a <= MAX_A and MIN_B <= b <= MAX_B and MIN_L <= light <= MAX_L


def remove_tint(image: torch.Tensor, shift: list[float]) -> torch.Tensor:
    """Subtract one (L, a, b) shift from every pixel. image: [B, H, W, C] in 0..1."""
    lab = rgb_to_lab(image[..., :3]) - torch.tensor(shift, dtype=torch.float64)
    out = image.clone()
    out[..., :3] = lab_to_rgb(lab).to(image.dtype)
    return out


def take_out_tint(images: torch.Tensor, source: torch.Tensor) -> tuple[torch.Tensor, list[float] | None]:
    """Each picture of the batch with its tint taken out when it looks like the model's tint.

    Returns the pictures and the largest shift taken out (None when none was)."""
    out = images.clone()
    taken: list[float] | None = None
    for index in range(int(images.shape[0])):
        shift, share = measure_tint(images[index], source[0])
        if looks_like_tint(shift, share):
            out[index:index + 1] = remove_tint(images[index:index + 1], shift)
            if taken is None or abs(shift[1]) > abs(taken[1]):
                taken = shift
    return out, taken
