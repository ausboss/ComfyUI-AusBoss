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


NO_TRIM = {"trim_left": 0, "trim_top": 0, "trim_right": 0, "trim_bottom": 0}


class ResolvePadGeometryTests(unittest.TestCase):
    def test_both_sides_padded_keeps_the_remainder_on_the_far_side(self):
        geometry = resolve_pad_geometry(10, 8, 1, 2, 3, 4, 16)
        self.assertEqual(
            geometry,
            {"left": 1, "top": 2, "right": 5, "bottom": 6, "width": 16, "height": 16, **NO_TRIM},
        )

    def test_multiple_one_and_negatives_are_normalized(self):
        geometry = resolve_pad_geometry(10, 8, -5, 0, 3, 0, 1)
        self.assertEqual(
            geometry,
            {"left": 0, "top": 0, "right": 3, "bottom": 0, "width": 13, "height": 8, **NO_TRIM},
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
            {"left": 10, "top": 20, "right": 30, "bottom": 44, "width": 840, "height": 664, **NO_TRIM},
        )

    def test_one_padded_side_takes_the_whole_remainder(self):
        # Pinned in tests/pad_canvas.test.mjs as well. 100 + 20 rounds to
        # 128 at 16, 100 + 30 to 192 at 64; the other axis is a multiple.
        cases = {
            (100, 64, 20, 0, 0, 0, 16): {"left": 28, "top": 0, "right": 0, "bottom": 0, "width": 128, "height": 64},
            (100, 64, 0, 0, 20, 0, 16): {"left": 0, "top": 0, "right": 28, "bottom": 0, "width": 128, "height": 64},
            (128, 100, 0, 30, 0, 0, 64): {"left": 0, "top": 92, "right": 0, "bottom": 0, "width": 128, "height": 192},
            (128, 100, 0, 0, 0, 30, 64): {"left": 0, "top": 0, "right": 0, "bottom": 92, "width": 128, "height": 192},
        }
        for args, expected in cases.items():
            with self.subTest(args=args):
                self.assertEqual(resolve_pad_geometry(*args), {**expected, **NO_TRIM})

    def test_an_axis_nobody_padded_trims_the_source_instead_of_growing_a_strip(self):
        # The published Krea 2 Outpaint case at source scale: top and bottom
        # padded, the 1130 px width left alone. It used to grow to 1136 with a
        # 6 px strip on the right; now the source loses 5 px on each side.
        self.assertEqual(
            resolve_pad_geometry(1130, 638, 0, 271, 0, 509, 16),
            {
                "left": 0, "top": 271, "right": 0, "bottom": 515, "width": 1120, "height": 1424,
                "trim_left": 5, "trim_top": 0, "trim_right": 5, "trim_bottom": 0,
            },
        )
        self.assertEqual(
            resolve_pad_geometry(1000, 750, 0, 0, 0, 0, 64),
            {
                "left": 0, "top": 0, "right": 0, "bottom": 0, "width": 960, "height": 704,
                "trim_left": 20, "trim_top": 23, "trim_right": 20, "trim_bottom": 23,
            },
        )
        # An odd trim puts the extra pixel on the far side, like Align Image.
        geometry = resolve_pad_geometry(1001, 64, 0, 0, 0, 0, 16)
        self.assertEqual((geometry["trim_left"], geometry["trim_right"], geometry["width"]), (4, 5, 992))

    def test_a_source_smaller_than_one_multiple_still_grows(self):
        # Nothing to trim down to: the width grows on the far side, while the
        # unpadded height above one multiple is trimmed as usual.
        self.assertEqual(
            resolve_pad_geometry(10, 750, 0, 0, 0, 0, 16),
            {
                "left": 0, "top": 0, "right": 6, "bottom": 0, "width": 16, "height": 736,
                "trim_left": 0, "trim_top": 7, "trim_right": 0, "trim_bottom": 7,
            },
        )

    def test_the_remainder_never_lands_on_an_edge_nobody_padded(self):
        import random

        rng = random.Random(7)
        for _ in range(3000):
            size = rng.randint(1, 3000)
            multiple = rng.choice([1, 8, 16, 64, rng.randint(2, 128)])
            before = rng.choice([0, 0, rng.randint(1, 500)])
            after = rng.choice([0, 0, rng.randint(1, 500)])
            geometry = resolve_pad_geometry(size, 64, before, 0, after, 0, multiple)
            left, right = geometry["left"], geometry["right"]
            trim_left, trim_right = geometry["trim_left"], geometry["trim_right"]
            with self.subTest(size=size, multiple=multiple, before=before, after=after):
                self.assertEqual(geometry["width"] % multiple, 0)
                self.assertEqual(size - trim_left - trim_right + left + right, geometry["width"])
                self.assertGreaterEqual(left, before)
                self.assertGreaterEqual(right, after)
                if before == 0 and left:
                    self.fail("the remainder landed on an unpadded left edge")
                if after == 0 and right and (before or size >= multiple):
                    self.fail("the remainder landed on an unpadded right edge")
                if before or after:
                    self.assertEqual((trim_left, trim_right), (0, 0))
                else:
                    self.assertLess(trim_left + trim_right, multiple)
                    self.assertIn(trim_right - trim_left, (0, 1))


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

    def test_target_off_trims_an_axis_nobody_padded(self):
        plan = plan_pad_canvas(1130, 638, 0, 271, 0, 509, 16, 0.0)
        self.assertEqual((plan["source_width"], plan["source_height"]), (1130, 638))
        self.assertEqual((plan["trim_left"], plan["trim_right"]), (5, 5))
        self.assertEqual((plan["left"], plan["right"], plan["width"]), (0, 0, 1120))

    def test_published_krea2_outpaint_canvas_has_no_strip(self):
        # The Krea 2 Outpaint workflow as published: a 2720x1536 photo padded
        # top and bottom at 16 and 1.6 MP. It used to place the source 1130
        # wide on an 1136 canvas, a 6 px strip on the right that nobody
        # padded. The width is now resized onto the multiple and sets the
        # scale for the height, so the photo spans the canvas at its own
        # shape. Pinned in tests/pad_canvas.test.mjs too.
        plan = plan_pad_canvas(2720, 1536, 0, 652, 0, 1212, 16, 1.6)
        self.assertEqual(plan["scale"], 1136 / 2720)
        self.assertEqual((plan["source_width"], plan["source_height"]), (1136, 642))
        self.assertEqual((plan["left"], plan["right"], plan["width"]), (0, 0, 1136))
        self.assertEqual((plan["top"], plan["bottom"], plan["height"]), (272, 510, 1424))
        self.assertEqual(
            (plan["trim_left"], plan["trim_top"], plan["trim_right"], plan["trim_bottom"]),
            (0, 0, 0, 0),
        )
        # The same at 64: still one scale for both axes.
        plan = plan_pad_canvas(2720, 1536, 0, 652, 0, 1212, 64, 1.6)
        self.assertEqual((plan["source_width"], plan["source_height"]), (1088, 614))
        self.assertEqual((plan["left"], plan["right"], plan["width"], plan["height"]), (0, 0, 1088, 1408))

    def test_one_padded_side_takes_the_remainder_after_the_resize(self):
        # A photo padded top and right: the height's remainder joins the top
        # now, where it used to add a 4 px strip along the unpadded bottom.
        plan = plan_pad_canvas(502, 634, 0, 240, 320, 0, 16, 1.6)
        self.assertEqual((plan["source_width"], plan["source_height"]), (742, 937))
        self.assertEqual((plan["top"], plan["bottom"], plan["height"]), (359, 0, 1296))
        self.assertEqual((plan["left"], plan["right"], plan["width"]), (0, 474, 1216))
        plan = plan_pad_canvas(502, 634, 0, 240, 320, 0, 64, 1.6)
        self.assertEqual((plan["top"], plan["bottom"], plan["height"]), (415, 0, 1344))
        self.assertEqual((plan["left"], plan["right"], plan["width"]), (0, 481, 1216))

    def test_a_side_under_half_a_multiple_is_not_snapped(self):
        # 20 px tall at 64: snapping it up to one multiple would more than
        # double the scale and the padded width with it. It keeps the budget
        # scale and grows on the far side instead.
        plan = plan_pad_canvas(2000, 20, 100, 0, 100, 0, 64, 0.25)
        self.assertEqual(plan["scale"], math.sqrt(0.25e6 / (2240 * 64)))
        self.assertEqual((plan["source_width"], plan["source_height"]), (2641, 26))
        self.assertEqual((plan["top"], plan["bottom"], plan["height"]), (0, 38, 64))
        self.assertEqual(plan["width"], 2944)

    def test_no_padding_snaps_each_side_like_align_image_resize(self):
        plan = plan_pad_canvas(1000, 750, 0, 0, 0, 0, 16, 1.0)
        self.assertEqual((plan["source_width"], plan["source_height"]), (1152, 864))
        self.assertEqual((plan["width"], plan["height"]), (1152, 864))
        self.assertEqual((plan["left"], plan["top"], plan["right"], plan["bottom"]), (0, 0, 0, 0))

    def test_target_on_never_leaves_a_strip_or_trim_on_an_unpadded_axis(self):
        import random

        rng = random.Random(11)
        for _ in range(2000):
            width, height = rng.randint(16, 4000), rng.randint(16, 4000)
            multiple = rng.choice([8, 16, 64])
            pads = [rng.choice([0, 0, rng.randint(40, 1500)]) for _ in range(4)]
            target = rng.choice([0.5, 1.0, 1.6, 4.0])
            plan = plan_pad_canvas(width, height, *pads, multiple, target)
            left, top, right, bottom = pads
            with self.subTest(size=(width, height), pads=pads, multiple=multiple, target=target):
                self.assertEqual(plan["width"] % multiple, 0)
                self.assertEqual(plan["height"] % multiple, 0)
                snapped = []
                for size, before, after, pad_before, pad_after in (
                    (plan["source_width"], plan["left"], plan["right"], left, right),
                    (plan["source_height"], plan["top"], plan["bottom"], top, bottom),
                ):
                    if pad_before + pad_after:
                        continue
                    if size % multiple == 0:
                        snapped.append(True)
                        self.assertEqual((before, after), (0, 0))
                    else:
                        # Under half a multiple at the budget scale: left
                        # alone and grown on the far side.
                        self.assertLess(size, multiple)
                        self.assertEqual(before, 0)
                self.assertEqual(
                    (plan["trim_left"], plan["trim_top"], plan["trim_right"], plan["trim_bottom"]),
                    (0, 0, 0, 0),
                )
                if snapped and (left + right == 0) != (top + bottom == 0):
                    # One unpadded axis sets a single scale: no stretch
                    # beyond the other side's half-pixel rounding.
                    aspect = width / height
                    self.assertAlmostEqual(
                        plan["source_width"] / plan["source_height"],
                        aspect,
                        delta=aspect / min(plan["source_width"], plan["source_height"]),
                    )


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


class FeatherCornerTests(unittest.TestCase):
    """Two padded sides meet without a crease: the ramps unite instead of
    taking their maximum, so the corner is bilinear."""

    def test_corner_is_the_union_of_the_two_ramps(self):
        _, mask = pad_image(rand_image(1, 16, 20, seed=11), 3, 5, 2, 4, "color")
        out = feather_pad_mask(mask, 3, 5, 2, 4, 3)
        # Row 5 is the first image row (top ramp 0.75), col 3 the first image
        # column (left ramp 0.75): union 1 - 0.25 * 0.25, not max 0.75.
        self.assertAlmostEqual(float(out[0, 5, 3]), 1.0 - 0.25 * 0.25, places=5)
        self.assertAlmostEqual(float(out[0, 6, 4]), 1.0 - 0.5 * 0.5, places=5)
        # Along a side the other ramp is 0, so nothing changes there.
        self.assertAlmostEqual(float(out[0, 5, 12]), 0.75, places=5)
        self.assertAlmostEqual(float(out[0, 10, 3]), 0.75, places=5)

    def test_corner_has_no_diagonal_crease(self):
        # With max(), stepping across the corner's diagonal flips which ramp
        # wins and the gradient jumps. With the union the value along the
        # diagonal is symmetric and the differences to its two neighbours
        # are equal - no crease to print.
        _, mask = pad_image(rand_image(1, 60, 60, seed=12), 20, 20, 20, 20, "color")
        out = feather_pad_mask(mask, 20, 20, 20, 20, 16)
        for step in range(1, 15):
            y, x = 20 + step, 20 + step
            self.assertAlmostEqual(float(out[0, y, x - 1]), float(out[0, y - 1, x]), places=5)
            self.assertLess(float(out[0, y, x]), float(out[0, y, x - 1]))


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
            cls.RETURN_TYPES,
            ("IMAGE", "MASK", "INT", "INT", "AUSBOSS_STITCHER", "IMAGE"),
        )
        self.assertEqual(
            cls.RETURN_NAMES,
            ("image", "mask", "width", "height", "stitcher", "reference"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp)
            (image, mask, width, height, _, _), _ = self.run_node(cls, path)
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
            (image, mask, width, height, _, _), values = self.run_node(
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
            (_, mask, _, _, _, _), _ = self.run_node(cls, path, feather=6)
            values = torch.unique(mask).tolist()
            self.assertTrue(any(0.0 < value < 1.0 for value in values))
            self.assertEqual(float(mask[0, 0, 0]), 1.0)  # padding stays solid

    def test_reference_is_the_unpadded_source_snapped_to_16(self):
        import tempfile

        cls = self.make_node()
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp)
            (_, _, _, _, _, reference), _ = self.run_node(cls, path)
            # 64x48 is already under the 384 cap and already /16.
            self.assertEqual(tuple(reference.shape), (1, 48, 64, 3))
            # It is the SOURCE, not the canvas: no padding colour in it.
            self.assertGreater(float(reference.min()), 0.0)

    def test_reference_downscales_a_large_source_to_a_multiple_of_16(self):
        import tempfile

        cls = self.make_node()
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp, width=1000, height=750)
            (_, _, _, _, _, reference), _ = self.run_node(cls, path)
            _batch, height, width, _channels = reference.shape
            self.assertLessEqual(max(width, height), 384)
            self.assertEqual(width % 16, 0)
            self.assertEqual(height % 16, 0)

    def test_stitcher_carries_where_the_source_sits(self):
        import tempfile

        cls = self.make_node()
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp)
            (_, mask, width, height, stitcher, _), _ = self.run_node(cls, path)
            # pad_left=2, pad_top=3 on a 64x48 source.
            self.assertEqual(stitcher["source_bbox"], (2, 3, 66, 51))
            x0, y0, x1, y1 = stitcher["bbox_normalized"]
            self.assertAlmostEqual(x0, 2 / width)
            self.assertAlmostEqual(y0, 3 / height)
            self.assertAlmostEqual(x1, 66 / width)
            self.assertAlmostEqual(y1, 51 / height)
            # The bbox is exactly the region the mask protects.
            inner = mask[0, 3:51, 2:66]
            self.assertEqual(float(inner.sum()), 0.0)
            self.assertEqual(float(mask.sum()), float(mask.numel() - inner.numel()))

    def test_bbox_tracks_the_megapixel_resize(self):
        import tempfile

        cls = self.make_node()
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write_image(tmp)
            (_, mask, _, _, stitcher, _), _ = self.run_node(
                cls, path, target_megapixels=0.05
            )
            plan = plan_pad_canvas(64, 48, 2, 3, 4, 5, 8, 0.05)
            x0, y0, x1, y1 = stitcher["source_bbox"]
            self.assertEqual((x0, y0), (plan["left"], plan["top"]))
            self.assertEqual(x1 - x0, plan["source_width"])
            self.assertEqual(y1 - y0, plan["source_height"])
            self.assertEqual(float(mask[0, y0:y1, x0:x1].sum()), 0.0)

    def test_an_edge_nobody_padded_stays_photo_through_the_stitch(self):
        import tempfile

        from PIL import Image

        from nodes._inpaint_crop_helpers import apply_stitch

        cls = self.make_node()
        generator = torch.Generator().manual_seed(21)
        pixels = (torch.rand((50, 70, 3), generator=generator) * 255).to(torch.uint8)
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "source.png")
            Image.fromarray(pixels.numpy()).save(path)
            source = pixels.float().unsqueeze(0) / 255.0
            for target in (0.0, 0.01):
                with self.subTest(target_megapixels=target):
                    (image, mask, width, height, stitcher, _), _ = self.run_node(
                        cls, path, pad_left=0, pad_top=6, pad_right=0, pad_bottom=10,
                        canvas_multiple=16, target_megapixels=target,
                    )
                    self.assertEqual(width % 16, 0)
                    # The source spans the whole width: no strip for the model
                    # to paint, no seam for tone match to read on either side.
                    x0, y0, x1, y1 = stitcher["source_bbox"]
                    self.assertEqual((x0, x1), (0, width))
                    self.assertEqual(float(mask[0, y0:y1].sum()), 0.0)
                    if target == 0.0:
                        # 70 px trims to 64, three columns off each side, and
                        # what is kept lands bit-identical.
                        self.assertEqual(width, 64)
                        self.assertTrue(torch.equal(image[:, y0:y1], source[:, :, 3:67]))
                    # Whatever the sampler returns, both unpadded edges come
                    # back as photo.
                    stitched = apply_stitch(stitcher, torch.rand(image.shape, generator=generator))
                    self.assertTrue(torch.equal(stitched[:, y0:y1, :1], image[:, y0:y1, :1]))
                    self.assertTrue(torch.equal(stitched[:, y0:y1, -1:], image[:, y0:y1, -1:]))

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


if __name__ == "__main__":
    unittest.main()
