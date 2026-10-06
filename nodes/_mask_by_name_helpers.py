"""Mask by Name helpers: what to do with what was found.

The search itself is ComfyUI's own SAM 3 Detect, called from the node. Here
is everything around it that needs no model: cleaning the typed name, cutting
the detector's stack of masks back into one stack per picture, choosing among
several matches, the cut-out, the tinted preview and the messages. Torch only,
so tests run without ComfyUI.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F

SEVERAL = ("all of them", "the biggest")
IF_NOTHING = ("stop the run", "empty mask")
NAME_MAX = 200

# The preview tint: the pack teal, a little lighter so it reads on dark pictures.
TINT = (0.0, 0.78, 0.74)
OUTLINE = (0.47, 1.0, 0.94)
TINT_STRENGTH = 0.5

NO_NAME = 'Mask by Name: type what to find, like "the dog" or "the jacket".'
NEEDS_SAM3 = (
    "Mask by Name needs ComfyUI 0.38 or newer. It uses ComfyUI's own SAM 3 "
    "Detect node, and this ComfyUI does not have it."
)
NOT_SAM3 = (
    "Mask by Name could not search the picture. Wire model and clip from a "
    "Load Checkpoint that loads the SAM 3 file (sam3.1_multiplex_fp16.safetensors)."
)


def clean_name(name) -> str:
    """The typed name with stray spaces and line breaks gone."""
    return " ".join(str(name or "").split())[:NAME_MAX]


def nothing_message(name: str) -> str:
    """What the run stops with when the name matches nothing."""
    return (
        f'Mask by Name: nothing called "{name}" was found in the picture. '
        "Try another name, or lower Sureness under More."
    )


def split_by_frame(masks: torch.Tensor, counts: list[int]) -> list[torch.Tensor]:
    """One stack of masks per picture.

    The detector returns every match of every picture in one N x H x W stack,
    with how many each picture had. A count that does not add up (a detector
    that changed what it returns) is an error here, not a silent wrong mask.
    """
    if not isinstance(masks, torch.Tensor) or masks.ndim != 3:
        raise ValueError("Mask by Name expected the detector's masks as one N x H x W stack.")
    total = sum(int(count) for count in counts)
    if total != int(masks.shape[0]):
        raise ValueError(
            f"Mask by Name got {int(masks.shape[0])} masks for {total} matches; "
            "the detector's answer does not add up."
        )
    frames = []
    start = 0
    for count in counts:
        frames.append(masks[start:start + int(count)])
        start += int(count)
    return frames


def pick(found: torch.Tensor, several: str) -> torch.Tensor:
    """One H x W mask from a picture's matches: all of them joined, or the
    biggest one. No match gives an empty mask."""
    if found.shape[0] == 0:
        return torch.zeros(found.shape[1:], dtype=torch.float32, device=found.device)
    found = found.float().clamp(0.0, 1.0)
    if several == "the biggest" and found.shape[0] > 1:
        areas = found.flatten(1).sum(dim=1)
        return found[int(areas.argmax())]
    return found.amax(dim=0)


def cut_out(image: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """The picture with the mask as its see-through channel (B x H x W x 4).

    One mask for a batch of pictures is used for each of them."""
    rgb = image[..., :3]
    alpha = mask.to(device=rgb.device, dtype=rgb.dtype).clamp(0.0, 1.0)
    if alpha.shape[0] != rgb.shape[0]:
        alpha = alpha[:1].expand(rgb.shape[0], -1, -1)
    return torch.cat([rgb, alpha.unsqueeze(-1)], dim=-1)


def tint_preview(image: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """The first picture with what was found tinted teal and outlined.

    The outline's width follows the picture's size, so it reads the same on
    a small preview of a large picture."""
    frame = image[:1, ..., :3].detach().float().cpu().clamp(0.0, 1.0)
    found = mask[:1].detach().float().cpu().clamp(0.0, 1.0).unsqueeze(-1)
    tint = torch.tensor(TINT, dtype=torch.float32).view(1, 1, 1, 3)
    out = frame * (1.0 - TINT_STRENGTH * found) + tint * (TINT_STRENGTH * found)
    height, width = int(frame.shape[1]), int(frame.shape[2])
    reach = max(1, round(min(height, width) / 300))
    plane = found.movedim(-1, 1)
    size = 2 * reach + 1
    grown = F.max_pool2d(plane, size, stride=1, padding=reach)
    shrunk = 1.0 - F.max_pool2d(1.0 - plane, size, stride=1, padding=reach)
    edge = ((grown - shrunk) > 0.5).float().movedim(1, -1)
    line = torch.tensor(OUTLINE, dtype=torch.float32).view(1, 1, 1, 3)
    return out * (1.0 - edge) + line * edge


__all__ = [
    "IF_NOTHING",
    "NEEDS_SAM3",
    "NOT_SAM3",
    "NO_NAME",
    "SEVERAL",
    "clean_name",
    "cut_out",
    "nothing_message",
    "pick",
    "split_by_frame",
    "tint_preview",
]
