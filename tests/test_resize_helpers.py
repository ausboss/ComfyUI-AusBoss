from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._resize_helpers import (
    INTERPOLATION_MODES,
    PROPORTION_MODES,
    TARGET_MODES,
    apply_resize,
    plan_resize,
    resample_batch,
    resolve_target,
    snap_to_multiple,
)


def rand_image(batch: int, height: int, width: int, seed: int = 0) -> torch.Tensor:
    generator = torch.Generator().manual_seed(seed)
    return torch.rand((batch, height, width, 3), generator=generator, dtype=torch.float32)


class SnapToMultipleTests(unittest.TestCase):
    def test_snaps_to_the_nearest_multiple_half_up(self):
        self.assertEqual(snap_to_multiple(1000, 16), 1008)  # 62.5 rounds up
        self.assertEqual(snap_to_multiple(23, 16), 16)
        self.assertEqual(snap_to_multiple(24, 16), 32)  # 1.5 rounds up
        self.assertEqual(snap_to_multiple(16, 16), 16)

    def test_never_returns_below_one_step(self):
        self.assertEqual(snap_to_multiple(0, 16), 16)
        self.assertEqual(snap_to_multiple(3, 16), 16)

    def test_multiple_one_is_a_passthrough(self):
        self.assertEqual(snap_to_multiple(7, 1), 7)
        self.assertEqual(snap_to_multiple(7, 0), 7)  # normalized to 1


class ResolveTargetTests(unittest.TestCase):
    def test_width_height_zero_keeps_the_source(self):
        self.assertEqual(resolve_target(1920, 1080, "width+height", 0, 0), (1920, 1080))

    def test_width_height_one_value_preserves_aspect(self):
        self.assertEqual(resolve_target(1920, 1080, "width+height", 960, 0), (960, 540))
        self.assertEqual(resolve_target(1920, 1080, "width+height", 0, 540), (960, 540))

    def test_width_height_both_values_are_exact(self):
        self.assertEqual(resolve_target(1920, 1080, "width+height", 512, 512), (512, 512))

    def test_longest_edge_lands_exactly_on_the_request(self):
        self.assertEqual(
            resolve_target(1920, 1080, "longest_edge", edge_length=960), (960, 540)
        )
        self.assertEqual(
            resolve_target(1080, 1920, "longest_edge", edge_length=960), (540, 960)
        )
        self.assertEqual(
            resolve_target(1920, 1080, "longest_edge", edge_length=0), (1920, 1080)
        )

    def test_shortest_edge_lands_exactly_on_the_request(self):
        self.assertEqual(
            resolve_target(1920, 1080, "shortest_edge", edge_length=540), (960, 540)
        )
        self.assertEqual(
            resolve_target(1080, 1920, "shortest_edge", edge_length=540), (540, 960)
        )
        self.assertEqual(
            resolve_target(1920, 1080, "shortest_edge", edge_length=0), (1920, 1080)
        )

    def test_megapixels_hits_the_pixel_budget(self):
        width, height = resolve_target(1920, 1080, "megapixels", megapixels=1.0)
        self.assertEqual((width, height), (1333, 750))
        self.assertLess(abs(width * height / 1e6 - 1.0), 0.01)
        # Aspect survives the scale.
        self.assertAlmostEqual(width / height, 1920 / 1080, places=2)
        self.assertEqual(
            resolve_target(1920, 1080, "megapixels", megapixels=0.0), (1920, 1080)
        )

    def test_scale_factor_multiplies_and_zero_keeps_the_source(self):
        self.assertEqual(
            resolve_target(1920, 1080, "scale_factor", scale_factor=0.5), (960, 540)
        )
        self.assertEqual(
            resolve_target(1920, 1080, "scale_factor", scale_factor=2.0), (3840, 2160)
        )
        self.assertEqual(
            resolve_target(1920, 1080, "scale_factor", scale_factor=0.0), (1920, 1080)
        )

    def test_dimensions_never_collapse_to_zero(self):
        self.assertEqual(
            resolve_target(2000, 10, "scale_factor", scale_factor=0.01), (20, 1)
        )

    def test_unknown_mode_and_empty_source_are_rejected(self):
        with self.assertRaises(ValueError):
            resolve_target(64, 64, "diagonal")
        with self.assertRaises(ValueError):
            resolve_target(0, 64, "width+height")


class PlanResizeTests(unittest.TestCase):
    def test_stretch_resizes_straight_to_the_target(self):
        plan = plan_resize(1920, 1080, 512, 512, "stretch")
        self.assertEqual(
            plan,
            {
                "resize_width": 512,
                "resize_height": 512,
                "canvas_width": 512,
                "canvas_height": 512,
                "crop_x": 0,
                "crop_y": 0,
                "offset_x": 0,
                "offset_y": 0,
            },
        )

    def test_fit_shrinks_the_target_box_to_the_source_aspect(self):
        plan = plan_resize(1920, 1080, 512, 512, "fit")
        self.assertEqual((plan["canvas_width"], plan["canvas_height"]), (512, 288))
        self.assertEqual((plan["resize_width"], plan["resize_height"]), (512, 288))
        self.assertEqual((plan["offset_x"], plan["offset_y"]), (0, 0))

    def test_fit_snaps_the_fitted_size_to_the_multiple(self):
        plan = plan_resize(1920, 1080, 500, 500, "fit", divisible_by=16)
        self.assertEqual((plan["canvas_width"], plan["canvas_height"]), (496, 288))
        self.assertEqual(plan["canvas_width"] % 16, 0)
        self.assertEqual(plan["canvas_height"] % 16, 0)

    def test_cover_crop_overshoots_and_centers_the_crop(self):
        plan = plan_resize(1920, 1080, 512, 512, "cover_crop")
        self.assertEqual((plan["canvas_width"], plan["canvas_height"]), (512, 512))
        self.assertEqual((plan["resize_width"], plan["resize_height"]), (911, 512))
        self.assertEqual((plan["crop_x"], plan["crop_y"]), (199, 0))

    def test_cover_crop_exact_scale_does_not_overshoot_by_a_pixel(self):
        # scale is exactly 0.5; floating-point noise must not ceil past it.
        plan = plan_resize(100, 50, 50, 25, "cover_crop")
        self.assertEqual((plan["resize_width"], plan["resize_height"]), (50, 25))
        self.assertEqual((plan["crop_x"], plan["crop_y"]), (0, 0))

    def test_pad_fits_inside_and_centers_the_bars(self):
        plan = plan_resize(1920, 1080, 512, 512, "pad")
        self.assertEqual((plan["canvas_width"], plan["canvas_height"]), (512, 512))
        self.assertEqual((plan["resize_width"], plan["resize_height"]), (512, 288))
        self.assertEqual((plan["offset_x"], plan["offset_y"]), (0, 112))

    def test_pad_snaps_the_canvas_then_refits_the_source(self):
        plan = plan_resize(1920, 1080, 500, 500, "pad", divisible_by=16)
        self.assertEqual((plan["canvas_width"], plan["canvas_height"]), (496, 496))
        self.assertEqual((plan["resize_width"], plan["resize_height"]), (496, 279))
        self.assertEqual((plan["offset_x"], plan["offset_y"]), (0, 108))

    def test_matching_target_is_an_identity_plan(self):
        for mode in PROPORTION_MODES:
            with self.subTest(mode=mode):
                plan = plan_resize(640, 480, 640, 480, mode)
                self.assertEqual((plan["resize_width"], plan["resize_height"]), (640, 480))
                self.assertEqual((plan["canvas_width"], plan["canvas_height"]), (640, 480))
                self.assertEqual((plan["crop_x"], plan["crop_y"]), (0, 0))
                self.assertEqual((plan["offset_x"], plan["offset_y"]), (0, 0))

    def test_divisible_by_applies_even_when_the_target_is_the_source(self):
        plan = plan_resize(1000, 750, 1000, 750, "stretch", divisible_by=16)
        self.assertEqual((plan["canvas_width"], plan["canvas_height"]), (1008, 752))

    def test_invalid_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            plan_resize(640, 480, 512, 512, "letterbox")
        with self.assertRaises(ValueError):
            plan_resize(640, 480, 0, 512, "fit")


class ResampleBatchTests(unittest.TestCase):
    def test_every_mode_returns_the_requested_shape(self):
        image = rand_image(2, 16, 16, seed=1)
        for mode in INTERPOLATION_MODES:
            for width, height in ((24, 20), (8, 8)):
                with self.subTest(mode=mode, size=(width, height)):
                    out = resample_batch(image, width, height, mode)
                    self.assertEqual(tuple(out.shape), (2, height, width, 3))
                    self.assertFalse(bool(out.isnan().any()))

    def test_matching_size_returns_the_input_untouched(self):
        image = rand_image(1, 12, 10, seed=2)
        self.assertIs(resample_batch(image, 10, 12, "lanczos"), image)

    def test_nearest_invents_no_new_values(self):
        image = torch.tensor(
            [[[0.0, 0.25], [0.5, 1.0]]], dtype=torch.float32
        ).unsqueeze(-1)
        out = resample_batch(image, 8, 8, "nearest")
        self.assertEqual(
            set(torch.unique(out).tolist()), set(torch.unique(image).tolist())
        )

    def test_overshooting_filters_stay_inside_the_value_range(self):
        # A hard checkerboard makes lanczos and bicubic ring past 0..1.
        checker = torch.zeros((1, 16, 16, 3), dtype=torch.float32)
        checker[:, ::2, ::2, :] = 1.0
        checker[:, 1::2, 1::2, :] = 1.0
        for mode in ("lanczos", "bicubic"):
            with self.subTest(mode=mode):
                out = resample_batch(checker, 24, 24, mode)
                self.assertGreaterEqual(float(out.min()), 0.0)
                self.assertLessEqual(float(out.max()), 1.0)

    def test_lanczos_keeps_a_constant_image_constant(self):
        image = torch.full((1, 10, 14, 3), 0.375, dtype=torch.float32)
        out = resample_batch(image, 7, 5, "lanczos")
        self.assertTrue(torch.allclose(out, torch.full_like(out, 0.375), atol=1e-5))

    def test_area_downscale_averages_exactly(self):
        checker = torch.zeros((1, 4, 4, 1), dtype=torch.float32)
        checker[:, ::2, ::2] = 1.0
        checker[:, 1::2, 1::2] = 1.0
        out = resample_batch(checker, 2, 2, "area")
        self.assertTrue(torch.allclose(out, torch.full_like(out, 0.5)))

    def test_bad_arguments_are_rejected(self):
        image = rand_image(1, 8, 8)
        with self.assertRaises(ValueError):
            resample_batch(image, 8, 8, "mitchell")
        with self.assertRaises(ValueError):
            resample_batch(image, 0, 8, "bilinear")
        with self.assertRaises(ValueError):
            resample_batch(image[0], 8, 8, "bilinear")


def run_resize(image, mask=None, **overrides):
    values = {
        "target_mode": "width+height",
        "width": 0,
        "height": 0,
        "edge_length": 0,
        "megapixels": 0.0,
        "scale_factor": 0.0,
        "keep_proportion": "fit",
        "fill_color": "#000000",
        "divisible_by": 1,
        "interpolation": "nearest",
    }
    values.update(overrides)
    return apply_resize(image, mask, **values)


class ApplyResizeTests(unittest.TestCase):
    def test_stretch_hits_the_exact_target_and_reports_it(self):
        image = rand_image(2, 24, 32, seed=3)
        out, mask, width, height = run_resize(
            image, width=16, height=12, keep_proportion="stretch"
        )
        self.assertEqual(tuple(out.shape), (2, 12, 16, 3))
        self.assertEqual(tuple(mask.shape), (2, 12, 16))
        self.assertEqual((width, height), (16, 12))
        self.assertEqual(float(mask.sum()), 0.0)

    def test_fit_keeps_the_aspect_instead_of_the_box(self):
        image = rand_image(1, 24, 32, seed=4)
        out, _, width, height = run_resize(image, width=16, height=16)
        self.assertEqual((width, height), (16, 12))
        self.assertEqual(tuple(out.shape), (1, 12, 16, 3))

    def test_zero_widgets_are_a_bit_identical_passthrough(self):
        image = rand_image(1, 24, 32, seed=5)
        out, mask, width, height = run_resize(image)
        self.assertIs(out, image)
        self.assertEqual((width, height), (32, 24))
        self.assertEqual(tuple(mask.shape), (1, 24, 32))
        self.assertEqual(float(mask.sum()), 0.0)

    def test_zero_widgets_still_respect_divisible_by(self):
        image = rand_image(1, 20, 30, seed=6)
        out, _, width, height = run_resize(
            image, keep_proportion="stretch", divisible_by=8
        )
        self.assertEqual((width, height), (32, 24))
        self.assertEqual(tuple(out.shape), (1, 24, 32, 3))

    def test_scale_derived_modes_never_invent_pixels(self):
        # 855x480 at longest_edge 512 fits to 512x287 but snaps to 512x288 —
        # the case where pad used to answer divisible_by with an invented
        # bottom row. The box is derived from the source's own aspect, so
        # every proportion mode must resolve the snap like fit does: a
        # sub-half-step resize, a black mask, and not one invented pixel.
        image = rand_image(1, 480, 855, seed=9)
        for proportion in ("stretch", "fit", "cover_crop", "pad"):
            out, mask, width, height = run_resize(
                image,
                target_mode="longest_edge",
                edge_length=512,
                keep_proportion=proportion,
                divisible_by=16,
            )
            self.assertEqual((width, height), (512, 288), proportion)
            self.assertEqual(tuple(out.shape), (1, 288, 512, 3), proportion)
            self.assertEqual(float(mask.max()), 0.0, proportion)

    def test_pad_fills_the_bars_and_marks_them_in_the_mask(self):
        image = rand_image(1, 24, 32, seed=7)
        out, mask, width, height = run_resize(
            image, width=32, height=32, keep_proportion="pad", fill_color="#ff0000"
        )
        self.assertEqual((width, height), (32, 32))
        self.assertEqual(tuple(out.shape), (1, 32, 32, 3))
        # The source resamples to itself, so it lands bit-identical at y=4.
        self.assertTrue(torch.equal(out[:, 4:28, :, :], image))
        red = torch.tensor([1.0, 0.0, 0.0])
        self.assertTrue(torch.allclose(out[0, 0, 0], red))
        self.assertTrue(torch.allclose(out[0, -1, -1], red))
        # Generated-area contract: bars 1.0, source region 0.0.
        self.assertEqual(float(mask[:, 4:28, :].sum()), 0.0)
        self.assertEqual(float(mask.sum()), float(2 * 4 * 32))

    def test_pad_carries_the_input_mask_inside_the_bars(self):
        image = rand_image(1, 24, 32, seed=8)
        mask = torch.full((1, 24, 32), 0.5, dtype=torch.float32)
        _, out_mask, _, _ = run_resize(
            image, mask, width=32, height=32, keep_proportion="pad"
        )
        self.assertTrue(
            torch.allclose(out_mask[:, 4:28, :], torch.full((1, 24, 32), 0.5))
        )
        self.assertEqual(float(out_mask[:, :4, :].min()), 1.0)
        self.assertEqual(float(out_mask[:, 28:, :].min()), 1.0)

    def test_cover_crop_slices_image_and_mask_identically(self):
        image = rand_image(1, 24, 32, seed=9)
        mask = torch.zeros((1, 24, 32), dtype=torch.float32)
        mask[:, :, :16] = 1.0
        out, out_mask, width, height = run_resize(
            image, mask, width=24, height=24, keep_proportion="cover_crop"
        )
        self.assertEqual((width, height), (24, 24))
        # Cover scale is exactly 1.0 here, so the crop is a pure slice.
        self.assertTrue(torch.equal(out, image[:, :, 4:28, :]))
        self.assertTrue(torch.equal(out_mask, mask[:, :, 4:28]))

    def test_mask_keeps_its_own_batch_size(self):
        image = rand_image(3, 24, 32, seed=10)
        mask = torch.ones((1, 24, 32), dtype=torch.float32)
        out, out_mask, _, _ = run_resize(
            image, mask, width=32, height=32, keep_proportion="pad"
        )
        self.assertEqual(out.shape[0], 3)
        self.assertEqual(out_mask.shape[0], 1)

    def test_scaling_modes_flow_through_end_to_end(self):
        image = rand_image(2, 24, 32, seed=11)
        _, _, width, height = run_resize(
            image, target_mode="longest_edge", edge_length=16
        )
        self.assertEqual((width, height), (16, 12))
        _, _, width, height = run_resize(
            image, target_mode="shortest_edge", edge_length=12
        )
        self.assertEqual((width, height), (16, 12))
        _, _, width, height = run_resize(
            image, target_mode="scale_factor", scale_factor=0.5
        )
        self.assertEqual((width, height), (16, 12))

    def test_bad_tensors_are_rejected(self):
        with self.assertRaises(ValueError):
            run_resize(torch.zeros((24, 32, 3)))
        with self.assertRaises(ValueError):
            run_resize(rand_image(1, 8, 8), torch.zeros((1, 8, 8, 1)))


class ImageResizeNodeTests(unittest.TestCase):
    def make_node(self):
        from nodes.node_image_resize import (
            NODE_CLASS_MAPPINGS,
            NODE_DISPLAY_NAME_MAPPINGS,
        )

        self.assertIn("AUSBOSS_NODES_ImageResize", NODE_CLASS_MAPPINGS)
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_ImageResize"],
            "Image Resize 🆎",
        )
        return NODE_CLASS_MAPPINGS["AUSBOSS_NODES_ImageResize"]

    def test_contract(self):
        cls = self.make_node()
        self.assertIn("AusBoss/Image", cls.CATEGORY)
        self.assertIn("ausboss", cls.SEARCH_ALIASES)
        self.assertTrue(cls.DESCRIPTION)
        self.assertEqual(cls.RETURN_TYPES, ("IMAGE", "MASK", "INT", "INT"))
        self.assertEqual(cls.RETURN_NAMES, ("image", "mask", "width", "height"))
        self.assertEqual(len(cls.OUTPUT_TOOLTIPS), 4)

    def test_every_input_is_tooltipped_and_combos_match_the_helpers(self):
        cls = self.make_node()
        inputs = cls.INPUT_TYPES()
        for section in ("required", "optional"):
            for name, (kind, options) in inputs[section].items():
                with self.subTest(input=name):
                    self.assertTrue(options.get("tooltip"))
        self.assertEqual(inputs["required"]["target_mode"][0], list(TARGET_MODES))
        self.assertEqual(inputs["required"]["keep_proportion"][0], list(PROPORTION_MODES))
        self.assertEqual(inputs["required"]["interpolation"][0], list(INTERPOLATION_MODES))
        self.assertIn("mask", inputs["optional"])

    def run_node(self, cls, image, mask=None, **overrides):
        values = {
            "target_mode": "width+height",
            "width": 0,
            "height": 0,
            "edge_length": 0,
            "megapixels": 0.0,
            "scale_factor": 0.0,
            "keep_proportion": "fit",
            "fill_color": "#000000",
            "divisible_by": 1,
            "interpolation": "bilinear",
        }
        values.update(overrides)
        return getattr(cls(), cls.FUNCTION)(image=image, mask=mask, **values)

    def test_resizes_by_longest_edge(self):
        cls = self.make_node()
        image = rand_image(1, 24, 32, seed=12)
        out, mask, width, height = self.run_node(
            cls, image, target_mode="longest_edge", edge_length=16
        )
        self.assertEqual((width, height), (16, 12))
        self.assertEqual(tuple(out.shape), (1, 12, 16, 3))
        self.assertEqual(tuple(mask.shape), (1, 12, 16))

    def test_defaults_keep_the_source(self):
        cls = self.make_node()
        image = rand_image(1, 24, 32, seed=13)
        out, _, width, height = self.run_node(cls, image)
        self.assertIs(out, image)
        self.assertEqual((width, height), (32, 24))


if __name__ == "__main__":
    unittest.main()
