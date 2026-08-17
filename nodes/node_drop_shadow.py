"""Drop Shadow 🆎."""

from __future__ import annotations

from ._shadow_helpers import drop_shadow


class AusBossDropShadow:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Casts a colored drop shadow from a subject mask: the mask is "
        "shifted, optionally grown and feathered, and composited under "
        "the subject. The subject itself is never darkened, and pixels "
        "the shadow does not reach stay bit-identical."
    )
    SEARCH_ALIASES = [
        "drop shadow",
        "shadow",
        "cast shadow",
        "cutout shadow",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC image containing the subject."},
                ),
                "mask": (
                    "MASK",
                    {
                        "tooltip": (
                            "The subject alpha: white is the subject that "
                            "casts the shadow. A single mask broadcasts "
                            "across a batch."
                        )
                    },
                ),
                "offset_x": (
                    "INT",
                    {
                        "default": 12,
                        "min": -4096,
                        "max": 4096,
                        "step": 1,
                        "tooltip": "Horizontal shadow offset in pixels; negative casts left.",
                    },
                ),
                "offset_y": (
                    "INT",
                    {
                        "default": 12,
                        "min": -4096,
                        "max": 4096,
                        "step": 1,
                        "tooltip": "Vertical shadow offset in pixels; negative casts up.",
                    },
                ),
                "grow": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 256,
                        "step": 1,
                        "tooltip": "Pixels to expand the shadow beyond the subject outline.",
                    },
                ),
                "blur": (
                    "INT",
                    {
                        "default": 12,
                        "min": 0,
                        "max": 256,
                        "step": 1,
                        "tooltip": "Gaussian softness of the shadow edge in pixels; 0 keeps it hard.",
                    },
                ),
                "shadow_color": (
                    "STRING",
                    {
                        "default": "#000000",
                        "tooltip": (
                            "Shadow color; accepts #RGB/#RRGGBB hex, R, G, B "
                            "(0-255 or 0..1 floats), one grayscale number, or "
                            "a CSS color name."
                        ),
                    },
                ),
                "opacity": (
                    "FLOAT",
                    {
                        "default": 0.6,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "Shadow strength; 0 returns the image untouched.",
                    },
                ),
            },
            "optional": {
                "blend": (
                    ["normal", "multiply"],
                    {
                        "default": "normal",
                        "tooltip": (
                            "normal mixes the backdrop toward the shadow "
                            "color. multiply darkens the backdrop by the "
                            "color instead, keeping its texture visible — "
                            "the photographic choice on busy ground."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "shadow_mask")
    OUTPUT_TOOLTIPS = (
        "The image with the shadow composited under the subject.",
        "The effective shadow alpha — offset, grown, feathered, opacity-"
        "scaled, and carved by the subject — for compositing the shadow "
        "yourself downstream.",
    )
    FUNCTION = "cast"

    def cast(
        self,
        image,
        mask,
        offset_x,
        offset_y,
        grow,
        blur,
        shadow_color,
        opacity,
        blend="normal",
    ):
        return drop_shadow(
            image,
            mask,
            int(offset_x),
            int(offset_y),
            int(grow),
            int(blur),
            shadow_color,
            float(opacity),
            str(blend),
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_DropShadow": AusBossDropShadow}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_DropShadow": "Drop Shadow 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
