"""Film Grain's grain match: read the grain of another picture and copy it.

With a picture on Film Grain's `grain_from` input and Auto on, the node
reads how strong, how big and how colourful that picture's grain is, and
adds grain like it.

How it reads the grain:

- Same viewing size. The picture to copy from is scaled to the megapixels
  of the picture getting the grain (its shape kept), so grain is compared
  as it would look at the same size on screen.
- Plain patches only. Grain shows best where the picture itself is plain:
  a sky, a wall, skin. Both pictures are cut into small blocks, and only the
  plainest fifth of the mid-tone blocks is read, so the picture's own detail
  is mostly not taken for grain.
- Several sizes. Fine detail is measured (a Laplacian filter, as in
  `measure_noise`) on the picture and on copies shrunk 1.5 to 12 times. How
  the strength falls from one size to the next tells the grain's size: fine
  grain mostly vanishes in the first shrink, coarse grain survives several.
  Colour grain is read the same way on two colour-difference channels.
- Only the grain missing. What the target picture already has at each size
  is taken off first, so a picture that is already grainy gets less.
- Fitted to Film Grain's own grain. A stored table (`_grain_match_table.py`)
  holds the same measures of Film Grain's grain at every size and colour;
  the closest one gives the size, the colour comes from how strong the
  colour grain is against the brightness grain, and the amount is then
  checked by adding grain to the target twice and correcting it.

Roughness is not read; it stays the card's own. A clip is read from its
first frame, and so is a clip given as the picture to copy from.

Technical details: the fit works in log space and weighs each size by the
share of grain it adds, with a mild pull toward size 1. Grain smaller than a
pixel reads as size 1 and a lower amount, which looks the same. Reading a 1 MP pair takes
about a third of a second on the CPU.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as F

from . import _grain_helpers as G

# The shrink factors the grain is measured at.
SCALES = (1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0)
# Brightness and two colour differences, each with a spread of 1 on white noise.
OPPONENT = (
    (0.2126, 0.7152, 0.0722),
    (0.7071067811865476, -0.7071067811865476, 0.0),
    (0.4082482904638631, 0.4082482904638631, -0.8164965809277261),
)
LAPLACIAN = ((1.0, -2.0, 1.0), (-2.0, 4.0, -2.0), (1.0, -2.0, 1.0))
# Mean |Laplacian| of white noise with a spread of 1: 6 * sqrt(2 / pi).
LAPLACIAN_MEAN = 6.0 * math.sqrt(2.0 / math.pi)
# Block side at each size, the share of the plainest blocks read, the fewest
# mid-tone blocks worth reading, and what counts as a mid tone.
BLOCK = 16
PLAINEST = 0.2
MIN_BLOCKS = 8
MID_TONES = (0.15, 0.85)
# The smallest side a shrunk copy is read at; sizes below it are skipped.
MIN_SIDE = 32
# Grain weaker than this (0-1 values) counts as none.
NO_GRAIN = 1e-4
# The pull toward size 1, against the fit's error.
SIZE_PULL = 0.01
# Rounds of the colour fit and of the amount check.
COLOR_ROUNDS = 2
AMOUNT_ROUNDS = 2
# What the stored table was measured on: grain of this roughness on flat grey
# of this side, from this seed.
TABLE_ROUGHNESS = 0.5
TABLE_SIDE = 640
TABLE_SEED = 1234
# Sizes from 1 up: grain smaller than a pixel is pixel noise at any size, and
# the in-between sizes below 1 measure like coarser grain, so they are left out.
TABLE_SIZES = tuple(round(2 ** (i / 6), 4) for i in range(25))  # 1 .. 16
TABLE_COLORS = tuple(i / 10 for i in range(11))


def _first_rgb(image: torch.Tensor) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4 or int(image.shape[0]) < 1:
        raise ValueError("Film Grain expected an IMAGE batch.")
    frame = image[0].detach().float()
    if int(frame.shape[-1]) == 1:
        frame = frame.expand(-1, -1, 3)
    return frame[..., :3].clamp(0.0, 1.0)


def _blocks(channel: torch.Tensor, luma: torch.Tensor, side: int) -> tuple[torch.Tensor, torch.Tensor]:
    """Each block's grain (mean |Laplacian| as a spread) and mean brightness."""
    kernel = channel.new_tensor(LAPLACIAN).view(1, 1, 3, 3)
    detail = F.conv2d(channel[None, None], kernel).abs() / LAPLACIAN_MEAN
    grain = F.avg_pool2d(detail, side)[0, 0].flatten()
    tone = F.avg_pool2d(luma[None, None, 1:-1, 1:-1], side)[0, 0].flatten()
    return grain, tone


def grain_profile(image: torch.Tensor) -> dict[float, tuple[float, float]]:
    """The grain of the first frame at each size it is big enough for:
    {scale: (brightness grain, colour grain)}, as spreads in 0-1 values."""
    rgb = _first_rgb(image)
    opponent = torch.einsum("hwc,kc->khw", rgb, rgb.new_tensor(OPPONENT))
    height, width = int(opponent.shape[1]), int(opponent.shape[2])
    out: dict[float, tuple[float, float]] = {}
    for scale in SCALES:
        rows, cols = round(height / scale), round(width / scale)
        if min(rows, cols) < MIN_SIDE:
            continue
        shrunk = opponent if scale == 1.0 else F.interpolate(opponent[None], size=(rows, cols), mode="area")[0]
        side = min(BLOCK, max(4, (min(rows, cols) - 2) // 4))
        bright, tone = _blocks(shrunk[0], shrunk[0], side)
        mid = (tone > MID_TONES[0]) & (tone < MID_TONES[1])
        keep = mid if int(mid.sum()) >= MIN_BLOCKS else torch.ones_like(mid)
        cut = torch.quantile(bright[keep], PLAINEST)
        chosen = keep & (bright <= cut)
        red_green, _ = _blocks(shrunk[1], shrunk[0], side)
        yellow_blue, _ = _blocks(shrunk[2], shrunk[0], side)
        colour = ((red_green[chosen] ** 2 + yellow_blue[chosen] ** 2) / 2.0).sqrt().mean()
        out[scale] = (float(bright[chosen].mean()), float(colour))
    return out


def same_viewing_size(reference: torch.Tensor, height: int, width: int) -> torch.Tensor:
    """The reference's first frame scaled to the megapixels of a height x width
    picture, its shape kept."""
    rgb = _first_rgb(reference)
    ref_h, ref_w = int(rgb.shape[0]), int(rgb.shape[1])
    factor = math.sqrt((float(height) * float(width)) / max(float(ref_h) * float(ref_w), 1.0))
    rows, cols = max(1, round(ref_h * factor)), max(1, round(ref_w * factor))
    if (rows, cols) == (ref_h, ref_w):
        return rgb[None]
    scaled = F.interpolate(rgb.movedim(-1, 0)[None], size=(rows, cols), mode="bicubic", antialias=True, align_corners=False)
    return scaled[0].movedim(0, -1).clamp(0.0, 1.0)[None]


def build_match_table() -> dict:
    """Film Grain's own grain, measured: for each table size and colour, the
    brightness and colour grain at every scale per unit of amount. Writes
    nothing; tests/test_grain_match.py --update stores it."""
    luma, chroma = [], []
    for size in TABLE_SIZES:
        luma_row, chroma_row = [], []
        for color in TABLE_COLORS:
            grain = G.grain_frame(TABLE_SEED, TABLE_SIDE, TABLE_SIDE, size, TABLE_ROUGHNESS, color)
            if int(grain.shape[0]) == 1:
                grain = grain.expand(3, -1, -1)
            profile = grain_profile((0.5 + G.FULL_STRENGTH * grain.movedim(0, -1))[None])
            luma_row.append([round(profile[s][0] / G.FULL_STRENGTH, 6) for s in SCALES])
            chroma_row.append([round(profile[s][1] / G.FULL_STRENGTH, 6) for s in SCALES])
        luma.append(luma_row)
        chroma.append(chroma_row)
    return {"sizes": list(TABLE_SIZES), "colors": list(TABLE_COLORS), "scales": list(SCALES), "luma": luma, "chroma": chroma}


def _table() -> dict:
    from ._grain_match_table import TABLE

    return TABLE


def _ratio(weights, top, bottom) -> float:
    return sum(w * t for w, t in zip(weights, top)) / max(sum(w * b for w, b in zip(weights, bottom)), 1e-12)


def match_grain(reference: torch.Tensor, image: torch.Tensor, roughness: float, seed: int) -> dict:
    """The amount, size and colour that give `image` grain like `reference`'s,
    with Film Grain's roughness and seed. Adds "found": False when the
    reference has no grain `image` does not already have."""
    height, width = int(image.shape[1]), int(image.shape[2])
    if min(height, width) < MIN_SIDE * 2:
        raise ValueError(f"Film Grain: the picture is too small to match grain to ({width}x{height}); it needs {MIN_SIDE * 2} px a side.")
    target = _first_rgb(image)[None]
    wanted = grain_profile(same_viewing_size(reference, height, width))
    own = grain_profile(target)
    table = _table()
    columns = [table["scales"].index(scale) for scale in SCALES if scale in wanted and scale in own]
    scales = [table["scales"][i] for i in columns]
    if len(scales) < 2:
        raise ValueError("Film Grain: the picture to copy grain from is too small to read; it needs 64 px a side.")
    bright = [math.sqrt(max(wanted[s][0] ** 2 - own[s][0] ** 2, 0.0)) for s in scales]
    colour = [math.sqrt(max(wanted[s][1] ** 2 - own[s][1] ** 2, 0.0)) for s in scales]
    if max(bright) < NO_GRAIN:
        return {"amount": 0.0, "size": 1.0, "color": 0.0, "found": False}
    # Each size counts by the share of its grain that is to be added.
    weights = [b * b / max(wanted[s][0] ** 2, 1e-12) for b, s in zip(bright, scales)]
    total = max(sum(weights), 1e-12)
    sizes, colors = table["sizes"], table["colors"]

    def fit(color_at: int) -> tuple[float, int]:
        best = None
        for size_at, size in enumerate(sizes):
            row = [table["luma"][size_at][color_at][i] for i in columns]
            logs = [math.log(max(b, 1e-6) / max(x, 1e-9)) for b, x in zip(bright, row)]
            level = sum(w * v for w, v in zip(weights, logs)) / total
            error = sum(w * (v - level) ** 2 for w, v in zip(weights, logs)) + SIZE_PULL * total * math.log(size) ** 2
            if best is None or error < best[0]:
                best = (error, math.exp(level), size_at)
        return best[1], best[2]

    color_at = colors.index(0.5)
    for _ in range(COLOR_ROUNDS):
        level, size_at = fit(color_at)
        share = _ratio(weights, colour, bright)
        color_at = min(
            range(len(colors)),
            key=lambda c: abs(share - _ratio(weights, [table["chroma"][size_at][c][i] for i in columns], [table["luma"][size_at][c][i] for i in columns])),
        )
    level, size_at = fit(color_at)
    size, color = float(sizes[size_at]), float(colors[color_at])
    amount = min(level, 1.0)
    # The check: grain on the picture itself, its tones included.
    want = sum(w * b for w, b in zip(weights, bright)) / total
    for _ in range(AMOUNT_ROUNDS):
        if amount <= 0.0:
            break
        trial = grain_profile(G.add_film_grain(target, amount, size, roughness, color, False, seed))
        got = sum(w * math.sqrt(max(trial[s][0] ** 2 - own[s][0] ** 2, 1e-12)) for w, s in zip(weights, scales)) / total
        amount = min(max(amount * want / max(got, 1e-9), 0.0), 1.0)
    return {"amount": amount, "size": size, "color": color, "found": True}


def matched_film_grain_values(
    reference: torch.Tensor, image: torch.Tensor, roughness: float, seed: int,
    amount_times: float, size_times: float, color_times: float,
) -> dict:
    """What Auto does with a picture to copy from: the match ("base_amount",
    "base_size", "base_color") and the values to use, which are the match
    times the card's three multipliers, kept inside Film Grain's limits."""
    found = match_grain(reference, image, roughness, seed)
    return {
        "amount": min(max(found["amount"] * float(amount_times), 0.0), 1.0),
        "size": min(max(found["size"] * float(size_times), G.AUTO_SIZE_RANGE[0]), G.AUTO_SIZE_RANGE[1]),
        "color": min(max(found["color"] * float(color_times), 0.0), 1.0),
        "base_amount": found["amount"],
        "base_size": found["size"],
        "base_color": found["color"],
        "found": found["found"],
    }


__all__ = ["build_match_table", "grain_profile", "match_grain", "matched_film_grain_values", "same_viewing_size"]
