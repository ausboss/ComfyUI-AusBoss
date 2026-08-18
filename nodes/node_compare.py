"""Image Compare A/B 🆎."""

from __future__ import annotations

import random
import string
from pathlib import Path

import torch
from PIL import Image

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None


def first_frame_to_pil(image: torch.Tensor) -> Image.Image:
    """First frame of a BHWC float batch as a PIL image, ready to save."""
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Compare expected a BHWC IMAGE batch.")
    if int(image.shape[0]) < 1:
        raise ValueError("Compare received an empty IMAGE batch.")
    frame = image[0].detach().cpu().clamp(0.0, 1.0).mul(255.0).round().to(torch.uint8)
    array = frame.numpy()
    if array.shape[-1] == 1:
        array = array[..., 0]
    return Image.fromarray(array)


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
        self._prefix = "ausboss_compare_" + "".join(
            random.choices(string.ascii_lowercase, k=5)
        )

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
        if folder_paths is None:
            raise RuntimeError("Compare requires ComfyUI's folder_paths at runtime.")
        return {
            "ui": {
                "a_images": [self._save_temp_preview(image_a)],
                "b_images": [self._save_temp_preview(image_b)],
            },
            "result": (image_a,),
        }

    def _save_temp_preview(self, image):
        preview = first_frame_to_pil(image)
        full_output_folder, filename, counter, subfolder, _prefix = (
            folder_paths.get_save_image_path(
                self._prefix,
                folder_paths.get_temp_directory(),
                preview.width,
                preview.height,
            )
        )
        file = f"{filename}_{counter:05}_.png"
        preview.save(Path(full_output_folder) / file, compress_level=4)
        return {
            "filename": file,
            "subfolder": subfolder,
            "type": "temp",
            "width": preview.width,
            "height": preview.height,
        }


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Compare": AusBossCompare}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Compare": "Image Compare A/B 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
