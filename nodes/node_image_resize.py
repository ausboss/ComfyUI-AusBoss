"""Image Resize 🆎."""

from __future__ import annotations

from ._resize_helpers import (
    INTERPOLATION_MODES,
    PROPORTION_MODES,
    TARGET_MODES,
    apply_resize,
)


class AusBossImageResize:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Resizes an image (and an optional mask, identically) to a target "
        "width+height, longest or shortest edge, megapixel budget, or scale "
        "factor. keep_proportion decides what happens when the aspect "
        "changes: stretch, fit inside, cover and center-crop, or pad with a "
        "fill color - pad marks the new bars as 1.0 in the mask output. "
        "divisible_by snaps the result to a clean multiple (16 for WAN), "
        "and 0 in a size widget keeps the source dimension."
    )
    SEARCH_ALIASES = [
        "resize image",
        "scale image",
        "upscale",
        "downscale",
        "fit",
        "crop to size",
        "letterbox pad",
        "megapixels",
        "divisible by",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC image batch to resize."},
                ),
                "target_mode": (
                    list(TARGET_MODES),
                    {
                        "default": "width+height",
                        "tooltip": (
                            "What sets the output size: width+height reads "
                            "the two size widgets; longest_edge and "
                            "shortest_edge scale until that edge hits "
                            "edge_length; megapixels scales to a pixel "
                            "budget; scale_factor multiplies the source. "
                            "Each mode reads only its own widget(s)."
                        ),
                    },
                ),
                "width": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": (
                            "Target width for width+height mode. 0 keeps "
                            "the source width, or follows height to "
                            "preserve the aspect when only height is set."
                        ),
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": (
                            "Target height for width+height mode. 0 keeps "
                            "the source height, or follows width to "
                            "preserve the aspect when only width is set."
                        ),
                    },
                ),
                "edge_length": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": (
                            "Target length for the longest_edge and "
                            "shortest_edge modes; the chosen edge lands "
                            "exactly here and the other keeps the aspect. "
                            "0 keeps the source size."
                        ),
                    },
                ),
                "megapixels": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 64.0,
                        "step": 0.01,
                        "tooltip": (
                            "Pixel budget for megapixels mode: the image "
                            "scales (aspect preserved) until width x height "
                            "is about this many million pixels. 0 keeps the "
                            "source size."
                        ),
                    },
                ),
                "scale_factor": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.0,
                        "max": 16.0,
                        "step": 0.01,
                        "tooltip": (
                            "Multiplier for scale_factor mode: 0.5 halves "
                            "both dimensions, 2.0 doubles them. 0 keeps the "
                            "source size."
                        ),
                    },
                ),
                "keep_proportion": (
                    list(PROPORTION_MODES),
                    {
                        "default": "fit",
                        "tooltip": (
                            "When the width+height box differs from the "
                            "source aspect: stretch distorts to the exact "
                            "target; fit shrinks the target box to the "
                            "source aspect (output may be smaller than "
                            "requested, no bars); cover_crop fills the "
                            "target and center-crops the overflow; pad fits "
                            "inside and fills the rest with fill_color, "
                            "marking the bars in the mask output. The other "
                            "target modes derive the box from the source "
                            "itself, so they never crop, distort visibly, "
                            "or invent pixels regardless of this setting."
                        ),
                    },
                ),
                "fill_color": (
                    "STRING",
                    {
                        "default": "#000000",
                        "tooltip": (
                            "Bar color for pad mode; accepts #RGB/#RRGGBB "
                            "hex, R, G, B (0-255 or 0..1 floats), one "
                            "grayscale number, or a CSS color name. Other "
                            "modes ignore it."
                        ),
                    },
                ),
                "divisible_by": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 1024,
                        "step": 1,
                        "tooltip": (
                            "Snaps each output dimension to the nearest "
                            "multiple of this (never below one step) - set "
                            "16 for WAN, 8 for most latent spaces. 1 leaves "
                            "sizes exactly as computed. The snap is always "
                            "resolved by a sub-half-step resize, never by "
                            "inventing pixels."
                        ),
                    },
                ),
                "interpolation": (
                    list(INTERPOLATION_MODES),
                    {
                        "default": "lanczos",
                        "tooltip": (
                            "Resampling filter: lanczos is the sharpest "
                            "all-rounder, bicubic and bilinear are softer, "
                            "nearest keeps hard pixels (pixel art, masks), "
                            "area is best for strong downscales."
                        ),
                    },
                ),
            },
            "optional": {
                "mask": (
                    "MASK",
                    {
                        "tooltip": (
                            "Optional BHW mask carried through the exact "
                            "same resize, crop, and pad geometry as the "
                            "image."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The resized image batch in BHWC format.",
        "The input mask through the identical transform; in pad mode the "
        "new bars are 1.0 (a ready outpaint mask). All zeros when no mask "
        "is wired.",
        "Output width in pixels.",
        "Output height in pixels.",
    )
    FUNCTION = "resize"

    def resize(
        self,
        image,
        target_mode,
        width,
        height,
        edge_length,
        megapixels,
        scale_factor,
        keep_proportion,
        fill_color,
        divisible_by,
        interpolation,
        mask=None,
    ):
        return apply_resize(
            image,
            mask,
            str(target_mode),
            int(width),
            int(height),
            int(edge_length),
            float(megapixels),
            float(scale_factor),
            str(keep_proportion),
            fill_color,
            int(divisible_by),
            str(interpolation),
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ImageResize": AusBossImageResize}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ImageResize": "Image Resize 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
