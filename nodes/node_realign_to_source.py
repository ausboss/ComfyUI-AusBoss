"""Realign to Source (EXPERIMENTAL) 🆎: undo the zoom and shift an edit model added.

Qwen Image 2.1 redraws broad edits (style changes) a few percent taller,
seed by seed, even when the latent matches the source exactly. This node
measures that drift against the source and warps the edit back onto the
source's frame; the measuring and warping live in _realign_helpers.py.
"""

from __future__ import annotations

import torch

from ._execution_helpers import advance_progress, frame_progress, raise_if_interrupted
from ._realign_helpers import EMPTY_FILLS, FIT_MODES, describe, measure, warp_to_source


class AusBossRealignToSource:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "EXPERIMENTAL. Undoes the zoom and shift an edit model adds to a broad "
        "edit: Qwen Image 2.1 draws style changes a few percent taller (up to "
        "about 12%), differently for every seed. Measures where the edit's "
        "content sits against the source it was made from and warps the edit "
        "back onto the source's frame, at the source's size. It fixes the "
        "whole-frame zoom and shift only: shapes a restyle redrew in a new "
        "place stay where the model drew them, so the result lines up closely "
        "but not pixel for pixel. empty_mask marks the strip the model pushed "
        "out of view, to crop or inpaint. A frame it cannot measure is passed "
        "through at the source's size with an empty mask, and the report says "
        "why."
    )
    SEARCH_ALIASES = [
        "realign",
        "align to source",
        "pixel shift",
        "zoom drift",
        "unzoom",
        "qwen edit shift",
        "register images",
        "experimental",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "edited": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "The edit to realign, at any size: it is compared as "
                            "if scaled to the source's exact size. An alpha "
                            "channel is ignored."
                        ),
                    },
                ),
                "source": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "The picture the edit was made from, at the size the "
                            "edit model saw it: one frame, or one per edited "
                            "frame. The result comes out at this size."
                        ),
                    },
                ),
                "fit": (
                    list(FIT_MODES),
                    {
                        "default": FIT_MODES[0],
                        "tooltip": (
                            "zoom + shift: a separate horizontal and vertical "
                            "zoom plus a shift, which is how Qwen edits drift. "
                            "affine also allows a slight rotation or shear."
                        ),
                    },
                ),
                "empty_fill": (
                    list(EMPTY_FILLS),
                    {
                        "default": EMPTY_FILLS[0],
                        "tooltip": (
                            "What the strip with no content shows: edge "
                            "stretches the nearest edge pixels, source uses the "
                            "original's pixels, gray is flat #808080 for an "
                            "inpaint pass. empty_mask marks the strip either way."
                        ),
                    },
                ),
                "max_zoom": (
                    "FLOAT",
                    {
                        "default": 20.0,
                        "min": 1.0,
                        "max": 50.0,
                        "step": 0.5,
                        "tooltip": (
                            "Largest zoom, in percent, it will undo. Past it the "
                            "edit most likely changed the framing on purpose, so "
                            "the frame is left as it is."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "empty_mask", "report")
    OUTPUT_TOOLTIPS = (
        "The edit on the source's frame, at the source's size. A frame that "
        "could not be measured is only scaled to that size.",
        "White where the realigned edit has no content (the strip the model "
        "pushed out of view): crop it off or inpaint it. All black for a frame "
        "that was left as it is.",
        "What was measured and done, one line per frame: the zoom per axis, "
        "the shift at the centre, the worst corner and how many areas agreed, "
        "or why a frame was left as it is.",
    )
    FUNCTION = "realign"

    def realign(self, edited, source, fit, empty_fill, max_zoom):
        if edited.ndim != 4 or source.ndim != 4:
            raise ValueError("Realign to Source: edited and source must be IMAGE batches.")
        frames = int(edited.shape[0])
        sources = int(source.shape[0])
        if sources not in (1, frames):
            raise ValueError(
                f"Realign to Source: {sources} source frames for {frames} edited "
                "frames; give one source, or one per edited frame."
            )
        height, width = int(source.shape[1]), int(source.shape[2])
        identity = torch.eye(3, dtype=torch.float64)
        progress = frame_progress(frames) if frames > 1 else None
        images, masks, lines = [], [], []
        for index in range(frames):
            raise_if_interrupted()
            # The measuring and warping run on the CPU: they work at 768 px at
            # most and take a fraction of a second per frame.
            src = source[min(index, sources - 1), ..., :3].detach().float().cpu()
            edit = edited[index, ..., :3].detach().float().cpu()
            result = measure(src, edit, str(fit), float(max_zoom) / 100.0)
            matrix = result.matrix if result.reliable else identity
            out, empty = warp_to_source(edit, matrix, width, height, str(empty_fill), src)
            if not result.reliable:
                empty = torch.zeros_like(empty)
            images.append(out)
            masks.append(empty)
            lines.append(describe(result, float(empty.mean()), result.reliable))
            advance_progress(progress, index + 1, frames)
        report = lines[0] if frames == 1 else "\n".join(
            f"frame {i + 1}: {line}" for i, line in enumerate(lines)
        )
        image = torch.stack(images).to(device=edited.device, dtype=edited.dtype)
        mask = torch.stack(masks).to(edited.device)
        return (image, mask, report)


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_RealignToSource": AusBossRealignToSource}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_RealignToSource": "Realign to Source (EXPERIMENTAL 🧪) 🆎"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
