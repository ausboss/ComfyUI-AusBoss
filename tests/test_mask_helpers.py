from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._mask_helpers import (
    _torch_fill_holes,
    blur_mask,
    fill_mask_holes,
    grow_shrink_mask,
    refine_mask,
)


def donut_mask() -> torch.Tensor:
    mask = torch.zeros((1, 16, 16), dtype=torch.float32)
    mask[:, 3:13, 3:13] = 1.0
    mask[:, 6:10, 6:10] = 0.0
    return mask


class GrowShrinkTests(unittest.TestCase):
    def test_grow_and_shrink_change_area_in_the_right_direction(self):
        mask = torch.zeros((1, 12, 12), dtype=torch.float32)
        mask[:, 4:8, 4:8] = 1.0
        self.assertGreater(grow_shrink_mask(mask, 2).sum(), mask.sum())
        self.assertLess(grow_shrink_mask(mask, -1).sum(), mask.sum())
        self.assertTrue(torch.equal(grow_shrink_mask(mask, 0), mask))

    def test_grow_by_one_adds_exactly_one_pixel_ring(self):
        mask = torch.zeros((1, 9, 9), dtype=torch.float32)
        mask[:, 4, 4] = 1.0
        grown = grow_shrink_mask(mask, 1)
        self.assertEqual(int(grown.sum()), 9)


class FillHolesTests(unittest.TestCase):
    def test_enclosed_hole_is_filled_but_outside_stays_empty(self):
        filled = fill_mask_holes(donut_mask())
        self.assertTrue(torch.all(filled[:, 6:10, 6:10] == 1.0))
        self.assertTrue(torch.all(filled[:, 0:2] == 0.0))

    def test_torch_fallback_matches_expected_fill(self):
        solid = donut_mask() >= 0.5
        filled = _torch_fill_holes(solid)
        self.assertTrue(bool(filled[:, 7, 7].all()))
        self.assertFalse(bool(filled[:, 0, 0].any()))

    def test_border_connected_gap_is_not_treated_as_a_hole(self):
        opened = donut_mask()
        opened[:, 0:8, 8] = 0.0  # cut a channel from the top edge into the hole
        filled = fill_mask_holes(opened)
        self.assertEqual(float(filled[:, 7, 8]), 0.0)  # inside the (now open) gap
        self.assertEqual(float(filled[:, 1, 8]), 0.0)  # the channel itself


class BlurAndRefineTests(unittest.TestCase):
    def test_blur_softens_edges_and_stays_in_range(self):
        mask = torch.zeros((1, 16, 16), dtype=torch.float32)
        mask[:, :, 8:] = 1.0
        blurred = blur_mask(mask, 2.0)
        self.assertGreater(float(blurred[:, 8, 7]), 0.0)
        self.assertLess(float(blurred[:, 8, 8]), 1.0)
        self.assertGreaterEqual(float(blurred.min()), 0.0)
        self.assertLessEqual(float(blurred.max()), 1.0)
        self.assertTrue(torch.equal(blur_mask(mask, 0.0), mask))

    def test_refine_returns_mask_and_exact_inverse_and_accepts_2d(self):
        mask2d = torch.zeros((10, 10), dtype=torch.float32)
        mask2d[2:6, 2:6] = 1.0
        refined, inverted = refine_mask(mask2d, 1, 1.5, True)
        self.assertEqual(tuple(refined.shape), (1, 10, 10))
        self.assertTrue(torch.allclose(refined + inverted, torch.ones_like(refined)))

    def test_refine_rejects_wrong_rank(self):
        with self.assertRaisesRegex(ValueError, "BHW"):
            refine_mask(torch.zeros((1, 1, 4, 4)), 0, 0.0, False)


if __name__ == "__main__":
    unittest.main()
