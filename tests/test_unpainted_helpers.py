from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._inpaint_crop_helpers import build_canvas_stitcher, build_transform_stitcher
from nodes._unpainted_helpers import unpainted_notice, unpainted_share


FRAMES, HEIGHT, WIDTH = 5, 64, 160
LEFT, RIGHT = 48, 112  # the source sits in columns 48..111, bars on both sides


def padded_clip(fill: float = 0.0, seed: int = 0):
    """A source strip in the middle, flat fill bars on the sides, and the bar mask."""
    generator = torch.Generator().manual_seed(seed)
    frames = torch.full((FRAMES, HEIGHT, WIDTH, 3), fill)
    frames[:, :, LEFT:RIGHT] = torch.rand((FRAMES, HEIGHT, RIGHT - LEFT, 3), generator=generator)
    mask = torch.ones((FRAMES, HEIGHT, WIDTH))
    mask[:, :, LEFT:RIGHT] = 0.0
    return frames, mask


class Geometry:
    """Just what build_transform_stitcher reads from a transform's geometry."""

    output_width, output_height = WIDTH, HEIGHT
    pad_left, pad_top = LEFT, 0
    crop_width, crop_height = RIGHT - LEFT, HEIGHT


def textured(shape, low: float, high: float, seed: int = 1) -> torch.Tensor:
    generator = torch.Generator().manual_seed(seed)
    return low + (high - low) * torch.rand(shape, generator=generator)


class UnpaintedShareTests(unittest.TestCase):
    def setUp(self):
        self.frames, self.mask = padded_clip()
        self.stitcher = build_transform_stitcher(self.frames, self.mask, Geometry(), 8)

    def test_untouched_bars_count_as_unpainted_and_say_so(self):
        share = unpainted_share(self.stitcher, self.frames.clone())
        self.assertEqual(share["mean"], 1.0)
        self.assertEqual(share["worst"], 1.0)
        notice = unpainted_notice(share)
        self.assertIn("100% of the new area", notice)
        self.assertTrue(notice.isascii(), "console text must stay ASCII")

    def test_a_vae_round_trip_of_black_is_still_unpainted(self):
        result = self.frames.clone()
        result[:, :, :LEFT] = 2.0 / 255.0
        result[:, :, RIGHT:] = 1.0 / 255.0
        self.assertEqual(unpainted_share(self.stitcher, result)["mean"], 1.0)

    def test_painted_bars_pass_even_when_the_scene_is_dark(self):
        result = self.frames.clone()
        result[:, :, :LEFT] = textured((FRAMES, HEIGHT, LEFT, 3), 0.0, 0.08)
        result[:, :, RIGHT:] = textured((FRAMES, HEIGHT, WIDTH - RIGHT, 3), 0.0, 0.08, seed=2)
        share = unpainted_share(self.stitcher, result)
        self.assertEqual(share["mean"], 0.0)
        self.assertIsNone(unpainted_notice(share))

    def test_one_painted_side_is_half_unpainted(self):
        result = self.frames.clone()
        result[:, :, :LEFT] = textured((FRAMES, HEIGHT, LEFT, 3), 0.2, 0.8)
        share = unpainted_share(self.stitcher, result)
        self.assertAlmostEqual(share["mean"], 0.5)
        self.assertIn("50% of the new area", unpainted_notice(share))

    def test_a_clip_that_fades_back_to_the_fill_is_reported(self):
        result = self.frames.clone()
        painted = textured((FRAMES, HEIGHT, WIDTH, 3), 0.2, 0.8)
        # The first frames paint, the last ones give the bars back.
        result[:3, :, :LEFT] = painted[:3, :, :LEFT]
        result[:3, :, RIGHT:] = painted[:3, :, RIGHT:]
        share = unpainted_share(self.stitcher, result)
        self.assertEqual(share["worst"], 1.0)
        self.assertLess(share["mean"], 0.5)
        self.assertIn("up to 100% in some frames", unpainted_notice(share))

    def test_small_leftovers_stay_quiet(self):
        result = self.frames.clone()
        result[:, :, :LEFT] = textured((FRAMES, HEIGHT, LEFT, 3), 0.2, 0.8)
        result[:, :, RIGHT:] = textured((FRAMES, HEIGHT, WIDTH - RIGHT, 3), 0.2, 0.8, seed=3)
        result[:, :16, :16] = 0.0  # one dark corner block left as fill
        self.assertIsNone(unpainted_notice(unpainted_share(self.stitcher, result)))

    def test_a_gray_fill_is_judged_against_its_own_color(self):
        frames, mask = padded_clip(fill=0.5)
        stitcher = build_transform_stitcher(frames, mask, Geometry(), 8)
        self.assertEqual(unpainted_share(stitcher, frames.clone())["mean"], 1.0)
        result = frames.clone()
        result[:, :, :LEFT] = 0.0  # black is not the gray fill: it was changed
        self.assertAlmostEqual(unpainted_share(stitcher, result)["mean"], 0.5)

    def test_a_result_at_another_size_is_resized_first(self):
        small = torch.nn.functional.interpolate(
            self.frames.movedim(-1, 1), size=(HEIGHT // 2, WIDTH // 2), mode="nearest"
        ).movedim(1, -1)
        # Resizing blurs the blocks next to the source edge; the rest stay fill.
        share = unpainted_share(self.stitcher, small)
        self.assertGreaterEqual(share["mean"], 0.6)
        self.assertIsNotNone(unpainted_notice(share))

    def test_a_padded_photo_is_judged_from_its_source_box(self):
        frames, mask = padded_clip()
        stitcher = build_canvas_stitcher(frames[:1], mask[:1], bbox=(LEFT, 0, RIGHT, HEIGHT))
        self.assertNotIn("generated", stitcher)
        self.assertEqual(unpainted_share(stitcher, frames[:1].clone())["mean"], 1.0)

    def test_a_night_sky_continued_as_black_stays_quiet(self):
        # A night scene: most of the source is flat black sky with faint noise,
        # a few bright lights below. The model continues the sky as black.
        frames, mask = padded_clip()
        generator = torch.Generator().manual_seed(4)
        sky = 0.5 / 255.0 * torch.rand((FRAMES, HEIGHT, RIGHT - LEFT, 3), generator=generator)
        frames[:, :, LEFT:RIGHT] = sky
        frames[:, 48:, LEFT:RIGHT] = textured((FRAMES, HEIGHT - 48, RIGHT - LEFT, 3), 0.3, 0.9)
        stitcher = build_transform_stitcher(frames, mask, Geometry(), 8)
        result = frames.clone()
        result[:, :, :LEFT] = 1.0 / 255.0
        result[:, :, RIGHT:] = 1.0 / 255.0
        result[:, 48:, :LEFT] = textured((FRAMES, HEIGHT - 48, LEFT, 3), 0.3, 0.9, seed=5)
        result[:, 48:, RIGHT:] = textured((FRAMES, HEIGHT - 48, WIDTH - RIGHT, 3), 0.3, 0.9, seed=6)
        share = unpainted_share(stitcher, result)
        self.assertGreater(share["mean"], 0.5)  # the painted sky is as flat as the fill...
        self.assertGreater(share["source"], 0.5)  # ...and so is the picture's own sky
        self.assertIsNone(unpainted_notice(share))

    def test_a_crop_for_inpaint_stitcher_is_not_judged(self):
        frames, mask = padded_clip()
        stitcher = build_canvas_stitcher(frames[:1], mask[:1])
        self.assertIsNone(unpainted_share(stitcher, frames[:1].clone()))
        self.assertIsNone(unpainted_notice(None))


if __name__ == "__main__":
    unittest.main()
