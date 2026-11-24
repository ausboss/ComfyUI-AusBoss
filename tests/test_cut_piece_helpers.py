from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._cut_piece_helpers import POSITIONS, cut_piece, piece_box


def ramp(height: int = 60, width: int = 100) -> torch.Tensor:
    """A one-picture BHWC batch whose red channel is the column and green the row, so a cut shows where it came from."""
    image = torch.ones((1, height, width, 3))
    image[0, :, :, 0] = torch.arange(width)[None, :] / 1000
    image[0, :, :, 1] = torch.arange(height)[:, None] / 1000
    return image


def origin(piece: torch.Tensor) -> tuple[int, int]:
    """(row, column) of a cut's top left pixel in the ramp."""
    return round(float(piece[0, 0, 0, 1]) * 1000), round(float(piece[0, 0, 0, 0]) * 1000)


class PieceBoxTests(unittest.TestCase):
    def test_each_position_puts_the_piece_where_it_says(self):
        expected = {
            "top left": (0, 0), "top": (0, 30), "top right": (0, 60),
            "left": (10, 0), "center": (10, 30), "right": (10, 60),
            "bottom left": (20, 0), "bottom": (20, 30), "bottom right": (20, 60),
        }
        self.assertEqual(set(expected), set(POSITIONS))
        for position, (top, left) in expected.items():
            self.assertEqual(piece_box(60, 100, 40, 40, position), (top, left, top + 40, left + 40), position)

    def test_moves_add_to_the_position_and_stop_at_the_edge(self):
        self.assertEqual(piece_box(60, 100, 40, 40, "top left", 25, 5), (5, 25, 45, 65))
        self.assertEqual(piece_box(60, 100, 40, 40, "center", -10, 0), (10, 20, 50, 60))
        self.assertEqual(piece_box(60, 100, 40, 40, "top left", 500, 500), (20, 60, 60, 100))
        self.assertEqual(piece_box(60, 100, 40, 40, "bottom right", -500, -500), (0, 0, 40, 40))

    def test_zero_takes_the_full_side_and_too_large_is_cut_to_the_picture(self):
        self.assertEqual(piece_box(60, 100, 0, 0), (0, 0, 60, 100))
        self.assertEqual(piece_box(60, 100, 30, 0, "right"), (0, 70, 60, 100))
        self.assertEqual(piece_box(60, 100, 4000, 4000, "center"), (0, 0, 60, 100))

    def test_an_unknown_position_is_an_error(self):
        with self.assertRaises(ValueError):
            piece_box(60, 100, 10, 10, "middle")


class CutPieceTests(unittest.TestCase):
    def test_the_piece_has_the_size_asked_for_and_comes_from_its_place(self):
        piece, _rest = cut_piece(ramp(), 30, 20, "top left", 12, 7)
        self.assertEqual(tuple(piece.shape), (1, 20, 30, 3))
        self.assertEqual(origin(piece), (7, 12))

    def test_a_full_height_piece_at_the_left_leaves_the_strip_on_its_right(self):
        # Two parts of different sizes from one picture: 35 px and the other 65 px.
        piece, rest = cut_piece(ramp(), 35, 0, "top left")
        self.assertEqual(tuple(piece.shape), (1, 60, 35, 3))
        self.assertEqual(tuple(rest.shape), (1, 60, 65, 3))
        self.assertEqual(origin(rest), (0, 35))

    def test_a_full_height_piece_at_the_right_leaves_the_strip_on_its_left(self):
        _piece, rest = cut_piece(ramp(), 35, 0, "right")
        self.assertEqual(tuple(rest.shape), (1, 60, 65, 3))
        self.assertEqual(origin(rest), (0, 0))

    def test_a_full_width_piece_leaves_the_strip_above_or_below(self):
        _piece, below = cut_piece(ramp(), 0, 25, "top")
        self.assertEqual(tuple(below.shape), (1, 35, 100, 3))
        self.assertEqual(origin(below), (25, 0))
        _piece, above = cut_piece(ramp(), 0, 25, "bottom")
        self.assertEqual(tuple(above.shape), (1, 35, 100, 3))
        self.assertEqual(origin(above), (0, 0))

    def test_a_piece_inside_leaves_the_picture_with_its_hole_filled(self):
        image = torch.ones((1, 60, 100, 3))
        image[0, 20:40, 40:60] = 0.2
        _piece, rest = cut_piece(image, 20, 20, "center")
        self.assertEqual(tuple(rest.shape), tuple(image.shape))
        self.assertTrue(torch.all(rest == 1.0))
        self.assertTrue(torch.all(image[0, 20:40, 40:60] == 0.2), "the input is left alone")

    def test_a_batch_is_cut_at_the_same_place_in_every_picture(self):
        batch = torch.cat([ramp(), ramp() * 0.5])
        piece, rest = cut_piece(batch, 10, 10, "bottom right")
        self.assertEqual(tuple(piece.shape), (2, 10, 10, 3))
        self.assertEqual(rest.shape[0], 2)
        self.assertTrue(torch.allclose(piece[1], piece[0] * 0.5))


class ToolboxNodeTests(unittest.TestCase):
    def test_the_node_runs_both_jobs_and_old_calls_still_work(self):
        from nodes.node_image_toolbox import AusBossImageToolbox

        node = AusBossImageToolbox()
        image = ramp()
        pieces, passed = node.run(image, "split sheet at gaps", 1)
        self.assertEqual(tuple(pieces.shape), tuple(image.shape))
        self.assertIs(passed, image)
        piece, rest = node.run(image, "cut a piece", 4, width=40, height=0, position="left")
        self.assertEqual(tuple(piece.shape), (1, 60, 40, 3))
        self.assertEqual(tuple(rest.shape), (1, 60, 60, 3))


if __name__ == "__main__":
    unittest.main()
