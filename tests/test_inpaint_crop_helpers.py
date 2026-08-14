from __future__ import annotations

import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _inpaint_crop_helpers as inpaint_helpers
from nodes._inpaint_crop_helpers import (
    apply_stitch,
    build_crop,
    expand_rect_to_multiple,
    fit_rect,
    grow_rect,
    mask_bbox,
    round_up_to_multiple,
)

HAS_PYMATTING = importlib.util.find_spec("pymatting") is not None


def rand_image(batch: int, height: int, width: int, seed: int = 0) -> torch.Tensor:
    generator = torch.Generator().manual_seed(seed)
    return torch.rand((batch, height, width, 3), generator=generator, dtype=torch.float32)


def gradient_image(batch: int, height: int, width: int) -> torch.Tensor:
    rows = torch.linspace(0.0, 1.0, height).view(1, height, 1, 1)
    cols = torch.linspace(0.0, 1.0, width).view(1, 1, width, 1)
    chans = torch.linspace(0.1, 0.3, 3).view(1, 1, 1, 3)
    image = 0.35 * rows + 0.45 * cols + chans
    return image.expand(batch, height, width, 3).clone().float()


def box_mask(height: int, width: int, y0: int, y1: int, x0: int, x1: int) -> torch.Tensor:
    mask = torch.zeros((1, height, width), dtype=torch.float32)
    mask[:, y0:y1, x0:x1] = 1.0
    return mask


def shuffle_pixels(image: torch.Tensor) -> torch.Tensor:
    """Deterministically change every pixel while staying inside [0, 1]."""
    return ((image + 0.31) % 1.0).float()


def crop_alpha(stitcher: dict) -> torch.Tensor:
    """The blend mask over the crop window, as BHWC weights."""
    cx, cy, cw, ch = stitcher["crop_to_canvas"]
    return stitcher["blend"][:, cy : cy + ch, cx : cx + cw].unsqueeze(-1)


def contaminated_patch(stitcher: dict, color: torch.Tensor) -> torch.Tensor:
    """An inpainted crop whose soft edge already carries the old background.

    This is the halo case: the sampler faded its result toward the
    surrounding pixels over the same feathered edge, so pasting it through
    that edge a second time counts the background twice and rims the seam.
    """
    cx, cy, cw, ch = stitcher["crop_to_canvas"]
    alpha = crop_alpha(stitcher)
    region = stitcher["canvas"][:, cy : cy + ch, cx : cx + cw, :]
    return alpha * color.view(1, 1, 1, 3) + (1.0 - alpha) * region


def blend_bands(stitcher: dict) -> tuple[torch.Tensor, torch.Tensor]:
    """(untouched, feathered) BHW masks over the original-size frame.

    ``untouched`` is every pixel the paste cannot reach — outside the paste
    window, or inside it at zero blend weight — and must stay bit-identical.
    ``feathered`` is the semi-transparent band the halo fix may rewrite.
    """
    ox, oy, ow, oh = stitcher["canvas_to_original"]
    cx, cy, cw, ch = stitcher["crop_to_canvas"]
    blend = stitcher["blend"][:, oy : oy + oh, ox : ox + ow]
    window = torch.zeros_like(blend, dtype=torch.bool)
    y0, y1 = max(cy, oy) - oy, min(cy + ch, oy + oh) - oy
    x0, x1 = max(cx, ox) - ox, min(cx + cw, ox + ow) - ox
    if y1 > y0 and x1 > x0:
        window[:, y0:y1, x0:x1] = True
    pasted = window & (blend > 0.0)
    return ~pasted, pasted & (blend < 1.0)


class GeometryTests(unittest.TestCase):
    def test_round_up_to_multiple(self):
        self.assertEqual(round_up_to_multiple(100, 8), 104)
        self.assertEqual(round_up_to_multiple(104, 8), 104)
        self.assertEqual(round_up_to_multiple(1, 8), 8)
        self.assertEqual(round_up_to_multiple(37, 1), 37)

    def test_mask_bbox_finds_the_tight_box(self):
        mask = box_mask(20, 30, 5, 9, 11, 18)
        self.assertEqual(mask_bbox(mask), (11, 5, 7, 4))

    def test_mask_bbox_empty_mask_is_none(self):
        self.assertIsNone(mask_bbox(torch.zeros((1, 8, 8))))

    def test_mask_bbox_unions_across_the_batch(self):
        frame_a = box_mask(20, 20, 2, 5, 3, 6)
        frame_b = box_mask(20, 20, 10, 15, 12, 17)
        bbox = mask_bbox(torch.cat([frame_a, frame_b], dim=0))
        self.assertEqual(bbox, (3, 2, 14, 13))

    def test_grow_rect_is_symmetric_and_identity_at_one(self):
        self.assertEqual(grow_rect((10, 10, 20, 10), 1.0), (10, 10, 20, 10))
        self.assertEqual(grow_rect((10, 10, 20, 10), 2.0), (0, 5, 40, 20))

    def test_expand_rect_to_multiple_grows_symmetrically(self):
        self.assertEqual(expand_rect_to_multiple((3, 5, 10, 10), 8), (0, 2, 16, 16))
        self.assertEqual(expand_rect_to_multiple((3, 5, 16, 8), 8), (3, 5, 16, 8))

    def test_fit_rect_shifts_into_bounds_when_it_fits(self):
        self.assertEqual(fit_rect((-4, 3, 10, 10), 100, 50), (0, 3, 10, 10))
        self.assertEqual(fit_rect((95, 45, 10, 10), 100, 50), (90, 40, 10, 10))
        self.assertEqual(fit_rect((20, 20, 10, 10), 100, 50), (20, 20, 10, 10))

    def test_fit_rect_centers_when_it_cannot_fit(self):
        x, y, w, h = fit_rect((0, 0, 120, 40), 100, 50)
        self.assertEqual((w, h), (120, 40))
        self.assertEqual(x, -10)  # 20 px overflow split across both sides
        self.assertEqual(y, 0)


class CropContractTests(unittest.TestCase):
    def test_stitcher_schema(self):
        image = rand_image(1, 64, 96)
        mask = box_mask(64, 96, 24, 40, 40, 56)
        _, _, stitcher = build_crop(image, mask, 1.2, 8, 8)
        for key in ("kind", "version", "canvas", "canvas_to_original", "crop_to_canvas", "blend", "scale"):
            self.assertIn(key, stitcher)
        self.assertEqual(stitcher["kind"], "ausboss_inpaint_stitcher")
        self.assertEqual(stitcher["version"], 1)
        self.assertIsNone(stitcher["scale"])
        self.assertEqual(len(stitcher["canvas_to_original"]), 4)
        self.assertEqual(len(stitcher["crop_to_canvas"]), 4)
        self.assertEqual(stitcher["canvas"].shape[0], 1)
        self.assertEqual(stitcher["blend"].shape, stitcher["canvas"].shape[:3])

    def test_sampling_mask_is_the_raw_mask_never_feathered(self):
        image = rand_image(1, 40, 40, seed=1)
        mask = box_mask(40, 40, 10, 20, 10, 20)
        _, sampling, stitcher = build_crop(image, mask, 2.0, 16, 1)
        # context 2.0 on a 10x10 bbox with multiple 1 -> rect (5, 5, 20, 20)
        self.assertEqual(stitcher["crop_to_canvas"], (5, 5, 20, 20))
        self.assertTrue(torch.equal(sampling, mask[:, 5:25, 5:25]))
        values = torch.unique(sampling)
        self.assertTrue(all(v in (0.0, 1.0) for v in values.tolist()))
        # The blend mask is feathered: it must contain intermediate values.
        blend = stitcher["blend"]
        self.assertTrue(bool(((blend > 0.0) & (blend < 1.0)).any()))

    def test_native_crop_dims_round_up_to_output_multiple(self):
        image = rand_image(1, 50, 70, seed=2)
        mask = box_mask(50, 70, 10, 30, 10, 40)  # bbox 30x20
        cropped, sampling, stitcher = build_crop(image, mask, 1.0, 0, 8)
        self.assertEqual(cropped.shape, (1, 24, 32, 3))
        self.assertEqual(sampling.shape, (1, 24, 32))
        x, y, w, h = stitcher["crop_to_canvas"]
        self.assertEqual((w, h), (32, 24))
        self.assertTrue(torch.equal(sampling, mask[:, y : y + h, x : x + w]))

    def test_target_dims_round_up_to_output_multiple(self):
        image = rand_image(1, 64, 96, seed=3)
        mask = box_mask(64, 96, 24, 40, 40, 56)
        cropped, sampling, stitcher = build_crop(
            image, mask, 1.5, 8, 8, target_width=100, target_height=60
        )
        self.assertEqual(cropped.shape, (1, 64, 104, 3))
        self.assertEqual(sampling.shape, (1, 64, 104))
        self.assertIsNotNone(stitcher["scale"])

    def test_single_target_dim_keeps_aspect_and_multiple(self):
        image = rand_image(1, 64, 96, seed=4)
        mask = box_mask(64, 96, 24, 40, 40, 56)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 8, 8, target_width=128)
        self.assertEqual(cropped.shape[2], 128)
        self.assertEqual(cropped.shape[1] % 8, 0)
        self.assertIsNotNone(stitcher["scale"])

    def test_empty_mask_crops_the_full_image(self):
        image = rand_image(1, 32, 48, seed=5)
        mask = torch.zeros((1, 32, 48), dtype=torch.float32)
        cropped, sampling, stitcher = build_crop(image, mask, 1.2, 16, 8)
        self.assertTrue(torch.equal(cropped, image))
        self.assertEqual(float(sampling.sum()), 0.0)
        self.assertEqual(float(stitcher["blend"].sum()), 0.0)
        out = apply_stitch(stitcher, shuffle_pixels(cropped))
        self.assertTrue(torch.equal(out, image))

    def test_accepts_a_2d_mask(self):
        image = rand_image(1, 32, 32, seed=6)
        mask2d = torch.zeros((32, 32), dtype=torch.float32)
        mask2d[8:16, 8:16] = 1.0
        cropped, sampling, stitcher = build_crop(image, mask2d, 1.2, 4, 8)
        self.assertEqual(sampling.ndim, 3)
        out = apply_stitch(stitcher, cropped)
        self.assertTrue(torch.equal(out, image))

    def test_rejects_a_mask_that_does_not_match_the_image(self):
        image = rand_image(1, 32, 32, seed=7)
        mask = torch.zeros((1, 16, 16), dtype=torch.float32)
        with self.assertRaises(ValueError):
            build_crop(image, mask, 1.2, 8, 8)


class StitchExactnessTests(unittest.TestCase):
    def test_identity_round_trip_is_bit_exact(self):
        image = rand_image(1, 64, 96, seed=10)
        mask = box_mask(64, 96, 24, 40, 40, 56)
        cropped, _, stitcher = build_crop(image, mask, 1.2, 16, 8)
        out = apply_stitch(stitcher, cropped)
        self.assertTrue(torch.equal(out, image))

    def test_pixels_outside_the_blend_region_are_bit_identical(self):
        image = rand_image(1, 64, 96, seed=11)
        mask = box_mask(64, 96, 24, 40, 40, 56)
        cropped, _, stitcher = build_crop(image, mask, 2.0, 4, 8)
        out = apply_stitch(stitcher, shuffle_pixels(cropped))
        self.assertEqual(out.shape, image.shape)
        # blend reach is grow(4) + blur radius (<= 5); margin 10 is conservative.
        self.assertTrue(torch.equal(out[:, :14], image[:, :14]))
        self.assertTrue(torch.equal(out[:, 50:], image[:, 50:]))
        self.assertTrue(torch.equal(out[:, :, :30], image[:, :, :30]))
        self.assertTrue(torch.equal(out[:, :, 66:], image[:, :, 66:]))
        # The masked core really took the new content.
        self.assertFalse(torch.equal(out[:, 30:34, 46:50], image[:, 30:34, 46:50]))

    def test_mask_at_each_border_and_corner(self):
        height, width = 48, 64
        image = rand_image(1, height, width, seed=12)
        placements = [
            (0, 8, 28, 36),    # top edge
            (40, 48, 28, 36),  # bottom edge
            (20, 28, 0, 8),    # left edge
            (20, 28, 56, 64),  # right edge
            (0, 8, 0, 8),      # top-left corner
            (0, 8, 56, 64),    # top-right corner
            (40, 48, 0, 8),    # bottom-left corner
            (40, 48, 56, 64),  # bottom-right corner
        ]
        for y0, y1, x0, x1 in placements:
            with self.subTest(placement=(y0, y1, x0, x1)):
                mask = box_mask(height, width, y0, y1, x0, x1)
                cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
                self.assertEqual(cropped.shape[1] % 8, 0)
                self.assertEqual(cropped.shape[2] % 8, 0)
                out = apply_stitch(stitcher, cropped)
                self.assertTrue(torch.equal(out, image))

    def test_grown_rect_exceeding_bounds_takes_the_canvas_path(self):
        image = rand_image(1, 32, 32, seed=13)
        mask = box_mask(32, 32, 2, 30, 2, 30)
        cropped, _, stitcher = build_crop(image, mask, 3.0, 4, 8)
        canvas = stitcher["canvas"]
        self.assertGreater(canvas.shape[1], 32)
        self.assertGreater(canvas.shape[2], 32)
        ox, oy, ow, oh = stitcher["canvas_to_original"]
        self.assertEqual((ow, oh), (32, 32))
        # The original image lives verbatim inside the canvas...
        self.assertTrue(torch.equal(canvas[:, oy : oy + oh, ox : ox + ow], image))
        # ...and the padded margin replicates the image edges.
        if oy > 0:
            self.assertTrue(torch.equal(canvas[:, oy - 1, ox : ox + ow], image[:, 0, :]))
        if ox > 0:
            self.assertTrue(torch.equal(canvas[:, oy : oy + oh, ox - 1], image[:, :, 0]))
        out = apply_stitch(stitcher, cropped)
        self.assertTrue(torch.equal(out, image))

    def test_target_rescale_round_trip(self):
        image = gradient_image(1, 64, 64)
        mask = box_mask(64, 64, 24, 40, 24, 40)
        cropped, _, stitcher = build_crop(
            image, mask, 2.0, 4, 8, target_width=96, target_height=96
        )
        self.assertEqual(cropped.shape, (1, 96, 96, 3))
        out = apply_stitch(stitcher, cropped)
        self.assertEqual(out.shape, image.shape)
        # Outside the blend reach: bit exact even though the crop was rescaled.
        self.assertTrue(torch.equal(out[:, :14], image[:, :14]))
        self.assertTrue(torch.equal(out[:, 50:], image[:, 50:]))
        self.assertTrue(torch.equal(out[:, :, :14], image[:, :, :14]))
        self.assertTrue(torch.equal(out[:, :, 50:], image[:, :, 50:]))
        # Inside the blend zone: the up/down rescale stays within tolerance.
        self.assertTrue(
            torch.allclose(out[:, 24:40, 24:40], image[:, 24:40, 24:40], atol=0.02)
        )

    def test_stitch_does_not_mutate_the_stitcher(self):
        image = rand_image(1, 48, 48, seed=14)
        mask = box_mask(48, 48, 16, 32, 16, 32)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
        canvas_before = stitcher["canvas"].clone()
        first = apply_stitch(stitcher, shuffle_pixels(cropped))
        second = apply_stitch(stitcher, cropped)
        self.assertTrue(torch.equal(stitcher["canvas"], canvas_before))
        self.assertTrue(torch.equal(second, image))
        self.assertFalse(torch.equal(first, second))


class BatchTests(unittest.TestCase):
    def test_batch_one_stitcher_broadcasts_over_frames(self):
        image = rand_image(1, 64, 96, seed=20)
        mask = box_mask(64, 96, 24, 40, 40, 56)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
        frames = torch.cat(
            [cropped, shuffle_pixels(cropped), cropped * 0.5, cropped.flip(2)], dim=0
        )
        out = apply_stitch(stitcher, frames)
        self.assertEqual(out.shape, (4, 64, 96, 3))
        # The identity frame reproduces the original exactly.
        self.assertTrue(torch.equal(out[0:1], image))
        # Every frame keeps the untouched region bit identical.
        for index in range(4):
            self.assertTrue(torch.equal(out[index : index + 1, :14], image[:, :14]))
            self.assertTrue(torch.equal(out[index : index + 1, :, :30], image[:, :, :30]))

    def test_matched_batch_to_batch_stitch(self):
        base = gradient_image(3, 48, 48)
        image = (base + torch.tensor([0.0, 0.02, 0.04]).view(3, 1, 1, 1)).clamp(0, 1)
        mask = box_mask(48, 48, 16, 32, 16, 32)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
        self.assertEqual(stitcher["canvas"].shape[0], 3)
        self.assertEqual(cropped.shape[0], 3)
        out = apply_stitch(stitcher, cropped)
        self.assertTrue(torch.equal(out, image))

    def test_mismatched_batches_are_rejected(self):
        image = rand_image(3, 32, 32, seed=21)
        mask = box_mask(32, 32, 8, 24, 8, 24)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
        with self.assertRaises(ValueError):
            apply_stitch(stitcher, cropped[:2])

    def test_stitch_rejects_a_foreign_stitcher(self):
        with self.assertRaises(ValueError):
            apply_stitch({"kind": "something_else"}, rand_image(1, 8, 8))
        with self.assertRaises(ValueError):
            apply_stitch("not a dict", rand_image(1, 8, 8))


class EdgeHaloTests(unittest.TestCase):
    """fix_edge_halo may only change what is pasted, never how far."""

    def setUp(self):
        self.image = rand_image(1, 64, 96, seed=40)
        self.mask = box_mask(64, 96, 24, 40, 40, 56)
        self.cropped, _, self.stitcher = build_crop(self.image, self.mask, 1.5, 8, 8)

    def disable_pymatting(self):
        """Make the helper behave as if pymatting were not installed."""
        original = inpaint_helpers._foreground_estimator
        warned = set(inpaint_helpers._warned)
        inpaint_helpers._foreground_estimator = lambda: None
        inpaint_helpers._warned.clear()

        def restore():
            inpaint_helpers._foreground_estimator = original
            inpaint_helpers._warned.clear()
            inpaint_helpers._warned.update(warned)

        self.addCleanup(restore)

    def stub_helper(self, name, replacement):
        """Swap one module-level seam for the length of a test."""
        original = getattr(inpaint_helpers, name)
        setattr(inpaint_helpers, name, replacement)
        self.addCleanup(lambda: setattr(inpaint_helpers, name, original))

    def stub_estimator(self, estimate):
        self.stub_helper("_foreground_estimator", lambda: estimate)

    def three_frames(self) -> torch.Tensor:
        return torch.cat(
            [self.cropped, shuffle_pixels(self.cropped), self.cropped * 0.5], dim=0
        )

    def test_toggle_off_is_the_paste_this_node_already_shipped(self):
        patch = shuffle_pixels(self.cropped)
        legacy = apply_stitch(self.stitcher, patch)
        self.assertTrue(torch.equal(apply_stitch(self.stitcher, patch, False), legacy))
        # The identity round trip stays exact on the default path.
        self.assertTrue(torch.equal(apply_stitch(self.stitcher, self.cropped, False), self.image))

    def test_toggle_on_without_pymatting_warns_once_and_pastes_unchanged(self):
        self.disable_pymatting()
        patch = shuffle_pixels(self.cropped)
        plain = apply_stitch(self.stitcher, patch)
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            first = apply_stitch(self.stitcher, patch, True)
            second = apply_stitch(self.stitcher, patch, True)
        self.assertTrue(torch.equal(first, plain))
        self.assertTrue(torch.equal(second, plain))
        output = buffer.getvalue()
        self.assertEqual(output.count("[AusBoss]"), 1)
        self.assertIn("pymatting", output)
        output.encode("ascii")  # console output must stay ASCII

    def test_a_hard_blend_has_no_feathered_band_to_spread(self):
        cropped, _, stitcher = build_crop(self.image, self.mask, 1.5, 0, 8)
        patch = shuffle_pixels(cropped)
        self.assertTrue(
            torch.equal(apply_stitch(stitcher, patch, True), apply_stitch(stitcher, patch))
        )

    def test_empty_mask_with_the_toggle_still_returns_the_original(self):
        empty = torch.zeros((1, 64, 96), dtype=torch.float32)
        cropped, _, stitcher = build_crop(self.image, empty, 1.2, 16, 8)
        out = apply_stitch(stitcher, shuffle_pixels(cropped), True)
        self.assertTrue(torch.equal(out, self.image))

    @unittest.skipUnless(HAS_PYMATTING, "pymatting is not installed")
    def test_spread_keeps_the_untouched_region_bit_identical(self):
        patch = shuffle_pixels(self.cropped)
        untouched, band = blend_bands(self.stitcher)
        self.assertTrue(bool(untouched.any()))
        self.assertTrue(bool(band.any()))
        out = apply_stitch(self.stitcher, patch, True)
        self.assertEqual(out.shape, self.image.shape)
        self.assertTrue(torch.equal(out[untouched], self.image[untouched]))
        # The pasted content really did change under the feather.
        self.assertFalse(torch.equal(out[band], apply_stitch(self.stitcher, patch)[band]))

    @unittest.skipUnless(HAS_PYMATTING, "pymatting is not installed")
    def test_spread_removes_the_double_blended_seam(self):
        # Wide context against a modest feather, so the band is well inside
        # the paste window instead of running off its edge.
        image = gradient_image(1, 128, 128)
        mask = box_mask(128, 128, 48, 80, 48, 80)
        cropped, _, stitcher = build_crop(image, mask, 2.0, 6, 8)
        untouched, band = blend_bands(stitcher)
        self.assertGreater(int(band.sum()), 500)

        color = torch.tensor([0.85, 0.30, 0.20])
        clean = color.view(1, 1, 1, 3).expand_as(cropped).contiguous()
        ideal = apply_stitch(stitcher, clean)  # one honest feathered paste
        patch = contaminated_patch(stitcher, color)
        plain = apply_stitch(stitcher, patch)
        fixed = apply_stitch(stitcher, patch, True)

        halo = float((plain[band] - ideal[band]).abs().mean())
        residue = float((fixed[band] - ideal[band]).abs().mean())
        self.assertGreater(halo, 0.02)  # the halo is really there
        # A user who turns this on should stop seeing the rim, not see a
        # slightly fainter one. Dilating the estimate's mask is what erodes
        # this, so the bound is tight enough to catch that regression.
        self.assertLess(residue, halo * 0.25)
        # ...and fixing it did not spill past the paste.
        self.assertTrue(torch.equal(fixed[untouched], image[untouched]))

    @unittest.skipUnless(HAS_PYMATTING, "pymatting is not installed")
    def test_spread_across_a_broadcast_frame_batch(self):
        frames = torch.cat([self.cropped, shuffle_pixels(self.cropped)], dim=0)
        untouched, _ = blend_bands(self.stitcher)
        out = apply_stitch(self.stitcher, frames, True)
        self.assertEqual(out.shape, (2, 64, 96, 3))
        for index in range(2):
            frame = out[index : index + 1]
            self.assertTrue(torch.equal(frame[untouched], self.image[untouched]))

    def test_a_cancel_lands_between_frames(self):
        """A batch started by mistake stops at the next frame boundary."""
        frames = self.three_frames()
        solved = []

        def solve(image, matte):
            solved.append(image.shape)
            return image  # a legal estimate; this test is about the loop

        self.stub_estimator(solve)
        expected = apply_stitch(self.stitcher, frames, True)
        self.assertEqual(len(solved), 3)  # one solve per frame

        class Cancelled(Exception):
            pass

        checks = []
        cancel_at = [2]

        def check():
            checks.append(1)
            if len(checks) == cancel_at[0]:
                raise Cancelled

        self.stub_helper("_raise_if_interrupted", check)
        solved.clear()
        canvas_before = self.stitcher["canvas"].clone()
        frames_before = frames.clone()
        with self.assertRaises(Cancelled):
            apply_stitch(self.stitcher, frames, True)
        # Checked before frame 0 and again before frame 1: the first frame's
        # solve ran, the second never started.
        self.assertEqual(len(checks), 2)
        self.assertEqual(len(solved), 1)
        # The cancelled run left nothing behind in the inputs...
        self.assertTrue(torch.equal(frames, frames_before))
        self.assertTrue(torch.equal(self.stitcher["canvas"], canvas_before))
        # ...and the finished frame was neither kept nor double-counted: the
        # same call reruns from scratch and returns the same pixels.
        cancel_at[0] = 0
        checks.clear()
        solved.clear()
        self.assertTrue(torch.equal(apply_stitch(self.stitcher, frames, True), expected))
        self.assertEqual(len(checks), 3)
        self.assertEqual(len(solved), 3)

    def test_progress_is_reported_once_per_frame(self):
        class Recorder:
            def __init__(self, total):
                self.total = total
                self.updates = []

            def update_absolute(self, value, total=None, preview=None):
                self.updates.append((value, total))

        bars = []

        def make_bar(total):
            bars.append(Recorder(total))
            return bars[-1]

        self.stub_helper("_progress_bar", make_bar)
        self.stub_estimator(lambda image, matte: image)

        apply_stitch(self.stitcher, self.three_frames(), True)
        self.assertEqual(len(bars), 1)
        self.assertEqual(bars[0].total, 3)
        self.assertEqual(bars[0].updates, [(1, 3), (2, 3), (3, 3)])

        # A single frame finishes before a bar would mean anything.
        bars.clear()
        apply_stitch(self.stitcher, self.cropped, True)
        self.assertEqual(bars, [])

    @unittest.skipUnless(HAS_PYMATTING, "pymatting is not installed")
    def test_the_estimator_is_fed_float32_and_float64_would_not_change_it(self):
        from pymatting import estimate_foreground_ml

        seen = []

        def estimate(image, matte):
            seen.append((str(image.dtype), str(matte.dtype)))
            result = estimate_foreground_ml(image, matte)
            # Exactly the float64 round trip this helper used to make: widen
            # the same float32 inputs and hand those over instead.
            legacy = estimate_foreground_ml(
                image.astype("float64"), matte.astype("float64")
            )
            self.assertTrue(bool((result == legacy).all()))
            return result

        self.stub_estimator(estimate)
        patch = shuffle_pixels(self.cropped)
        fixed = apply_stitch(self.stitcher, patch, True)
        self.assertEqual(seen, [("float32", "float32")])
        self.assertFalse(torch.equal(fixed, apply_stitch(self.stitcher, patch)))

    def test_node_appends_the_toggle_as_an_optional_widget(self):
        from nodes.node_inpaint_crop_stitch import NODE_CLASS_MAPPINGS

        stitch_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_StitchInpaint"]
        types = stitch_cls.INPUT_TYPES()
        self.assertEqual(list(types["required"]), ["stitcher", "inpainted"])
        self.assertEqual(list(types["optional"]), ["fix_edge_halo"])
        kind, options = types["optional"]["fix_edge_halo"]
        self.assertEqual(kind, "BOOLEAN")
        self.assertIs(options["default"], False)
        self.assertIn("pymatting", options["tooltip"])

        node = stitch_cls()
        patch = shuffle_pixels(self.cropped)
        # A workflow saved before the widget existed omits it entirely.
        legacy = getattr(node, stitch_cls.FUNCTION)(stitcher=self.stitcher, inpainted=patch)
        self.assertTrue(torch.equal(legacy[0], apply_stitch(self.stitcher, patch)))
        toggled = getattr(node, stitch_cls.FUNCTION)(
            stitcher=self.stitcher, inpainted=patch, fix_edge_halo=True
        )
        self.assertTrue(torch.equal(toggled[0], apply_stitch(self.stitcher, patch, True)))


class NodeWiringTests(unittest.TestCase):
    def test_nodes_round_trip_through_the_public_wrappers(self):
        from nodes.node_inpaint_crop_stitch import (
            NODE_CLASS_MAPPINGS,
            NODE_DISPLAY_NAME_MAPPINGS,
        )

        self.assertIn("AUSBOSS_NODES_CropForInpaint", NODE_CLASS_MAPPINGS)
        self.assertIn("AUSBOSS_NODES_StitchInpaint", NODE_CLASS_MAPPINGS)
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_CropForInpaint"],
            "Crop For Inpaint (AusBoss)",
        )
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_StitchInpaint"],
            "Stitch Inpaint (AusBoss)",
        )

        crop_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_CropForInpaint"]
        stitch_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_StitchInpaint"]
        self.assertIn("AusBoss/Inpaint", crop_cls.CATEGORY)
        self.assertIn("AusBoss/Inpaint", stitch_cls.CATEGORY)
        self.assertEqual(crop_cls.RETURN_TYPES, ("IMAGE", "MASK", "AUSBOSS_STITCHER"))
        self.assertEqual(stitch_cls.RETURN_TYPES, ("IMAGE",))

        image = rand_image(1, 64, 96, seed=30)
        mask = box_mask(64, 96, 24, 40, 40, 56)
        crop_result = getattr(crop_cls(), crop_cls.FUNCTION)(
            image=image,
            mask=mask,
            context_factor=1.2,
            blend_pixels=16,
            output_multiple=8,
            target_width=0,
            target_height=0,
        )
        self.assertEqual(len(crop_result), 3)
        stitch_result = getattr(stitch_cls(), stitch_cls.FUNCTION)(
            stitcher=crop_result[2], inpainted=crop_result[0]
        )
        self.assertEqual(len(stitch_result), 1)
        self.assertTrue(torch.equal(stitch_result[0], image))


if __name__ == "__main__":
    unittest.main()
