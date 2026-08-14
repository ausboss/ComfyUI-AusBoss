"""Refine Mask (AusBoss)."""

from __future__ import annotations

from ._mask_helpers import EDGE_REFINE_MODES, refine_mask


NODE_ID = "AUSBOSS_NODES_RefineMask"


class AusBossRefineMask:
    CATEGORY = "🆎 AusBoss/Mask"
    DESCRIPTION = (
        "Cleans up a mask in one fixed-order pass: expand (grow/shrink by "
        "whole pixels), fill enclosed holes, smooth (melts staircase jaggies "
        "without feathering), feather with a gaussian blur, edge-refine "
        "against the optional guide_image (guided filter or alpha matting), "
        "then remap levels with black_point/white_point to clear gray haze. "
        "Returns the refined mask and its inverse."
    )
    SEARCH_ALIASES = [
        "grow mask", "shrink mask", "expand mask", "feather", "fill holes",
        "smooth", "levels", "guided filter", "alpha matting", "ausboss",
    ]

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
                "black_point": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "Mask values at or below this become fully black; clears "
                        "faint gray haze outside the subject. Applied last.",
                    },
                ),
                "white_point": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "Mask values at or above this become fully white; "
                        "solidifies the mask core. Applied last.",
                    },
                ),
                "edge_refine": (
                    list(EDGE_REFINE_MODES),
                    {
                        "default": "off",
                        "tooltip": "Snap the mask edge to the guide_image. 'guided filter' "
                        "is fast edge-aware filtering (needs opencv-contrib-python); "
                        "'matting' solves closed-form alpha matting around the edge "
                        "(needs pymatting). Both require the guide_image input.",
                    },
                ),
            },
            "optional": {
                "guide_image": (
                    "IMAGE",
                    {
                        "tooltip": "RGB frames the mask belongs to; required when "
                        "edge_refine is 'guided filter' or 'matting'.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("MASK", "MASK")
    RETURN_NAMES = ("mask", "mask_inverted")
    OUTPUT_TOOLTIPS = (
        "The refined BHW mask.",
        "The refined mask inverted, for operations that target the background.",
    )
    FUNCTION = "refine"

    def refine(
        self,
        mask,
        expand,
        blur,
        fill_holes,
        smooth,
        black_point,
        white_point,
        edge_refine,
        guide_image=None,
    ):
        return refine_mask(
            mask,
            int(expand),
            float(blur),
            bool(fill_holes),
            smooth=int(smooth),
            black_point=float(black_point),
            white_point=float(white_point),
            edge_refine=str(edge_refine),
            guide_image=guide_image,
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_RefineMask": AusBossRefineMask}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_RefineMask": "Refine Mask (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
