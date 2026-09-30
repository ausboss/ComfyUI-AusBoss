"""A picture with no painted mask gets a plain message, wherever the mask lands.

Core Load Image hands out a 64x64 mask of zeros when the picture carries no
mask (no alpha channel), whatever the picture's size. That is what arrives
when someone forgets to paint one, and when they pick a new picture after
painting on the old one. It used to fail deep in the graph as "Mask size
(64, 64) does not match image size (...)".
"""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._color_helpers import match_colors  # noqa: E402
from nodes._inpaint_crop_helpers import build_crop  # noqa: E402
from nodes._lama_helpers import _normalized_masks  # noqa: E402
from nodes._mask_helpers import NO_MASK_PAINTED, is_unpainted_mask, mask_size_mismatch, refine_mask  # noqa: E402

PICTURE = torch.rand(1, 96, 128, 3)


def core_empty_mask(frames: int = 1) -> torch.Tensor:
    """What core Load Image returns for a picture with no mask."""
    return torch.zeros(frames, 64, 64)


class UnpaintedMaskTests(unittest.TestCase):
    def test_the_message_says_what_to_do(self):
        self.assertTrue(NO_MASK_PAINTED.startswith("No mask painted: "))
        self.assertIn("Open in MaskEditor", NO_MASK_PAINTED)
        NO_MASK_PAINTED.encode("ascii")  # logged to consoles that may be cp1252

    def test_only_the_empty_64x64_stand_in_counts(self):
        self.assertTrue(is_unpainted_mask(core_empty_mask()))
        self.assertTrue(is_unpainted_mask(core_empty_mask(4)), "an animated picture has one per frame")
        self.assertTrue(is_unpainted_mask(torch.zeros(64, 64)))
        painted = core_empty_mask()
        painted[0, 10, 10] = 1.0
        self.assertFalse(is_unpainted_mask(painted), "a real 64x64 mask")
        self.assertFalse(is_unpainted_mask(torch.zeros(1, 96, 128)), "an empty mask of the picture's own size")

    def test_crop_for_inpaint_explains_the_stand_in(self):
        with self.assertRaisesRegex(ValueError, "^No mask painted: "):
            build_crop(PICTURE, core_empty_mask(), 1.0, 16, 8)

    def test_a_mask_from_another_picture_names_both_sizes(self):
        other = torch.ones(1, 32, 48)
        with self.assertRaises(ValueError) as caught:
            build_crop(PICTURE, other, 1.0, 16, 8)
        self.assertEqual(str(caught.exception), mask_size_mismatch(other, 96, 128))
        self.assertTrue(str(caught.exception).startswith("The mask is 48x32 but the picture is 128x96."))

    def test_an_empty_mask_of_the_right_size_still_runs(self):
        # Crop For Inpaint's promise: nothing to paint selects the whole
        # picture and stitches back the original untouched.
        crop, _mask, _stitcher = build_crop(PICTURE, torch.zeros(1, 96, 128), 1.0, 16, 8)
        self.assertEqual(tuple(crop.shape[1:3]), (96, 128))

    def test_mask_refine_with_its_picture_explains_the_stand_in(self):
        with self.assertRaisesRegex(ValueError, "^No mask painted: "):
            refine_mask(core_empty_mask(), 4, 2.0, False, edge_refine="guided filter", guide_image=PICTURE)
        refined, _inverse = refine_mask(core_empty_mask(), 4, 2.0, False)
        self.assertEqual(tuple(refined.shape), (1, 64, 64), "without a picture it cannot tell, and passes it on")

    def test_lama_explains_the_stand_in_instead_of_painting_nothing(self):
        with self.assertRaisesRegex(ValueError, "^No mask painted: "):
            _normalized_masks(core_empty_mask(), 1, 96, 128)
        painted = torch.ones(1, 48, 64)
        self.assertEqual(tuple(_normalized_masks(painted, 1, 96, 128).shape), (1, 96, 128), "real masks still resize")

    def test_color_match_explains_the_stand_in(self):
        with self.assertRaisesRegex(ValueError, "^No mask painted: "):
            match_colors(PICTURE, PICTURE, 1.0, mask=core_empty_mask())


if __name__ == "__main__":
    unittest.main()
