"""Offline tests for Align Image and Image Size."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._align_helpers import ALIGN_MODES, align_image, aligned_size
from nodes.node_align_image import AusBossAlignImage
from nodes.node_image_size import AusBossImageSize


class AlignedSizeTests(unittest.TestCase):
    def test_crop_rounds_down_pad_rounds_up_resize_rounds_nearest(self):
        # 1000 / 16 = 62.5: down 992, up 1008, nearest ties-up 1008.
        self.assertEqual(aligned_size(1000, 1000, 16, "crop"), (992, 992))
        self.assertEqual(aligned_size(1000, 1000, 16, "pad"), (1008, 1008))
        self.assertEqual(aligned_size(1000, 1000, 16, "resize"), (1008, 1008))
        # 1030 is nearer 1024 than 1040.
        self.assertEqual(aligned_size(1030, 500, 16, "resize"), (1024, 496))

    def test_already_aligned_sizes_pass_through_every_mode(self):
        for mode in ALIGN_MODES:
            self.assertEqual(aligned_size(1024, 768, 32, mode), (1024, 768))

    def test_a_side_smaller_than_one_multiple_snaps_up_to_one(self):
        # Nothing can crop below the smallest legal size.
        for mode in ALIGN_MODES:
            self.assertEqual(aligned_size(20, 100, 32, mode)[0], 32, mode)

    def test_multiple_one_changes_nothing(self):
        for mode in ALIGN_MODES:
            self.assertEqual(aligned_size(1013, 777, 1, mode), (1013, 777))

    def test_unknown_mode_raises(self):
        with self.assertRaises(ValueError):
            aligned_size(100, 100, 16, "stretch")


def ramp(batch: int, height: int, width: int) -> torch.Tensor:
    """A BHWC batch whose pixel values encode their own x coordinate."""
    xs = torch.arange(width, dtype=torch.float32) / max(1, width - 1)
    return xs.view(1, 1, -1, 1).expand(batch, height, width, 3).clone()


class AlignImageTests(unittest.TestCase):
    def test_resize_hits_the_nearest_multiple(self):
        out, width, height, ox, oy = align_image(ramp(2, 500, 1000), 16, "resize")
        self.assertEqual((width, height), (1008, 496))
        self.assertEqual(tuple(out.shape), (2, 496, 1008, 3))
        self.assertEqual((ox, oy), (0, 0))

    def test_crop_is_centered_and_lossless_in_the_kept_region(self):
        frames = ramp(1, 100, 100)
        out, width, height, ox, oy = align_image(frames, 32, "crop")
        self.assertEqual((width, height), (96, 96))
        # Center crop of 100 -> 96 drops 2 columns each side.
        self.assertTrue(torch.equal(out, frames[:, 2:98, 2:98, :]))
        # The original's corner now sits 2 px outside the output.
        self.assertEqual((ox, oy), (-2, -2))

    def test_pad_replicates_edges_up_to_the_next_multiple(self):
        frames = ramp(1, 100, 100)
        out, width, height, ox, oy = align_image(frames, 32, "pad")
        self.assertEqual((width, height), (128, 128))
        # 28 extra pixels split 14/14; the original sits centered, untouched.
        self.assertTrue(torch.equal(out[:, 14:114, 14:114, :], frames))
        # The offsets point exactly at where the original landed.
        self.assertEqual((ox, oy), (14, 14))
        self.assertTrue(
            torch.equal(out[:, oy : oy + 100, ox : ox + 100, :], frames)
        )
        # Padding replicates the border, so corners equal the corner pixel.
        self.assertTrue(torch.equal(out[0, 0, 0], frames[0, 0, 0]))
        self.assertTrue(torch.equal(out[0, -1, -1], frames[0, -1, -1]))

    def test_already_aligned_input_is_returned_as_the_same_object(self):
        frames = ramp(1, 64, 128)
        out, width, height, _ox, _oy = align_image(frames, 32, "crop")
        self.assertIs(out, frames)
        self.assertEqual((width, height), (128, 64))

    def test_crop_mode_pads_a_side_it_cannot_crop(self):
        # 20 px wide with multiple 32: crop cannot reach a multiple below,
        # so that side replicate-pads up to exactly one multiple.
        out, width, height, ox, oy = align_image(ramp(1, 100, 20), 32, "crop")
        self.assertEqual((width, height), (32, 96))
        self.assertEqual(tuple(out.shape), (1, 96, 32, 3))
        # Mixed axes: the padded side is positive, the cropped side negative.
        self.assertEqual((ox, oy), (6, -2))

    def test_batch_and_values_survive(self):
        frames = ramp(3, 40, 40)
        out, _w, _h, _ox, _oy = align_image(frames, 16, "pad")
        self.assertEqual(out.shape[0], 3)
        self.assertGreaterEqual(float(out.min()), 0.0)
        self.assertLessEqual(float(out.max()), 1.0)

    def test_rejects_non_bhwc_input(self):
        with self.assertRaises(ValueError):
            align_image(torch.zeros((64, 64, 3)), 16, "resize")


class AlignImageNodeTests(unittest.TestCase):
    def test_node_returns_image_size_and_offsets(self):
        node = AusBossAlignImage()
        out, width, height, ox, oy = node.align(ramp(1, 100, 100), 32, "pad")
        self.assertEqual((width, height), (128, 128))
        self.assertEqual(tuple(out.shape), (1, 128, 128, 3))
        self.assertEqual((ox, oy), (14, 14))
        for value in (width, height, ox, oy):
            self.assertIsInstance(value, int)

    def test_mode_choices_match_the_helper(self):
        widget = AusBossAlignImage.INPUT_TYPES()["required"]["mode"][0]
        self.assertEqual(tuple(widget), ALIGN_MODES)


class ImageSizeNodeTests(unittest.TestCase):
    def test_reports_width_height_and_both_edges(self):
        node = AusBossImageSize()
        self.assertEqual(node.measure(torch.zeros((2, 480, 832, 3))), (832, 480, 832, 480))
        self.assertEqual(node.measure(torch.zeros((1, 1080, 608, 3))), (608, 1080, 1080, 608))

    def test_square_images_agree_on_both_edges(self):
        node = AusBossImageSize()
        self.assertEqual(node.measure(torch.zeros((1, 512, 512, 3))), (512, 512, 512, 512))

    def test_rejects_non_bhwc_input(self):
        with self.assertRaises(ValueError):
            AusBossImageSize().measure(torch.zeros((512, 512)))


if __name__ == "__main__":
    unittest.main()
