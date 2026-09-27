"""Realign an edit to its source: measure the zoom and shift an edit model
added, then warp the edit back onto the source's frame.

Why: edit models redraw a broad edit with slightly different proportions.
Qwen Image 2.1 draws style edits (watercolor, anime, oil) about 4% taller on
average and up to 12%, seed by seed, even when it samples on the encoder's
own latent; light edits hold within 0.4%. Snapping sizes to 32, 64 or 112
does not change it. Measuring the drift and warping it back does.

Torch only. Coordinates are pixel centres (0..W-1, 0..H-1), x right, y down.
The fitted model M maps a SOURCE position p to the position q where the same
content sits in the edit once the edit is scaled to the source's size:
    zoom + shift: q = (sx * x + tx, sy * y + ty)
    affine:       q = A @ p + t
stored as a 3x3 homogeneous matrix.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import torch
import torch.nn.functional as F

FIT_MODES = ("zoom + shift", "affine")
EMPTY_FILLS = ("edge", "source", "gray")

# Working sizes (long side, px) for the coarse and fine passes, and their
# block sizes. The coarse pass finds drifts up to about 15% of the frame;
# the fine passes refine that to a fraction of a pixel.
COARSE_LONG = 256
COARSE_BLOCK = 64
FINE_LONG = 768
FINE_BLOCK = 96

# A fit is trusted only when enough blocks agree with it.
MIN_INLIERS = 10
MIN_INLIER_FRACTION = 0.25

# Below this many pixels on the short side there is too little to compare.
MIN_SIDE = 64

# A different aspect ratio past this points at an edit made on a canvas of
# another shape, which the report names.
CANVAS_HINT_RATIO = 0.03


@dataclass
class Measurement:
    matrix: torch.Tensor  # 3x3, source px -> edit px (edit scaled to source size)
    width: int
    height: int
    blocks: int  # textured blocks compared in the last pass that counted
    inliers: int  # blocks that agree with the fit
    fit_error: float  # RMS disagreement of the inliers, source px
    reliable: bool
    reason: str = ""

    def displacement(self, x: float, y: float) -> tuple[float, float]:
        q = self.matrix @ torch.tensor([x, y, 1.0], dtype=self.matrix.dtype)
        return float(q[0] - x), float(q[1] - y)

    @property
    def zoom_x(self) -> float:
        """Horizontal scale change as a fraction (+0.04 = 4% larger)."""
        return float(self.matrix[0, 0]) - 1.0

    @property
    def zoom_y(self) -> float:
        return float(self.matrix[1, 1]) - 1.0

    @property
    def centre_shift(self) -> tuple[float, float]:
        return self.displacement((self.width - 1) / 2.0, (self.height - 1) / 2.0)

    @property
    def worst_corner(self) -> float:
        """How far the worst of the four corners moved, in source px."""
        right, bottom = self.width - 1.0, self.height - 1.0
        corners = ((0.0, 0.0), (right, 0.0), (0.0, bottom), (right, bottom))
        return max(math.hypot(*self.displacement(x, y)) for x, y in corners)


def to_gray(image: torch.Tensor) -> torch.Tensor:
    """HWC float image (any channel count >= 1) to an HW luma tensor."""
    image = image.float()
    if image.shape[-1] >= 3:
        r, g, b = image[..., 0], image[..., 1], image[..., 2]
        return 0.299 * r + 0.587 * g + 0.114 * b
    return image[..., 0]


def resize_gray(gray: torch.Tensor, height: int, width: int) -> torch.Tensor:
    if gray.shape == (height, width):
        return gray
    shrinking = height < gray.shape[0] or width < gray.shape[1]
    out = F.interpolate(gray[None, None], size=(height, width), mode="bilinear",
                        align_corners=False, antialias=shrinking)
    return out[0, 0]


def _gauss_kernel(sigma: float) -> torch.Tensor:
    radius = max(1, int(math.ceil(sigma * 3)))
    x = torch.arange(-radius, radius + 1, dtype=torch.float32)
    kernel = torch.exp(-(x * x) / (2 * sigma * sigma))
    return kernel / kernel.sum()


def _blur(gray: torch.Tensor, sigma: float) -> torch.Tensor:
    kernel = _gauss_kernel(sigma)
    radius = kernel.numel() // 2
    x = F.pad(gray[None, None], (radius, radius, 0, 0), mode="replicate")
    x = F.conv2d(x, kernel.view(1, 1, 1, -1))
    x = F.pad(x, (0, 0, radius, radius), mode="replicate")
    x = F.conv2d(x, kernel.view(1, 1, -1, 1))
    return x[0, 0]


def edge_map(gray: torch.Tensor, sigma: float = 1.0) -> torch.Tensor:
    """Gradient magnitude, normalised by its neighbourhood.

    Magnitude ignores polarity and absolute brightness, and the local
    normalisation evens out contrast, so a restyled picture (watercolour,
    night grade, inverted tones) still lines up with its source. The floor
    keeps faint gradients (a smooth sky) faint instead of amplifying them."""
    smooth = _blur(gray, sigma)
    x = F.pad(smooth[None, None], (1, 1, 1, 1), mode="replicate")
    sobel = torch.tensor([[1.0, 0.0, -1.0], [2.0, 0.0, -2.0], [1.0, 0.0, -1.0]]) / 8.0
    gx = F.conv2d(x, sobel.view(1, 1, 3, 3))
    gy = F.conv2d(x, sobel.t().contiguous().view(1, 1, 3, 3))
    magnitude = torch.sqrt(gx * gx + gy * gy + 1e-12)[0, 0]
    local = _blur(magnitude, 6.0)
    return magnitude / (local + 0.5 * magnitude.mean() + 1e-6)


def _hann(size: int) -> torch.Tensor:
    w = torch.hann_window(size, periodic=False)
    return w[:, None] * w[None, :]


def _lowpass(size: int, sigma_f: float) -> torch.Tensor:
    fy = torch.fft.fftfreq(size)[:, None]
    fx = torch.fft.rfftfreq(size)[None, :]
    return torch.exp(-(fx * fx + fy * fy) / (2.0 * sigma_f * sigma_f))


def correlation_noise_floor(size: int, sigma_f: float = 0.15) -> float:
    """Peak height a random match reaches, on the normalised scale where a
    perfect match is 1: a few standard deviations of the filtered noise."""
    freqs = torch.fft.fftshift(torch.fft.fftfreq(size))
    full = torch.exp(-(freqs[:, None] ** 2 + freqs[None, :] ** 2) / (2.0 * sigma_f * sigma_f))
    sd = float(torch.sqrt((full * full).sum()) / full.sum())
    return 1.3 * sd * math.sqrt(2.0 * math.log(size * size))


def _subpixel_step(centre, minus, plus):
    """Offset of a peak from its sample, from the samples either side.

    A Gaussian through the three log values where all are positive, else a
    parabola, else nothing; always within half a pixel."""
    positive = (centre > 1e-9) & (minus > 1e-9) & (plus > 1e-9)
    lc = torch.log(centre.clamp(min=1e-9))
    lm = torch.log(minus.clamp(min=1e-9))
    lp = torch.log(plus.clamp(min=1e-9))
    g_den = lm - 2.0 * lc + lp
    p_den = minus - 2.0 * centre + plus
    g_ok = positive & (g_den.abs() > 1e-9)
    p_ok = p_den.abs() > 1e-9
    g_step = 0.5 * (lm - lp) / torch.where(g_ok, g_den, torch.ones_like(g_den))
    p_step = 0.5 * (minus - plus) / torch.where(p_ok, p_den, torch.ones_like(p_den))
    step = torch.where(g_ok, g_step, torch.where(p_ok, p_step, torch.zeros_like(p_step)))
    return step.clamp(-0.5, 0.5)


def phase_correlate(a: torch.Tensor, b: torch.Tensor,
                    sigma_f: float = 0.15) -> tuple[torch.Tensor, torch.Tensor]:
    """Shift of each patch b relative to a, for (N, P, P) stacks.

    Returns (N, 2) shifts as (dx, dy) with b(x) ~ a(x - d), sub-pixel, and the
    (N,) peak height: about 1 for a clean match, near 0 for none. The phase
    spectrum is band-limited (Gaussian, sigma_f cycles/px) so brush strokes,
    grain and posterised bands can't outvote the picture's structure, and the
    smooth peak lets a 3-point fit find the sub-pixel position."""
    n, size, _ = a.shape
    window = _hann(size)
    a = (a - a.mean(dim=(-2, -1), keepdim=True)) * window
    b = (b - b.mean(dim=(-2, -1), keepdim=True)) * window
    spec = torch.fft.rfft2(b) * torch.conj(torch.fft.rfft2(a))
    weights = _lowpass(size, sigma_f)
    spec = spec / (spec.abs() + 1e-9) * weights
    surface = torch.fft.irfft2(spec, s=(size, size))
    # A perfect match puts the whole filtered spectrum in one peak.
    surface = surface / torch.fft.irfft2(weights.to(spec.dtype), s=(size, size))[0, 0]
    peak, index = surface.reshape(n, -1).max(dim=1)
    py = torch.div(index, size, rounding_mode="floor")
    px = index % size
    rows = torch.arange(n)
    centre = surface[rows, py, px]
    dy = py.float() + _subpixel_step(centre, surface[rows, (py - 1) % size, px],
                                     surface[rows, (py + 1) % size, px])
    dx = px.float() + _subpixel_step(centre, surface[rows, py, (px - 1) % size],
                                     surface[rows, py, (px + 1) % size])
    dy = torch.where(dy > size / 2, dy - size, dy)
    dx = torch.where(dx > size / 2, dx - size, dx)
    return torch.stack([dx, dy], dim=1), peak


def _block_centres(height: int, width: int, block: int) -> torch.Tensor:
    half = block // 2
    stride = max(8, block // 2)

    def axis(length):
        if length < block:
            return [length / 2.0]
        count = max(1, int(round((length - block) / stride)) + 1)
        return torch.linspace(half, length - half, count).tolist()

    ys, xs = axis(height), axis(width)
    return torch.tensor([[x, y] for y in ys for x in xs], dtype=torch.float32)


def _crop(image: torch.Tensor, centres: torch.Tensor, size: int) -> torch.Tensor:
    """(N, size, size) crops around integer-rounded centres, zero outside."""
    pad = size
    padded = F.pad(image[None, None], (pad, pad, pad, pad))[0, 0]
    top = torch.round(centres[:, 1]).long() - size // 2 + pad
    left = torch.round(centres[:, 0]).long() - size // 2 + pad
    top = top.clamp(0, padded.shape[0] - size)
    left = left.clamp(0, padded.shape[1] - size)
    offsets = torch.arange(size)
    rows = (top[:, None] + offsets[None, :])[:, :, None]
    cols = (left[:, None] + offsets[None, :])[:, None, :]
    return padded[rows, cols]


def match_blocks(source: torch.Tensor, edit: torch.Tensor, block: int,
                 max_residual: float | None = None):
    """Compare two edge maps block by block.

    Returns block positions (N, 2), their displacement source -> edit (N, 2)
    and a confidence weight (N,). With `max_residual`, a block whose shift is
    larger than that is dropped (used once the edit was pre-warped, when every
    true shift is small)."""
    height, width = source.shape
    centres = torch.round(_block_centres(height, width, block))
    texture_src = _crop(source, centres, block)
    energy = texture_src.mean(dim=(-2, -1))
    keep = energy > 0.35 * energy.median()
    centres, texture_src = centres[keep], texture_src[keep]
    texture_edit = _crop(edit, centres, block)
    shift, peak = phase_correlate(texture_src, texture_edit)
    # A peak no taller than a random match's is noise, not a match; and once
    # a prediction placed the block, a big residual means a wrong peak.
    weight = torch.where(peak > correlation_noise_floor(block), peak, torch.zeros_like(peak))
    if max_residual is not None:
        weight = torch.where(torch.linalg.norm(shift, dim=1) <= max_residual, weight,
                             torch.zeros_like(weight))
    # A crop spans [c - block//2, c - block//2 + block); the window, and so
    # the measured shift, is centred half a pixel earlier for even blocks.
    points = centres - block // 2 + (block - 1) / 2.0
    return points, shift, weight


def warp_gray(gray: torch.Tensor, matrix: torch.Tensor) -> torch.Tensor:
    """out(p) = gray(M p) on the same pixel grid (M in that grid's px)."""
    height, width = gray.shape
    ys, xs = torch.meshgrid(torch.arange(height, dtype=torch.float64),
                            torch.arange(width, dtype=torch.float64), indexing="ij")
    q = torch.stack([xs, ys, torch.ones_like(xs)], dim=-1) @ matrix.double().t()
    grid = torch.stack([2.0 * (q[..., 0] + 0.5) / width - 1.0,
                        2.0 * (q[..., 1] + 0.5) / height - 1.0], dim=-1).float()[None]
    out = F.grid_sample(gray[None, None].float(), grid, mode="bilinear",
                        padding_mode="border", align_corners=False)
    return out[0, 0]


def _level_to_source(width: int, height: int, level_w: int, level_h: int) -> torch.Tensor:
    sx, sy = width / level_w, height / level_h
    return torch.tensor([[sx, 0.0, 0.5 * sx - 0.5], [0.0, sy, 0.5 * sy - 0.5], [0.0, 0.0, 1.0]],
                        dtype=torch.float64)


def fit_model(points: torch.Tensor, disps: torch.Tensor, weights: torch.Tensor,
              mode: str, scale: float, width: int, height: int):
    """Robust fit of the displacement field (IRLS with Tukey weights).

    `scale` is the level's px per source px, so the inlier band is set in
    source pixels: never tighter than about 2 px, never looser than 8.
    Returns (3x3 matrix in level px, inlier mask, RMS in source px)."""
    p = points.double()
    d = disps.double()
    base = weights.double()
    cx, cy = (width - 1) / 2.0, (height - 1) / 2.0
    half = max(width, height) / 2.0
    x = (p[:, 0] - cx) / half
    y = (p[:, 1] - cy) / half
    ones = torch.ones_like(x)
    if mode == "affine":
        design_x = design_y = torch.stack([x, y, ones], dim=1)
    else:
        design_x = torch.stack([x, ones], dim=1)
        design_y = torch.stack([y, ones], dim=1)
    w = base.clone()
    floor = 0.75 * scale
    coef_x = coef_y = None
    for _ in range(10):
        if float(w.sum()) <= 0:
            break
        sw = torch.sqrt(w)[:, None]
        coef_x = torch.linalg.lstsq(design_x * sw, d[:, :1] * sw).solution[:, 0]
        coef_y = torch.linalg.lstsq(design_y * sw, d[:, 1:] * sw).solution[:, 0]
        pred = torch.stack([design_x @ coef_x, design_y @ coef_y], dim=1)
        resid = torch.linalg.norm(d - pred, dim=1)
        active = w > 0
        spread = 1.4826 * float(resid[active].median()) if bool(active.any()) else 1.0
        cutoff = min(max(4.685 * spread, 3.0 * floor), max(8.0 * scale, 3.0 * floor))
        w = base * torch.clamp(1.0 - (resid / cutoff) ** 2, min=0.0) ** 2
    if coef_x is None:
        return torch.eye(3, dtype=torch.float64), torch.zeros(len(p), dtype=torch.bool), float("inf")
    pred = torch.stack([design_x @ coef_x, design_y @ coef_y], dim=1)
    resid = torch.linalg.norm(d - pred, dim=1)
    # Tukey weights are exactly zero past the cutoff, so they are the inliers.
    inliers = w > 0
    rms = float(torch.sqrt((resid[inliers] ** 2).mean())) / scale if bool(inliers.any()) else float("inf")
    # Back from normalised coordinates to a level-px matrix.
    if mode == "affine":
        ax, bx, tx = coef_x.tolist()
        ay, by, ty = coef_y.tolist()
    else:
        ax, tx = coef_x.tolist()
        by, ty = coef_y.tolist()
        bx = ay = 0.0
    a = torch.tensor([[ax, bx], [ay, by]], dtype=torch.float64) / half
    t = torch.tensor([tx, ty], dtype=torch.float64) - a @ torch.tensor([cx, cy], dtype=torch.float64)
    matrix = torch.eye(3, dtype=torch.float64)
    matrix[:2, :2] += a
    matrix[:2, 2] = t
    return matrix, inliers, rms


def _level_size(width: int, height: int, long_side: int) -> tuple[int, int]:
    scale = min(1.0, long_side / max(width, height))
    return max(16, int(round(width * scale))), max(16, int(round(height * scale)))


def measure(source: torch.Tensor, edit: torch.Tensor, mode: str = "zoom + shift",
            max_zoom: float = 0.2) -> Measurement:
    """Measure where the edit's content sits relative to the source.

    source, edit: HWC float images in 0..1, any sizes (the edit is compared
    as if scaled to the source's exact size). max_zoom is a fraction: a
    measured zoom past it on either axis is not trusted."""
    if mode not in FIT_MODES:
        raise ValueError(f"Realign to Source: unknown fit '{mode}'.")
    height, width = int(source.shape[0]), int(source.shape[1])
    identity = torch.eye(3, dtype=torch.float64)
    if min(width, height) < MIN_SIDE or min(int(edit.shape[0]), int(edit.shape[1])) < MIN_SIDE:
        return Measurement(identity, width, height, 0, 0, float("inf"), False,
                           "the picture is too small to measure")
    src_gray, edit_gray = to_gray(source), to_gray(edit)
    predict_src = None
    blocks = inliers_count = 0
    fit_error = float("inf")
    # A coarse pass, then two fine ones. Each fine pass first warps the edit
    # by the estimate so far, so blocks are compared at the same scale and
    # only a small leftover is measured, then folds that leftover in.
    passes = ((COARSE_LONG, COARSE_BLOCK, 1.0), (FINE_LONG, FINE_BLOCK, 1.5), (FINE_LONG, FINE_BLOCK, 1.5))
    for long_side, block, sigma in passes:
        lw, lh = _level_size(width, height, long_side)
        block = min(block, max(16, (min(lw, lh) // 2) // 8 * 8))
        to_src = _level_to_source(width, height, lw, lh)
        from_src = torch.linalg.inv(to_src)
        src_edges = edge_map(resize_gray(src_gray, lh, lw), sigma)
        edit_level = resize_gray(edit_gray, lh, lw)
        current = None if predict_src is None else from_src @ predict_src @ to_src
        if current is not None:
            edit_level = warp_gray(edit_level, current)
        edit_edges = edge_map(edit_level, sigma)
        max_residual = None if current is None else max(3.0, 0.2 * block)
        centres, disps, weights = match_blocks(src_edges, edit_edges, block, max_residual)
        if len(centres) < 4:
            return Measurement(identity, width, height, len(centres), 0, float("inf"), False,
                               "the source has too little structure to compare")
        scale = lw / width
        matrix, inliers, error = fit_model(centres, disps, weights, mode, scale, lw, lh)
        count = int(inliers.sum())
        agreed = count >= MIN_INLIERS and count >= MIN_INLIER_FRACTION * len(centres)
        if current is not None and not agreed:
            break  # keep the estimate so far rather than a pass that didn't agree
        combined = matrix if current is None else current @ matrix
        predict_src = to_src @ combined @ from_src
        blocks, inliers_count, fit_error = len(centres), count, error
        if not agreed:
            break
    result = Measurement(predict_src, width, height, blocks, inliers_count, fit_error, True)
    if inliers_count < MIN_INLIERS or inliers_count < MIN_INLIER_FRACTION * blocks:
        result.reliable = False
        result.reason = f"only {inliers_count} of {blocks} areas agree on a zoom and shift"
        edit_h, edit_w = int(edit.shape[0]), int(edit.shape[1])
        if abs((edit_w / edit_h) / (width / height) - 1.0) > CANVAS_HINT_RATIO:
            # The usual cause: sampling on a canvas of another shape, which
            # makes the model shrink the whole picture to fit inside it.
            result.reason += (f"; the edit is {edit_w}x{edit_h} but the source is {width}x{height}, "
                              "so it was probably made on a canvas of another shape")
    elif abs(result.zoom_x) > max_zoom or abs(result.zoom_y) > max_zoom:
        result.reliable = False
        result.reason = (f"the measured zoom ({result.zoom_x:+.1%} x, {result.zoom_y:+.1%} y) "
                         f"is past the {max_zoom:.0%} limit")
    return result


def warp_to_source(edit: torch.Tensor, matrix: torch.Tensor, width: int, height: int,
                   fill: str = "edge", source: torch.Tensor | None = None):
    """Resample the edit onto the source's frame in one step.

    edit: HWC float at any size; matrix: source px -> edit px at source size.
    Returns (HWC image at width x height, HW mask of the pixels the edit has
    no content for). The edit is always sampled with its edge pixels
    extended, so the pixels beside the empty strip never blend in black;
    `fill` then decides what the strip itself shows."""
    if fill not in EMPTY_FILLS:
        raise ValueError(f"Realign to Source: unknown empty_fill '{fill}'.")
    if fill == "source" and source is None:
        raise ValueError("Realign to Source: empty_fill 'source' needs the source image.")
    ys, xs = torch.meshgrid(torch.arange(height, dtype=torch.float64),
                            torch.arange(width, dtype=torch.float64), indexing="ij")
    q = torch.stack([xs, ys, torch.ones_like(xs)], dim=-1) @ matrix.double().t()
    gx = 2.0 * (q[..., 0] + 0.5) / width - 1.0
    gy = 2.0 * (q[..., 1] + 0.5) / height - 1.0
    empty = ((gx < -1.0) | (gx > 1.0) | (gy < -1.0) | (gy > 1.0)).float()
    grid = torch.stack([gx, gy], dim=-1).float()[None]
    image = edit.float().permute(2, 0, 1)[None]
    out = F.grid_sample(image, grid, mode="bicubic", padding_mode="border", align_corners=False)
    out = out[0].permute(1, 2, 0).clamp(0.0, 1.0)
    if fill == "gray":
        out = torch.where(empty[..., None] > 0, torch.full_like(out, 0.5), out)
    elif fill == "source":
        out = torch.where(empty[..., None] > 0, source.float()[..., : out.shape[-1]], out)
    return out, empty


def describe(result: Measurement, empty_fraction: float, applied: bool) -> str:
    """One line a person can read, with the numbers that matter."""
    if not result.reliable:
        return f"left as is: {result.reason}"
    sx, sy = result.centre_shift
    numbers = (f"zoom x {result.zoom_x:+.2%}, y {result.zoom_y:+.2%}; shift x {sx:+.1f}, y {sy:+.1f} px; "
               f"worst corner {result.worst_corner:.1f} px")
    agreement = f"{result.inliers} of {result.blocks} areas agree, fit error {result.fit_error:.1f} px"
    if applied:
        return f"realigned: {numbers} ({agreement}); empty strip {empty_fraction:.1%} of the frame"
    return f"measured only: {numbers} ({agreement})"


__all__ = [
    "EMPTY_FILLS",
    "FIT_MODES",
    "Measurement",
    "describe",
    "edge_map",
    "fit_model",
    "match_blocks",
    "measure",
    "phase_correlate",
    "to_gray",
    "warp_to_source",
]
