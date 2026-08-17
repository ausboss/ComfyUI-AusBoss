from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._color_helpers import lab_to_rgb, match_colors, rgb_to_lab


def rand_image(batch: int, height: int, width: int, seed: int = 0) -> torch.Tensor:
    generator = torch.Generator().manual_seed(seed)
    return torch.rand((batch, height, width, 3), generator=generator, dtype=torch.float32)


def box_mask(height: int, width: int, y0: int, y1: int, x0: int, x1: int) -> torch.Tensor:
    mask = torch.zeros((1, height, width), dtype=torch.float32)
    mask[:, y0:y1, x0:x1] = 1.0
    return mask


class LabConversionTests(unittest.TestCase):
    def test_round_trip_is_close(self):
        image = rand_image(1, 32, 32, seed=1)
        out = lab_to_rgb(rgb_to_lab(image))
        self.assertTrue(torch.allclose(out, image, atol=2e-3))

    def test_known_anchors(self):
        anchors = torch.tensor(
            [[[[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]]]], dtype=torch.float32
        )
        lab = rgb_to_lab(anchors)
        # Black is L=0, white is L=100; both are neutral (a and b near 0).
        self.assertLess(abs(float(lab[0, 0, 0, 0])), 1e-3)
        self.assertLess(abs(float(lab[0, 0, 1, 0]) - 100.0), 1e-2)
        self.assertTrue(bool((lab[..., 1:].abs() < 1e-2).all()))
        # Pure red must carry positive a (red-green axis).
        red = rgb_to_lab(torch.tensor([[[[1.0, 0.0, 0.0]]]]))
        self.assertGreater(float(red[0, 0, 0, 1]), 50.0)


class MatchColorsTests(unittest.TestCase):
    def test_identity_reference_is_nearly_unchanged(self):
        image = rand_image(1, 48, 48, seed=2)
        out = match_colors(image, image, 1.0)
        self.assertTrue(torch.allclose(out, image, atol=5e-3))

    def test_strength_zero_is_bit_exact_passthrough(self):
        image = rand_image(1, 32, 32, seed=3)
        reference = rand_image(1, 32, 32, seed=4) * 0.5
        out = match_colors(image, reference, 0.0)
        self.assertTrue(torch.equal(out, image))

    def test_gray_world_shift_is_corrected(self):
        base = rand_image(1, 64, 64, seed=5) * 0.6 + 0.2
        shifted = base.clone()
        shifted[..., 0] = (shifted[..., 0] + 0.15).clamp(0.0, 1.0)  # warm cast
        out = match_colors(shifted, base, 1.0)
        # The matched image's channel means land near the reference means.
        for channel in range(3):
            self.assertLess(
                abs(float(out[..., channel].mean() - base[..., channel].mean())),
                0.02,
            )
        # And the fix moved the red channel back down substantially.
        self.assertLess(
            abs(float(out[..., 0].mean() - base[..., 0].mean())),
            abs(float(shifted[..., 0].mean() - base[..., 0].mean())) / 3.0,
        )

    def test_partial_strength_lands_between(self):
        base = rand_image(1, 32, 32, seed=6) * 0.5 + 0.25
        shifted = (base + 0.2).clamp(0.0, 1.0)
        full = match_colors(shifted, base, 1.0)
        half = match_colors(shifted, base, 0.5)
        expected = shifted + 0.5 * (full - shifted)
        self.assertTrue(torch.allclose(half, expected, atol=1e-5))

    def test_mask_restricts_stats_and_application(self):
        image = rand_image(1, 40, 40, seed=7) * 0.5
        image[:, 10:30, 10:30] = (image[:, 10:30, 10:30] + 0.3).clamp(0.0, 1.0)
        reference = rand_image(1, 40, 40, seed=8) * 0.5
        mask = box_mask(40, 40, 10, 30, 10, 30)
        out = match_colors(image, reference, 1.0, mask)
        # Outside the mask: bit-identical.
        self.assertTrue(torch.equal(out[:, :10], image[:, :10]))
        self.assertTrue(torch.equal(out[:, 30:], image[:, 30:]))
        self.assertTrue(torch.equal(out[:, :, :10], image[:, :, :10]))
        self.assertTrue(torch.equal(out[:, :, 30:], image[:, :, 30:]))
        # Inside the mask: actually corrected toward the reference stats.
        self.assertFalse(torch.equal(out[:, 10:30, 10:30], image[:, 10:30, 10:30]))
        inside = out[:, 10:30, 10:30]
        for channel in range(3):
            self.assertLess(
                abs(float(inside[..., channel].mean() - reference[..., channel].mean())),
                0.05,
            )

    def test_empty_mask_is_a_clean_passthrough(self):
        image = rand_image(1, 24, 24, seed=9)
        reference = rand_image(1, 24, 24, seed=10)
        mask = torch.zeros((1, 24, 24), dtype=torch.float32)
        out = match_colors(image, reference, 1.0, mask)
        self.assertTrue(torch.equal(out, image))
        self.assertFalse(bool(out.isnan().any()))

    def test_flat_image_region_does_not_explode(self):
        image = torch.full((1, 16, 16, 3), 0.5, dtype=torch.float32)
        reference = rand_image(1, 16, 16, seed=11)
        out = match_colors(image, reference, 1.0)
        self.assertFalse(bool(out.isnan().any()))
        self.assertTrue(bool((out >= 0.0).all() and (out <= 1.0).all()))

    def test_reference_batch_one_broadcasts(self):
        image = rand_image(3, 24, 24, seed=12)
        reference = rand_image(1, 24, 24, seed=13)
        out = match_colors(image, reference, 1.0)
        self.assertEqual(out.shape, image.shape)
        # Each frame is matched independently against the same reference.
        solo = match_colors(image[1:2], reference, 1.0)
        self.assertTrue(torch.allclose(out[1:2], solo, atol=1e-6))

    def test_mismatched_reference_batch_is_rejected(self):
        with self.assertRaises(ValueError):
            match_colors(rand_image(3, 16, 16), rand_image(2, 16, 16), 1.0)

    def test_mismatched_mask_is_rejected(self):
        with self.assertRaises(ValueError):
            match_colors(
                rand_image(1, 16, 16),
                rand_image(1, 16, 16),
                1.0,
                torch.zeros((1, 8, 8)),
            )


class NodeWiringTests(unittest.TestCase):
    def test_node_mapping_and_execution(self):
        from nodes.node_color_match import (
            NODE_CLASS_MAPPINGS,
            NODE_DISPLAY_NAME_MAPPINGS,
        )

        self.assertIn("AUSBOSS_NODES_ColorMatch", NODE_CLASS_MAPPINGS)
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_ColorMatch"],
            "Color Match 🆎",
        )
        cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_ColorMatch"]
        self.assertIn("AusBoss/Image", cls.CATEGORY)
        self.assertEqual(cls.RETURN_TYPES, ("IMAGE",))
        image = rand_image(1, 24, 24, seed=20)
        result = getattr(cls(), cls.FUNCTION)(
            image=image, reference=image, strength=0.0
        )
        self.assertEqual(len(result), 1)
        self.assertTrue(torch.equal(result[0], image))


if __name__ == "__main__":
    unittest.main()
