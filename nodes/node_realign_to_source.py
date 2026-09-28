"""Realign to Source (EXPERIMENTAL) 🆎: undo the zoom and shift an edit model added.

Qwen Image 2.1 redraws broad edits (style changes) a few percent taller,
seed by seed, even when the latent matches the source exactly. This node
measures that drift against the source and puts the edit back on the
source's frame: cut out whole when the drift is a whole-pixel shift, else
warped once. Given the stitcher of a padded canvas (Load Image + Pad), it
measures inside the picture's area and returns only that area, so the
margin the model drew into fills what would otherwise be an empty strip.
The measuring and warping live in _realign_helpers.py.
"""

from __future__ import annotations

import torch

from ._execution_helpers import advance_progress, frame_progress, raise_if_interrupted
from ._realign_helpers import (
    EMPTY_FILLS,
    FIT_MODES,
    crop_if_shift,
    describe,
    frame_matrix,
    measure,
    overshoot,
    warp_to_source,
)


def _stitcher_canvas(stitcher) -> tuple[torch.Tensor, tuple[int, int, int, int]]:
    """The padded canvas the edit model saw, and where the picture sits on it."""
    if not isinstance(stitcher, dict) or not isinstance(stitcher.get("canvas"), torch.Tensor):
        raise ValueError("Realign to Source: the stitcher input needs a stitcher from Load Image + Pad.")
    bbox = stitcher.get("source_bbox")
    if bbox is None:
        raise ValueError(
            "Realign to Source: this stitcher does not say where the picture sits on its canvas; "
            "use the one from Load Image + Pad or Image Crop + Rotate + Pad."
        )
    canvas = stitcher["canvas"]
    if canvas.ndim != 4:
        raise ValueError("Realign to Source: the stitcher's canvas is not an IMAGE batch.")
    return canvas, tuple(int(v) for v in bbox)


class AusBossRealignToSource:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "EXPERIMENTAL. Lines an edited picture back up with the original. "
        "Qwen Image 2.1 often draws an edit slightly zoomed in or shifted, "
        "especially style changes like watercolor or anime, so the edit no "
        "longer sits on top of the original. This node measures how far it "
        "moved and moves it back. Best result: pad the picture with Load "
        "Image + Pad before editing and plug its stitcher in here, so the "
        "edit has room to move and you get real picture all the way to the "
        "edges."
    )
    SEARCH_ALIASES = [
        "realign",
        "align to source",
        "pixel shift",
        "zoom drift",
        "unzoom",
        "qwen edit shift",
        "register images",
        "no offset edit",
        "edit margin",
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
                            "The edited picture."
                        ),
                    },
                ),
                "source": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "The original picture you edited, at the size the edit "
                            "model saw it. The result comes out at this size."
                        ),
                    },
                ),
                "fit": (
                    list(FIT_MODES),
                    {
                        "default": FIT_MODES[0],
                        "tooltip": (
                            "zoom + shift fixes the usual Qwen drift. affine also "
                            "fixes a slight tilt."
                        ),
                    },
                ),
                "empty_fill": (
                    list(EMPTY_FILLS),
                    {
                        "default": EMPTY_FILLS[0],
                        "tooltip": (
                            "If the edit slid past the edge, a thin strip ends up "
                            "with nothing in it. edge stretches the nearest "
                            "pixels into it, source fills it from the original, "
                            "gray fills it flat gray for inpainting."
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
                            "The biggest zoom it will undo, in percent. Anything "
                            "bigger is treated as a change you meant and left "
                            "alone."
                        ),
                    },
                ),
            },
            # Appended as optional, so saved workflows and API prompts load
            # unchanged; the socket has no widget, so widget positions hold.
            "optional": {
                "stitcher": (
                    "AUSBOSS_STITCHER",
                    {
                        "tooltip": (
                            "Optional. Plug in the stitcher from Load Image + Pad "
                            "🆎 if you padded the picture before editing. You "
                            "get your picture back without the padding, with "
                            "no empty edges."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "empty_mask", "report")
    OUTPUT_TOOLTIPS = (
        "The edit, lined up with the original and at its size.",
        "White where the lined-up edit has nothing (a strip that slid off "
        "the edge). All black when there is none.",
        "How far the edit had moved and what was done. Plug it into Show "
        "Text 🆎 to read it.",
    )
    FUNCTION = "realign"

    def realign(self, edited, source, fit, empty_fill, max_zoom, stitcher=None):
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
        canvases, bbox, frame, canvas_size = None, None, None, None
        if stitcher is not None:
            canvases, bbox = _stitcher_canvas(stitcher)
            if int(canvases.shape[0]) not in (1, frames):
                raise ValueError(
                    f"Realign to Source: the stitcher holds {int(canvases.shape[0])} canvases for "
                    f"{frames} edited frames."
                )
            canvas_size = (int(canvases.shape[2]), int(canvases.shape[1]))
            if (width, height) == canvas_size:
                # The padded canvas itself came in as source: return the
                # picture's area of it.
                width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            frame = frame_matrix(width, height, bbox)
        identity = torch.eye(3, dtype=torch.float64)
        progress = frame_progress(frames) if frames > 1 else None
        images, masks, lines = [], [], []
        for index in range(frames):
            raise_if_interrupted()
            # The measuring and warping run on the CPU: they work at 768 px at
            # most and take a fraction of a second per frame.
            src = source[min(index, sources - 1), ..., :3].detach().float().cpu()
            edit = edited[index, ..., :3].detach().float().cpu()
            if canvases is None:
                reference, fill_src = src, src
                result = measure(reference, edit, str(fit), float(max_zoom) / 100.0)
            else:
                reference = canvases[min(index, int(canvases.shape[0]) - 1), ..., :3].detach().float().cpu()
                if tuple(src.shape[:2]) != (height, width):
                    x0, y0, x1, y1 = bbox
                    src = src[y0:y1, x0:x1]
                fill_src = src
                result = measure(reference, edit, str(fit), float(max_zoom) / 100.0, region=bbox)
            matrix = result.matrix if result.reliable else identity
            out = crop_if_shift(edit, matrix, width, height, frame, canvas_size)
            cropped = out is not None
            if cropped:
                empty = torch.zeros((height, width), dtype=torch.float32)
            else:
                out, empty = warp_to_source(edit, matrix, width, height, str(empty_fill), fill_src,
                                            frame, canvas_size)
            if not result.reliable:
                empty = torch.zeros_like(empty)
            short = overshoot(matrix, width, height, frame, canvas_size) if bool(empty.any()) else None
            images.append(out)
            masks.append(empty)
            lines.append(describe(result, float(empty.mean()), result.reliable, cropped, short,
                                  stitcher is not None))
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
