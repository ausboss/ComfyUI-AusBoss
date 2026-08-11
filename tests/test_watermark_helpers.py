from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._batch_helpers import select_one_based_frame
from nodes._lama_helpers import inpaint_with_model


class WhiteHoleModel(torch.nn.Module):
    def forward(self, image, mask):
        return image * (1.0 - mask) + torch.ones_like(image) * mask


class SelectFrameTests(unittest.TestCase):
    def test_one_based_selection_preserves_frame_and_batch_axis(self):
        frames = torch.stack(
            [torch.full((4, 5, 3), value, dtype=torch.float32) for value in (0.1, 0.5, 0.9)]
        )
        selected = select_one_based_frame(frames, 2)
        self.assertEqual(tuple(selected.shape), (1, 4, 5, 3))
        self.assertTrue(torch.equal(selected, frames[1:2]))

    def test_invalid_frame_number_reports_available_range(self):
        frames = torch.zeros((3, 4, 5, 3))
        for number in (0, 4):
            with self.subTest(number=number), self.assertRaisesRegex(
                ValueError, "frames 1 through 3"
            ):
                select_one_based_frame(frames, number)


class LaMaHelperTests(unittest.TestCase):
    def test_batch_shape_padding_mask_broadcast_and_unmasked_preservation(self):
        images = torch.zeros((2, 9, 10, 3), dtype=torch.float32)
        mask = torch.zeros((1, 9, 10), dtype=torch.float32)
        mask[:, 2:7, 3:8] = 1.0
        output = inpaint_with_model(images, mask, WhiteHoleModel(), torch.device("cpu"))
        self.assertEqual(tuple(output.shape), tuple(images.shape))
        self.assertTrue(torch.equal(output[:, :2], images[:, :2]))
        self.assertTrue(torch.all(output[:, 2:7, 3:8] == 1.0))
        self.assertTrue(torch.isfinite(output).all())

    def test_soft_mask_blends_and_rgba_channel_is_preserved(self):
        images = torch.zeros((1, 8, 8, 4), dtype=torch.float32)
        images[..., 3] = 0.25
        mask = torch.zeros((1, 8, 8), dtype=torch.float32)
        mask[:, 3, 3] = 0.4
        output = inpaint_with_model(images, mask, WhiteHoleModel(), torch.device("cpu"))
        self.assertAlmostEqual(float(output[0, 3, 3, 0]), 0.4, places=5)
        self.assertTrue(torch.all(output[..., 3] == 0.25))

    def test_mask_is_resized_to_the_image_and_2d_masks_are_accepted(self):
        images = torch.zeros((1, 16, 16, 3), dtype=torch.float32)
        mask = torch.zeros((8, 8), dtype=torch.float32)
        mask[2:6, 2:6] = 1.0
        output = inpaint_with_model(images, mask, WhiteHoleModel(), torch.device("cpu"))
        self.assertEqual(tuple(output.shape), tuple(images.shape))
        self.assertTrue(torch.all(output[:, 6:10, 6:10] == 1.0))
        self.assertTrue(torch.all(output[:, 0, 0] == 0.0))

    def test_rejects_ambiguous_mask_batch(self):
        with self.assertRaisesRegex(ValueError, "one mask"):
            inpaint_with_model(
                torch.zeros((3, 8, 8, 3)),
                torch.zeros((2, 8, 8)),
                WhiteHoleModel(),
                torch.device("cpu"),
            )


if __name__ == "__main__":
    unittest.main()
