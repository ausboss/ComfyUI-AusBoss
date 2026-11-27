from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._cut_out_helpers import cut_out, smooth_over_frames
from nodes.node_cut_out import AusBossCutOut


def scene(height: int = 64, width: int = 64) -> tuple[torch.Tensor, torch.Tensor]:
    """A red subject on a green background, with a soft band between them."""
    alpha = torch.zeros(1, height, width)
    alpha[:, :, : width // 2] = 1.0
    alpha[:, :, width // 2 : width // 2 + 8] = torch.linspace(0.9, 0.1, 8)
    red = torch.tensor([0.9, 0.2, 0.1])
    green = torch.tensor([0.1, 0.8, 0.2])
    image = alpha.unsqueeze(-1) * red + (1.0 - alpha.unsqueeze(-1)) * green
    return image, alpha


class CutOutTests(unittest.TestCase):
    def test_outputs_rgba_and_alpha(self):
        image, alpha = scene()
        rgba, out_alpha = cut_out(image, alpha, feather=0.0)
        self.assertEqual(tuple(rgba.shape), (1, 64, 64, 4))
        self.assertEqual(tuple(out_alpha.shape), (1, 64, 64))
        self.assertTrue(torch.allclose(rgba[..., 3], out_alpha))
        self.assertTrue(torch.allclose(out_alpha, alpha))

    def test_fully_kept_pixels_stay_exactly_as_they_were(self):
        image, alpha = scene()
        rgba, out_alpha = cut_out(image, alpha, feather=2.0, clean_edges=True)
        solid = out_alpha[0] >= 1.0
        self.assertGreater(int(solid.sum()), 100)
        self.assertTrue(torch.equal(rgba[0][solid][:, :3], image[0][solid]))

    def test_clean_edges_takes_the_background_out_of_the_soft_band(self):
        # The cleaning reaches as far as the paper's at this width (1440).
        image, alpha = scene(32, 1440)
        plain, _ = cut_out(image, alpha, feather=0.0, clean_edges=False)
        clean, _ = cut_out(image, alpha, feather=0.0, clean_edges=True)
        band = (alpha[0] > 0.05) & (alpha[0] < 0.95)
        red = torch.tensor([0.9, 0.2, 0.1])
        plain_error = (plain[0][band][:, :3] - red).abs().mean()
        clean_error = (clean[0][band][:, :3] - red).abs().mean()
        self.assertLess(float(clean_error), float(plain_error) / 3)

    def test_keep_black_inverts_and_grow_widens(self):
        image, alpha = scene()
        _, black = cut_out(image, alpha, keep="black", feather=0.0, clean_edges=False)
        self.assertTrue(torch.allclose(black, 1.0 - alpha))
        hard = (alpha > 0.5).float()
        _, grown = cut_out(image, hard, grow=4, feather=0.0, clean_edges=False)
        self.assertEqual(int(grown.sum()) - int(hard.sum()), 4 * 64)

    def test_levels_clear_haze_and_fill_the_core(self):
        image, alpha = scene()
        _, out = cut_out(image, alpha, feather=0.0, clean_edges=False, clear_haze=0.3, solid_above=0.7)
        self.assertTrue(bool(((out == 0.0) | (out == 1.0) | ((alpha > 0.3) & (alpha < 0.7))).all()))

    def test_smooth_frames_averages_neighbours_with_short_ends(self):
        frames = torch.stack([torch.full((2, 2), float(value)) for value in (0, 3, 6, 9)])
        out = smooth_over_frames(frames, 1)
        self.assertTrue(torch.allclose(out[:, 0, 0], torch.tensor([1.5, 3.0, 6.0, 7.5])))

    def test_existing_transparency_is_kept(self):
        image, alpha = scene()
        rgba_in = torch.cat([image, torch.full((1, 64, 64, 1), 0.5)], dim=-1)
        _, out = cut_out(rgba_in, alpha, feather=0.0, clean_edges=False)
        self.assertTrue(torch.allclose(out, alpha * 0.5))

    def test_one_mask_serves_every_frame_and_unpainted_masks_are_explained(self):
        image, alpha = scene()
        rgba, _ = cut_out(image.expand(3, -1, -1, -1), alpha)
        self.assertEqual(int(rgba.shape[0]), 3)
        with self.assertRaisesRegex(ValueError, "No mask painted"):
            cut_out(torch.rand(1, 128, 128, 3), torch.zeros(1, 64, 64))

    def test_node_returns_both_outputs_with_preview_off(self):
        image, alpha = scene()
        out = AusBossCutOut().cut(image, alpha, "white", 0, 1.0, True, 0.0, 1.0, 0, preview=False)
        self.assertEqual(len(out), 2)


if __name__ == "__main__":
    unittest.main()
