"""Pad Image 🆎."""

from __future__ import annotations

from ._pad_helpers import PAD_MODES, pad_image


class AusBossPadImage:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Pads an image outward on any side with a solid color, an "
        "edge-color band, replicated edge pixels, or a blurred pillarbox "
        "backdrop. Also returns a mask covering exactly the new padding — "
        "a ready-made outpaint mask. The original pixels are never touched."
    )
    SEARCH_ALIASES = [
        "pad image",
        "outpaint pad",
        "letterbox",
        "pillarbox",
        "extend canvas",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC image or frames to pad outward."},
                ),
                "pad_left": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the left edge.",
                    },
                ),
                "pad_top": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the top edge.",
                    },
                ),
                "pad_right": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the right edge.",
                    },
                ),
                "pad_bottom": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the bottom edge.",
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
                            "backdrop is blurred and dimmed. The blur scales "
                            "with the canvas size, so the look is resolution "
                            "independent; 0 keeps the backdrop sharp and full "
                            "brightness."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    OUTPUT_TOOLTIPS = (
        "The padded image; the original region is bit-identical to the input.",
        "White over the new padding, black over the original — feed it "
        "straight to an inpainter as the outpaint mask.",
    )
    FUNCTION = "pad"

    def pad(
        self,
        image,
        pad_left,
        pad_top,
        pad_right,
        pad_bottom,
        mode,
        fill_color,
        backdrop_blur,
    ):
        return pad_image(
            image,
            int(pad_left),
            int(pad_top),
            int(pad_right),
            int(pad_bottom),
            str(mode),
            fill_color,
            float(backdrop_blur),
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_PadImage": AusBossPadImage}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_PadImage": "Pad Image 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
