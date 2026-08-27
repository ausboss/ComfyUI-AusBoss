"""Image Size 🆎."""

from __future__ import annotations

import torch


class AusBossImageSize:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Reads an image's dimensions as INTs: width, height, the longest "
        "and shortest edges, and the batch's image count. Wire them into "
        "resize, latent, or conditioning nodes instead of retyping numbers "
        "that drift out of date."
    )
    SEARCH_ALIASES = [
        "image size",
        "width height",
        "dimensions",
        "resolution",
        "longest edge",
        "get size",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC image batch to measure."},
                ),
            },
        }

    RETURN_TYPES = ("INT", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("width", "height", "longest_edge", "shortest_edge", "count")
    OUTPUT_TOOLTIPS = (
        "Width in pixels.",
        "Height in pixels.",
        "The larger of width and height.",
        "The smaller of width and height.",
        "Number of images in the batch - the frame count for video frames.",
    )
    FUNCTION = "measure"

    def measure(self, image):
        if not isinstance(image, torch.Tensor) or image.ndim != 4:
            raise ValueError("Image Size expected a BHWC IMAGE batch.")
        height, width = int(image.shape[1]), int(image.shape[2])
        return (width, height, max(width, height), min(width, height), int(image.shape[0]))


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ImageSize": AusBossImageSize}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ImageSize": "Image Size 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
