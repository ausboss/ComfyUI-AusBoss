"""Image Toolbox 🆎: small picture jobs behind one node.

Each job is a choice in the ``job`` list, so a new job is a new choice, not a
new node. The first job splits a sheet of side-by-side pictures at the gaps
between them (``_sheet_split_helpers``).
"""

from __future__ import annotations

from ._sheet_split_helpers import split_sheet

SPLIT_SHEET = "split sheet at gaps"
JOBS = [SPLIT_SHEET]


class AusBossImageToolbox:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Small picture jobs in one node: pick the job from the list. "
        "split sheet at gaps cuts a row of pictures, such as a character "
        "sheet's views, into separate pictures. Each cut goes to the gap "
        "between two pictures, not to an equal share of the width, so no "
        "piece gets part of its neighbour. The pieces come out as one batch, "
        "all the same size, padded with the sheet's backdrop colour."
    )
    SEARCH_ALIASES = [
        "toolbox",
        "split sheet",
        "character sheet",
        "turnaround",
        "split views",
        "cut into pieces",
        "slice image",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "The picture to work on. A batch is worked on picture by picture."},
                ),
                "job": (
                    JOBS,
                    {
                        "default": SPLIT_SHEET,
                        "tooltip": "What to do with the picture. split sheet at gaps: cut a row of pictures apart at the gaps between them.",
                    },
                ),
                "pieces": (
                    "INT",
                    {
                        "default": 4,
                        "min": 1,
                        "max": 16,
                        "step": 1,
                        "tooltip": "How many pictures sit side by side on the sheet. 4 for a four-view character sheet.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_TOOLTIPS = (
        "The result. For split sheet at gaps: the pieces from left to right, one batch, all the same size.",
    )
    FUNCTION = "run"

    def run(self, image, job, pieces):
        if job == SPLIT_SHEET:
            return (split_sheet(image, pieces),)
        raise ValueError(f"Image Toolbox has no job named {job!r}.")


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ImageToolbox": AusBossImageToolbox}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ImageToolbox": "Image Toolbox 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
