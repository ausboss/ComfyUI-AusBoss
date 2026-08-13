"""Refine Mask (AusBoss)."""

from __future__ import annotations

from ._mask_helpers import refine_mask


NODE_ID = "AUSBOSS_NODES_RefineMask"


class AusBossRefineMask:
    CATEGORY = "🆎 AusBoss/Mask"
    DESCRIPTION = (
        "Cleans up a mask in one fixed-order pass: expand (grow/shrink by "
        "whole pixels), fill enclosed holes, smooth (melts staircase jaggies "
        "without feathering), then feather with a gaussian blur. Returns the "
        "refined mask and its inverse."
    )
    SEARCH_ALIASES = ["grow mask", "shrink mask", "expand mask", "feather", "fill holes", "smooth", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mask": (
                    "MASK",
                    {"tooltip": "BHW mask; white is the selected area."},
                ),
                "expand": (
                    "INT",
                    {
                        "default": 0,
                        "min": -1024,
                        "max": 1024,
                        "step": 1,
                        "tooltip": "Pixels to grow (+) or shrink (-) the mask.",
                    },
                ),
                "blur": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 100.0,
                        "step": 0.1,
                        "tooltip": "Gaussian feather strength in pixels; 0 keeps hard edges.",
                    },
                ),
                "fill_holes": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Fill fully enclosed gaps inside the mask before feathering.",
                    },
                ),
                "smooth": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 256,
                        "step": 1,
                        "tooltip": "Melts staircase jaggies by this many pixels while keeping "
                        "a hard edge; 0 is off. Runs before the feather blur.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("MASK", "MASK")
    RETURN_NAMES = ("mask", "mask_inverted")
    OUTPUT_TOOLTIPS = (
        "The refined BHW mask.",
        "The refined mask inverted, for operations that target the background.",
    )
    FUNCTION = "refine"

    def refine(self, mask, expand, blur, fill_holes, smooth):
        return refine_mask(
            mask, int(expand), float(blur), bool(fill_holes), smooth=int(smooth)
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_RefineMask": AusBossRefineMask}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_RefineMask": "Refine Mask (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
