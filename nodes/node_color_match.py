"""Color Match (AusBoss)."""

from __future__ import annotations

from ._color_helpers import match_colors


class AusBossColorMatch:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Transfers the reference image's color statistics onto the input "
        "with per-channel LAB mean/std matching — fixes the color shift on "
        "inpainted or stitched regions. An optional mask restricts both "
        "the measurement and the correction to the white area; strength "
        "blends between the original and the fully matched result."
    )
    SEARCH_ALIASES = [
        "color match",
        "harmonize",
        "color transfer",
        "color correction",
        "white balance",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC image whose colors get corrected."},
                ),
                "reference": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "The image whose color statistics to copy — for "
                            "an inpainted crop, feed the original image here. "
                            "A single reference broadcasts across a batch."
                        )
                    },
                ),
                "strength": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": (
                            "Blend between the original (0) and the fully "
                            "matched image (1)."
                        ),
                    },
                ),
            },
            "optional": {
                "mask": (
                    "MASK",
                    {
                        "tooltip": (
                            "Restricts the correction to the white area — both "
                            "the statistics measured on the image and where the "
                            "fix is applied. Black pixels pass through "
                            "bit-identical. Without a mask the whole image is "
                            "matched."
                        )
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = (
        "The color-matched image; pixels outside the mask are untouched.",
    )
    FUNCTION = "match"

    def match(self, image, reference, strength, mask=None):
        return (match_colors(image, reference, float(strength), mask),)


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ColorMatch": AusBossColorMatch}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ColorMatch": "Color Match (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
