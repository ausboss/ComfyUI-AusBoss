"""Color Match 🆎."""

from __future__ import annotations

from ._color_helpers import COLOR_MATCH_METHODS, match_colors


class AusBossColorMatch:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Transfers the reference image's color statistics onto the input — "
        "fixes the color shift on inpainted or stitched regions. Four "
        "methods: lab and rgb move per-channel mean/std, mkl maps the full "
        "color covariance, histogram matches each channel's distribution "
        "exactly. An optional mask restricts both the measurement and the "
        "correction to its white area (invert_mask flips that), which is "
        "why the node takes a mask but outputs none: the mask only scopes "
        "the fix, and passes through your graph unchanged. Strength blends "
        "between the original and the fully matched result."
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
                "method": (
                    list(COLOR_MATCH_METHODS),
                    {
                        "default": "lab",
                        "tooltip": (
                            "How the colors move. lab: perceptual mean/std "
                            "shift, the safe default. rgb: the same in raw "
                            "channels. mkl: full covariance mapping, best "
                            "when hues are rotated, not just shifted. "
                            "histogram: exact per-channel distribution "
                            "match, the strongest and least subtle."
                        ),
                    },
                ),
                "mask": (
                    "MASK",
                    {
                        "tooltip": (
                            "Restricts the correction to the white area — both "
                            "the statistics measured on the image and where the "
                            "fix is applied; typical for recoloring just an "
                            "inpainted region. Black pixels pass through "
                            "bit-identical, so the mask itself never changes — "
                            "wire your original mask onward. Without a mask "
                            "the whole image is matched."
                        )
                    },
                ),
                "invert_mask": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Treat the mask's black area as the region to "
                            "correct instead of the white area."
                        ),
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

    def match(self, image, reference, strength, method="lab", mask=None, invert_mask=False):
        return (
            match_colors(
                image, reference, float(strength), mask, str(method), bool(invert_mask)
            ),
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ColorMatch": AusBossColorMatch}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ColorMatch": "Color Match 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
