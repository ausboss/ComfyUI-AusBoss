from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

import math

from nodes._pad_helpers import (
    PAD_MODES,
    _LOWRES_BLUR_MIN_SIGMA,
    _SIGMA_DIVISOR,
    _blur_image,
    _resize_image,
    pad_image,
)


def rand_image(batch: int, height: int, width: int, seed: int = 0) -> torch.Tensor:
    generator = torch.Generator().manual_seed(seed)
    return torch.rand((batch, height, width, 3), generator=generator, dtype=torch.float32)


PADS = (3, 5, 2, 4)  # left, top, right, bottom


class MaskContractTests(unittest.TestCase):
    def test_every_mode_shares_the_geometry_and_mask_contract(self):
        image = rand_image(2, 16, 20, seed=1)
        left, top, right, bottom = PADS
        for mode in PAD_MODES:
            with self.subTest(mode=mode):
                out, mask = pad_image(image, left, top, right, bottom, mode)
                self.assertEqual(out.shape, (2, 16 + top + bottom, 20 + left + right, 3))
                self.assertEqual(mask.shape, (2, 16 + top + bottom, 20 + left + right))
                # Original region: bit-identical image, zero mask.
                self.assertTrue(
                    torch.equal(out[:, top : top + 16, left : left + 20, :], image)
                )
                inner = mask[:, top : top + 16, left : left + 20]
                self.assertEqual(float(inner.sum()), 0.0)
                # Padding: mask is exactly 1 everywhere else.
                total = mask.numel() - inner.numel()
                self.assertEqual(float(mask.sum()), float(total))

    def test_zero_padding_is_a_passthrough_with_an_empty_mask(self):
        image = rand_image(1, 8, 8, seed=2)
        out, mask = pad_image(image, 0, 0, 0, 0, "edge")
        self.assertTrue(torch.equal(out, image))
        self.assertEqual(float(mask.sum()), 0.0)

    def test_unknown_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            pad_image(rand_image(1, 8, 8), 1, 1, 1, 1, "mirror")


class ColorModeTests(unittest.TestCase):
    def test_padding_takes_the_parsed_fill_color(self):
        image = rand_image(1, 8, 8, seed=3)
        out, _ = pad_image(image, 2, 2, 2, 2, "color", fill_color="teal")
        expected = torch.tensor([0.0, 128 / 255.0, 128 / 255.0])
        self.assertTrue(torch.allclose(out[0, 0, 0], expected))
        self.assertTrue(torch.allclose(out[0, -1, -1], expected))
        self.assertTrue(torch.allclose(out[0, 0, 5], expected))


class EdgeModeTests(unittest.TestCase):
    def test_sides_take_the_edge_average_and_corners_blend(self):
        image = rand_image(1, 10, 12, seed=4)
        left, top, right, bottom = PADS
        out, _ = pad_image(image, left, top, right, bottom, "edge")
        top_color = image[0, 0, :, :].mean(dim=0)
        left_color = image[0, :, 0, :].mean(dim=0)
        bottom_color = image[0, -1, :, :].mean(dim=0)
        right_color = image[0, :, -1, :].mean(dim=0)
        # Side bands are flat fills of the adjacent edge average.
        self.assertTrue(torch.allclose(out[0, 0, left + 3], top_color))
        self.assertTrue(torch.allclose(out[0, -1, left + 3], bottom_color))
        self.assertTrue(torch.allclose(out[0, top + 3, 0], left_color))
        self.assertTrue(torch.allclose(out[0, top + 3, -1], right_color))
        # Corner quadrants blend their two adjoining sides.
        self.assertTrue(torch.allclose(out[0, 0, 0], (top_color + left_color) / 2))
        self.assertTrue(torch.allclose(out[0, -1, -1], (bottom_color + right_color) / 2))


class EdgePixelModeTests(unittest.TestCase):
    def test_rows_and_cols_replicate_and_corners_take_the_corner_pixel(self):
        image = rand_image(1, 10, 12, seed=5)
        left, top, right, bottom = PADS
        out, _ = pad_image(image, left, top, right, bottom, "edge pixel")
        # Above the image, each column repeats the top source pixel of it.
        for j in (0, 5, 11):
            self.assertTrue(torch.equal(out[0, 0, left + j], image[0, 0, j]))
        # Left of the image, each row repeats its leftmost source pixel.
        for i in (0, 4, 9):
            self.assertTrue(torch.equal(out[0, top + i, 0], image[0, i, 0]))
        # Corner quadrants are the corner pixel.
        self.assertTrue(torch.equal(out[0, 0, 0], image[0, 0, 0]))
        self.assertTrue(torch.equal(out[0, 0, -1], image[0, 0, -1]))
        self.assertTrue(torch.equal(out[0, -1, 0], image[0, -1, 0]))
        self.assertTrue(torch.equal(out[0, -1, -1], image[0, -1, -1]))


class PillarboxBlurModeTests(unittest.TestCase):
    def test_backdrop_is_derived_from_the_image_not_a_flat_fill(self):
        rows = torch.linspace(0.0, 1.0, 24).view(1, 24, 1, 1)
        cols = torch.linspace(0.0, 1.0, 24).view(1, 1, 24, 1)
        image = (0.5 * rows + 0.5 * cols).expand(1, 24, 24, 3).clone()
        out, mask = pad_image(image, 12, 0, 12, 0, "pillarbox blur", backdrop_blur=0.5)
        self.assertEqual(out.shape, (1, 24, 48, 3))
        band = out[0, :, :12, :]
        # The band varies (it is image content), and stays dimmer than the
        # brightest source content because of the dim factor.
        self.assertGreater(float(band.max() - band.min()), 0.05)
        self.assertLessEqual(float(band.max()), 1.0 - 0.5 * 0.5 + 1e-4)
        self.assertFalse(bool(out.isnan().any()))
        self.assertEqual(float(mask[0, :, 12:36].sum()), 0.0)

    def test_zero_strength_keeps_the_backdrop_sharp_and_undimmed(self):
        image = rand_image(1, 16, 16, seed=6)
        out, _ = pad_image(image, 8, 0, 8, 0, "pillarbox blur", backdrop_blur=0.0)
        self.assertFalse(bool(out.isnan().any()))
        # No dimming at strength 0: the padding can reach source brightness.
        self.assertGreater(float(out[0, :, :8, :].max()), 0.5)

    def test_stronger_setting_blurs_more(self):
        generator = torch.Generator().manual_seed(7)
        image = torch.rand((1, 32, 32, 3), generator=generator)
        soft, _ = pad_image(image, 16, 0, 16, 0, "pillarbox blur", backdrop_blur=0.2)
        hard, _ = pad_image(image, 16, 0, 16, 0, "pillarbox blur", backdrop_blur=1.0)
        # More blur = less local variation in the backdrop band.
        self.assertLess(
            float(hard[0, :, :16, :].std()), float(soft[0, :, :16, :].std())
        )


class NodeWiringTests(unittest.TestCase):
    def test_node_mapping_and_execution(self):
        from nodes.node_pad_image import (
            NODE_CLASS_MAPPINGS,
            NODE_DISPLAY_NAME_MAPPINGS,
        )

        self.assertIn("AUSBOSS_NODES_PadImage", NODE_CLASS_MAPPINGS)
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_PadImage"],
            "Pad Image 🆎",
        )
        cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_PadImage"]
        self.assertIn("AusBoss/Image", cls.CATEGORY)
        self.assertEqual(cls.RETURN_TYPES, ("IMAGE", "MASK"))
        self.assertEqual(cls.RETURN_NAMES, ("image", "mask"))
        image = rand_image(1, 8, 8, seed=8)
        result = getattr(cls(), cls.FUNCTION)(
            image=image,
            pad_left=1,
            pad_top=2,
            pad_right=3,
            pad_bottom=4,
            mode="color",
            fill_color="#000000",
            backdrop_blur=0.5,
        )
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].shape, (1, 14, 12, 3))
        self.assertEqual(result[1].shape, (1, 14, 12))


if __name__ == "__main__":
    unittest.main()


class LowResBackdropBlurTests(unittest.TestCase):
    """A heavy pillarbox blur runs at quarter resolution; a light one stays on
    the exact full-resolution path."""

    def test_heavy_blur_matches_the_full_resolution_reference(self):
        torch.manual_seed(0)
        image = torch.rand((2, 96, 160, 3))
        out, _ = pad_image(image, 0, 120, 0, 120, "pillarbox blur", backdrop_blur=1.0)
        # Rebuild the old full-resolution backdrop for the padded band.
        canvas_h, canvas_w = 96 + 240, 160
        scale = max(canvas_w / 160, canvas_h / 96)
        sw = max(canvas_w, math.ceil(160 * scale))
        sh = max(canvas_h, math.ceil(96 * scale))
        backdrop = _resize_image(image, sw, sh)
        cx, cy = (sw - canvas_w) // 2, (sh - canvas_h) // 2
        backdrop = backdrop[:, cy : cy + canvas_h, cx : cx + canvas_w, :]
        sigma = min(canvas_h, canvas_w) / _SIGMA_DIVISOR
        self.assertGreaterEqual(sigma, _LOWRES_BLUR_MIN_SIGMA)  # heavy path taken
        reference = _blur_image(backdrop, sigma) * 0.5
        band = out[:, :120, :, :]
        self.assertLess(float((band - reference[:, :120, :, :]).abs().mean()), 0.01)

    def test_light_blur_stays_on_the_exact_path(self):
        torch.manual_seed(1)
        image = torch.rand((1, 40, 64, 3))
        # sigma = 0.2 * 56 / 16 = 0.7, far below the low-res threshold.
        sigma = 0.2 * min(40 + 16, 64) / _SIGMA_DIVISOR
        self.assertLess(sigma, _LOWRES_BLUR_MIN_SIGMA)
        out, _ = pad_image(image, 0, 8, 0, 8, "pillarbox blur", backdrop_blur=0.2)
        self.assertEqual(tuple(out.shape), (1, 56, 64, 3))
        # The padded band still derives from the picture, not a flat fill.
        band = out[:, :8, :, :]
        self.assertGreater(float(band.std()), 0.0)
