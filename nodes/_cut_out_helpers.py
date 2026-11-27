"""A see-through cut-out from a picture and a mask, for Cut Out 🆎.

The mask becomes the cut-out's alpha (how solid each pixel is) in a fixed
order: pick the white or the black part, grow or shrink it, feather it,
average it over neighbouring video frames, then clear the faint haze and
make the near-solid core fully solid.

Where the alpha is in between (hair, a soft or blurred edge) the picture's
colour is a mix of the subject and the old background, and a cut-out laid on
a new background would carry a rim of the old one. Clean edges works out the
subject's own colour there with blur-fusion foreground estimation (Forte and
Pitie, "Approximate Fast Foreground Colour Estimation", ICIP 2021), the pack's
own version of which is `clean_colours` in _fine_edge_helpers.py: blurred
averages of the subject and of the background around each pixel, corrected
by what the pixel actually shows, once wide and once narrow. Pixels the
alpha keeps fully solid keep their colours exactly.
"""

from __future__ import annotations

import torch

from ._execution_helpers import raise_if_interrupted
from ._fine_edge_helpers import clean_colours
from ._fit_helpers import batch_size, checked_mask, frames_at, mask_at
from ._mask_helpers import blur_mask, grow_shrink_mask, remap_mask

KEEP_CHOICES = ("white", "black")
# Frames worked on at once while the colours are cleaned.
CHUNK = 8
# Alpha this close to solid or clear is made exactly solid or clear.
SNAP = 1e-4


def smooth_over_frames(alpha: torch.Tensor, reach: int) -> torch.Tensor:
    """Each frame's alpha averaged with up to `reach` frames either side.

    At the start and end of the clip the window is shorter rather than
    padded, so the first frame is not pulled toward a copy of itself.
    """
    reach = int(reach)
    count = int(alpha.shape[0])
    if reach <= 0 or count < 2:
        return alpha
    running = torch.cat([alpha.new_zeros((1, *alpha.shape[1:])), alpha.double().cumsum(0)])
    index = torch.arange(count)
    low = (index - reach).clamp(min=0)
    high = (index + reach + 1).clamp(max=count)
    totals = running[high] - running[low]
    return (totals / (high - low).view(-1, 1, 1).double()).to(alpha.dtype)


def cut_out_alpha(
    mask: torch.Tensor,
    height: int,
    width: int,
    keep: str,
    grow: int,
    feather: float,
    smooth_frames: int,
    clear_haze: float,
    solid_above: float,
    device,
) -> torch.Tensor:
    """The cut-out's alpha, 1 where the picture is kept: one frame per mask
    frame (a single mask frame serves every picture frame)."""
    if keep not in KEEP_CHOICES:
        raise ValueError(f"Cut Out: keep must be one of {', '.join(KEEP_CHOICES)}.")
    count = int(mask.shape[0])
    alpha = mask_at(mask, 0, count, height, width, device).clone()
    if keep == "black":
        alpha = 1.0 - alpha
    alpha = grow_shrink_mask(alpha, int(grow))
    alpha = blur_mask(alpha, float(feather))
    alpha = smooth_over_frames(alpha, smooth_frames)
    alpha = remap_mask(alpha, float(clear_haze), float(solid_above)).clamp(0.0, 1.0)
    # A blur sums its weights to a hair under 1, which would leave the middle
    # of the subject a hair see-through; values that close count as solid or
    # clear.
    alpha = torch.where(alpha >= 1.0 - SNAP, torch.ones_like(alpha), alpha)
    return torch.where(alpha <= SNAP, torch.zeros_like(alpha), alpha)


def cut_out(
    image: torch.Tensor,
    mask: torch.Tensor,
    keep: str = "white",
    grow: int = 0,
    feather: float = 1.0,
    clean_edges: bool = True,
    clear_haze: float = 0.0,
    solid_above: float = 1.0,
    smooth_frames: int = 0,
) -> tuple[torch.Tensor, torch.Tensor]:
    """The cut-out as RGBA with straight alpha, and its alpha as a MASK."""
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Cut Out expected an IMAGE batch.")
    height, width = int(image.shape[1]), int(image.shape[2])
    mask = checked_mask(mask, height, width, "Cut Out")
    frames = batch_size("Cut Out", int(image.shape[0]), int(mask.shape[0]))
    alpha = cut_out_alpha(
        mask, height, width, keep, grow, feather, smooth_frames, clear_haze, solid_above, image.device
    )
    result = torch.empty((frames, height, width, 4), dtype=image.dtype, device=image.device)
    alphas = torch.empty((frames, height, width), dtype=torch.float32, device=image.device)
    for start in range(0, frames, CHUNK):
        raise_if_interrupted()
        end = min(frames, start + CHUNK)
        part = frames_at(image, start, end).float()
        rgb = part[..., :3]
        cover = alpha[start:end] if int(alpha.shape[0]) > 1 else alpha[:1].expand(end - start, -1, -1)
        if int(part.shape[-1]) == 4:
            cover = cover * part[..., 3].clamp(0.0, 1.0)
        colours = rgb
        if clean_edges:
            colours = rgb.clone()
            for index in range(end - start):
                frame_alpha = cover[index]
                if not bool(((frame_alpha > 0.0) & (frame_alpha < 1.0)).any()):
                    continue
                clean = clean_colours(rgb[index], frame_alpha).to(rgb.dtype)
                colours[index] = torch.where((frame_alpha >= 1.0).unsqueeze(-1), rgb[index], clean)
        result[start:end] = torch.cat([colours, cover.unsqueeze(-1)], dim=-1).to(image.dtype)
        alphas[start:end] = cover
    return result, alphas


__all__ = ["KEEP_CHOICES", "cut_out", "cut_out_alpha", "smooth_over_frames"]
