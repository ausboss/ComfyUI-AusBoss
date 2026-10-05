from __future__ import annotations

import contextlib
import importlib.util
import io
import math
from pathlib import Path
import sys
import types
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _inpaint_crop_helpers as inpaint_helpers
from nodes._inpaint_crop_helpers import (
    build_canvas_stitcher,
    stitch_blend_from_mask,
    apply_stitch,
    build_crop,
    expand_rect_to_multiple,
    fit_rect,
    grow_rect,
    mask_bbox,
    round_up_to_multiple,
    stitch_blend_mask,
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


def moving_box_mask(frames: int, height: int, width: int) -> torch.Tensor:
    """A per-frame mask whose 8x8 box steps diagonally, so no two frames match."""
    mask = torch.zeros((frames, height, width), dtype=torch.float32)
    for index in range(frames):
        offset = 8 + 4 * index
        mask[index, offset : offset + 8, offset : offset + 8] = 1.0
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

    def test_mask_grow_widens_the_selection_and_the_crop(self):
        image = rand_image(1, 40, 40, seed=2)
        mask = box_mask(40, 40, 15, 25, 15, 25)
        _, plain, _ = build_crop(image, mask, 1.0, 0, 1)
        _, grown, grown_stitcher = build_crop(image, mask, 1.0, 0, 1, mask_grow=4)
        self.assertGreater(grown.sum().item(), plain.sum().item())
        # The crop window follows the grown mask's bbox.
        self.assertEqual(grown_stitcher["crop_to_canvas"], (11, 11, 18, 18))

    def test_mask_blur_softens_the_sampling_edge(self):
        image = rand_image(1, 40, 40, seed=3)
        mask = box_mask(40, 40, 15, 25, 15, 25)
        _, sampling, _ = build_crop(image, mask, 1.5, 0, 1, mask_blur=2.0)
        self.assertTrue(bool(((sampling > 0.0) & (sampling < 1.0)).any()))

    def test_invert_mask_selects_the_outside(self):
        image = rand_image(1, 40, 40, seed=4)
        mask = box_mask(40, 40, 10, 30, 10, 30)
        _, sampling, _ = build_crop(image, mask, 1.0, 0, 1, invert_mask=True)
        # The inverted selection touches the frame edge, so the crop is the
        # whole image and the sampled corner is white while the center is not.
        self.assertEqual(sampling.shape[1:], (40, 40))
        self.assertEqual(sampling[0, 0, 0].item(), 1.0)
        self.assertEqual(sampling[0, 20, 20].item(), 0.0)

    def test_context_pixels_add_flat_margin(self):
        image = rand_image(1, 64, 64, seed=5)
        mask = box_mask(64, 64, 28, 36, 28, 36)
        _, _, tight = build_crop(image, mask, 1.0, 0, 1)
        _, _, padded = build_crop(image, mask, 1.0, 0, 1, context_pixels=8)
        tx, ty, tw, th = tight["crop_to_canvas"]
        px, py, pw, ph = padded["crop_to_canvas"]
        self.assertEqual((px, py), (tx - 8, ty - 8))
        self.assertEqual((pw, ph), (tw + 16, th + 16))

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

    def test_a_shorter_generated_batch_stitches_the_leading_frames(self):
        # A video model keeps 8n+1 frames and drops the tail: the frames
        # that came back land on their own source frames, the rest go.
        image = rand_image(5, 32, 32, seed=21)
        mask = box_mask(32, 32, 8, 24, 8, 24)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
        out = apply_stitch(stitcher, cropped[:3])
        self.assertEqual(out.shape[0], 3)
        self.assertTrue(torch.equal(out, image[:3]))

    def test_a_longer_generated_batch_is_rejected(self):
        image = rand_image(3, 32, 32, seed=21)
        mask = box_mask(32, 32, 8, 24, 8, 24)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
        with self.assertRaises(ValueError):
            apply_stitch(stitcher, torch.cat([cropped, cropped], dim=0))

    def test_stitch_rejects_a_foreign_stitcher(self):
        with self.assertRaises(ValueError):
            apply_stitch({"kind": "something_else"}, rand_image(1, 8, 8))
        with self.assertRaises(ValueError):
            apply_stitch("not a dict", rand_image(1, 8, 8))


class ChannelTests(unittest.TestCase):
    def test_an_rgba_inpainted_batch_drops_its_alpha_over_an_rgb_source(self):
        # Qwen Image 2.1's VAE decodes RGBA straight into the stitch.
        from nodes.node_inpaint_crop_stitch import NODE_CLASS_MAPPINGS

        stitch_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_StitchInpaint"]
        image = rand_image(1, 48, 64, seed=24)
        mask = box_mask(48, 64, 16, 32, 24, 40)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
        frames = torch.cat([cropped, shuffle_pixels(cropped)], dim=0)
        alpha = torch.rand(frames.shape[:3] + (1,), generator=torch.Generator().manual_seed(25))
        rgba = torch.cat([frames, alpha], dim=-1)
        stitched, blend_mask = getattr(stitch_cls(), stitch_cls.FUNCTION)(
            stitcher=stitcher, inpainted=rgba
        )
        self.assertEqual(stitched.shape, (2, 48, 64, 3))
        self.assertTrue(torch.equal(stitched, apply_stitch(stitcher, frames)))
        self.assertTrue(torch.equal(stitched[0:1], image))
        self.assertEqual(tuple(blend_mask.shape), (2, 48, 64))

    def test_other_channel_mismatches_are_still_rejected(self):
        image = rand_image(1, 32, 32, seed=26)
        mask = box_mask(32, 32, 8, 24, 8, 24)
        cropped, _, stitcher = build_crop(image, mask, 1.5, 4, 8)
        for channels in (1, 2, 5):
            patch = cropped[..., :1].expand(-1, -1, -1, channels)
            with self.subTest(channels=channels), self.assertRaises(ValueError):
                apply_stitch(stitcher, patch)
        rgba_source = torch.cat([image, torch.ones_like(image[..., :1])], dim=-1)
        _c, _s, rgba_stitcher = build_crop(rgba_source, mask, 1.5, 4, 8)
        with self.assertRaises(ValueError):
            apply_stitch(rgba_stitcher, cropped)


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

        self.stub_helper("raise_if_interrupted", check)
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

        self.stub_helper("progress_bar", make_bar)
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
        self.assertEqual(list(types["optional"]), ["fix_edge_halo", "color_match", "seam"])
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


class TargetMegapixelTests(unittest.TestCase):
    def test_megapixels_rescales_the_crop_toward_the_target_area(self):
        image = rand_image(1, 256, 256, seed=31)
        mask = box_mask(256, 256, 96, 160, 96, 160)
        cropped, sampling, stitcher = build_crop(
            image, mask, 1.0, 0, 8, target_megapixels=0.25
        )
        area = cropped.shape[1] * cropped.shape[2]
        # Multiple-of-8 rounding wobbles the exact area; it must land close.
        self.assertGreater(area, 200_000)
        self.assertLess(area, 320_000)
        self.assertEqual(sampling.shape[1:], cropped.shape[1:3])
        self.assertIsNotNone(stitcher["scale"])

    def test_explicit_target_beats_megapixels(self):
        image = rand_image(1, 128, 128, seed=32)
        mask = box_mask(128, 128, 32, 96, 32, 96)
        cropped, _sampling, _stitcher = build_crop(
            image, mask, 1.0, 0, 8, target_width=64, target_height=64,
            target_megapixels=4.0,
        )
        self.assertEqual(tuple(cropped.shape[1:3]), (64, 64))

    def test_megapixel_round_trip_still_stitches_exactly(self):
        image = rand_image(1, 96, 96, seed=33)
        mask = box_mask(96, 96, 24, 72, 24, 72)
        _cropped, _sampling, stitcher = build_crop(
            image, mask, 1.2, 4, 8, target_megapixels=0.1
        )
        cx, cy, cw, ch = stitcher["crop_to_canvas"]
        untouched = stitcher["canvas"][:, cy : cy + ch, cx : cx + cw, :]
        out = apply_stitch(stitcher, untouched)
        self.assertTrue(torch.equal(out, image))


class RescaleAlgorithmTests(unittest.TestCase):
    def test_unknown_algorithm_is_rejected(self):
        image = rand_image(1, 64, 64, seed=34)
        mask = box_mask(64, 64, 16, 48, 16, 48)
        with self.assertRaisesRegex(ValueError, "rescale_algorithm"):
            build_crop(image, mask, 1.0, 0, 8, rescale_algorithm="lanczos")

    def test_algorithm_rides_the_stitcher_for_the_paste_back(self):
        image = rand_image(1, 64, 64, seed=35)
        mask = box_mask(64, 64, 16, 48, 16, 48)
        for algorithm in ("bilinear", "bicubic", "area", "nearest"):
            _c, _s, stitcher = build_crop(
                image, mask, 1.0, 0, 8, rescale_algorithm=algorithm
            )
            self.assertEqual(stitcher["algorithm"], algorithm)


class OutpaintExtendTests(unittest.TestCase):
    def test_extension_grows_the_stitched_output(self):
        image = rand_image(1, 32, 32, seed=36)
        empty = torch.zeros((1, 32, 32), dtype=torch.float32)
        cropped, sampling, stitcher = build_crop(
            image, empty, 1.0, 0, 1, extend_right=16, extend_down=8
        )
        # The crop covers the whole extended frame...
        self.assertEqual(tuple(cropped.shape[1:3]), (40, 48))
        # ...and the extension bands are marked for painting.
        self.assertEqual(float(sampling[:, :, 32:].min()), 1.0)
        self.assertEqual(float(sampling[:, 32:, :].min()), 1.0)
        self.assertEqual(float(sampling[:, :32, :32].max()), 0.0)
        # Stitching returns the extended size, original area untouched.
        out = apply_stitch(stitcher, cropped)
        self.assertEqual(tuple(out.shape[1:3]), (40, 48))
        self.assertTrue(torch.equal(out[:, :32, :32, :], image))

    def test_extension_combines_with_a_drawn_mask(self):
        image = rand_image(1, 48, 48, seed=37)
        mask = box_mask(48, 48, 8, 16, 8, 16)
        _cropped, _sampling, stitcher = build_crop(
            image, mask, 1.0, 0, 1, extend_left=8
        )
        # The union bbox spans from the new left band to the drawn box.
        cx, cy, cw, ch = stitcher["crop_to_canvas"]
        self.assertEqual(cx, 0)
        self.assertGreaterEqual(cw, 8 + 16)


class KeepInsideTests(unittest.TestCase):
    """A mask as wide as a narrow picture: the grown box is wider than the frame."""

    def setUp(self):
        self.image = rand_image(1, 64, 48, seed=40)  # 48 wide, 64 tall
        self.mask = box_mask(64, 48, 40, 56, 0, 48)  # the full width, 16 tall

    def crop_node(self, **overrides):
        from nodes.node_inpaint_crop_stitch import NODE_CLASS_MAPPINGS

        crop_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_CropForInpaint"]
        inputs = dict(image=self.image, mask=self.mask, context_factor=2.0, blend_pixels=4, output_multiple=8)
        return getattr(crop_cls(), crop_cls.FUNCTION)(**{**inputs, **overrides})

    def test_node_keeps_the_crop_inside_the_picture_by_default(self):
        cropped, _sampling, stitcher = self.crop_node()
        # No padded margin: the canvas is the picture itself.
        self.assertEqual(tuple(stitcher["canvas"].shape), tuple(self.image.shape))
        self.assertEqual(stitcher["canvas_to_original"], (0, 0, 48, 64))
        cx, _cy, cw, _ch = stitcher["crop_to_canvas"]
        self.assertEqual((cx, cw), (0, 48))
        self.assertTrue(torch.equal(apply_stitch(stitcher, cropped), self.image))

    def test_turning_it_off_restores_the_padded_crop(self):
        _cropped, _sampling, stitcher = self.crop_node(keep_inside=False)
        self.assertEqual(stitcher["canvas"].shape[2], 96)
        self.assertEqual(stitcher["canvas_to_original"][0], 24)

    def test_the_helper_default_still_pads_for_existing_callers(self):
        _cropped, _sampling, stitcher = build_crop(self.image, self.mask, 2.0, 4, 8)
        self.assertEqual(stitcher["canvas"].shape[2], 96)

    def test_a_megapixel_target_draws_only_real_picture_and_larger(self):
        inside = build_crop(self.image, self.mask, 2.0, 4, 8, target_megapixels=0.01, keep_inside=True)[2]
        padded = build_crop(self.image, self.mask, 2.0, 4, 8, target_megapixels=0.01)[2]
        self.assertEqual(tuple(inside["canvas"].shape), tuple(self.image.shape))
        # The same pixel budget spent on real picture only: every source pixel is drawn larger.
        self.assertGreater(inside["scale"][0], padded["scale"][0])
        cx, cy, cw, ch = inside["crop_to_canvas"]
        untouched = inside["canvas"][:, cy : cy + ch, cx : cx + cw, :]
        self.assertTrue(torch.equal(apply_stitch(inside, untouched), self.image))

    def test_an_axis_that_fits_is_only_shifted(self):
        mask = box_mask(64, 48, 4, 12, 20, 28)  # a small box near the top edge
        inside = build_crop(self.image, mask, 2.0, 4, 8, keep_inside=True)[2]
        padded = build_crop(self.image, mask, 2.0, 4, 8)[2]
        self.assertEqual(inside["crop_to_canvas"], padded["crop_to_canvas"])
        self.assertEqual(inside["canvas_to_original"], padded["canvas_to_original"])

    def test_outpaint_extension_still_grows_the_output(self):
        empty = torch.zeros((1, 64, 48), dtype=torch.float32)
        cropped, _sampling, stitcher = build_crop(
            self.image, empty, 2.0, 0, 1, extend_right=16, keep_inside=True
        )
        out = apply_stitch(stitcher, cropped)
        self.assertEqual(tuple(out.shape[1:3]), (64, 64))
        self.assertTrue(torch.equal(out[:, :, :48, :], self.image))


class BlendMaskOutputTests(unittest.TestCase):
    """blend_mask maps the paste feather back onto the stitched image."""

    def setUp(self):
        self.image = rand_image(1, 64, 96, seed=50)
        self.mask = box_mask(64, 96, 24, 40, 40, 56)

    def test_matches_the_blend_over_the_original_window(self):
        _c, _s, stitcher = build_crop(self.image, self.mask, 1.5, 8, 8)
        out_mask = stitch_blend_mask(stitcher)
        ox, oy, ow, oh = stitcher["canvas_to_original"]
        self.assertEqual(tuple(out_mask.shape), (1, oh, ow))
        self.assertTrue(
            torch.equal(out_mask, stitcher["blend"][:, oy : oy + oh, ox : ox + ow])
        )
        # It is the feathered paste mask: intermediate values exist, and far
        # corners the paste cannot reach stay zero.
        self.assertTrue(bool(((out_mask > 0.0) & (out_mask < 1.0)).any()))
        self.assertEqual(float(out_mask[:, :8, :8].max()), 0.0)

    def test_shape_follows_the_stitched_image(self):
        cropped, _s, stitcher = build_crop(self.image, self.mask, 1.5, 8, 8)
        out = apply_stitch(stitcher, cropped)
        out_mask = stitch_blend_mask(stitcher, out.shape[0])
        self.assertEqual(tuple(out_mask.shape), tuple(out.shape[:3]))

    def test_a_padded_canvas_slices_back_to_the_original_size(self):
        image = rand_image(1, 32, 32, seed=51)
        mask = box_mask(32, 32, 2, 30, 2, 30)
        _c, _s, stitcher = build_crop(image, mask, 3.0, 4, 8)
        self.assertGreater(stitcher["canvas"].shape[1], 32)  # really padded
        out_mask = stitch_blend_mask(stitcher)
        self.assertEqual(tuple(out_mask.shape), (1, 32, 32))

    def test_a_single_image_stitcher_broadcasts_across_frames(self):
        _c, _s, stitcher = build_crop(self.image, self.mask, 1.5, 8, 8)
        single = stitch_blend_mask(stitcher, 1)
        broadcast = stitch_blend_mask(stitcher, 4)
        self.assertEqual(broadcast.shape[0], 4)
        for index in range(4):
            self.assertTrue(torch.equal(broadcast[index : index + 1], single))

    def test_a_longer_stitcher_is_trimmed_to_the_leading_frames(self):
        # apply_stitch keeps the leading frames when fewer come back; the
        # mask must follow it rather than refuse the shorter batch.
        _c, _s, stitcher = build_crop(
            rand_image(3, 48, 48, seed=52), moving_box_mask(3, 48, 48), 1.5, 4, 8
        )
        blend = stitcher["blend"]
        self.assertEqual(blend.shape[0], 3)
        self.assertFalse(torch.equal(blend[1], blend[2]))  # per-frame, not one
        ox, oy, ow, oh = stitcher["canvas_to_original"]
        trimmed = stitch_blend_mask(stitcher, 2)
        self.assertTrue(torch.equal(trimmed, blend[:2, oy : oy + oh, ox : ox + ow]))

    def test_frames_the_stitcher_never_had_are_rejected(self):
        _c, _s, stitcher = build_crop(
            rand_image(3, 48, 48, seed=52), moving_box_mask(3, 48, 48), 1.5, 4, 8
        )
        with self.assertRaises(ValueError):
            stitch_blend_mask(stitcher, 4)

    def test_a_foreign_stitcher_is_rejected(self):
        with self.assertRaises(ValueError):
            stitch_blend_mask({"kind": "something_else"})
        with self.assertRaises(ValueError):
            stitch_blend_mask("not a dict")

    def test_an_empty_mask_yields_an_empty_blend_mask(self):
        empty = torch.zeros((1, 64, 96), dtype=torch.float32)
        _c, _s, stitcher = build_crop(self.image, empty, 1.2, 16, 8)
        self.assertEqual(float(stitch_blend_mask(stitcher).sum()), 0.0)

    def test_the_node_returns_image_then_blend_mask(self):
        from nodes.node_inpaint_crop_stitch import NODE_CLASS_MAPPINGS

        stitch_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_StitchInpaint"]
        cropped, _s, stitcher = build_crop(self.image, self.mask, 1.5, 8, 8)
        frames = torch.cat([cropped, shuffle_pixels(cropped)], dim=0)
        result = getattr(stitch_cls(), stitch_cls.FUNCTION)(
            stitcher=stitcher, inpainted=frames
        )
        self.assertEqual(len(result), 2)
        # BHW MASK, batched like the stitched image so downstream nodes
        # (e.g. a color match) can consume the pair directly.
        self.assertEqual(result[1].ndim, 3)
        self.assertEqual(result[1].shape[0], result[0].shape[0])
        self.assertEqual(tuple(result[1].shape[1:]), tuple(result[0].shape[1:3]))

    def test_the_node_stitches_fewer_frames_than_a_per_frame_mask_holds(self):
        # A video model keeps 8n+1 or 4n+1 frames: nine went in, five came
        # back. The stitch pastes the leading five and the mask follows it.
        from nodes.node_inpaint_crop_stitch import NODE_CLASS_MAPPINGS

        crop_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_CropForInpaint"]
        stitch_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_StitchInpaint"]
        image = rand_image(9, 48, 64, seed=53)
        cropped, _s, stitcher = getattr(crop_cls(), crop_cls.FUNCTION)(
            image=image,
            mask=moving_box_mask(9, 48, 64),
            context_factor=1.2,
            blend_pixels=8,
            output_multiple=8,
        )
        self.assertEqual(stitcher["blend"].shape[0], 9)
        with contextlib.redirect_stdout(io.StringIO()) as note:
            stitched, blend_mask = getattr(stitch_cls(), stitch_cls.FUNCTION)(
                stitcher=stitcher, inpainted=cropped[:5]
            )
        self.assertIn("stitching the first 5", note.getvalue())
        self.assertTrue(torch.equal(stitched, image[:5]))
        ox, oy, ow, oh = stitcher["canvas_to_original"]
        self.assertEqual(tuple(blend_mask.shape), (5, 48, 64))
        self.assertTrue(
            torch.equal(blend_mask, stitcher["blend"][:5, oy : oy + oh, ox : ox + ow])
        )


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
            "Crop For Inpaint 🆎",
        )
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_StitchInpaint"],
            "Stitch Inpaint 🆎",
        )

        crop_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_CropForInpaint"]
        stitch_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_StitchInpaint"]
        self.assertIn("AusBoss/Inpaint", crop_cls.CATEGORY)
        self.assertIn("AusBoss/Inpaint", stitch_cls.CATEGORY)
        self.assertEqual(crop_cls.RETURN_TYPES, ("IMAGE", "MASK", "AUSBOSS_STITCHER"))
        # blend_mask is appended after image; the existing slot never moves.
        self.assertEqual(stitch_cls.RETURN_TYPES, ("IMAGE", "MASK"))
        self.assertEqual(stitch_cls.RETURN_NAMES, ("image", "blend_mask"))
        self.assertEqual(len(stitch_cls.OUTPUT_TOOLTIPS), 2)

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
        self.assertEqual(len(stitch_result), 2)
        self.assertTrue(torch.equal(stitch_result[0], image))
        self.assertTrue(
            torch.equal(stitch_result[1], stitch_blend_mask(crop_result[2]))
        )


class CanvasStitcherTests(unittest.TestCase):
    """Padding sends the whole canvas to the sampler, so its stitcher is the
    identity crop with the pad band as the blend."""

    def setUp(self):
        torch.manual_seed(7)
        self.source = torch.rand(1, 32, 24, 3)
        self.canvas = torch.rand(1, 48, 40, 3)
        self.canvas[:, 8:40, 8:32, :] = self.source          # source at (8, 8)
        self.mask = torch.ones(1, 48, 40)
        self.mask[:, 8:40, 8:32] = 0.0                       # protect the source

    def test_zero_blend_region_is_bit_identical(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask)
        out = apply_stitch(stitcher, torch.rand_like(self.canvas))
        self.assertTrue(torch.equal(out[:, 8:40, 8:32, :], self.source))

    def test_masked_band_takes_the_sampled_pixels(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask)
        sampled = torch.rand_like(self.canvas)
        out = apply_stitch(stitcher, sampled)
        band = self.mask[0] >= 1.0
        self.assertTrue(torch.allclose(out[0][band], sampled[0][band], atol=1e-6))

    def test_identity_round_trip_is_exact(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask)
        self.assertTrue(torch.equal(apply_stitch(stitcher, self.canvas), self.canvas))

    def test_output_keeps_the_full_canvas_size(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask)
        out = apply_stitch(stitcher, torch.rand_like(self.canvas))
        self.assertEqual(out.shape, self.canvas.shape)

    def test_a_feathered_band_blends_rather_than_replaces(self):
        soft = self.mask.clone()
        soft[:, 6:8, 8:32] = 0.5
        stitcher = build_canvas_stitcher(self.canvas, soft)
        sampled = torch.zeros_like(self.canvas)
        out = apply_stitch(stitcher, sampled)
        expected = self.canvas[:, 6:8, 8:32, :] * 0.5
        self.assertTrue(torch.allclose(out[:, 6:8, 8:32, :], expected, atol=1e-6))

    def test_stitch_node_accepts_it(self):
        # Same stitcher shape as Crop For Inpaint, so one stitch node serves both.
        stitcher = build_canvas_stitcher(self.canvas, self.mask)
        self.assertEqual(stitcher["kind"], inpaint_helpers.STITCHER_KIND)
        self.assertEqual(stitcher["crop_to_canvas"], (0, 0, 40, 48))
        self.assertEqual(stitcher["canvas_to_original"], (0, 0, 40, 48))


class CanvasStitcherBboxTests(unittest.TestCase):
    """Where the source sits inside the canvas rides on the stitcher, so a
    model that places reference tokens on the canvas grid cannot be handed a
    canvas without its placement."""

    def setUp(self):
        torch.manual_seed(11)
        self.canvas = torch.rand(1, 48, 40, 3)
        self.mask = torch.zeros(1, 48, 40)
        self.mask[:, :8, :] = 1.0

    def test_bbox_is_absent_unless_given(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask)
        self.assertNotIn("source_bbox", stitcher)
        self.assertNotIn("bbox_normalized", stitcher)

    def test_bbox_is_stored_in_pixels_and_normalized(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask, bbox=(8, 8, 32, 40))
        self.assertEqual(stitcher["source_bbox"], (8, 8, 32, 40))
        # Canvas is 40 wide, 48 tall: x over width, y over height.
        self.assertEqual(
            stitcher["bbox_normalized"], [8 / 40, 8 / 48, 32 / 40, 40 / 48]
        )

    def test_a_full_canvas_bbox_normalizes_to_the_unit_square(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask, bbox=(0, 0, 40, 48))
        self.assertEqual(stitcher["bbox_normalized"], [0.0, 0.0, 1.0, 1.0])

    def test_floats_are_taken_as_pixels(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask, bbox=(8.0, 8.0, 32.0, 40.0))
        self.assertEqual(stitcher["source_bbox"], (8, 8, 32, 40))

    def test_stitching_ignores_the_bbox_entirely(self):
        # apply_stitch never reads it, so an older stitcher still stitches and
        # a newer one stitches identically.
        plain = build_canvas_stitcher(self.canvas, self.mask)
        with_bbox = build_canvas_stitcher(self.canvas, self.mask, bbox=(8, 8, 32, 40))
        sampled = torch.zeros_like(self.canvas)
        self.assertTrue(
            torch.equal(apply_stitch(plain, sampled), apply_stitch(with_bbox, sampled))
        )




class ToneMatchTests(unittest.TestCase):
    """color_match: the drift is read off the feathered band and undone."""

    def _pad_stitcher(self):
        # A 1x40x60 canvas: source in the middle 20 columns, padding either
        # side, and a feathered blend ramping 8px into the source on each side.
        canvas = torch.full((1, 40, 60, 3), 0.40)
        canvas[:, :, 20:40, :] = 0.40
        blend = torch.ones((1, 40, 60))
        blend[:, :, 20:40] = 0.0
        ramp = torch.linspace(1.0, 0.0, 8)
        blend[:, :, 20:28] = ramp.view(1, 1, 8)
        blend[:, :, 32:40] = ramp.flip(0).view(1, 1, 8)
        # The source sits in columns 20..40: the bbox is what lets the tone
        # match measure each padded side line by line.
        return inpaint_helpers.build_canvas_stitcher(canvas, blend, bbox=(20, 0, 40, 40))

    def test_offset_is_recovered_from_a_partially_regenerated_band(self):
        stitcher = self._pad_stitcher()
        canvas, blend = stitcher["canvas"], stitcher["blend"]
        # The sampler drifted +0.1 brighter everywhere it generated; in the
        # band the drift shows scaled by the mask, as the sampler mixes it.
        drift = 0.10
        inpainted = canvas + drift * blend.unsqueeze(-1)
        offset = inpaint_helpers.estimate_tone_offset(inpainted, canvas, blend)
        from nodes._color_helpers import rgb_to_lab
        expected = rgb_to_lab(torch.full((1, 1, 1, 3), 0.50)) - rgb_to_lab(torch.full((1, 1, 1, 3), 0.40))
        self.assertTrue(torch.allclose(offset, expected.view(1, 3), atol=0.35), (offset, expected))

    def test_no_band_means_no_offset(self):
        canvas = torch.rand((1, 8, 8, 3))
        hard = (torch.rand((1, 8, 8)) > 0.5).float()
        offset = inpaint_helpers.estimate_tone_offset(canvas + 0.2, canvas, hard)
        self.assertTrue(torch.equal(offset, torch.zeros((1, 3))))

    def test_color_match_moves_the_bands_and_leaves_the_source_bit_identical(self):
        stitcher = self._pad_stitcher()
        canvas, blend = stitcher["canvas"], stitcher["blend"]
        inpainted = (canvas + 0.10 * blend.unsqueeze(-1)).clamp(0, 1)
        plain = inpaint_helpers.apply_stitch(stitcher, inpainted, color_match=0.0)
        matched = inpaint_helpers.apply_stitch(stitcher, inpainted, color_match=1.0)
        # Source columns (blend 0) never change, matched or not.
        self.assertTrue(torch.equal(matched[:, :, 28:32, :], canvas[:, :, 28:32, :]))
        self.assertTrue(torch.equal(plain[:, :, 28:32, :], canvas[:, :, 28:32, :]))
        # The fully generated bands come back down toward the canvas tone.
        self.assertGreater(float(plain[:, :, :20, :].mean()), 0.49)
        self.assertLess(float(matched[:, :, :20, :].mean()), 0.44)
        self.assertGreater(float(matched[:, :, :20, :].mean()), 0.36)

    def test_zero_strength_is_the_plain_stitch(self):
        stitcher = self._pad_stitcher()
        inpainted = torch.rand_like(stitcher["canvas"])
        self.assertTrue(torch.equal(
            inpaint_helpers.apply_stitch(stitcher, inpainted),
            inpaint_helpers.apply_stitch(stitcher, inpainted, color_match=0.0),
        ))

    def test_drift_that_varies_along_the_seam_is_matched_line_by_line(self):
        stitcher = self._pad_stitcher()
        canvas, blend = stitcher["canvas"], stitcher["blend"]
        # Top half drifted brighter, bottom half darker - one global shift
        # could not fix both; the per-row field must.
        drift = torch.zeros((1, 40, 1, 1))
        drift[:, :20] = 0.05
        drift[:, 20:] = -0.05
        inpainted = (canvas + drift * blend.unsqueeze(-1)).clamp(0, 1)
        matched = inpaint_helpers.apply_stitch(stitcher, inpainted, color_match=1.0)
        top = float(matched[:, :16, :20, :].mean())
        bottom = float(matched[:, 24:, :20, :].mean())
        self.assertAlmostEqual(top, 0.40, delta=0.02)
        self.assertAlmostEqual(bottom, 0.40, delta=0.02)
        self.assertTrue(torch.equal(matched[:, :, 28:32, :], canvas[:, :, 28:32, :]))

    def test_a_line_far_from_its_side_average_is_clamped_not_matched(self):
        # LINE_DRIFT_CLAMP: a line whose overlap differs from its band by
        # more than a few LAB units is treated as content (a reflection
        # under open water), so only the side average plus the clamp is
        # removed. A twenty-unit step between the halves therefore keeps
        # part of its drift - by design, not by accident.
        stitcher = self._pad_stitcher()
        canvas, blend = stitcher["canvas"], stitcher["blend"]
        drift = torch.zeros((1, 40, 1, 1))
        drift[:, :20] = 0.12
        drift[:, 20:] = -0.08
        inpainted = (canvas + drift * blend.unsqueeze(-1)).clamp(0, 1)
        matched = inpaint_helpers.apply_stitch(stitcher, inpainted, color_match=1.0)
        top = float(matched[:, :16, :20, :].mean())
        bottom = float(matched[:, 24:, :20, :].mean())
        # Part of the drift comes off (the side average plus the clamp), but
        # not all of it - unlike the flat 0.40 a clamp-free match reaches.
        self.assertLess(top, 0.40 + 0.12 - 0.03)
        self.assertGreater(top, 0.40 + 0.02)
        self.assertGreater(bottom, 0.40 - 0.08 + 0.02)
        self.assertLess(bottom, 0.40 - 0.02)
        with_clamp_lifted = inpaint_helpers.LINE_DRIFT_CLAMP
        try:
            inpaint_helpers.LINE_DRIFT_CLAMP = 100.0
            flat = inpaint_helpers.apply_stitch(stitcher, inpainted, color_match=1.0)
        finally:
            inpaint_helpers.LINE_DRIFT_CLAMP = with_clamp_lifted
        self.assertAlmostEqual(float(flat[:, :16, :20, :].mean()), 0.40, delta=0.03)
        self.assertAlmostEqual(float(flat[:, 24:, :20, :].mean()), 0.40, delta=0.03)


class ToneMatchSeamTests(unittest.TestCase):
    """The drift is read across the seam and blended between sides."""

    def _four_side_stitcher(self):
        # 100x100 canvas, source 60x60 in the middle, 20 px of padding on
        # every side, feathered 8 px into the source.
        canvas = torch.full((1, 100, 100, 3), 0.40)
        mask = torch.ones((1, 100, 100))
        mask[:, 20:80, 20:80] = 0.0
        from nodes._pad_helpers import feather_pad_mask
        blend = feather_pad_mask(mask, 20, 20, 20, 20, 8)
        return inpaint_helpers.build_canvas_stitcher(canvas, blend, bbox=(20, 20, 80, 80))

    def test_drift_is_read_outside_the_seam_not_in_the_mixed_band(self):
        stitcher = self._four_side_stitcher()
        canvas, blend = stitcher["canvas"], stitcher["blend"]
        # The sampler painted the padding 0.1 brighter and, as samplers do,
        # smeared that into the feathered band in proportion to the mask.
        inpainted = (canvas + 0.10 * blend.unsqueeze(-1)).clamp(0, 1)
        matched = inpaint_helpers.apply_stitch(stitcher, inpainted, color_match=1.0)
        # Padding comes back to the canvas tone on all four sides ...
        for region in (matched[:, 40:60, :16], matched[:, 40:60, 84:], matched[:, :16, 40:60], matched[:, 84:, 40:60]):
            self.assertAlmostEqual(float(region.mean()), 0.40, delta=0.015)
        # ... and so does the band, whose mixed pixels get the same share of
        # the correction the sampler gave them.
        self.assertAlmostEqual(float(matched[:, 40:60, 20:28].mean()), 0.40, delta=0.015)
        self.assertTrue(torch.equal(matched[:, 40:60, 40:60], canvas[:, 40:60, 40:60]))

    def test_corner_blends_two_sides_without_a_crease(self):
        stitcher = self._four_side_stitcher()
        canvas, blend = stitcher["canvas"], stitcher["blend"]
        # Left side drifted bright, top side dark: the field must turn the
        # corner between them smoothly rather than switch on the diagonal.
        drift = torch.zeros((1, 100, 100, 1))
        drift[:, :, :20] = 0.08
        drift[:, :20, 20:] = -0.08
        inpainted = (canvas + drift * blend.unsqueeze(-1)).clamp(0, 1)
        field = inpaint_helpers.tone_offset_field(inpainted, canvas, blend, stitcher["source_bbox"])
        lum = field[0, :, :, 0]
        # Far from the corner each side gets its own sign.
        self.assertGreater(float(lum[50, 5]), 2.0)
        self.assertLess(float(lum[5, 50]), -2.0)
        # Along the corner's diagonal the field changes by small steps only:
        # no pixel jumps by more than a fraction of the side difference.
        jumps = [abs(float(lum[i, 19 - i]) - float(lum[i + 1, 18 - i])) for i in range(0, 18)]
        self.assertLess(max(jumps), 0.25 * (float(lum[50, 5]) - float(lum[5, 50])))

    def test_only_picture_pixels_are_read_inside_the_seam(self):
        # [1, 6 rows, 4 px] strips: lines 0-1 are all fill, lines 2-5 keep
        # their two inner pixels. Only kept pixels reach the inside mean.
        outside = torch.full((1, 6, 4, 3), 5.0)
        inside = torch.zeros((1, 6, 4, 3))
        inside[:, :, :2] = 40.0
        kept = torch.zeros((1, 6, 4))
        kept[:, 2:, 2:] = 1.0
        fallback = torch.tensor([[1.0, -2.0, 3.0]])
        _, cover = inpaint_helpers._seam_lines(outside, inside, True, fallback, kept)
        self.assertEqual(cover[0].tolist(), [0.0, 0.0, 2.0, 2.0, 2.0, 2.0])
        # With nothing kept at all the side has no reading of its own and
        # takes the fallback (the band's global offset) everywhere.
        curve, _ = inpaint_helpers._seam_lines(outside, inside, True, fallback, torch.zeros_like(kept))
        self.assertTrue(torch.allclose(curve, fallback.view(1, 1, 3).expand_as(curve), atol=1e-5))
        # Everything kept is the plain unweighted reading.
        plain, _ = inpaint_helpers._seam_lines(outside, inside, True, fallback)
        weighted, _ = inpaint_helpers._seam_lines(outside, inside, True, fallback, torch.ones_like(kept))
        self.assertTrue(torch.allclose(plain, weighted, atol=1e-5))


class StitchBlendFromMaskTests(unittest.TestCase):
    def test_zero_settings_return_an_equal_copy(self):
        mask = torch.zeros((1, 20, 30))
        mask[:, :, :10] = 1.0
        blend = stitch_blend_from_mask(mask, 0)
        self.assertTrue(torch.equal(blend, mask))
        self.assertIsNot(blend, mask)

    def test_blend_ramps_into_the_kept_side_only(self):
        mask = torch.zeros((1, 20, 30))
        mask[:, :, :10] = 1.0
        blend = stitch_blend_from_mask(mask, 3)
        # Inside the band the blur kernel's float sum lands a hair under 1.
        self.assertTrue(torch.all(blend[:, :, :10] >= 1.0 - 1e-5))
        self.assertGreater(float(blend[:, :, 10:13].min()), 0.0)
        self.assertEqual(float(blend[:, :, 20:].max()), 0.0)

    def test_grow_moves_the_boundary_before_the_ramp(self):
        mask = torch.zeros((1, 20, 30))
        mask[:, :, :10] = 1.0
        self.assertTrue(torch.all(stitch_blend_from_mask(mask, 0, 4)[:, :, :14] == 1.0))
        self.assertTrue(torch.all(stitch_blend_from_mask(mask, 0, -4)[:, :, 6:] == 0.0))


def smooth_picture(batch: int, height: int, width: int, seed: int = 0) -> torch.Tensor:
    """A photo stand-in: a colour gradient with soft grain."""
    rows = torch.linspace(0.0, 1.0, height).view(1, height, 1, 1)
    cols = torch.linspace(0.0, 1.0, width).view(1, 1, width, 1)
    base = 0.2 + 0.3 * rows + 0.25 * cols + torch.tensor((0.08, 0.12, 0.0)).view(1, 1, 1, 3)
    grain = rand_image(batch, height, width, seed) - 0.5
    grain = torch.nn.functional.avg_pool2d(grain.movedim(-1, 1), 3, stride=1, padding=1, count_include_pad=False)
    return (base + 0.12 * grain.movedim(1, -1)).clamp(0.0, 1.0)


def grain_picture(batch: int, height: int, width: int, seed: int = 0) -> torch.Tensor:
    """Soft grain on one flat tint: detail with no slope across any seam."""
    grain = rand_image(batch, height, width, seed) - 0.5
    grain = torch.nn.functional.avg_pool2d(grain.movedim(-1, 1), 3, stride=1, padding=1, count_include_pad=False)
    tint = torch.tensor((0.53, 0.57, 0.45)).view(1, 1, 1, 3)
    return (tint + 0.12 * grain.movedim(1, -1)).clamp(0.0, 1.0)


def shrink(image: torch.Tensor, mask: torch.Tensor, scale: float):
    """The megapixel resize a transform node can apply to its canvas and mask."""
    size = (round(image.shape[1] * scale), round(image.shape[2] * scale))
    image = torch.nn.functional.interpolate(
        image.movedim(-1, 1), size=size, mode="bicubic", antialias=True, align_corners=False
    ).movedim(1, -1).clamp(0.0, 1.0)
    mask = torch.nn.functional.interpolate(
        mask.unsqueeze(1), size=size, mode="bilinear", antialias=True, align_corners=False
    ).squeeze(1).clamp(0.0, 1.0)
    return image, mask


def turned_stitcher(picture: torch.Tensor, feather: int = 12, scale: float = 0.65, degrees: float = -14.3) -> dict:
    """A Crop + Rotate + Pad stitcher for a turned picture, resized like a
    megapixel budget does, pasted with no extra ramp (stitch_blend 0)."""
    from nodes._transform_engine import TransformSpec, transform_tensor_batch

    output, mask, geometry = transform_tensor_batch(picture, TransformSpec(rotation_degrees=degrees, feather=feather))
    if scale != 1.0:
        output, mask = shrink(output, mask, scale)
    return inpaint_helpers.build_transform_stitcher(output, mask, geometry, 0)


def padded_stitcher(picture: torch.Tensor, pads=(24, 16, 20, 0), feather: int = 12, fill: float = 0.5) -> dict:
    """A Load Image + Pad stitcher: the picture on a flat fill, the feathered
    padding mask as its blend, and the source rectangle."""
    from nodes._pad_helpers import feather_pad_mask

    left, top, right, bottom = pads
    batch, height, width, channels = picture.shape
    canvas = torch.full((batch, height + top + bottom, width + left + right, channels), fill)
    canvas[:, top : top + height, left : left + width] = picture
    mask = torch.ones(canvas.shape[:3])
    mask[:, top : top + height, left : left + width] = 0.0
    blend = feather_pad_mask(mask, left, top, right, bottom, feather)
    return build_canvas_stitcher(canvas, blend, bbox=(left, top, left + width, top + height))


def new_area(stitcher: dict) -> torch.Tensor:
    """[1, H, W] True where the canvas holds no picture."""
    generated = stitcher.get("generated")
    if generated is not None:
        return (generated >= 0.98).any(dim=0, keepdim=True)
    x0, y0, x1, y1 = stitcher["source_bbox"]
    area = torch.ones((1, *stitcher["canvas"].shape[1:3]), dtype=torch.bool)
    area[:, y0:y1, x0:x1] = False
    return area


def model_result(stitcher: dict, seed: int = 1, cast: float = 0.0, frames: int | None = None) -> torch.Tensor:
    """A stand-in for the model: the picture redrawn with a little grain, its
    own texture where the picture was missing, and an optional colour cast."""
    canvas = stitcher["canvas"]
    if frames is not None:
        canvas = canvas[:1].expand(frames, -1, -1, -1)
    generator = torch.Generator().manual_seed(seed)
    grain = (torch.rand(canvas.shape, generator=generator) - 0.5) * 0.04
    painted = 0.3 + 0.4 * torch.rand(canvas.shape, generator=generator)
    painted = torch.nn.functional.avg_pool2d(painted.movedim(-1, 1), 5, stride=1, padding=2, count_include_pad=False).movedim(1, -1)
    result = torch.where(new_area(stitcher).unsqueeze(-1), painted, canvas + grain)
    return (result + cast).clamp(0.0, 1.0)


class SeamBlendInTests(unittest.TestCase):
    """seam="blend in": the model's picture hands over to the source by depth."""

    def setUp(self):
        self.stitcher = turned_stitcher(smooth_picture(1, 216, 288, seed=60))
        self.canvas = self.stitcher["canvas"]
        self.patch = model_result(self.stitcher, seed=61)
        self.plan = inpaint_helpers.seam_plan(self.stitcher)
        self.depth = self.plan["depth"]

    def blend_in(self, stitcher=None, patch=None, **options):
        return apply_stitch(stitcher or self.stitcher, self.patch if patch is None else patch, seam="blend in", **options)

    def zones(self, plan=None):
        plan = plan or self.plan
        tone, detail = plan["tone"], plan["detail"]
        deep = plan["depth"] >= max(tone[1], detail[1])
        new = plan["depth"] <= min(tone[0], detail[0])
        return deep, new

    def test_the_deep_picture_is_bit_identical(self):
        out = self.blend_in()
        deep, _ = self.zones()
        self.assertGreater(int(deep.sum()), 0.2 * deep.numel())
        self.assertTrue(torch.equal(out[deep], self.canvas[deep]))
        # The ramps end well inside the depth map's reach.
        self.assertLess(max(self.plan["tone"][1], self.plan["detail"][1]), inpaint_helpers.SEAM_DEPTH_CAP)

    def test_outside_the_picture_is_the_model_untouched(self):
        out = self.blend_in()
        _, new = self.zones()
        self.assertTrue(bool((new & new_area(self.stitcher)).any()))
        self.assertTrue(torch.equal(out[new], self.patch[new]))
        self.assertTrue(bool((new_area(self.stitcher) <= new).all()))

    def test_a_constant_cast_on_the_model_survives_unchanged(self):
        cast = model_result(self.stitcher, seed=61, cast=0.05)
        out = self.blend_in(patch=cast)
        area = new_area(self.stitcher)
        # No global shift: the new area is exactly what the model painted...
        self.assertTrue(torch.equal(out[area], cast[area]))
        # ...and the cast stays out of the deep picture.
        deep, _ = self.zones()
        self.assertTrue(torch.equal(out[deep], self.canvas[deep]))
        # The classic tone match does move it, which is what blend in avoids.
        classic = apply_stitch(self.stitcher, cast, color_match=1.0)
        self.assertGreater(float((classic[area] - cast[area]).abs().mean()), 0.01)

    def test_an_untouched_picture_comes_back_within_two_levels(self):
        # The model leaves the picture alone and continues its edge colours.
        # That is only a perfect answer for a picture with no slope across
        # the seam, so the picture is grain on one tint.
        picture = grain_picture(1, 120, 160, seed=62)
        left, top, right, bottom = 24, 16, 20, 12
        stitcher = padded_stitcher(picture, (left, top, right, bottom))
        continued = torch.nn.functional.pad(
            picture.movedim(-1, 1), (left, right, top, bottom), mode="replicate"
        ).movedim(1, -1)
        out = self.blend_in(stitcher=stitcher, patch=continued)
        depth = inpaint_helpers.seam_plan(stitcher)["depth"]
        inside = (depth >= 4.0).unsqueeze(-1).expand_as(out)
        self.assertLess(float((out - stitcher["canvas"])[inside].abs().max()), 2.0 / 255.0)

    def test_a_turned_edge_mixed_with_fill_gives_no_shift(self):
        # A flat green picture, turned and resized: its outermost pixels are
        # part fill. The model continues the green perfectly. Classic tone
        # match reads those pixels as drift and moves the whole new area;
        # blend in leaves it where the model put it.
        green = torch.tensor((46, 150, 72), dtype=torch.float32) / 255.0
        flat = green.view(1, 1, 1, 3).expand(1, 216, 288, 3).clone()
        stitcher = turned_stitcher(flat)
        continuation = green.view(1, 1, 1, 3).expand_as(stitcher["canvas"]).clone()
        from nodes._color_helpers import rgb_to_lab

        def error(image):
            return (rgb_to_lab(image) - rgb_to_lab(continuation)).norm(dim=-1)

        area = new_area(stitcher)
        self.assertGreater(float(error(apply_stitch(stitcher, continuation, color_match=1.0))[area].mean()), 3.0)
        blended = self.blend_in(stitcher=stitcher, patch=continuation)
        self.assertTrue(torch.equal(blended[area], continuation[area]))
        self.assertLess(float(error(blended).max()), 0.5)

    def test_a_side_flush_with_the_frame_is_not_a_seam(self):
        picture = smooth_picture(1, 96, 128, seed=63)
        stitcher = padded_stitcher(picture, (24, 16, 20, 0))  # the bottom is not padded
        plan = inpaint_helpers.seam_plan(stitcher)
        depth = plan["depth"][0]
        bottom = depth[-6:, 24 + 44 : 24 + 128 - 44]
        self.assertGreater(float(bottom.min()), 40.0)
        out = self.blend_in(stitcher=stitcher, patch=model_result(stitcher, seed=64))
        canvas = stitcher["canvas"]
        self.assertTrue(torch.equal(out[:, -6:, 24 + 44 : 24 + 128 - 44], canvas[:, -6:, 24 + 44 : 24 + 128 - 44]))
        # A padded side right next to it still is one.
        self.assertLess(float(depth[-1, 24]), 1.0)

    def test_one_canvas_broadcasts_over_a_frame_batch(self):
        frames = torch.cat([model_result(self.stitcher, seed=seed) for seed in (70, 71, 72)], dim=0)
        together = self.blend_in(patch=frames)
        self.assertEqual(tuple(together.shape), tuple(frames.shape))
        for index in range(3):
            alone = self.blend_in(patch=frames[index : index + 1])
            self.assertTrue(torch.allclose(together[index : index + 1], alone, atol=1e-6))

    def test_a_longer_stitcher_is_trimmed_to_the_frames_that_came_back(self):
        from nodes._transform_engine import TransformSpec, transform_tensor_batch

        pictures = smooth_picture(3, 144, 192, seed=73)
        output, mask, geometry = transform_tensor_batch(pictures, TransformSpec(rotation_degrees=9.0, pad_left=24, feather=8))
        stitcher = inpaint_helpers.build_transform_stitcher(output, mask, geometry, 32)
        generated = model_result(stitcher, seed=74)[:2]
        with contextlib.redirect_stdout(io.StringIO()) as note:
            out = self.blend_in(stitcher=stitcher, patch=generated)
        self.assertIn("stitching the first 2", note.getvalue())
        self.assertEqual(out.shape[0], 2)
        for index in range(2):
            single = inpaint_helpers.build_transform_stitcher(
                output[index : index + 1], mask[index : index + 1], geometry, 32
            )
            alone = self.blend_in(stitcher=single, patch=generated[index : index + 1])
            self.assertTrue(torch.allclose(out[index : index + 1], alone, atol=1e-6))

    def test_the_video_clip_stitcher_blends_every_frame_alike(self):
        from nodes._transform_engine import TransformSpec, transform_tensor_batch_chunked

        wide = smooth_picture(1, 112, 176, seed=75)[0]
        clip = torch.stack([wide[:, 3 * index : 3 * index + 160] for index in range(5)])
        spec = TransformSpec(rotation_degrees=6.0, pad_left=32, pad_right=16, fill_color="#000000")
        output, mask, geometry = transform_tensor_batch_chunked(clip, spec, chunk_size=2)
        stitcher = inpaint_helpers.build_transform_stitcher(output, mask, geometry, 32)
        generated = model_result(stitcher, seed=76)
        out = self.blend_in(stitcher=stitcher, patch=generated)
        deep, new = self.zones(inpaint_helpers.seam_plan(stitcher))
        for index in range(5):
            frame, canvas, patch = out[index], output[index], generated[index]
            self.assertTrue(torch.equal(frame[deep[0]], canvas[deep[0]]))
            self.assertTrue(torch.equal(frame[new[0]], patch[new[0]]))
        # Chunks of one frame give the same clip, and so does a second run.
        chunk = inpaint_helpers.SEAM_CHUNK_PIXELS
        inpaint_helpers.SEAM_CHUNK_PIXELS = 1
        try:
            one_by_one = self.blend_in(stitcher=stitcher, patch=generated)
        finally:
            inpaint_helpers.SEAM_CHUNK_PIXELS = chunk
        self.assertTrue(torch.allclose(one_by_one, out, atol=1e-6))
        self.assertTrue(torch.equal(self.blend_in(stitcher=stitcher, patch=generated), out))

    def test_the_detail_hand_over_keeps_its_strength(self):
        # The model redrew everything with its own grain of the same
        # strength. A plain cross-fade of two unrelated grains is about a
        # quarter weaker halfway across; most of that is put back.
        picture = grain_picture(1, 160, 200, seed=85)
        stitcher = padded_stitcher(picture, (40, 40, 40, 40))
        redrawn = grain_picture(1, *stitcher["canvas"].shape[1:3], seed=86)
        out = self.blend_in(stitcher=stitcher, patch=redrawn)
        plan = inpaint_helpers.seam_plan(stitcher)
        luma = (out * torch.tensor((0.299, 0.587, 0.114))).sum(-1).unsqueeze(1)
        fine = (luma - torch.nn.functional.avg_pool2d(luma, 5, stride=1, padding=2, count_include_pad=False))[:, 0]
        depth = plan["depth"]
        middle = (depth - sum(plan["detail"]) / 2.0).abs() < 1.0
        deep = depth >= plan["tone"][1] + 4.0
        self.assertGreater(float(fine[middle].std() / fine[deep].std()), 0.85)

    def test_a_long_clip_reports_progress_and_stops_between_chunks(self):
        frames = torch.cat([self.patch] * 3, dim=0)
        checks, bars = [], []

        class Recorder:
            def __init__(self, total):
                self.total, self.updates = total, []

            def update_absolute(self, value, total=None, preview=None):
                self.updates.append((value, total))

        def make_bar(total):
            bars.append(Recorder(total))
            return bars[-1]

        originals = (inpaint_helpers.SEAM_CHUNK_PIXELS, inpaint_helpers.raise_if_interrupted, inpaint_helpers.progress_bar)
        inpaint_helpers.SEAM_CHUNK_PIXELS = 1
        inpaint_helpers.raise_if_interrupted = lambda: checks.append(1)
        inpaint_helpers.progress_bar = make_bar
        try:
            self.blend_in(patch=frames)
        finally:
            inpaint_helpers.SEAM_CHUNK_PIXELS, inpaint_helpers.raise_if_interrupted, inpaint_helpers.progress_bar = originals
        self.assertEqual(len(checks), 3)
        self.assertEqual(len(bars), 1)
        self.assertEqual(bars[0].updates, [(1, 3), (2, 3), (3, 3)])

    def test_the_halo_fix_does_not_apply_and_grain_is_no_drift(self):
        # Blend in never runs the halo estimate. The stand-in model redraws
        # the picture with grain and no drift, so Tone match finds nothing it
        # can check and the stitch is plain blend in, bit for bit.
        def refuse(*_args):
            raise AssertionError("the halo estimate ran")

        original = inpaint_helpers._foreground_estimator
        inpaint_helpers._foreground_estimator = lambda: refuse
        try:
            both = self.blend_in(color_match=1.0, fix_edge_halo=True)
        finally:
            inpaint_helpers._foreground_estimator = original
        self.assertTrue(torch.equal(both, self.blend_in()))

    def test_crop_for_inpaint_is_stitched_the_classic_way(self):
        image = rand_image(1, 64, 96, seed=77)
        cropped, _, stitcher = build_crop(image, box_mask(64, 96, 24, 40, 40, 56), 1.5, 8, 8)
        patch = shuffle_pixels(cropped)
        inpaint_helpers._warned.discard(inpaint_helpers._BLEND_IN_FALLBACK_NOTE)
        with contextlib.redirect_stdout(io.StringIO()) as note:
            first = apply_stitch(stitcher, patch, color_match=0.5, seam="blend in")
            second = apply_stitch(stitcher, patch, color_match=0.5, seam="blend in")
        classic = apply_stitch(stitcher, patch, color_match=0.5)
        self.assertTrue(torch.equal(first, classic))
        self.assertTrue(torch.equal(second, classic))
        self.assertEqual(note.getvalue().count("[AusBoss]"), 1)
        note.getvalue().encode("ascii")  # console output must stay ASCII
        self.assertIsNone(inpaint_helpers.seam_plan(stitcher))
        self.assertTrue(torch.equal(stitch_blend_mask(stitcher, 1, "blend in"), stitch_blend_mask(stitcher)))

    def test_the_blend_mask_shows_the_hand_over(self):
        out = self.blend_in()
        mask = stitch_blend_mask(self.stitcher, 2, "blend in")
        self.assertEqual(tuple(mask.shape), (2, *self.canvas.shape[1:3]))
        deep, new = self.zones()
        self.assertTrue(bool((mask[0][new[0]] == 1.0).all()))
        self.assertTrue(bool((mask[0][deep[0]] == 0.0).all()))
        self.assertGreaterEqual(float(mask.min()), 0.0)
        self.assertLessEqual(float(mask.max()), 1.0)
        # Zero exactly where the stitch left the picture alone.
        untouched = mask[:1] == 0.0
        self.assertTrue(torch.equal(out[untouched], self.canvas[untouched]))
        # Classic keeps the stitcher's feathered paste mask.
        self.assertTrue(torch.equal(stitch_blend_mask(self.stitcher, 2, "classic"), stitch_blend_mask(self.stitcher, 2)))

    def test_one_plan_per_stitcher(self):
        stitcher = turned_stitcher(smooth_picture(1, 144, 192, seed=78))
        calls = []
        original = inpaint_helpers._signed_depth

        def counted(picture):
            calls.append(1)
            return original(picture)

        inpaint_helpers._signed_depth = counted
        try:
            patch = model_result(stitcher, seed=79)
            first = self.blend_in(stitcher=stitcher, patch=patch)
            second = self.blend_in(stitcher=stitcher, patch=patch)
            stitch_blend_mask(stitcher, 1, "blend in")
            self.assertEqual(len(calls), 1)
            self.assertTrue(torch.equal(first, second))
            # A copy that lost the generated-area mask reads the rectangle.
            older = {key: value for key, value in stitcher.items() if key not in ("generated", "seam_plan")}
            older["seam_plan"] = stitcher["seam_plan"]
            self.blend_in(stitcher=older, patch=patch)
            self.assertEqual(len(calls), 2)
        finally:
            inpaint_helpers._signed_depth = original

    def test_the_ramps_follow_the_mask_the_model_was_given(self):
        # Load Image + Pad feathers 40 px inward: the model could redraw
        # about 36 px deep, so the detail ramp starts about 27 px in.
        stitcher = padded_stitcher(smooth_picture(1, 160, 200, seed=80), (48, 40, 48, 40), feather=40)
        plan = inpaint_helpers.seam_plan(stitcher)
        self.assertAlmostEqual(plan["detail"][0], 0.75 * 36.5, delta=1.0)
        self.assertAlmostEqual(plan["detail"][1] - plan["detail"][0], 10.0)
        self.assertAlmostEqual(plan["tone"][1], plan["detail"][1] + 14.0)
        # No feather to read: the default reach.
        hard = padded_stitcher(smooth_picture(1, 160, 200, seed=80), (48, 40, 48, 40), feather=0)
        self.assertEqual(inpaint_helpers.seam_plan(hard)["detail"], (9.75, 19.75))

    def test_scipy_and_the_torch_fallback_measure_the_same_depth(self):
        pictures = [
            ~(self.stitcher["generated"] >= 0.98).any(dim=0),
            inpaint_helpers._seam_picture(padded_stitcher(smooth_picture(1, 60, 80), (20, 10, 0, 30))),
        ]
        generator = torch.Generator().manual_seed(81)
        blobs = torch.nn.functional.avg_pool2d(torch.rand((1, 1, 90, 130), generator=generator), 9, stride=1, padding=4)
        pictures.append(blobs[0, 0] > 0.5)
        original = inpaint_helpers._scipy_distance
        try:
            inpaint_helpers._scipy_distance = None
            fallback = [inpaint_helpers._signed_depth(picture) for picture in pictures]
        finally:
            inpaint_helpers._scipy_distance = original
        if original is None:
            self.skipTest("scipy is not installed")
        for picture, estimate in zip(pictures, fallback):
            exact = inpaint_helpers._signed_depth(picture)
            self.assertLess(float((exact - estimate).abs().max()), 1e-3)

    def test_the_torch_fallback_stitches_like_scipy(self):
        original = inpaint_helpers._scipy_distance
        if original is None:
            self.skipTest("scipy is not installed")
        stitcher = turned_stitcher(smooth_picture(1, 144, 192, seed=82))
        patch = model_result(stitcher, seed=83)
        with_scipy = self.blend_in(stitcher=stitcher, patch=patch)
        stitcher.pop("seam_plan")
        try:
            inpaint_helpers._scipy_distance = None
            without = self.blend_in(stitcher=stitcher, patch=patch)
        finally:
            inpaint_helpers._scipy_distance = original
        self.assertTrue(torch.allclose(with_scipy, without, atol=1e-5))

    def test_no_picture_edge_and_no_picture_at_all(self):
        # Nothing padded or turned: every pixel is picture and stays as it is.
        picture = smooth_picture(1, 48, 64, seed=84)
        whole = build_canvas_stitcher(picture, torch.zeros((1, 48, 64)), bbox=(0, 0, 64, 48))
        self.assertTrue(torch.equal(self.blend_in(stitcher=whole, patch=shuffle_pixels(picture)), picture))
        # An empty rectangle: every pixel is new and comes from the model.
        empty = build_canvas_stitcher(picture, torch.ones((1, 48, 64)), bbox=(0, 0, 0, 0))
        patch = shuffle_pixels(picture)
        self.assertTrue(torch.equal(self.blend_in(stitcher=empty, patch=patch), patch))


def known_truth(height: int, width: int, seed: int = 0, dark: bool = False) -> torch.Tensor:
    """[1, H, W, 3] a scene whose every pixel is known: soft colour structure
    across brightness, or, ``dark``, a black backdrop with a lit subject."""
    rows = torch.linspace(0.0, 1.0, height).view(1, height, 1, 1)
    cols = torch.linspace(0.0, 1.0, width).view(1, 1, width, 1)
    tint = torch.tensor((0.9, 1.0, 0.8)).view(1, 1, 1, 3)
    scene = (0.08 + 0.8 * (0.5 + 0.5 * torch.sin(5.0 * cols + 3.0 * rows + seed))) * tint
    grain = torch.nn.functional.avg_pool2d(
        (rand_image(1, height, width, seed) - 0.5).movedim(-1, 1), 5, stride=1, padding=2, count_include_pad=False
    ).movedim(1, -1)
    scene = scene + 0.04 * grain
    if dark:
        lit = (0.5 + 0.5 * torch.sin(7.0 * cols - 2.0 * rows)) > 0.55
        scene = torch.where(lit, scene, torch.zeros_like(scene))
    return scene.clamp(0.0, 1.0)


def tilted_stitcher(truth: torch.Tensor, degrees: float = -11.0, feather: float = 10.0, fill: float = 0.5) -> dict:
    """A turned outpaint whose true continuation is ``truth`` everywhere: the
    picture is a turned rectangle in the middle, its rim part fill as a turn
    leaves it, and the generated-area mask feathers into the picture the way
    Crop + Rotate + Pad feathers it (stitch_blend 0)."""
    from PIL import Image, ImageDraw, ImageFilter
    import numpy as np

    height, width = truth.shape[1:3]
    scale = 4
    board = Image.new("L", (width * scale, height * scale), 0)
    cx, cy = width * scale / 2.0, height * scale / 2.0
    half_w, half_h = width * scale * 0.33, height * scale * 0.33
    turn = math.radians(degrees)
    corners = [
        (cx + x * math.cos(turn) - y * math.sin(turn), cy + x * math.sin(turn) + y * math.cos(turn))
        for x, y in ((-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h))
    ]
    ImageDraw.Draw(board).polygon(corners, fill=255)
    alpha = board.resize((width, height), Image.Resampling.BOX)
    empty = Image.fromarray(255 - np.asarray(alpha))
    blurred = np.asarray(empty.filter(ImageFilter.GaussianBlur(feather)), dtype=np.float32) * 2.0
    mask = np.maximum(np.asarray(empty, dtype=np.float32), np.minimum(blurred, 255.0)) / 255.0
    kept = torch.from_numpy(np.asarray(alpha, dtype=np.float32) / 255.0).view(1, height, width, 1)
    canvas = truth * kept + fill * (1.0 - kept)
    mask = torch.from_numpy(mask).unsqueeze(0)
    stitcher = build_canvas_stitcher(canvas, mask.clone(), bbox=(0, 0, width, height))
    stitcher["generated"] = mask
    return stitcher


def truth_stitcher(truth: torch.Tensor, pads=(40, 32, 48, 24), feather: int = 24) -> dict:
    """A Load Image + Pad outpaint of the middle of ``truth``."""
    left, top, right, bottom = pads
    picture = truth[:, top : truth.shape[1] - bottom, left : truth.shape[2] - right]
    return padded_stitcher(picture, pads, feather=feather)


def midtone_drift(values: torch.Tensor) -> torch.Tensor:
    """How a model might repaint tones: black and white kept, mid-tones up to
    12 levels darker, a little more in blue than in red."""
    per_channel = torch.tensor((0.8, 1.0, 1.25)).view(1, 1, 1, 3)
    return -(12.0 / 255.0) * torch.sin(math.pi * values.clamp(0.0, 1.0)) * per_channel


def drifted_model(stitcher: dict, truth: torch.Tensor, drift=midtone_drift, seed: int = 5) -> torch.Tensor:
    """The model as a masked sampler paints it: the true scene with its drift
    at full strength in the new area and scaled by the sampler mask inside
    the picture, plus a little grain."""
    sampler = stitcher.get("generated")
    if sampler is None:
        sampler = stitcher["blend"]
    grain = (rand_image(1, *truth.shape[1:3], seed) - 0.5) * 0.01
    return (truth + sampler.unsqueeze(-1) * drift(truth) + grain).clamp(0.0, 1.0)


class SeamBlendInToneMatchTests(unittest.TestCase):
    """Tone match under blend in: the model's drift read where it redrew the
    picture, checked on held-out tiles, and taken off before the blend."""

    def stitch(self, stitcher, patch, color_match):
        return apply_stitch(stitcher, patch, color_match=color_match, seam="blend in")

    def new_area_error(self, stitcher, image, truth):
        area = new_area(stitcher).squeeze(0)
        return float((image[0][area] - truth[0][area]).abs().mean()) * 255.0

    def test_the_models_drift_comes_off_turned_and_straight(self):
        for name, build in (
            ("turned", lambda truth: tilted_stitcher(truth, feather=32.0)),
            ("straight", lambda truth: truth_stitcher(truth, feather=32)),
        ):
            with self.subTest(edge=name):
                truth = known_truth(288, 352, seed=3)
                stitcher = build(truth)
                model = drifted_model(stitcher, truth)
                plain = self.new_area_error(stitcher, self.stitch(stitcher, model, 0.0), truth)
                matched = self.stitch(stitcher, model, 1.0)
                # Plain blend in keeps the model's darker mid-tones; Tone
                # match takes most of the drift back off the new area.
                self.assertGreater(plain, 6.0)
                self.assertLess(self.new_area_error(stitcher, matched, truth), 0.35 * plain)
                # Your picture is still exact past the hand-over.
                plan = inpaint_helpers.seam_plan(stitcher)
                deep = plan["depth"][0] >= max(plan["tone"][1], plan["detail"][1])
                self.assertTrue(torch.equal(matched[0][deep], stitcher["canvas"][0][deep]))

    def test_a_thin_feather_corrects_less_never_more(self):
        # A thin feather lets the model redraw a thin strip, so there is less
        # to read. Tone match then takes off part of the drift, never more.
        truth = known_truth(288, 352, seed=3)
        stitcher = tilted_stitcher(truth, feather=10.0)
        model = drifted_model(stitcher, truth)
        plain = self.new_area_error(stitcher, self.stitch(stitcher, model, 0.0), truth)
        matched = self.stitch(stitcher, model, 1.0)
        self.assertLess(self.new_area_error(stitcher, matched, truth), 0.8 * plain)
        area = new_area(stitcher).squeeze(0)
        lifted = matched[0][area] - model[0][area]
        # The model painted darker; the correction only ever lightens.
        self.assertGreaterEqual(float(lifted.min()), -1.0 / 255.0)

    def test_black_the_model_kept_black_stays_black(self):
        truth = known_truth(288, 352, seed=4, dark=True)
        stitcher = tilted_stitcher(truth, feather=32.0)
        model = drifted_model(stitcher, truth)
        plain = self.new_area_error(stitcher, self.stitch(stitcher, model, 0.0), truth)
        matched = self.stitch(stitcher, model, 1.0)
        area = new_area(stitcher).squeeze(0) & (truth[0].amax(dim=-1) == 0.0)
        self.assertGreater(int(area.sum()), 2000)
        # A flat lift would raise this black; the drift curves keep it.
        self.assertLess(float(matched[0][area].mean()) * 255.0, 1.5)
        self.assertLess(self.new_area_error(stitcher, matched, truth), 0.55 * plain)

    def test_a_turned_rim_mixed_with_fill_is_not_read_as_drift(self):
        # A night scene, turned on grey fill; the model continues it exactly
        # and only the turned rim holds fill. Classic Tone match reads that
        # rim as drift and lifts the whole new area (the seam a turned night
        # outpaint showed); blend in's Tone match never reads the rim.
        truth = known_truth(288, 352, seed=6, dark=True)
        stitcher = tilted_stitcher(truth)
        self.assertTrue(torch.equal(self.stitch(stitcher, truth, 1.0), self.stitch(stitcher, truth, 0.0)))
        classic = apply_stitch(stitcher, truth, color_match=1.0)
        self.assertGreater(self.new_area_error(stitcher, classic, truth), 1.5)

    def test_no_feather_leaves_nothing_to_read(self):
        truth = known_truth(288, 352, seed=7)
        stitcher = tilted_stitcher(truth, feather=0.0)
        model = drifted_model(stitcher, truth)
        self.assertTrue(torch.equal(self.stitch(stitcher, model, 1.0), self.stitch(stitcher, model, 0.0)))

    def test_strength_scales_the_correction(self):
        truth = known_truth(288, 352, seed=8)
        stitcher = truth_stitcher(truth, feather=32)
        model = drifted_model(stitcher, truth)
        area = new_area(stitcher).squeeze(0)
        full = float((self.stitch(stitcher, model, 1.0)[0][area] - model[0][area]).mean())
        half = float((self.stitch(stitcher, model, 0.5)[0][area] - model[0][area]).mean())
        self.assertGreater(full, 3.0 / 255.0)
        self.assertAlmostEqual(half / full, 0.5, delta=0.1)

    def test_a_clip_is_measured_once_and_matched_alike(self):
        truth = known_truth(288, 352, seed=9)
        stitcher = truth_stitcher(truth, feather=32)
        frames = torch.cat([drifted_model(stitcher, truth, seed=20 + index) for index in range(3)])
        calls = []
        original = inpaint_helpers.blend_in_tone_match

        def counted(*args, **kwargs):
            calls.append(1)
            return original(*args, **kwargs)

        inpaint_helpers.blend_in_tone_match = counted
        try:
            out = self.stitch(stitcher, frames, 1.0)
        finally:
            inpaint_helpers.blend_in_tone_match = original
        self.assertEqual(len(calls), 1)
        area = new_area(stitcher).squeeze(0)
        errors = [float((out[index][area] - truth[0][area]).abs().mean()) * 255.0 for index in range(3)]
        self.assertLess(max(errors), 3.0)
        self.assertLess(max(errors) - min(errors), 0.2)


def drift_along_the_edge(values: torch.Tensor) -> torch.Tensor:
    """midtone_drift, a third as strong on the left as it is on the right."""
    ramp = torch.linspace(0.3, 1.7, values.shape[2]).view(1, 1, -1, 1)
    return midtone_drift(values) * ramp


class ToneMatchMatchesTheOldCodeTests(unittest.TestCase):
    """Tone match was rewritten to run as a few large operations; the old
    code (tests/_tone_match_reference.py, verbatim) ran thousands of small
    ones. Both must take the same decision and stitch the same picture: the
    rewrite only adds the fit's sums in another order, so the two stay far
    inside a hundredth of one 8-bit level."""

    TOLERANCE = 1e-5

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import _tone_match_reference

        cls.reference = _tone_match_reference

    def stitch(self, module, stitcher, patch, strength):
        saved = (inpaint_helpers.blend_in_tone_match, inpaint_helpers._apply_tone_match)
        if module is not inpaint_helpers:
            inpaint_helpers.blend_in_tone_match = module.blend_in_tone_match
            inpaint_helpers._apply_tone_match = lambda model, match, strength, undone=None: module._apply_tone_match(
                model, match, strength
            )
        try:
            return apply_stitch(stitcher, patch, color_match=strength, seam="blend in")
        finally:
            inpaint_helpers.blend_in_tone_match, inpaint_helpers._apply_tone_match = saved

    def decision(self, module, stitcher, patch):
        plan = inpaint_helpers.seam_plan(stitcher)
        match = module.blend_in_tone_match(stitcher["canvas"], patch, {"depth": plan["depth"], "sampler": plan["sampler"]})
        if match is None:
            return "nothing"
        return "curves" if match["gain"] is None else "curves and gain"

    def assert_same(self, stitcher, patch, expected):
        self.assertEqual(self.decision(self.reference, stitcher, patch), expected)
        self.assertEqual(self.decision(inpaint_helpers, stitcher, patch), expected)
        for strength in (1.0, 0.4):
            old = self.stitch(self.reference, stitcher, patch, strength)
            new = self.stitch(inpaint_helpers, stitcher, patch, strength)
            self.assertEqual(new.shape, old.shape)
            self.assertLess(float((old - new).abs().max()), self.TOLERANCE, f"strength {strength}")

    def test_turned_straight_dark_and_thin_edges(self):
        for name, truth, build in (
            ("turned", known_truth(288, 352, seed=3), lambda truth: tilted_stitcher(truth, feather=32.0)),
            ("straight", known_truth(288, 352, seed=3), lambda truth: truth_stitcher(truth, feather=32)),
            ("dark", known_truth(288, 352, seed=4, dark=True), lambda truth: tilted_stitcher(truth, feather=32.0)),
            ("thin feather", known_truth(288, 352, seed=3), lambda truth: tilted_stitcher(truth, feather=10.0)),
        ):
            with self.subTest(case=name):
                stitcher = build(truth)
                self.assert_same(stitcher, drifted_model(stitcher, truth), "curves and gain")

    def test_a_drift_that_changes_along_the_edge(self):
        for build in (lambda truth: tilted_stitcher(truth, feather=32.0), lambda truth: truth_stitcher(truth, feather=32)):
            truth = known_truth(288, 352, seed=8)
            stitcher = build(truth)
            self.assert_same(stitcher, drifted_model(stitcher, truth, drift=drift_along_the_edge), "curves and gain")

    def test_the_curves_alone(self):
        # The local gain is used only when it holds out well enough; with the
        # bar out of reach both codes take the curves alone.
        truth = known_truth(288, 352, seed=3)
        stitcher = tilted_stitcher(truth, feather=32.0)
        saved = inpaint_helpers.SEAM_MATCH_LOCAL_GAIN, self.reference.SEAM_MATCH_LOCAL_GAIN
        inpaint_helpers.SEAM_MATCH_LOCAL_GAIN = self.reference.SEAM_MATCH_LOCAL_GAIN = 2.0
        try:
            self.assert_same(stitcher, drifted_model(stitcher, truth), "curves")
        finally:
            inpaint_helpers.SEAM_MATCH_LOCAL_GAIN, self.reference.SEAM_MATCH_LOCAL_GAIN = saved

    def test_nothing_to_read(self):
        truth = known_truth(288, 352, seed=7)
        stitcher = tilted_stitcher(truth, feather=0.0)
        self.assert_same(stitcher, drifted_model(stitcher, truth), "nothing")
        # Grain and no drift: nothing that holds out.
        stitcher = turned_stitcher(smooth_picture(1, 216, 288, seed=60))
        self.assert_same(stitcher, model_result(stitcher, seed=61), "nothing")

    def test_a_clip_and_a_picture_with_alpha(self):
        truth = known_truth(288, 352, seed=9)
        stitcher = truth_stitcher(truth, feather=32)
        frames = torch.cat([drifted_model(stitcher, truth, seed=20 + index) for index in range(3)])
        self.assert_same(stitcher, frames, "curves and gain")
        # A fourth channel rides along untouched.
        alpha = 0.25 + 0.5 * rand_image(1, 288, 352, seed=12)[..., :1]
        with_alpha = truth_stitcher(torch.cat([truth, alpha], dim=-1), feather=32)
        patch = torch.cat([drifted_model(stitcher, truth), torch.rand((1, *with_alpha["canvas"].shape[1:3], 1))], dim=-1)
        self.assert_same(with_alpha, patch, "curves and gain")


class SeamChoiceNodeTests(unittest.TestCase):
    """The Seam choice on Stitch Inpaint: appended, classic by default."""

    def setUp(self):
        from nodes.node_inpaint_crop_stitch import NODE_CLASS_MAPPINGS

        self.node_cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_StitchInpaint"]
        self.stitcher = turned_stitcher(smooth_picture(1, 144, 192, seed=90))
        self.patch = model_result(self.stitcher, seed=91)

    def run_node(self, **inputs):
        return getattr(self.node_cls(), self.node_cls.FUNCTION)(stitcher=self.stitcher, inpainted=self.patch, **inputs)

    def test_the_choice_is_appended_last_and_defaults_to_classic(self):
        optional = self.node_cls.INPUT_TYPES()["optional"]
        self.assertEqual(list(optional)[-1], "seam")
        choices, options = optional["seam"]
        self.assertEqual(choices, ["classic", "blend in"])
        self.assertEqual(options["default"], "classic")
        for word in ("blend in", "classic", "Crop For Inpaint"):
            self.assertIn(word, options["tooltip"])

    def test_leaving_it_out_is_classic(self):
        plain = self.run_node(color_match=1.0)
        named = self.run_node(color_match=1.0, seam="classic")
        self.assertTrue(torch.equal(plain[0], named[0]))
        self.assertTrue(torch.equal(plain[1], named[1]))
        self.assertTrue(torch.equal(plain[0], apply_stitch(self.stitcher, self.patch, color_match=1.0)))

    def test_blend_in_reaches_the_helpers(self):
        image, mask = self.run_node(color_match=1.0, seam="blend in")
        self.assertTrue(torch.equal(image, apply_stitch(self.stitcher, self.patch, seam="blend in")))
        self.assertTrue(torch.equal(mask, stitch_blend_mask(self.stitcher, 1, "blend in")))

    def test_an_older_workflow_s_empty_slot_is_classic(self):
        # A workflow saved before Seam existed keeps the card's empty value
        # in the slot Seam now takes; it must still queue and stitch classic.
        self.assertIs(self.node_cls.VALIDATE_INPUTS(seam=""), True)
        self.assertIs(self.node_cls.VALIDATE_INPUTS(seam=None), True)
        self.assertIs(self.node_cls.VALIDATE_INPUTS(), True)
        for value in ("classic", "blend in"):
            self.assertIs(self.node_cls.VALIDATE_INPUTS(seam=value), True)
        self.assertIsInstance(self.node_cls.VALIDATE_INPUTS(seam="blend"), str)
        legacy = self.run_node(color_match=1.0, seam="")
        self.assertTrue(torch.equal(legacy[0], self.run_node(color_match=1.0)[0]))
        with self.assertRaisesRegex(ValueError, "seam"):
            self.run_node(seam="blend")


class ErrorSourceTests(unittest.TestCase):
    """Input errors name the node the user is looking at."""

    def test_crop_for_inpaint_keeps_its_wording(self):
        with self.assertRaisesRegex(ValueError, r"^Crop For Inpaint expected a BHWC IMAGE batch\.$"):
            build_crop(torch.zeros((8, 8, 3)), torch.zeros((1, 8, 8)), 1.2, 0, 8)
        with self.assertRaisesRegex(ValueError, r"^Crop For Inpaint expected a BHW MASK\.$"):
            build_crop(rand_image(1, 8, 8), torch.zeros(8), 1.2, 0, 8)

    def test_stitch_inpaint_names_itself(self):
        _c, _s, stitcher = build_crop(
            rand_image(1, 32, 32), box_mask(32, 32, 8, 24, 8, 24), 1.2, 0, 8
        )
        with self.assertRaisesRegex(ValueError, r"^Stitch Inpaint expected a BHWC IMAGE batch\.$"):
            apply_stitch(stitcher, torch.zeros((32, 32, 3)))

    def test_stitcher_producers_name_themselves(self):
        canvas = rand_image(1, 16, 16)
        with self.assertRaisesRegex(ValueError, r"^Load Image \+ Pad expected a BHWC IMAGE batch\.$"):
            build_canvas_stitcher(canvas[0], torch.zeros((1, 16, 16)), source="Load Image + Pad")
        with self.assertRaisesRegex(ValueError, r"^Load Image \+ Pad expected a BHW MASK\.$"):
            build_canvas_stitcher(canvas, torch.zeros(16), source="Load Image + Pad")
        geometry = types.SimpleNamespace(
            output_width=16, output_height=16, pad_left=0, pad_top=0, crop_width=16, crop_height=16
        )
        with self.assertRaisesRegex(
            ValueError, r"^Video Crop \+ Rotate \+ Pad -> Clip expected a BHWC IMAGE batch\.$"
        ):
            inpaint_helpers.build_transform_stitcher(
                canvas[0], torch.zeros((1, 16, 16)), geometry, 0,
                source="Video Crop + Rotate + Pad -> Clip",
            )


if __name__ == "__main__":
    unittest.main()
