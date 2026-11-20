from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._sheet_split_helpers import cut_columns, split_sheet

WHITE = 1.0


def sheet(spans: list[tuple[int, int]], width: int = 400, height: int = 60) -> torch.Tensor:
    """A white HWC sheet with one solid block per span; block i has value i / 10."""
    image = torch.full((height, width, 3), WHITE)
    for index, (start, end) in enumerate(spans):
        image[10:50, start:end] = (index + 1) / 10
    return image


def values_in(piece: torch.Tensor) -> set[float]:
    return {round(float(v), 2) for v in piece[..., 0].unique()} - {WHITE}


class CutColumnTests(unittest.TestCase):
    def test_cuts_land_in_the_gaps_not_on_equal_shares(self):
        # Equal quarters are at 100, 200, 300; the gaps are at 115-125, 190-205, 280-290.
        cuts = cut_columns(sheet([(5, 115), (125, 190), (205, 280), (290, 395)]), 4)
        self.assertEqual(cuts[0], 0)
        self.assertEqual(cuts[-1], 400)
        self.assertTrue(115 <= cuts[1] <= 125, cuts)
        self.assertTrue(190 <= cuts[2] <= 205, cuts)
        self.assertTrue(280 <= cuts[3] <= 290, cuts)

    def test_touching_pictures_cut_where_least_is_lost(self):
        image = sheet([(5, 110), (110, 200), (200, 300), (300, 395)])
        image[10:50, 105:115] = 0.5   # an overlap: the cut still has to go somewhere
        image[30:50, 105:115] = WHITE  # thinnest at its upper half only
        cuts = cut_columns(image, 4)
        self.assertEqual(len(cuts), 5)
        self.assertEqual(cuts, sorted(set(cuts)))

    def test_one_piece_is_the_whole_width(self):
        self.assertEqual(cut_columns(sheet([(5, 395)]), 1), [0, 400])


class SplitSheetTests(unittest.TestCase):
    def test_each_piece_holds_one_picture_and_all_share_a_size(self):
        image = sheet([(5, 115), (125, 190), (205, 280), (290, 395)])
        pieces = split_sheet(image[None], 4)
        self.assertEqual(pieces.shape[0], 4)
        self.assertEqual(len({tuple(p.shape) for p in pieces}), 1)
        for index, piece in enumerate(pieces):
            self.assertEqual(values_in(piece), {round((index + 1) / 10, 2)})

    def test_outer_pieces_keep_the_sheet_edge_at_their_edge(self):
        # Pictures that run to the sheet's edges stay flush there after padding.
        image = sheet([(0, 115), (125, 190), (205, 280), (290, 400)])
        pieces = split_sheet(image[None], 4)
        self.assertLess(float(pieces[0][30, 0, 0]), WHITE)
        self.assertLess(float(pieces[-1][30, -1, 0]), WHITE)

    def test_backdrop_padding_matches_a_coloured_sheet(self):
        image = sheet([(5, 115), (125, 190), (205, 280), (290, 395)])
        image[image == WHITE] = 0.9
        pieces = split_sheet(image[None], 4)
        self.assertAlmostEqual(float(pieces[1][0, 0, 0]), 0.9, places=5)

    def test_a_batch_gives_every_picture_its_pieces_in_order(self):
        first = sheet([(5, 115), (125, 190), (205, 280), (290, 395)])
        second = sheet([(5, 90), (110, 190), (215, 300), (320, 395)])
        pieces = split_sheet(torch.stack([first, second]), 4)
        self.assertEqual(pieces.shape[0], 8)
        self.assertEqual(values_in(pieces[4]), {0.1})
        self.assertEqual(values_in(pieces[7]), {0.4})

    def test_one_piece_returns_the_batch_unchanged(self):
        image = sheet([(5, 395)])[None]
        self.assertIs(split_sheet(image, 1), image)

    def test_more_pieces_than_columns_still_cuts(self):
        pieces = split_sheet(torch.ones((1, 4, 3, 3)), 16)
        self.assertEqual(pieces.shape[0], 3)

    def test_rejects_a_non_batch(self):
        with self.assertRaises(ValueError):
            split_sheet(torch.ones((4, 4, 3)), 2)


if __name__ == "__main__":
    unittest.main()
