from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._grain_helpers import (
    add_film_grain, auto_film_grain_values, auto_grain, frame_seed, grain_frame, measure_noise, tone_weight,
)
from nodes.node_film_grain import AusBossFilmGrain


def grey(frames: int = 1, height: int = 48, width: int = 64, value: float = 0.5) -> torch.Tensor:
    return torch.full((frames, height, width, 3), value)


class FilmGrainTests(unittest.TestCase):
    def test_same_seed_same_grain_and_new_seed_new_grain(self):
        image = grey()
        first = add_film_grain(image, 0.25, 1.0, 0.5, 0.3, True, 7)
        again = add_film_grain(image, 0.25, 1.0, 0.5, 0.3, True, 7)
        other = add_film_grain(image, 0.25, 1.0, 0.5, 0.3, True, 8)
        self.assertTrue(torch.equal(first, again))
        self.assertFalse(torch.equal(first, other))

    def test_amount_zero_changes_nothing(self):
        image = torch.rand(2, 16, 16, 3)
        self.assertTrue(torch.equal(add_film_grain(image, 0.0, 1.0, 0.5, 0.0, True, 0), image))

    def test_moving_grain_differs_per_frame_and_still_grain_does_not(self):
        image = grey(3)
        moving = add_film_grain(image, 0.3, 1.0, 0.5, 0.0, True, 1)
        still = add_film_grain(image, 0.3, 1.0, 0.5, 0.0, False, 1)
        self.assertFalse(torch.equal(moving[0], moving[1]))
        self.assertTrue(torch.equal(still[0], still[1]))
        self.assertTrue(torch.equal(still[1], still[2]))

    def test_a_frame_does_not_depend_on_the_batch_around_it(self):
        image = grey(11)
        whole = add_film_grain(image, 0.3, 1.5, 0.5, 0.5, True, 3)
        alone = grain_frame(frame_seed(3, 10, True), 48, 64, 1.5, 0.5, 0.5)
        delta = (whole[10] - image[10])
        expected = (alone.movedim(0, -1) * tone_weight(image[10:11])[0] * 0.3 * 0.15)
        self.assertTrue(torch.allclose(delta, expected.expand_as(delta), atol=1e-6))

    def test_grain_is_strongest_in_the_midtones(self):
        def spread(value):
            image = grey(1, 64, 64, value)
            return float((add_film_grain(image, 0.3, 1.0, 0.0, 0.0, True, 2) - image).std())

        self.assertGreater(spread(0.5), 2.5 * spread(0.03))
        self.assertGreater(spread(0.5), 2.5 * spread(0.97))

    def test_monochrome_grain_is_the_same_in_every_channel(self):
        out = add_film_grain(grey(), 0.3, 1.0, 0.5, 0.0, True, 4)
        self.assertTrue(torch.equal(out[..., 0], out[..., 1]))
        colour = add_film_grain(grey(), 0.3, 1.0, 0.5, 1.0, True, 4)
        self.assertFalse(torch.equal(colour[..., 0], colour[..., 1]))

    def test_bigger_size_gives_bigger_grains(self):
        def neighbour_match(size):
            grain = grain_frame(5, 128, 128, size, 0.0, 0.0)[0]
            return float(torch.corrcoef(torch.stack([grain[:, :-1].flatten(), grain[:, 1:].flatten()]))[0, 1])

        self.assertLess(abs(neighbour_match(1.0)), 0.1)
        self.assertGreater(neighbour_match(3.0), 0.6)

    def test_mask_limits_the_grain_and_keeps_alpha(self):
        image = torch.cat([grey(), torch.full((1, 48, 64, 1), 0.25)], dim=-1)
        mask = torch.zeros(1, 48, 64)
        mask[:, :, 32:] = 1.0
        out = add_film_grain(image, 0.5, 1.0, 0.5, 0.0, True, 6, mask)
        self.assertTrue(torch.equal(out[:, :, :32], image[:, :, :32]))
        self.assertFalse(torch.equal(out[:, :, 32:], image[:, :, 32:]))
        self.assertTrue(torch.equal(out[..., 3], image[..., 3]))

    def test_one_picture_and_a_mask_per_frame_give_a_batch(self):
        out = add_film_grain(grey(1), 0.3, 1.0, 0.5, 0.0, True, 0, torch.ones(4, 24, 32))
        self.assertEqual(tuple(out.shape), (4, 48, 64, 3))
        with self.assertRaises(ValueError):
            add_film_grain(grey(3), 0.3, 1.0, 0.5, 0.0, True, 0, torch.ones(2, 48, 64))

    def test_node_returns_the_image_with_preview_off(self):
        (out,) = AusBossFilmGrain().grain(grey(), 0.25, 1.0, 0.5, 0.0, True, 0, preview=False)
        self.assertEqual(tuple(out.shape), (1, 48, 64, 3))

    def test_auto_grain_size_follows_the_square_root_of_the_megapixels(self):
        _, small = auto_grain(1000, 1000, 0.0)
        _, big = auto_grain(2000, 2000, 0.0)
        self.assertAlmostEqual(small, 1.0)
        self.assertAlmostEqual(big, 2.0)

    def test_a_clean_picture_gets_the_normal_amount_and_a_grainy_one_more(self):
        gradient = torch.linspace(0.1, 0.9, 128).view(1, 1, 128, 1).expand(1, 128, 128, 3).contiguous()
        self.assertLess(measure_noise(gradient), 0.0015)
        self.assertAlmostEqual(auto_grain(128, 128, measure_noise(gradient))[0], 0.25)
        generator = torch.Generator().manual_seed(1)
        noisy = (gradient + 0.03 * torch.randn(gradient.shape, generator=generator)).clamp(0, 1)
        self.assertGreater(auto_grain(128, 128, measure_noise(noisy))[0], 0.35)

    def test_the_noise_measure_reads_the_noise_level(self):
        generator = torch.Generator().manual_seed(2)
        flat = torch.full((1, 200, 200, 3), 0.5)
        noisy = flat + 0.02 * torch.randn((1, 200, 200, 1), generator=generator)
        self.assertAlmostEqual(measure_noise(noisy), 0.02, delta=0.002)

    def test_the_multipliers_scale_autos_picks(self):
        image = grey(1, 100, 100)
        base = auto_film_grain_values(image, 1.0, 1.0)
        twice = auto_film_grain_values(image, 2.0, 2.0)
        self.assertAlmostEqual(twice["amount"], base["amount"] * 2)
        self.assertAlmostEqual(twice["size"], base["size"] * 2)
        self.assertAlmostEqual(twice["base_amount"], base["base_amount"])

    def test_auto_off_is_the_plain_node_and_auto_on_ignores_amount_and_size(self):
        image = torch.rand(1, 40, 40, 3)
        node = AusBossFilmGrain()
        (plain,) = node.grain(image, 0.25, 1.0, 0.5, 0.0, True, 0, preview=False)
        (off,) = node.grain(image, 0.25, 1.0, 0.5, 0.0, True, 0, preview=False, auto=False, auto_amount=3.0, auto_size=3.0)
        self.assertTrue(torch.equal(plain, off))
        (one,) = node.grain(image, 0.9, 3.0, 0.5, 0.0, True, 0, preview=False, auto=True)
        picked = auto_film_grain_values(image, 1.0, 1.0)
        expected = add_film_grain(image, picked["amount"], picked["size"], 0.5, 0.0, True, 0)
        self.assertTrue(torch.equal(one, expected))


if __name__ == "__main__":
    unittest.main()
