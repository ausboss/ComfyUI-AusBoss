from __future__ import annotations

import importlib
from pathlib import Path
import sys
import types
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _mask_helpers as mask_helpers
from nodes._mask_helpers import (
    _guide_frames,
    _torch_fill_holes,
    blur_mask,
    fill_mask_holes,
    grow_shrink_mask,
    refine_mask,
    remap_mask,
    smooth_mask,
)


def _importable(module: str, attribute: str | None = None) -> bool:
    try:
        imported = importlib.import_module(module)
    except Exception:
        return False
    return attribute is None or hasattr(imported, attribute)


HAS_GUIDED_FILTER = _importable("cv2", "ximgproc")
HAS_MATTING = _importable("pymatting")


def donut_mask() -> torch.Tensor:
    mask = torch.zeros((1, 16, 16), dtype=torch.float32)
    mask[:, 3:13, 3:13] = 1.0
    mask[:, 6:10, 6:10] = 0.0
    return mask


class GrowShrinkTests(unittest.TestCase):
    def test_grow_and_shrink_change_area_in_the_right_direction(self):
        mask = torch.zeros((1, 12, 12), dtype=torch.float32)
        mask[:, 4:8, 4:8] = 1.0
        self.assertGreater(grow_shrink_mask(mask, 2).sum(), mask.sum())
        self.assertLess(grow_shrink_mask(mask, -1).sum(), mask.sum())
        self.assertTrue(torch.equal(grow_shrink_mask(mask, 0), mask))

    def test_grow_by_one_adds_exactly_one_pixel_ring(self):
        mask = torch.zeros((1, 9, 9), dtype=torch.float32)
        mask[:, 4, 4] = 1.0
        grown = grow_shrink_mask(mask, 1)
        self.assertEqual(int(grown.sum()), 9)


class FillHolesTests(unittest.TestCase):
    def test_enclosed_hole_is_filled_but_outside_stays_empty(self):
        filled = fill_mask_holes(donut_mask())
        self.assertTrue(torch.all(filled[:, 6:10, 6:10] == 1.0))
        self.assertTrue(torch.all(filled[:, 0:2] == 0.0))

    def test_torch_fallback_matches_expected_fill(self):
        solid = donut_mask() >= 0.5
        filled = _torch_fill_holes(solid)
        self.assertTrue(bool(filled[:, 7, 7].all()))
        self.assertFalse(bool(filled[:, 0, 0].any()))

    def test_border_connected_gap_is_not_treated_as_a_hole(self):
        opened = donut_mask()
        opened[:, 0:8, 8] = 0.0  # cut a channel from the top edge into the hole
        filled = fill_mask_holes(opened)
        self.assertEqual(float(filled[:, 7, 8]), 0.0)  # inside the (now open) gap
        self.assertEqual(float(filled[:, 1, 8]), 0.0)  # the channel itself


class SmoothTests(unittest.TestCase):
    def test_zero_smooth_is_identity(self):
        mask = donut_mask()
        self.assertTrue(torch.equal(smooth_mask(mask, 0), mask))

    def test_output_stays_binary(self):
        mask = donut_mask()
        smoothed = smooth_mask(mask, 2)
        self.assertTrue(torch.all((smoothed == 0.0) | (smoothed == 1.0)))

    def test_isolated_speck_and_pinhole_are_melted(self):
        # A lone pixel blurs to a peak of K(0)^2 < 0.5, so re-binarizing at
        # 0.5 removes it; by symmetry a lone hole in a solid field closes.
        speck = torch.zeros((1, 15, 15), dtype=torch.float32)
        speck[:, 7, 7] = 1.0
        self.assertEqual(float(smooth_mask(speck, 1).sum()), 0.0)
        pinhole = 1.0 - speck
        self.assertEqual(float(smooth_mask(pinhole, 1).sum()), 15.0 * 15.0)

    def test_straight_edge_survives_unchanged(self):
        # Blurring a half-plane gives values that cross 0.5 exactly between
        # the last 0 column and the first 1 column, so the edge snaps back.
        mask = torch.zeros((1, 16, 16), dtype=torch.float32)
        mask[:, :, 8:] = 1.0
        self.assertTrue(torch.equal(smooth_mask(mask, 2), mask))

    def test_smooth_does_not_feather_but_blur_does(self):
        mask = donut_mask()
        smoothed = smooth_mask(mask, 2)
        blurred = blur_mask(mask, 2.0)
        self.assertEqual(len(torch.unique(smoothed)), 2)
        self.assertGreater(len(torch.unique(blurred)), 2)

    def test_refine_smooth_default_preserves_previous_behavior(self):
        mask = donut_mask()
        legacy = refine_mask(mask, 1, 1.5, True)
        keyword = refine_mask(mask, 1, 1.5, True, smooth=0)
        self.assertTrue(torch.equal(legacy[0], keyword[0]))


class RemapTests(unittest.TestCase):
    def test_hand_computed_levels(self):
        # (value - 0.1) / (0.9 - 0.1), clamped to [0, 1].
        values = torch.tensor([[[0.0, 0.1, 0.3, 0.5, 0.9, 1.0]]])
        expected = torch.tensor([[[0.0, 0.0, 0.25, 0.5, 1.0, 1.0]]])
        self.assertTrue(torch.allclose(remap_mask(values, 0.1, 0.9), expected))

    def test_default_points_are_an_exact_identity(self):
        mask = torch.rand((1, 8, 8))
        self.assertTrue(torch.equal(remap_mask(mask, 0.0, 1.0), mask))

    def test_degenerate_points_act_as_a_hard_threshold(self):
        values = torch.tensor([[[0.0, 0.49, 0.5, 0.51, 1.0]]])
        expected = torch.tensor([[[0.0, 0.0, 0.0, 1.0, 1.0]]])
        self.assertTrue(torch.equal(remap_mask(values, 0.5, 0.5), expected))
        self.assertTrue(torch.equal(remap_mask(values, 0.5, 0.2), expected))

    def test_refine_applies_remap_last_and_defaults_stay_identical(self):
        mask = donut_mask()
        soft, _inverted = refine_mask(mask, 0, 2.0, False)
        remapped, inverted = refine_mask(mask, 0, 2.0, False, black_point=0.2, white_point=0.8)
        self.assertTrue(torch.allclose(remapped, remap_mask(soft, 0.2, 0.8)))
        self.assertTrue(torch.allclose(remapped + inverted, torch.ones_like(remapped)))
        legacy = refine_mask(mask, 1, 1.5, True)
        keyword = refine_mask(mask, 1, 1.5, True, black_point=0.0, white_point=1.0)
        self.assertTrue(torch.equal(legacy[0], keyword[0]))


class BlurAndRefineTests(unittest.TestCase):
    def test_blur_softens_edges_and_stays_in_range(self):
        mask = torch.zeros((1, 16, 16), dtype=torch.float32)
        mask[:, :, 8:] = 1.0
        blurred = blur_mask(mask, 2.0)
        self.assertGreater(float(blurred[:, 8, 7]), 0.0)
        self.assertLess(float(blurred[:, 8, 8]), 1.0)
        self.assertGreaterEqual(float(blurred.min()), 0.0)
        self.assertLessEqual(float(blurred.max()), 1.0)
        self.assertTrue(torch.equal(blur_mask(mask, 0.0), mask))

    def test_refine_returns_mask_and_exact_inverse_and_accepts_2d(self):
        mask2d = torch.zeros((10, 10), dtype=torch.float32)
        mask2d[2:6, 2:6] = 1.0
        refined, inverted = refine_mask(mask2d, 1, 1.5, True)
        self.assertEqual(tuple(refined.shape), (1, 10, 10))
        self.assertTrue(torch.allclose(refined + inverted, torch.ones_like(refined)))

    def test_refine_rejects_wrong_rank(self):
        with self.assertRaisesRegex(ValueError, "BHW"):
            refine_mask(torch.zeros((1, 1, 4, 4)), 0, 0.0, False)


def square_mask(batch: int = 1) -> torch.Tensor:
    mask = torch.zeros((batch, 32, 32), dtype=torch.float32)
    mask[:, 8:24, 8:24] = 1.0
    return mask


def square_guide(batch: int = 1) -> torch.Tensor:
    image = torch.zeros((batch, 32, 32, 3), dtype=torch.float32)
    image[:, 8:24, 8:24, :] = 1.0
    return image


class EdgeRefineSelectionTests(unittest.TestCase):
    def test_each_tier_requires_the_guide_image(self):
        for mode in ("guided filter", "matting"):
            with self.assertRaisesRegex(ValueError, "guide_image"):
                refine_mask(square_mask(), 0, 0.0, False, edge_refine=mode)

    def test_unknown_mode_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "edge_refine"):
            refine_mask(square_mask(), 0, 0.0, False, edge_refine="sharpen")

    def test_off_ignores_a_connected_guide(self):
        plain = refine_mask(square_mask(), 0, 1.0, False)
        with_guide = refine_mask(
            square_mask(), 0, 1.0, False, edge_refine="off", guide_image=square_guide()
        )
        self.assertTrue(torch.equal(plain[0], with_guide[0]))

    def test_guide_frames_validates_rank_size_and_batch(self):
        with self.assertRaisesRegex(ValueError, "BHWC"):
            _guide_frames(torch.zeros((32, 32, 3)), 1, 32, 32)
        with self.assertRaisesRegex(ValueError, "16x16"):
            _guide_frames(torch.zeros((1, 16, 16, 3)), 1, 32, 32)
        with self.assertRaisesRegex(ValueError, "one guide frame"):
            _guide_frames(torch.zeros((3, 32, 32, 3)), 2, 32, 32)

    def test_guide_frames_broadcasts_a_single_frame(self):
        frames = _guide_frames(square_guide(1), 3, 32, 32)
        self.assertEqual(tuple(frames.shape), (3, 32, 32, 3))


class EdgeRefineDependencyTests(unittest.TestCase):
    def _patched_import(self, replacement):
        original = mask_helpers._optional_import
        mask_helpers._optional_import = replacement
        self.addCleanup(setattr, mask_helpers, "_optional_import", original)

    def test_missing_cv2_names_the_optional_install(self):
        def failing(name):
            raise ImportError(f"No module named '{name}'")

        self._patched_import(failing)
        with self.assertRaisesRegex(RuntimeError, "opencv-contrib-python"):
            refine_mask(
                square_mask(), 0, 0.0, False,
                edge_refine="guided filter", guide_image=square_guide(),
            )

    def test_cv2_without_contrib_names_the_optional_install(self):
        self._patched_import(lambda name: types.SimpleNamespace())
        with self.assertRaisesRegex(RuntimeError, "opencv-contrib-python"):
            refine_mask(
                square_mask(), 0, 0.0, False,
                edge_refine="guided filter", guide_image=square_guide(),
            )

    def test_missing_pymatting_names_the_optional_install(self):
        def failing(name):
            raise ImportError(f"No module named '{name}'")

        self._patched_import(failing)
        with self.assertRaisesRegex(RuntimeError, "pymatting"):
            refine_mask(
                square_mask(), 0, 0.0, False,
                edge_refine="matting", guide_image=square_guide(),
            )


@unittest.skipUnless(HAS_GUIDED_FILTER, "cv2.ximgproc is not installed")
class GuidedFilterSmokeTests(unittest.TestCase):
    def test_tier_runs_on_a_synthetic_mask_and_image(self):
        refined, inverted = refine_mask(
            square_mask(), 0, 2.0, False,
            edge_refine="guided filter", guide_image=square_guide(),
        )
        self.assertEqual(tuple(refined.shape), (1, 32, 32))
        self.assertGreaterEqual(float(refined.min()), 0.0)
        self.assertLessEqual(float(refined.max()), 1.0)
        self.assertTrue(torch.allclose(refined + inverted, torch.ones_like(refined)))
        self.assertGreater(float(refined[0, 16, 16]), 0.5)
        self.assertLess(float(refined[0, 2, 2]), 0.5)

    def test_single_guide_frame_serves_a_mask_batch(self):
        refined, _inverted = refine_mask(
            square_mask(batch=2), 0, 0.0, False,
            edge_refine="guided filter", guide_image=square_guide(1),
        )
        self.assertEqual(tuple(refined.shape), (2, 32, 32))


@unittest.skipUnless(HAS_MATTING, "pymatting is not installed")
class MattingSmokeTests(unittest.TestCase):
    def test_tier_runs_on_a_synthetic_mask_and_image(self):
        refined, inverted = refine_mask(
            square_mask(), 0, 0.0, False,
            edge_refine="matting", guide_image=square_guide(),
        )
        self.assertEqual(tuple(refined.shape), (1, 32, 32))
        self.assertTrue(bool(torch.isfinite(refined).all()))
        self.assertGreaterEqual(float(refined.min()), 0.0)
        self.assertLessEqual(float(refined.max()), 1.0)
        self.assertTrue(torch.allclose(refined + inverted, torch.ones_like(refined)))
        self.assertGreater(float(refined[0, 16, 16]), 0.5)
        self.assertLess(float(refined[0, 2, 2]), 0.5)

    def test_degenerate_trimap_falls_back_to_the_binarized_mask(self):
        empty = torch.zeros((1, 32, 32), dtype=torch.float32)
        refined, _inverted = refine_mask(
            empty, 0, 0.0, False, edge_refine="matting", guide_image=square_guide()
        )
        self.assertEqual(float(refined.sum()), 0.0)


if __name__ == "__main__":
    unittest.main()
