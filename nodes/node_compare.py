"""Image Compare A/B 🆎."""

from __future__ import annotations

from PIL import Image

from ._preview_helpers import save_temp_preview, temp_prefix
from ._preview_helpers import first_frame_to_pil as _first_frame_to_pil


def first_frame_to_pil(image) -> Image.Image:
    """First frame of a BHWC float batch as a PIL image, ready to save."""
    return _first_frame_to_pil(image, "Compare")


class AusBossCompare:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Shows A and B on one panel: slide across it to reveal B up to the "
        "pointer, or switch to hold mode and press to flash B over A. "
        "image_a passes through unchanged so the node can sit mid-graph."
    )
    SEARCH_ALIASES = ["image compare", "compare", "a/b", "before after", "slider", "diff", "ausboss"]

    def __init__(self):
        # A distinct temp prefix per node instance, so two Compare nodes in
        # one workflow never overwrite each other's previews.
        self._prefix = temp_prefix("compare")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_a": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "Baseline batch. Its first frame is preview A, and the whole "
                            "batch passes through the output unchanged."
                        ),
                    },
                ),
                "image_b": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "Comparison batch. Its first frame is preview B, revealed by "
                            "sliding across or holding on the panel."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image_a",)
    OUTPUT_TOOLTIPS = (
        "image_a passed through unchanged, so downstream nodes keep working while you compare.",
    )
    OUTPUT_NODE = True
    FUNCTION = "compare"

    def compare(self, image_a, image_b):
        return {
            "ui": {
                "a_images": [self._save_temp_preview(image_a)],
                "b_images": [self._save_temp_preview(image_b)],
            },
            "result": (image_a,),
        }

    def _save_temp_preview(self, image):
        return save_temp_preview(image, self._prefix, "Compare")


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Compare": AusBossCompare}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Compare": "Image Compare A/B 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
