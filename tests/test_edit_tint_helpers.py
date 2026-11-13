"""Edit Lock Restore's tint fix: the model's pink tint goes, an intended recolor stays."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._edit_lock_helpers import EditLock  # noqa: E402
from nodes._edit_tint_helpers import (  # noqa: E402
    lab_to_rgb,
    looks_like_tint,
    measure_tint,
    remove_tint,
    rgb_to_lab,
    take_out_tint,
)
from nodes.node_edit_lock import AusBossEditLockRestore  # noqa: E402

TINT = [2.0, 5.0, -3.0]  # what MiniMax H3 Image adds: lighter, pinker, bluer


def picture(seed: int = 0, size: int = 384) -> torch.Tensor:
    """A textured photo stand-in, [1, H, W, 3], mid tones so a shift never clips."""
    gen = torch.Generator().manual_seed(seed)
    coarse = torch.rand(1, 3, size // 16, size // 16, generator=gen)
    fine = torch.rand(1, 3, size // 4, size // 4, generator=gen)
    img = 0.6 * F.interpolate(coarse, size=(size, size), mode="bicubic", align_corners=False)
    img = img + 0.4 * F.interpolate(fine, size=(size, size), mode="bilinear", align_corners=False)
    return (0.2 + 0.6 * img).clamp(0.0, 1.0).movedim(1, -1)


def shifted(image: torch.Tensor, shift) -> torch.Tensor:
    return lab_to_rgb(rgb_to_lab(image) + torch.tensor(shift, dtype=torch.float64)).float()


def edited(source: torch.Tensor, shift) -> torch.Tensor:
    """A local edit (a new patch) on top of an even shift of the whole picture."""
    out = shifted(source, shift)
    out[:, 120:260, 140:280] = torch.tensor([0.85, 0.85, 0.88])
    return out


class TintTests(unittest.TestCase):
    def test_lab_round_trip(self):
        img = picture(1)
        self.assertLess(float((lab_to_rgb(rgb_to_lab(img)).float() - img).abs().max()), 1e-4)

    def test_reads_the_tint_on_the_untouched_part(self):
        source = picture(2)
        shift, share = measure_tint(edited(source, TINT)[0], source[0])
        self.assertIsNotNone(shift)
        for got, want in zip(shift, TINT):
            self.assertAlmostEqual(got, want, delta=0.4)
        self.assertGreater(share, 0.5)

    def test_takes_the_tint_out(self):
        source = picture(3)
        out, taken = take_out_tint(edited(source, TINT), source)
        self.assertIsNotNone(taken)
        outside = (slice(0, 100), slice(0, 384))
        self.assertLess(float((out[0][outside] - source[0][outside]).abs().mean()), 0.004)

    def test_leaves_an_intended_recolor(self):
        source = picture(4)
        golden = [6.0, 20.0, 30.0]  # golden hour: warmer and much yellower
        image = edited(source, golden)
        out, taken = take_out_tint(image, source)
        self.assertIsNone(taken)
        self.assertTrue(torch.equal(out, image))

    def test_the_tint_rule(self):
        self.assertTrue(looks_like_tint([2.6, 6.3, -3.4], 0.49))      # silver hair
        self.assertTrue(looks_like_tint([1.8, 3.5, -1.8], 0.62))      # rain
        self.assertFalse(looks_like_tint([-2.0, 29.4, 2.9], 0.05))    # red light
        self.assertFalse(looks_like_tint([19.5, 2.5, -5.5], 0.07))    # anime restyle
        self.assertFalse(looks_like_tint([7.8, 23.9, 31.3], 1.0))     # golden hour
        self.assertFalse(looks_like_tint([0.0, 0.1, -0.1], 0.9))      # already clean
        self.assertFalse(looks_like_tint(None, 0.0))

    def test_noise_is_left_alone(self):
        gen = torch.Generator().manual_seed(5)
        image = torch.rand(1, 64, 64, 3, generator=gen)
        out, taken = take_out_tint(image, torch.rand(1, 64, 64, 3, generator=gen))
        self.assertIsNone(taken)
        self.assertTrue(torch.equal(out, image))

    def test_restore_node_takes_it_out_when_the_lock_stepped_aside(self):
        source = picture(6)
        lock = EditLock()
        lock.status = "whole picture"
        lock.source = source
        image = edited(source, TINT)
        out, mask, report = AusBossEditLockRestore().restore(image, lock, 16)
        self.assertLess(float((out[0, :100] - source[0, :100]).abs().mean()), 0.004)
        self.assertIn("tint", report)
        self.assertTrue(torch.all(mask == 1.0))
        # switched off, it passes through as before
        out, _, report = AusBossEditLockRestore().restore(image, lock, 16, remove_tint=False)
        self.assertTrue(torch.equal(out, image))
        self.assertNotIn("tint", report)

    def test_remove_tint_keeps_alpha(self):
        image = torch.cat([picture(7), torch.ones(1, 384, 384, 1)], -1)
        out = remove_tint(image, TINT)
        self.assertTrue(torch.equal(out[..., 3], image[..., 3]))


if __name__ == "__main__":
    unittest.main()
