"""Image Toolbox 🆎: small picture jobs behind one node.

Each job is a choice in the ``job`` list, so a new job is a new choice, not a
new node. split sheet at gaps cuts a sheet of side-by-side pictures at the
gaps between them (``_sheet_split_helpers``); cut a piece cuts one piece of a
chosen size and place (``_cut_piece_helpers``).
"""

from __future__ import annotations

from ._cut_piece_helpers import POSITIONS, cut_piece
from ._sheet_split_helpers import split_sheet

SPLIT_SHEET = "split sheet at gaps"
CUT_PIECE = "cut a piece"
JOBS = [SPLIT_SHEET, CUT_PIECE]
# Largest piece size and offset, in pixels.
MAX_SIDE = 16384


class AusBossImageToolbox:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Small picture jobs in one node: pick the job from the list. "
        "split sheet at gaps cuts a row of pictures, such as a character "
        "sheet's views, into separate pictures. Each cut goes to the gap "
        "between two pictures, not to an equal share of the width, so no "
        "piece gets part of its neighbour. The pieces come out as one batch, "
        "all the same size, padded with the sheet's backdrop colour. "
        "cut a piece cuts one piece of the width and height you set, at the "
        "position you pick, and gives back the rest of the picture too."
    )
    SEARCH_ALIASES = [
        "toolbox",
        "split sheet",
        "character sheet",
        "turnaround",
        "split views",
        "cut into pieces",
        "slice image",
        "crop",
        "cut a piece",
        "crop with offset",
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
                        "tooltip": "What to do with the picture. split sheet at gaps: cut a row of pictures apart at the gaps between them. cut a piece: cut out one piece of the size you set.",
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
            "optional": {
                "width": (
                    "INT",
                    {
                        "default": 512,
                        "min": 0,
                        "max": MAX_SIDE,
                        "step": 1,
                        "tooltip": "For cut a piece: how wide the piece is, in pixels. 0 takes the picture's full width.",
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 512,
                        "min": 0,
                        "max": MAX_SIDE,
                        "step": 1,
                        "tooltip": "For cut a piece: how tall the piece is, in pixels. 0 takes the picture's full height.",
                    },
                ),
                "position": (
                    list(POSITIONS),
                    {
                        "default": "top left",
                        "tooltip": "For cut a piece: where on the picture the piece sits before it is moved. top left starts at the top left corner.",
                    },
                ),
                "move_right": (
                    "INT",
                    {
                        "default": 0,
                        "min": -MAX_SIDE,
                        "max": MAX_SIDE,
                        "step": 1,
                        "tooltip": "For cut a piece: moves the piece right by this many pixels; below 0 moves it left. It stops at the picture's edge.",
                    },
                ),
                "move_down": (
                    "INT",
                    {
                        "default": 0,
                        "min": -MAX_SIDE,
                        "max": MAX_SIDE,
                        "step": 1,
                        "tooltip": "For cut a piece: moves the piece down by this many pixels; below 0 moves it up. It stops at the picture's edge.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("images", "rest")
    OUTPUT_TOOLTIPS = (
        "The result. For split sheet at gaps: the pieces from left to right, one batch, all the same size. For cut a piece: the piece.",
        "For cut a piece: the rest of the picture. A piece that takes a whole side leaves the strip beside it; any other piece leaves the picture with its hole filled with the backdrop colour. Other jobs pass the picture through.",
    )
    FUNCTION = "run"

    def run(self, image, job, pieces, width=512, height=512, position="top left", move_right=0, move_down=0):
        if job == SPLIT_SHEET:
            return (split_sheet(image, pieces), image)
        if job == CUT_PIECE:
            return cut_piece(image, width, height, position, move_right, move_down)
        raise ValueError(f"Image Toolbox has no job named {job!r}.")


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ImageToolbox": AusBossImageToolbox}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ImageToolbox": "Image Toolbox 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
