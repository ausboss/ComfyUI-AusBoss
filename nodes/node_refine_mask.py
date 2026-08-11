"""Refine Mask (AusBoss)."""

from __future__ import annotations

from ._mask_helpers import refine_mask


NODE_ID = "AUSBOSS_NODES_RefineMask"


class AusBossRefineMask:
    CATEGORY = "🆎 AusBoss/Mask"
    DESCRIPTION = (
        "Grows or shrinks a mask by whole pixels, optionally fills enclosed "
        "holes, then feathers the edge with a gaussian blur. Returns the "
        "refined mask and its inverse."
    )
    SEARCH_ALIASES = ["grow mask", "shrink mask", "expand mask", "feather", "fill holes", "ausboss"]

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
            }
        }

    RETURN_TYPES = ("MASK", "MASK")
    RETURN_NAMES = ("mask", "mask_inverted")
    OUTPUT_TOOLTIPS = (
        "The refined BHW mask.",
        "The refined mask inverted, for operations that target the background.",
    )
    FUNCTION = "refine"

    def refine(self, mask, expand, blur, fill_holes):
        return refine_mask(mask, int(expand), float(blur), bool(fill_holes))


NODE_CLASS_MAPPINGS = {NODE_ID: AusBossRefineMask}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: "Refine Mask (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
