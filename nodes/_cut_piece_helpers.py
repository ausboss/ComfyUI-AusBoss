"""Cut a piece of a chosen size out of a picture.

The piece's place is a position on the picture (a corner, an edge's middle
or the centre) moved by an offset in pixels. The piece always stays inside
the picture: a size larger than the picture is cut to the picture's size,
and an offset that would push it past an edge stops at that edge.

Besides the piece, the job gives back the rest of the picture. When the
piece takes a whole side (the full height against the left or right edge,
or the full width against the top or bottom), the rest is the strip beside
it, so one cut splits a picture into two parts of different sizes. Any
other piece leaves a hole, and the rest is the whole picture with that
hole filled with the picture's backdrop colour.
"""

from __future__ import annotations

import torch

from ._sheet_split_helpers import backdrop_color

# Reading order, so the list reads like the picture: top row, middle, bottom.
POSITIONS = (
    "top left",
    "top",
    "top right",
    "left",
    "center",
    "right",
    "bottom left",
    "bottom",
    "bottom right",
)


def piece_box(
    height: int,
    width: int,
    piece_width: int,
    piece_height: int,
    position: str = "top left",
    move_right: int = 0,
    move_down: int = 0,
) -> tuple[int, int, int, int]:
    """(top, left, bottom, right) of the piece, inside a height x width picture.

    A piece width or height of 0 (or less) means the picture's full width or
    height; a larger one is cut to the picture.
    """
    if position not in POSITIONS:
        raise ValueError(f"Cut a piece has no position named {position!r}.")
    piece_width = width if piece_width <= 0 else min(int(piece_width), width)
    piece_height = height if piece_height <= 0 else min(int(piece_height), height)
    if "left" in position:
        left = 0
    elif "right" in position:
        left = width - piece_width
    else:
        left = (width - piece_width) // 2
    if position.startswith("top"):
        top = 0
    elif position.startswith("bottom"):
        top = height - piece_height
    else:
        top = (height - piece_height) // 2
    left = max(0, min(width - piece_width, left + int(move_right)))
    top = max(0, min(height - piece_height, top + int(move_down)))
    return top, left, top + piece_height, left + piece_width


def rest_of(image: torch.Tensor, box: tuple[int, int, int, int]) -> torch.Tensor:
    """What is left of a BHWC batch once the piece in ``box`` is cut out."""
    top, left, bottom, right = box
    height, width = image.shape[1], image.shape[2]
    full_height = top == 0 and bottom == height
    full_width = left == 0 and right == width
    if full_height and not full_width:
        if left == 0:
            return image[:, :, right:].clone()
        if right == width:
            return image[:, :, :left].clone()
    if full_width and not full_height:
        if top == 0:
            return image[:, bottom:].clone()
        if bottom == height:
            return image[:, :top].clone()
    rest = image.clone()
    for index in range(rest.shape[0]):
        rest[index, top:bottom, left:right] = backdrop_color(image[index])
    return rest


def cut_piece(
    image: torch.Tensor,
    piece_width: int,
    piece_height: int,
    position: str = "top left",
    move_right: int = 0,
    move_down: int = 0,
) -> tuple[torch.Tensor, torch.Tensor]:
    """The piece and the rest, for every picture of a BHWC batch at the same place."""
    box = piece_box(image.shape[1], image.shape[2], piece_width, piece_height, position, move_right, move_down)
    top, left, bottom, right = box
    return image[:, top:bottom, left:right].clone(), rest_of(image, box)
