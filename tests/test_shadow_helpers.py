from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._shadow_helpers import drop_shadow, shift_mask


def flat_image(batch: int, height: int, width: int, value: float = 0.5) -> torch.Tensor:
    return torch.full((batch, height, width, 3), value, dtype=torch.float32)


def box_mask(height: int, width: int, y0: int, y1: int, x0: int, x1: int) -> torch.Tensor:
    mask = torch.zeros((1, height, width), dtype=torch.float32)
    mask[:, y0:y1, x0:x1] = 1.0
    return mask


class ShiftMaskTests(unittest.TestCase):
    def test_positive_offset_moves_right_and_down(self):
        mask = box_mask(20, 20, 4, 8, 4, 8)
        shifted = shift_mask(mask, 6, 4)
        expected = box_mask(20, 20, 8, 12, 10, 14)
        self.assertTrue(torch.equal(shifted, expected))

    def test_negative_offset_moves_left_and_up(self):
        mask = box_mask(20, 20, 8, 12, 8, 12)
        shifted = shift_mask(mask, -3, -5)
        expected = box_mask(20, 20, 3, 7, 5, 9)
        self.assertTrue(torch.equal(shifted, expected))

    def test_offset_clips_at_the_frame_border(self):
        mask = box_mask(10, 10, 6, 10, 6, 10)
        shifted = shift_mask(mask, 6, 6)
        self.assertEqual(float(shifted.sum()), 0.0)
        partial = shift_mask(mask, 2, 0)
        self.assertTrue(torch.equal(partial, box_mask(10, 10, 6, 10, 8, 10)))

    def test_zero_offset_is_identity(self):
        mask = box_mask(8, 8, 2, 5, 2, 5)
        self.assertTrue(torch.equal(shift_mask(mask, 0, 0), mask))


class DropShadowTests(unittest.TestCase):
    def test_offset_geometry_with_a_hard_shadow(self):
        image = flat_image(1, 24, 24)
        mask = box_mask(24, 24, 4, 10, 4, 10)
        out, _ = drop_shadow(image, mask, 6, 4, 0, 0, "red", 1.0)
        red = torch.tensor([1.0, 0.0, 0.0])
        # Shadow region = shifted box minus the subject box.
        self.assertTrue(torch.allclose(out[0, 12, 12], red))  # pure shadow
        self.assertTrue(torch.equal(out[0, 5, 5], image[0, 5, 5]))  # subject
        self.assertTrue(torch.equal(out[0, 20, 20], image[0, 20, 20]))  # untouched
        # Overlap of shifted box and subject stays subject (never shadowed).
        self.assertTrue(torch.equal(out[0, 9, 9], image[0, 9, 9]))

    def test_opacity_zero_is_a_bit_exact_passthrough(self):
        image = torch.rand((1, 16, 16, 3), generator=torch.Generator().manual_seed(1))
        mask = box_mask(16, 16, 4, 8, 4, 8)
        out, _ = drop_shadow(image, mask, 5, 5, 2, 4, "#000000", 0.0)
        self.assertTrue(torch.equal(out, image))

    def test_shadow_never_covers_the_subject(self):
        image = torch.rand((1, 32, 32, 3), generator=torch.Generator().manual_seed(2))
        mask = box_mask(32, 32, 8, 20, 8, 20)
        # Zero offset with heavy grow and blur floods around the subject.
        out, _ = drop_shadow(image, mask, 0, 0, 6, 8, "#000000", 1.0)
        inside = mask[0] >= 1.0
        self.assertTrue(torch.equal(out[0][inside], image[0][inside]))
        # But the ring right outside the subject did darken.
        self.assertFalse(torch.equal(out[0, 6, 14], image[0, 6, 14]))

    def test_untouched_pixels_are_bit_identical(self):
        image = torch.rand((1, 40, 40, 3), generator=torch.Generator().manual_seed(3))
        mask = box_mask(40, 40, 10, 16, 10, 16)
        out, _ = drop_shadow(image, mask, 4, 4, 1, 2, "#202020", 0.8)
        # Far corner: no shadow reach at all.
        self.assertTrue(torch.equal(out[:, 30:, 30:], image[:, 30:, 30:]))
        self.assertTrue(torch.equal(out[:, :4, :4], image[:, :4, :4]))

    def test_half_opacity_lands_halfway(self):
        image = flat_image(1, 16, 16, 0.8)
        mask = box_mask(16, 16, 2, 6, 2, 6)
        out, _ = drop_shadow(image, mask, 4, 4, 0, 0, "#000000", 0.5)
        # Pure shadow pixel: lerp(0.8, 0.0, 0.5) = 0.4.
        self.assertTrue(torch.allclose(out[0, 9, 9], torch.full((3,), 0.4)))

    def test_blur_produces_a_soft_edge(self):
        image = flat_image(1, 32, 32)
        mask = box_mask(32, 32, 8, 16, 8, 16)
        out, _ = drop_shadow(image, mask, 8, 8, 0, 4, "#000000", 1.0)
        shadowed = image[..., 0] - out[..., 0]
        soft = (shadowed > 0.01) & (shadowed < 0.45)
        self.assertTrue(bool(soft.any()))

    def test_multiply_blend_scales_the_backdrop_by_the_color(self):
        image = flat_image(1, 16, 16, 0.8)
        mask = box_mask(16, 16, 2, 6, 2, 6)
        out, _ = drop_shadow(image, mask, 4, 4, 0, 0, "#808080", 1.0, "multiply")
        # Full-alpha multiply by mid-gray: 0.8 * (128/255) ~= 0.4016.
        expected = 0.8 * (128.0 / 255.0)
        self.assertTrue(
            torch.allclose(out[0, 9, 9], torch.full((3,), expected), atol=1e-4)
        )
        # Untouched pixels stay bit-identical in multiply mode too.
        self.assertTrue(torch.equal(out[:, 12:, 12:], image[:, 12:, 12:]))

    def test_unknown_blend_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "blend"):
            drop_shadow(
                flat_image(1, 8, 8),
                box_mask(8, 8, 2, 4, 2, 4),
                1,
                1,
                0,
                0,
                "#000000",
                1.0,
                "screen",
            )

    def test_shadow_mask_reports_the_effective_alpha(self):
        image = flat_image(1, 24, 24)
        mask = box_mask(24, 24, 4, 10, 4, 10)
        out, shadow_mask = drop_shadow(image, mask, 6, 4, 0, 0, "#000000", 0.5)
        self.assertEqual(tuple(shadow_mask.shape), (1, 24, 24))
        # Pure shadow pixel carries the opacity; subject and far pixels are 0.
        self.assertAlmostEqual(float(shadow_mask[0, 12, 12]), 0.5, places=5)
        self.assertEqual(float(shadow_mask[0, 5, 5]), 0.0)
        self.assertEqual(float(shadow_mask[0, 20, 20]), 0.0)
        # Zero opacity reports an all-zero mask.
        _, empty = drop_shadow(image, mask, 6, 4, 0, 0, "#000000", 0.0)
        self.assertEqual(float(empty.sum()), 0.0)

    def test_mask_broadcasts_across_the_batch(self):
        image = torch.rand((3, 16, 16, 3), generator=torch.Generator().manual_seed(4))
        mask = box_mask(16, 16, 4, 8, 4, 8)
        out, _ = drop_shadow(image, mask, 3, 3, 0, 1, "#000000", 0.7)
        self.assertEqual(out.shape, image.shape)
        solo, _ = drop_shadow(image[1:2], mask, 3, 3, 0, 1, "#000000", 0.7)
        # Convolution kernels can accumulate in a slightly different order
        # for batch 3 versus batch 1, so compare the broadcast result at
        # normal float32 precision rather than demanding bit identity.
        self.assertTrue(torch.allclose(out[1:2], solo, atol=1e-7, rtol=1e-6))

    def test_shape_mismatches_are_rejected(self):
        with self.assertRaises(ValueError):
            drop_shadow(flat_image(1, 16, 16), box_mask(8, 8, 0, 4, 0, 4), 1, 1, 0, 0)
        with self.assertRaises(ValueError):
            drop_shadow(
                flat_image(2, 16, 16),
                torch.zeros((3, 16, 16)),
                1, 1, 0, 0,
            )


class NodeWiringTests(unittest.TestCase):
    def test_node_mapping_and_execution(self):
        from nodes.node_drop_shadow import (
            NODE_CLASS_MAPPINGS,
            NODE_DISPLAY_NAME_MAPPINGS,
        )

        self.assertIn("AUSBOSS_NODES_DropShadow", NODE_CLASS_MAPPINGS)
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_DropShadow"],
            "Drop Shadow 🆎",
        )
        cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_DropShadow"]
        self.assertIn("AusBoss/Image", cls.CATEGORY)
        self.assertEqual(cls.RETURN_TYPES, ("IMAGE", "MASK"))
        image = flat_image(1, 16, 16)
        mask = box_mask(16, 16, 4, 8, 4, 8)
        result = getattr(cls(), cls.FUNCTION)(
            image=image,
            mask=mask,
            offset_x=2,
            offset_y=2,
            grow=0,
            blur=0,
            shadow_color="#000000",
            opacity=0.0,
        )
        self.assertEqual(len(result), 2)
        self.assertTrue(torch.equal(result[0], image))
        self.assertEqual(float(result[1].sum()), 0.0)


if __name__ == "__main__":
    unittest.main()
