from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._detail_helpers import _gaussian, keep_detail, linear_to_srgb, srgb_to_linear
from nodes.node_keep_detail import AusBossKeepDetail


def textured(height: int = 64, width: int = 64, seed: int = 0) -> torch.Tensor:
    """Mid-grey with a fine random texture."""
    generator = torch.Generator().manual_seed(seed)
    texture = torch.rand((1, height, width, 1), generator=generator) * 0.2 - 0.1
    return (torch.full((1, height, width, 3), 0.5) + texture).clamp(0.0, 1.0)


def blurred(image: torch.Tensor, sigma: float = 3.0) -> torch.Tensor:
    return _gaussian(image.movedim(-1, 1), sigma).movedim(1, -1)


def fine(image: torch.Tensor) -> torch.Tensor:
    return image - blurred(image, 2.0)


class KeepDetailTests(unittest.TestCase):
    def test_srgb_round_trip(self):
        values = torch.linspace(0.0, 1.0, 101)
        self.assertTrue(torch.allclose(linear_to_srgb(srgb_to_linear(values)), values, atol=1e-5))

    def test_strength_zero_leaves_the_edit_unchanged(self):
        original = textured()
        edit = blurred(original)
        out, _ = keep_detail(edit, original, strength=0.0)
        self.assertTrue(torch.equal(out, edit))

    def test_the_original_against_itself_comes_back(self):
        original = textured()
        for color_detail in (False, True):
            for edge_safe in (False, True):
                out, _ = keep_detail(original, original, 4.0, 1.0, color_detail, edge_safe)
                self.assertLess(float((out - original).abs().max()), 1e-4)

    def test_detail_comes_back_on_a_smoothed_edit(self):
        original = textured()
        edit = blurred(original)
        out, _ = keep_detail(edit, original, 4.0, 1.0, False, False)
        lost = float(fine(edit).std())
        kept = float(fine(out).std())
        self.assertGreater(kept, 3 * lost)
        self.assertGreater(float(torch.corrcoef(torch.stack([fine(out).flatten(), fine(original).flatten()]))[0, 1]), 0.8)

    def test_light_only_never_shifts_the_colour(self):
        original = textured(seed=1) * torch.tensor([1.2, 0.8, 1.0])
        original = original.clamp(0.0, 1.0)
        edit = (blurred(original) * torch.tensor([0.9, 1.0, 1.2])).clamp(0.0, 1.0)
        out, _ = keep_detail(edit, original, 4.0, 1.0, False, True)
        def chroma(picture):
            linear = srgb_to_linear(picture)
            return linear / linear.sum(-1, keepdim=True).clamp_min(1e-6)
        self.assertLess(float((chroma(out) - chroma(edit)).abs().max()), 2e-3)

    def test_detail_carries_over_as_a_ratio_onto_a_darker_edit(self):
        original = textured(seed=2)
        dark_edit = srgb_to_linear(blurred(original)) * 0.25
        dark_edit = linear_to_srgb(dark_edit)
        out, _ = keep_detail(dark_edit, original, 4.0, 1.0, False, False)
        ratio_original = srgb_to_linear(original) / srgb_to_linear(blurred(original, 4.0))
        ratio_out = srgb_to_linear(out) / srgb_to_linear(blurred(out, 4.0))
        self.assertLess(float((ratio_out - ratio_original)[:, 8:-8, 8:-8].abs().mean()), 0.03)

    def test_edge_safe_keeps_a_strong_edge_free_of_a_halo(self):
        original = torch.full((1, 32, 64, 3), 0.1)
        original[:, :, 32:] = 0.9
        shifted = torch.full((1, 32, 64, 3), 0.1)
        shifted[:, :, 33:] = 0.9
        plain, _ = keep_detail(shifted, original, 4.0, 1.0, False, False)
        safe, _ = keep_detail(shifted, original, 4.0, 1.0, False, True)
        self.assertLess(float((safe - shifted).abs().max()), float((plain - shifted).abs().max()) / 2)

    def test_mask_and_resize(self):
        original = textured()
        edit = blurred(original)
        mask = torch.zeros(1, 64, 64)
        mask[:, :, 32:] = 1.0
        out, resized = keep_detail(edit, original, mask=mask)
        self.assertFalse(resized)
        self.assertTrue(torch.equal(out[:, :, :32], edit[:, :, :32]))
        small = torch.nn.functional.interpolate(original.movedim(-1, 1), size=(32, 32), mode="area").movedim(1, -1)
        out, resized = keep_detail(edit, small)
        self.assertTrue(resized)
        self.assertEqual(tuple(out.shape), (1, 64, 64, 3))

    def test_node_with_preview_off(self):
        original = textured()
        (out,) = AusBossKeepDetail().keep(blurred(original), original, 4.0, 1.0, False, True, preview=False)
        self.assertEqual(tuple(out.shape), (1, 64, 64, 3))


if __name__ == "__main__":
    unittest.main()
