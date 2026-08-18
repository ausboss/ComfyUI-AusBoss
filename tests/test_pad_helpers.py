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
    feather_pad_mask,
    pad_image,
    plan_pad_canvas,
    resolve_pad_geometry,
    round_up_to_multiple,
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
        self.assertEqual(cls.RETURN_TYPES, ("IMAGE", "MASK", "AUSBOSS_STITCHER"))
        self.assertEqual(cls.RETURN_NAMES, ("image", "mask", "stitcher"))
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
        self.assertEqual(len(result), 3)
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


class ResolvePadGeometryTests(unittest.TestCase):
    def test_multiple_remainder_lands_on_right_and_bottom(self):
        geometry = resolve_pad_geometry(10, 8, 1, 2, 3, 4, 16)
        self.assertEqual(
            geometry,
            {"left": 1, "top": 2, "right": 5, "bottom": 6, "width": 16, "height": 16},
        )

    def test_multiple_one_and_negatives_are_normalized(self):
        geometry = resolve_pad_geometry(10, 8, -5, 0, 3, 0, 1)
        self.assertEqual(
            geometry,
            {"left": 0, "top": 0, "right": 3, "bottom": 0, "width": 13, "height": 8},
        )
        self.assertEqual(round_up_to_multiple(0, 8), 0)
        self.assertEqual(round_up_to_multiple(1, 8), 8)
        self.assertEqual(round_up_to_multiple(16, 8), 16)

    def test_geometry_matches_the_frontend_pin(self):
        # The same numbers are pinned in tests/pad_canvas.test.mjs — the JS
        # mirror and this implementation must drift together or not at all.
        geometry = resolve_pad_geometry(800, 600, 10, 20, 30, 40, 8)
        self.assertEqual(
            geometry,
            {"left": 10, "top": 20, "right": 30, "bottom": 44, "width": 840, "height": 664},
        )


class PlanPadCanvasTests(unittest.TestCase):
    def test_target_off_is_a_passthrough(self):
        plan = plan_pad_canvas(800, 600, 10, 20, 30, 40, 8, 0.0)
        self.assertEqual(plan["scale"], 1.0)
        self.assertEqual((plan["source_width"], plan["source_height"]), (800, 600))
        self.assertEqual((plan["width"], plan["height"]), (840, 664))

    def test_megapixel_target_rescales_the_source_first(self):
        # Pinned against tests/pad_canvas.test.mjs finalOutputSize.
        plan = plan_pad_canvas(800, 600, 10, 20, 30, 40, 8, 1.0)
        self.assertAlmostEqual(plan["scale"], 1.3389868666385072, places=12)
        self.assertEqual((plan["source_width"], plan["source_height"]), (1071, 803))
        self.assertEqual((plan["width"], plan["height"]), (1128, 888))
        # The plan lands within multiple-rounding distance of the target.
        self.assertLess(abs(plan["width"] * plan["height"] / 1e6 - 1.0), 0.02)
        # Everything still rounds to the multiple after scaling.
        self.assertEqual(plan["width"] % 8, 0)
        self.assertEqual(plan["height"] % 8, 0)
        # The source was scaled, and the scaled pads add up to the canvas.
        self.assertEqual(plan["source_width"] + plan["left"] + plan["right"], plan["width"])
        self.assertEqual(plan["source_height"] + plan["top"] + plan["bottom"], plan["height"])


class FeatherPadMaskTests(unittest.TestCase):
    def build_mask(self):
        _, mask = pad_image(rand_image(1, 16, 20, seed=9), 3, 5, 2, 4, "color")
        return mask  # canvas 25 x 25, image at (3, 5) sized 20 x 16

    def test_zero_feather_returns_the_mask_untouched(self):
        mask = self.build_mask()
        self.assertTrue(torch.equal(feather_pad_mask(mask, 3, 5, 2, 4, 0), mask))

    def test_ramp_runs_inward_and_padding_stays_solid(self):
        mask = self.build_mask()
        out = feather_pad_mask(mask, 3, 5, 2, 4, 3)
        # Padding is untouched: fully 1 in the bands and corners.
        self.assertEqual(float(out[0, 0, 0]), 1.0)
        self.assertEqual(float(out[0, 2, 12]), 1.0)
        self.assertEqual(float(out[0, -1, -1]), 1.0)
        # Top ramp descends 0.75 / 0.5 / 0.25 into the image (col 12 is clear
        # of the left/right ramps).
        self.assertAlmostEqual(float(out[0, 5, 12]), 0.75, places=5)
        self.assertAlmostEqual(float(out[0, 6, 12]), 0.5, places=5)
        self.assertAlmostEqual(float(out[0, 7, 12]), 0.25, places=5)
        self.assertEqual(float(out[0, 8, 12]), 0.0)
        # Left ramp likewise, on a row clear of the top/bottom ramps.
        self.assertAlmostEqual(float(out[0, 10, 3]), 0.75, places=5)
        self.assertAlmostEqual(float(out[0, 10, 5]), 0.25, places=5)
        self.assertEqual(float(out[0, 10, 6]), 0.0)
        # Bottom ramp ascends back toward the padding.
        self.assertAlmostEqual(float(out[0, 20, 12]), 0.75, places=5)
        self.assertAlmostEqual(float(out[0, 18, 12]), 0.25, places=5)
        # The far interior stays clean.
        self.assertEqual(float(out[0, 12, 12]), 0.0)

    def test_unpadded_sides_are_not_feathered(self):
        _, mask = pad_image(rand_image(1, 16, 20, seed=10), 0, 0, 0, 6, "color")
        out = feather_pad_mask(mask, 0, 0, 0, 6, 4)
        # Only the bottom ramp exists: top rows and side columns stay 0.
        self.assertEqual(float(out[0, 0, :].sum()), 0.0)
        self.assertEqual(float(out[0, 2:12, 0].sum()), 0.0)
        self.assertGreater(float(out[0, 15, 10]), 0.0)

    def test_ramp_width_is_capped_by_the_image_dimension(self):
        mask = self.build_mask()
        out = feather_pad_mask(mask, 3, 5, 2, 4, 500)
        self.assertEqual(out.shape, mask.shape)
        # The whole image column is ramped but values stay in (0, 1].
        self.assertGreater(float(out[0, 12, 12]), 0.0)
        self.assertLessEqual(float(out.max()), 1.0)


class LoadImagePadNodeTests(unittest.TestCase):
    def make_node(self):
        from nodes.node_load_image_pad import (
            NODE_CLASS_MAPPINGS,
            NODE_DISPLAY_NAME_MAPPINGS,
        )

        self.assertIn("AUSBOSS_NODES_LoadImagePad", NODE_CLASS_MAPPINGS)
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_LoadImagePad"],
            "Load Image + Pad 🆎",
        )
        return NODE_CLASS_MAPPINGS["AUSBOSS_NODES_LoadImagePad"]

    def write_image(self, directory: str, width: int = 64, height: int = 48) -> str:
        from PIL import Image

        path = Path(directory) / "source.png"
        Image.new("RGB", (width, height), (30, 180, 90)).save(path)
        return str(path)

    def run_node(self, cls, image_path: str, **overrides):
        values = {
            "pad_left": 2,
            "pad_top": 3,
            "pad_right": 4,
            "pad_bottom": 5,
            "mode": "color",
            "fill_color": "#000000",
            "backdrop_blur": 0.5,
            "feather": 0,
            "canvas_multiple": 8,
            "target_megapixels": 0.0,
        }
        values.update(overrides)
        return getattr(cls(), cls.FUNCTION)(image=image_path, **values), values

    def test_contract_and_plain_padding(self):
        import tempfile

        cls = self.make_node()
        self.assertIn("AusBoss/Image", cls.CATEGORY)
        self.assertEqual(
            cls.RETURN_TYPES, ("IMAGE", "MASK", "INT", "INT", "AUSBOSS_STITCHER")
        )
        self.assertEqual(
            cls.RETURN_NAMES, ("image", "mask", "width", "height", "stitcher")
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp)
            (image, mask, width, height, _), _ = self.run_node(cls, path)
            self.assertEqual((width, height), (72, 56))  # 70x56 ceiled to 8
            self.assertEqual(tuple(image.shape), (1, 56, 72, 3))
            self.assertEqual(tuple(mask.shape), (1, 56, 72))
            # Hard mask, and the original lands intact at (2, 3).
            self.assertEqual(set(torch.unique(mask).tolist()), {0.0, 1.0})
            self.assertEqual(float(mask[0, 3 : 3 + 48, 2 : 2 + 64].sum()), 0.0)

    def test_megapixel_target_resizes_source_first_and_keeps_the_seam_hard(self):
        import tempfile

        cls = self.make_node()
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp)
            (image, mask, width, height, _), values = self.run_node(
                cls, path, target_megapixels=0.05
            )
            plan = plan_pad_canvas(64, 48, 2, 3, 4, 5, 8, 0.05)
            self.assertEqual((width, height), (plan["width"], plan["height"]))
            self.assertEqual(tuple(image.shape), (1, height, width, 3))
            self.assertLess(abs(width * height / 1e6 - 0.05), 0.01)
            # Source-first order: the mask's zero region is exactly the
            # RESIZED source rect, and the seam is still binary because the
            # padding happened after the resize.
            self.assertEqual(set(torch.unique(mask).tolist()), {0.0, 1.0})
            inner = mask[
                0,
                plan["top"] : plan["top"] + plan["source_height"],
                plan["left"] : plan["left"] + plan["source_width"],
            ]
            self.assertEqual(float(inner.sum()), 0.0)
            self.assertEqual(
                float(mask.sum()), float(mask.numel() - inner.numel())
            )

    def test_feather_softens_the_seam_but_not_the_padding(self):
        import tempfile

        cls = self.make_node()
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp)
            (_, mask, _, _, _), _ = self.run_node(cls, path, feather=6)
            values = torch.unique(mask).tolist()
            self.assertTrue(any(0.0 < value < 1.0 for value in values))
            self.assertEqual(float(mask[0, 0, 0]), 1.0)  # padding stays solid

    def test_validation_and_fingerprint(self):
        import tempfile

        cls = self.make_node()
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp)
            self.assertIs(cls.VALIDATE_INPUTS(image=path), True)
            missing = str(Path(tmp) / "gone.png")
            self.assertIn("Load Image + Pad", cls.VALIDATE_INPUTS(image=missing))
            first = cls.IS_CHANGED(image=path, pad_left=1, feather=0)
            second = cls.IS_CHANGED(image=path, pad_left=2, feather=0)
            self.assertIsInstance(first, str)
            self.assertNotEqual(first, second)
