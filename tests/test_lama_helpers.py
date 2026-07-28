from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._lama_helpers import inpaint_with_model


class WhiteHoleModel(torch.nn.Module):
    def forward(self, image, mask):
        return image * (1.0 - mask) + torch.ones_like(image) * mask


class NonFiniteModel(torch.nn.Module):
    def forward(self, image, _mask):
        return torch.full_like(image, float("nan"))


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

    def test_empty_mask_returns_input_without_running_model(self):
        images = torch.rand((1, 8, 8, 3), dtype=torch.float32)
        output = inpaint_with_model(
            images, torch.zeros((1, 8, 8)), NonFiniteModel(), torch.device("cpu")
        )
        self.assertTrue(torch.equal(output, images))

    def test_rejects_ambiguous_mask_batch(self):
        with self.assertRaisesRegex(ValueError, "one mask"):
            inpaint_with_model(
                torch.zeros((3, 8, 8, 3)),
                torch.zeros((2, 8, 8)),
                WhiteHoleModel(),
                torch.device("cpu"),
            )

    def test_rejects_non_finite_model_output(self):
        with self.assertRaisesRegex(RuntimeError, "non-finite"):
            inpaint_with_model(
                torch.zeros((1, 8, 8, 3)),
                torch.ones((1, 8, 8)),
                NonFiniteModel(),
                torch.device("cpu"),
            )


if __name__ == "__main__":
    unittest.main()
