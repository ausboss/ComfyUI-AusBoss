"""Align Image 🆎."""

from __future__ import annotations

from ._align_helpers import (
    ALIGN_MODES,
    CROP_POSITIONS,
    PAD_FILLS,
    PAD_POSITIONS,
    align_image,
)


class AusBossAlignImage:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Snaps an image's width and height to a clean multiple of a number "
        "you choose — 8, 16, 32, whatever the model wants. Qwen image "
        "models, VAEs, and many samplers behave best on cleanly divisible "
        "sizes. Resize rescales to the nearest multiple, crop center-crops "
        "down, pad replicate-pads the edges up; the new size comes out as "
        "INTs for wiring into latent nodes."
    )
    SEARCH_ALIASES = [
        "align",
        "multiple of 8",
        "multiple of 16",
        "divisible",
        "snap size",
        "resize to multiple",
        "qwen",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC image batch to align."},
                ),
                "multiple": (
                    "INT",
                    {
                        "default": 16,
                        "min": 1,
                        "max": 1024,
                        "step": 1,
                        "tooltip": (
                            "Width and height come out divisible by this. 16 "
                            "or 32 suits most diffusion models; latent-space "
                            "nodes usually want at least 8."
                        ),
                    },
                ),
                "mode": (
                    list(ALIGN_MODES),
                    {
                        "default": "resize",
                        "tooltip": (
                            "How to reach the multiple. resize rescales to "
                            "the NEAREST multiple (slight stretch, keeps "
                            "every pixel's content). crop center-crops DOWN "
                            "to the next multiple (no distortion, trims "
                            "edges). pad replicate-pads UP to the next "
                            "multiple (no distortion, adds edges). A side "
                            "smaller than one multiple always grows to "
                            "exactly one."
                        ),
                    },
                ),
            },
            "optional": {
                "crop_position": (
                    list(CROP_POSITIONS),
                    {
                        "default": "center",
                        "tooltip": (
                            "Crop mode only: which part of the frame "
                            "survives. center trims both edges evenly; top, "
                            "bottom, left, or right pin that edge and trim "
                            "the opposite one. Ignored by resize and pad."
                        ),
                    },
                ),
                "pad_position": (
                    list(PAD_POSITIONS),
                    {
                        "default": "center",
                        "tooltip": (
                            "Pad mode only: where the image sits on the "
                            "grown canvas — the new pixels land on the "
                            "opposite side. center splits them evenly."
                        ),
                    },
                ),
                "pad_fill": (
                    list(PAD_FILLS),
                    {
                        "default": "replicate",
                        "tooltip": (
                            "Pad mode only: what fills the new area. "
                            "replicate stretches the edge pixels out; color "
                            "uses pad_color as a solid."
                        ),
                    },
                ),
                "pad_color": (
                    "STRING",
                    {
                        "default": "#000000",
                        "tooltip": (
                            "Solid fill for pad_fill: color. Hex, R,G,B "
                            "numbers, or a CSS color name."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The aligned batch; both sides are multiples of the chosen number.",
        "Aligned width in pixels.",
        "Aligned height in pixels.",
    )
    FUNCTION = "align"

    def align(
        self,
        image,
        multiple,
        mode,
        crop_position="center",
        pad_position="center",
        pad_fill="replicate",
        pad_color="#000000",
    ):
        aligned, width, height = align_image(
            image,
            int(multiple),
            str(mode),
            str(crop_position),
            str(pad_position),
            str(pad_fill),
            pad_color,
        )
        return (aligned, width, height)


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_AlignImage": AusBossAlignImage}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_AlignImage": "Align Image 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
