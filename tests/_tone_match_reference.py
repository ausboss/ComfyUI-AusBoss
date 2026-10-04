"""The Tone match implementation that shipped before the vectorized rewrite.

Kept only so the tests can check that the new one gives the same answer: it
is the old code verbatim (it runs thousands of small torch operations, which
is what made it slow in containers), reading the same constants and the same
blur as the pack.
"""

from __future__ import annotations

from pathlib import Path
import sys

import torch
import torch.nn.functional as functional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._inpaint_crop_helpers import (  # noqa: E402
    SEAM_CLEAN_DEPTH,
    SEAM_MATCH_ALONG,
    SEAM_MATCH_ANCHOR,
    SEAM_MATCH_CLIP,
    SEAM_MATCH_FALLBACK,
    SEAM_MATCH_GAIN_MAX,
    SEAM_MATCH_HUBER,
    SEAM_MATCH_INVERT_STEPS,
    SEAM_MATCH_KNOTS,
    SEAM_MATCH_LOCAL_GAIN,
    SEAM_MATCH_MAX,
    SEAM_MATCH_MIN_GAIN,
    SEAM_MATCH_MIN_MASK,
    SEAM_MATCH_MIN_PIXELS,
    SEAM_MATCH_PASSES,
    SEAM_MATCH_SAMPLES,
    SEAM_MATCH_SHRINK_FREE,
    SEAM_MATCH_SIGMA,
    SEAM_MATCH_SMOOTH,
    SEAM_MATCH_SMOOTH_FREE,
    SEAM_MATCH_TILE,
    _seam_blur,
)


def _knot_values(values: torch.Tensor, v: torch.Tensor) -> torch.Tensor:
    """The piecewise-linear curve with ``values`` at SEAM_MATCH_KNOTS, read at
    ``v`` (any shape, clamped to 0..1)."""
    knots = torch.tensor(SEAM_MATCH_KNOTS, dtype=v.dtype, device=v.device)
    values = values.to(dtype=v.dtype, device=v.device)
    v = v.clamp(0.0, 1.0)
    index = torch.bucketize(v, knots[1:-1])
    low, high = knots[index], knots[index + 1]
    t = (v - low) / (high - low)
    return values[index] * (1.0 - t) + values[index + 1] * t


def _knot_basis(v: torch.Tensor) -> torch.Tensor:
    """[N, K] hat-function weights of values ``v`` [N] on SEAM_MATCH_KNOTS."""
    knots = torch.tensor(SEAM_MATCH_KNOTS, dtype=v.dtype, device=v.device)
    v = v.clamp(0.0, 1.0)
    index = torch.bucketize(v, knots[1:-1])
    t = (v - knots[index]) / (knots[index + 1] - knots[index])
    basis = torch.zeros((v.shape[0], knots.numel()), dtype=v.dtype, device=v.device)
    basis.scatter_(1, index.unsqueeze(1), (1.0 - t).unsqueeze(1))
    basis.scatter_add_(1, (index + 1).unsqueeze(1), t.unsqueeze(1))
    return basis


def _fit_drift_curves(v, m, d, w):
    """Knot values of the pinned curve A and the free curve E, per channel.

    ``v`` [N, 3] your picture's tone, ``m`` [N] the sampler mask, ``d`` [N, 3]
    the model's tone minus yours, ``w`` [N] weights. The drift is modelled as
    d = A(v) + m * (E(v) - A(v)); least squares with SEAM_MATCH_* penalties.
    """
    count = len(SEAM_MATCH_KNOTS)
    dtype, device = v.dtype, v.device
    steps = torch.zeros((count - 1, count), dtype=dtype, device=device)
    steps[torch.arange(count - 1), torch.arange(count - 1)] = -1.0
    steps[torch.arange(count - 1), torch.arange(1, count)] = 1.0
    rough = steps.t() @ steps
    eye = torch.eye(count, dtype=dtype, device=device)
    zero = torch.zeros_like(eye)
    penalty = torch.cat(
        [
            torch.cat([SEAM_MATCH_SMOOTH * rough + SEAM_MATCH_ANCHOR * eye, zero], 1),
            torch.cat([zero, SEAM_MATCH_SMOOTH_FREE * rough + SEAM_MATCH_SHRINK_FREE * eye], 1),
        ],
        0,
    ) * float(w.sum())
    curves = []
    for channel in range(3):
        basis = _knot_basis(v[:, channel])
        design = torch.cat([basis, basis * m.unsqueeze(1)], dim=1)
        weighted = design.t() * w
        solved = torch.linalg.solve(weighted @ design + penalty, weighted @ d[:, channel])
        pinned, free = solved[:count], solved[:count] + solved[count:]
        curves.append((pinned.clamp(-SEAM_MATCH_MAX, SEAM_MATCH_MAX), free.clamp(-SEAM_MATCH_MAX, SEAM_MATCH_MAX)))
    return curves


def _drift_at(curves, v, m):
    """The fitted drift [N, 3] at picture tone ``v`` [N, 3] and mask ``m`` [N]."""
    columns = []
    for channel, (pinned, free) in enumerate(curves):
        a = _knot_values(pinned, v[:, channel])
        columns.append(a + m * (_knot_values(free, v[:, channel]) - a))
    return torch.stack(columns, dim=1)


def _robust_drift_curves(v, m, d, w):
    """:func:`_fit_drift_curves` with SEAM_MATCH_PASSES reweighting passes:
    pixels further than SEAM_MATCH_HUBER off the fit count less. Returns the
    curves and the final weights."""
    weight = w
    curves = None
    for _ in range(SEAM_MATCH_PASSES):
        curves = _fit_drift_curves(v, m, d, weight)
        miss = (d - _drift_at(curves, v, m)).abs().amax(dim=1)
        weight = w * torch.where(miss <= SEAM_MATCH_HUBER, torch.ones_like(miss), SEAM_MATCH_HUBER / miss.clamp_min(1e-9))
    return curves, weight


def _checkerboard(rows: torch.Tensor, cols: torch.Tensor) -> torch.Tensor:
    return ((rows // SEAM_MATCH_TILE + cols // SEAM_MATCH_TILE) % 2) == 0


def _held_out_gain(errors) -> float:
    """1 - (held-out error with the fit) / (held-out error with nothing)."""
    none, fitted = errors
    return 1.0 - fitted / max(none, 1e-12)


def _undo_drift(model: torch.Tensor, curves, m: torch.Tensor, strength: float) -> torch.Tensor:
    """Take each RGB value of ``model`` [B, C, H, W] back through its drift
    curve: the picture value v with v + drift(v) = model, found by
    SEAM_MATCH_INVERT_STEPS fixed-point steps, so a value the model kept
    (black stays black) is kept. ``m`` [1, 1, H, W] mixes pinned and free."""
    fixed = model.clone()
    for channel, (pinned, free) in enumerate(curves):
        value = model[:, channel]
        guess = value
        for _ in range(SEAM_MATCH_INVERT_STEPS):
            a = _knot_values(pinned, guess)
            drift = a + m[:, 0] * (_knot_values(free, guess) - a)
            guess = (value - drift).clamp(0.0, 1.0)
        fixed[:, channel] = value + strength * (guess - value)
    return fixed


def _gain_field(weight, tone, miss, sigma):
    """Local gain g [1, 3, H, W] with miss ~ g * tone, smoothed along the edge
    (normalised Gaussian at a quarter of the resolution), capped at
    SEAM_MATCH_GAIN_MAX and easing to 1 away from any measurement."""
    height, width = tone.shape[-2:]

    def smooth(x):
        small = functional.avg_pool2d(x, 4, stride=4, ceil_mode=True)
        small = _seam_blur(small, max(0.5, sigma / 4.0))
        return functional.interpolate(small, size=(height, width), mode="bilinear", align_corners=False)

    numerator = smooth(weight * tone * miss)
    denominator = smooth(weight * tone * tone)
    floor = SEAM_MATCH_FALLBACK * float(denominator.max()) + 1e-12
    return (numerator / (denominator + floor)).clamp(-SEAM_MATCH_GAIN_MAX, SEAM_MATCH_GAIN_MAX)


def blend_in_tone_match(canvas: torch.Tensor, patch: torch.Tensor, plan: dict) -> dict | None:
    """What Tone match takes off the model's picture before blend in, or None
    when there is nothing it can trust.

    ``canvas`` [1 or B, H, W, C] and ``patch`` [B, H, W, C] as in
    :func:`blend_in_seam`, ``plan`` from :func:`seam_plan`. Your picture and
    the model's are compared as tone layers (blur sigma SEAM_MATCH_SIGMA, both
    over the same clean picture pixels) over the band the model redrew: picture pixels at
    least SEAM_CLEAN_DEPTH inside the edge where the sampler mask is above
    SEAM_MATCH_MIN_MASK, clipped highlights left out. Every frame is measured
    at once through the frames' mean, so a clip gets one correction and no
    flicker. The drift curves (:func:`_fit_drift_curves`) must predict a
    held-out half of the band - alternate SEAM_MATCH_TILE px tiles - at least
    SEAM_MATCH_MIN_GAIN better than no correction, and the local gain along
    the edge another SEAM_MATCH_LOCAL_GAIN better than the curves alone.
    """
    sampler = plan.get("sampler")
    if sampler is None or canvas.shape[-1] < 3:
        return None
    dtype, device = patch.dtype, patch.device
    height, width = patch.shape[1:3]
    sd = plan["depth"].to(device=device, dtype=dtype).view(1, 1, height, width)
    mask = sampler.to(device=device, dtype=dtype).view(1, 1, height, width)
    clean = (sd >= SEAM_CLEAN_DEPTH).to(dtype)
    share = _seam_blur(clean, SEAM_MATCH_SIGMA).clamp_min(1e-4)
    base = canvas[..., :3].to(dtype).mean(dim=0, keepdim=True).movedim(-1, 1)
    base_tone = _seam_blur(base * clean, SEAM_MATCH_SIGMA) / share
    model = patch[..., :3].mean(dim=0, keepdim=True).movedim(-1, 1)
    # Both tone layers are read over the same clean picture pixels: blurred
    # across the edge, the model's would carry the new area's content into
    # the band and read it as drift.
    model_tone = _seam_blur(model * clean, SEAM_MATCH_SIGMA) / share
    unclipped = (base_tone.amax(dim=1, keepdim=True) < SEAM_MATCH_CLIP) & (
        model_tone.amax(dim=1, keepdim=True) < SEAM_MATCH_CLIP
    )
    band = (sd >= SEAM_CLEAN_DEPTH) & (mask > SEAM_MATCH_MIN_MASK) & unclipped
    rows, cols = torch.nonzero(band[0, 0], as_tuple=True)
    if rows.numel() < SEAM_MATCH_MIN_PIXELS:
        return None
    stride = max(1, rows.numel() // SEAM_MATCH_SAMPLES)
    rows, cols = rows[::stride], cols[::stride]
    v = base_tone[0, :, rows, cols].t()
    d = model_tone[0, :, rows, cols].t() - v
    # The tone layers average each pixel with deeper, more pinned ones, so
    # the mask they are fitted against is averaged the same way.
    mask_tone = _seam_blur(mask * clean, SEAM_MATCH_SIGMA) / share
    m = mask_tone[0, 0, rows, cols]
    ones = torch.ones_like(m)
    curves, weight = _robust_drift_curves(v, m, d, ones)

    # The check: fit on one half of the tiles, predict the other, both ways.
    black = _checkerboard(rows, cols)
    errors = [0.0, 0.0]
    for part in (black, ~black):
        test = ~part
        if int(part.sum()) < 50 or int(test.sum()) < 50:
            return None
        half, _ = _robust_drift_curves(v[part], m[part], d[part], ones[part])
        miss = d[test] - _drift_at(half, v[test], m[test])
        errors[0] += float((weight[test].unsqueeze(1) * d[test].abs()).sum())
        errors[1] += float((weight[test].unsqueeze(1) * miss.abs()).sum())
    if _held_out_gain(errors) < SEAM_MATCH_MIN_GAIN:
        return None
    match = {"curves": curves, "mask": mask, "gain": None}

    # Drift that changes along the edge (sky and water on one side) is left
    # in the model's curve-corrected tone; a local gain, which leaves black
    # black, takes it off when it holds out as well.
    fixed_tone = _seam_blur(_undo_drift(model, curves, mask, 1.0) * clean, SEAM_MATCH_SIGMA) / share
    miss = (fixed_tone - base_tone) * band
    band_w = band.to(dtype) * mask * mask
    tile_black = _checkerboard(
        torch.arange(height, device=device).view(height, 1), torch.arange(width, device=device).view(1, width)
    ).to(dtype).view(1, 1, height, width)
    errors = [0.0, 0.0]
    for part in (tile_black, 1.0 - tile_black):
        gain = _gain_field(band_w * part, base_tone, miss, SEAM_MATCH_ALONG)
        test = band.to(dtype) * (1.0 - part)
        errors[0] += float((test * miss.abs()).sum())
        errors[1] += float((test * (miss - mask * gain * base_tone).abs()).sum())
    if _held_out_gain(errors) >= SEAM_MATCH_LOCAL_GAIN:
        match["gain"] = _gain_field(band_w, base_tone, miss, SEAM_MATCH_ALONG)
    return match


def _apply_tone_match(model: torch.Tensor, match: dict, strength: float) -> torch.Tensor:
    """The model's frames [B, C, H, W] with Tone match's correction taken off,
    at ``strength`` (0..1). Channels past RGB pass through."""
    mask = match["mask"].to(device=model.device, dtype=model.dtype)
    rgb = _undo_drift(model[:, :3], match["curves"], mask, strength)
    gain = match["gain"]
    if gain is not None:
        rgb = rgb / (1.0 + strength * mask * gain.to(device=model.device, dtype=model.dtype))
    rgb = rgb.clamp(0.0, 1.0)
    if model.shape[1] > 3:
        return torch.cat([rgb, model[:, 3:]], dim=1)
    return rgb
