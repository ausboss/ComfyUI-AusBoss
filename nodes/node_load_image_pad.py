"""Load Image + Pad 🆎."""

from __future__ import annotations

import numpy as np
import torch

from ._inpaint_crop_helpers import build_canvas_stitcher
from ._media_helpers import list_input_images, load_image_frames, resolve_input_path
from ._pad_helpers import (
    PAD_MODES,
    feather_pad_mask,
    pad_image,
    plan_pad_canvas,
    resize_source,
)
from ._transform_engine import stable_file_fingerprint


def _frames_to_tensor(frames) -> torch.Tensor:
    """RGBA PIL frames (from load_image_frames) to a BHWC RGB float batch."""
    stacked = []
    for frame in frames:
        array = np.asarray(frame.convert("RGB"), dtype=np.float32) / 255.0
        stacked.append(torch.from_numpy(array.copy()))
    return torch.stack(stacked, dim=0)


class AusBossLoadImagePad:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Loads an image and pads it into an outpaint canvas in one node. "
        "Drag any edge of the canvas drawn on the node to set the per-side "
        "padding visually; the mask covers exactly the new padding, "
        "optionally feathered inward across the seam. The canvas rounds up "
        "to a clean multiple, and a megapixel target rescales the source "
        "first so the mask seam stays crisp."
    )
    SEARCH_ALIASES = [
        "load image",
        "outpaint canvas",
        "pad",
        "outpaint pad",
        "extend canvas",
        "megapixel",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    list_input_images(),
                    {
                        "image_upload": True,
                        "tooltip": "Choose or upload an image from ComfyUI's input folder.",
                    },
                ),
                "pad_left": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the left edge (drag the canvas edge on the node).",
                    },
                ),
                "pad_top": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the top edge (drag the canvas edge on the node).",
                    },
                ),
                "pad_right": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the right edge (drag the canvas edge on the node).",
                    },
                ),
                "pad_bottom": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the bottom edge (drag the canvas edge on the node).",
                    },
                ),
                "mode": (
                    list(PAD_MODES),
                    {
                        "default": "color",
                        "tooltip": (
                            "color = solid fill_color; edge = each side takes "
                            "the average color of the nearest image edge; "
                            "edge pixel = the outermost rows and columns "
                            "smear outward; pillarbox blur = the image itself, "
                            "stretched to cover the canvas, blurred and dimmed "
                            "behind the sharp original."
                        ),
                    },
                ),
                "fill_color": (
                    "STRING",
                    {
                        "default": "#808080",
                        "tooltip": (
                            "Padding color for the color mode; accepts "
                            "#RGB/#RRGGBB hex, R, G, B (0-255 or 0..1 floats), "
                            "one grayscale number, or a CSS color name. Other "
                            "modes ignore it."
                        ),
                    },
                ),
                "backdrop_blur": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": (
                            "Pillarbox blur only: one knob for how strongly the "
                            "backdrop is blurred and dimmed; 0 keeps it sharp "
                            "and full brightness."
                        ),
                    },
                ),
                "feather": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 2048,
                        "step": 1,
                        "tooltip": (
                            "Ramps the mask inward across the image edge on "
                            "each padded side so the sampler blends the seam; "
                            "0 keeps the seam hard."
                        ),
                    },
                ),
                "canvas_multiple": (
                    "INT",
                    {
                        "default": 8,
                        "min": 1,
                        "max": 4096,
                        "step": 1,
                        "tooltip": (
                            "Rounds the final canvas up to this multiple; the "
                            "remainder joins the right and bottom padding."
                        ),
                    },
                ),
                "target_megapixels": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 64.0,
                        "step": 0.01,
                        "tooltip": (
                            "0 = off. Rescales the SOURCE so the padded canvas "
                            "lands on this many megapixels (then re-rounds to "
                            "canvas_multiple) — resizing before padding keeps "
                            "the mask seam crisp."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "AUSBOSS_STITCHER")
    RETURN_NAMES = ("image", "mask", "width", "height", "stitcher")
    OUTPUT_TOOLTIPS = (
        "The padded image; the original pixels are untouched (resized only "
        "when a megapixel target is set).",
        "White over the new padding, feathered inward per the feather widget "
        "— feed it straight to an inpainter as the outpaint mask.",
        "Final canvas width after multiple/megapixel rounding.",
        "Final canvas height after multiple/megapixel rounding.",
        "Hand to Stitch Inpaint 🆎 with the sampled result to keep only the "
        "new padding and restore the original pixels bit-identically.",
    )
    FUNCTION = "load_pad"

    def load_pad(
        self,
        image,
        pad_left,
        pad_top,
        pad_right,
        pad_bottom,
        mode,
        fill_color,
        backdrop_blur,
        feather,
        canvas_multiple,
        target_megapixels,
    ):
        path = resolve_input_path(image)
        frames = _frames_to_tensor(load_image_frames(path))
        plan = plan_pad_canvas(
            frames.shape[2],
            frames.shape[1],
            int(pad_left),
            int(pad_top),
            int(pad_right),
            int(pad_bottom),
            int(canvas_multiple),
            float(target_megapixels),
        )
        frames = resize_source(frames, plan["source_width"], plan["source_height"])
        output, mask = pad_image(
            frames,
            plan["left"],
            plan["top"],
            plan["right"],
            plan["bottom"],
            str(mode),
            fill_color,
            float(backdrop_blur),
        )
        mask = feather_pad_mask(
            mask, plan["left"], plan["top"], plan["right"], plan["bottom"], int(feather)
        )
        # The padded canvas is the stitch base, so whatever the sampler does
        # outside the feathered band is discarded and the source survives.
        stitcher = build_canvas_stitcher(output, mask)
        return output, mask, int(plan["width"]), int(plan["height"]), stitcher

    @classmethod
    def VALIDATE_INPUTS(cls, image, **_values):
        try:
            resolve_input_path(image)
        except Exception as exc:
            return f"Load Image + Pad: {exc}"
        return True

    @classmethod
    def IS_CHANGED(cls, image, **values):
        try:
            path = resolve_input_path(image)
        except Exception:
            path = image or ""
        return stable_file_fingerprint(path, {"image": image, **values})


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LoadImagePad": AusBossLoadImagePad}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LoadImagePad": "Load Image + Pad 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
