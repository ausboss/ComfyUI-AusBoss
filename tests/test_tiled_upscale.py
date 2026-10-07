from __future__ import annotations

from pathlib import Path
import sys
import types
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import node_tiled_upscale as module
from nodes._resize_helpers import resample_batch
from nodes.node_tiled_upscale import AusBossTiledUpscaleStitch, AusBossTiledUpscale


def picture(batch: int, height: int, width: int, seed: int = 0, channels: int = 3) -> torch.Tensor:
    """A smooth picture with a little texture: sharp noise would not survive a resample."""
    generator = torch.Generator().manual_seed(seed)
    ys = torch.linspace(0, 1, height)[None, :, None, None]
    xs = torch.linspace(0, 1, width)[None, None, :, None]
    base = torch.cat([ys.expand(1, height, width, 1), xs.expand(1, height, width, 1), (ys * xs).expand(1, height, width, 1)], dim=-1)
    noise = torch.rand((batch, height, width, 3), generator=generator) * 0.05
    out = (base * 0.9 + noise).clamp(0, 1)
    if channels == 4:
        out = torch.cat([out, torch.ones((batch, height, width, 1))], dim=-1)
    return out


def stitch(tiles, stitcher, keep_colors=1.0):
    # the node is INPUT_IS_LIST: every input arrives as a list
    return AusBossTiledUpscaleStitch().stitch(list(tiles), [stitcher], [keep_colors])[0]


class SplitTests(unittest.TestCase):
    def test_outputs(self):
        tiles, stitcher, before, width, height, report = AusBossTiledUpscale().split(picture(1, 327, 184), 2.0)
        self.assertEqual((width, height), (1056, 1888))
        self.assertEqual(len(tiles), 1)
        self.assertEqual(tuple(tiles[0].shape), (1, 1888, 1056, 3))
        self.assertEqual(tuple(before.shape), (1, 1888, 1056, 3))
        self.assertEqual(stitcher["kind"], module.STITCHER_KIND)
        self.assertIn("one tile", report)

    def test_tiles_are_cut_from_the_enlarged_picture(self):
        source = picture(1, 654, 368)
        tiles, stitcher, before, width, height, _ = AusBossTiledUpscale().split(source, 8.0, max_growth=64.0)
        plan = stitcher["plan"]
        self.assertEqual(len(tiles), 4)
        base = resample_batch(source, *plan["redraw"], "lanczos")
        for tile, (left, top, right, bottom) in zip(tiles, plan["boxes"]):
            self.assertTrue(torch.equal(tile, base[:, top:bottom, left:right, :]))
        self.assertEqual((before.shape[2], before.shape[1]), (width, height))

    def test_alpha_and_single_channel_pictures(self):
        tiles, *_ = AusBossTiledUpscale().split(picture(1, 96, 64, channels=4), 0.5)
        self.assertEqual(tiles[0].shape[-1], 3)
        gray = picture(1, 96, 64)[..., :1]
        tiles, *_ = AusBossTiledUpscale().split(gray, 0.5)
        self.assertEqual(tiles[0].shape[-1], 3)

    def test_rejects_what_is_not_a_picture(self):
        with self.assertRaisesRegex(ValueError, "BHWC"):
            AusBossTiledUpscale().split(torch.zeros((8, 8, 3)), 2.0)


class StitchTests(unittest.TestCase):
    def test_untouched_tiles_give_the_enlarged_picture_back(self):
        source = picture(1, 654, 368, seed=3)
        for asked, count in ((2.0, 1), (4.0, 2), (8.0, 4)):
            with self.subTest(megapixels=asked):
                tiles, stitcher, before, width, height, _ = AusBossTiledUpscale().split(source, asked, max_growth=64.0)
                self.assertEqual(len(tiles), count)
                out = stitch(tiles, stitcher, 0.0)
                self.assertEqual(tuple(out.shape), (1, height, width, 3))
                # blended joins of identical content: the picture itself, to float precision
                self.assertLess(float((out - before).abs().max()), 1e-5)
                matched = stitch(tiles, stitcher, 1.0)
                self.assertLess(float((matched - before).abs().max()), 2e-3)

    def test_a_small_picture_ends_at_the_size_asked(self):
        tiles, stitcher, before, width, height, report = AusBossTiledUpscale().split(picture(1, 256, 147), 8.0)
        self.assertEqual(len(tiles), 1)
        self.assertIn("enlarged", report)
        out = stitch(tiles, stitcher)
        self.assertEqual(tuple(out.shape), (1, height, width, 3))
        self.assertGreater(width * height, tiles[0].shape[1] * tiles[0].shape[2] * 3)

    def test_tiles_of_another_size_or_with_alpha_are_fitted(self):
        tiles, stitcher, before, width, height, _ = AusBossTiledUpscale().split(picture(1, 654, 368, seed=5), 4.0, max_growth=64.0)
        changed = []
        for tile in tiles:
            half = resample_batch(tile, tile.shape[2] // 2, tile.shape[1] // 2, "bilinear")
            changed.append(torch.cat([half, torch.ones_like(half[..., :1])], dim=-1))
        out = stitch(changed, stitcher, 0.0)
        self.assertEqual(tuple(out.shape), (1, height, width, 3))
        self.assertLess(float((out - before).abs().mean()), 0.02)

    def test_keep_colors_pulls_a_tinted_tile_back(self):
        tiles, stitcher, before, *_ = AusBossTiledUpscale().split(picture(1, 654, 368, seed=7), 4.0, max_growth=64.0)
        self.assertEqual(len(tiles), 2)
        tinted = [(tile * 0.8 + 0.1).clamp(0, 1) if index == 0 else tile for index, tile in enumerate(tiles)]
        loose = stitch(tinted, stitcher, 0.0)
        kept = stitch(tinted, stitcher, 1.0)
        self.assertGreater(float((loose - before).abs().mean()), 3 * float((kept - before).abs().mean()))
        half = stitch(tinted, stitcher, 0.5)
        self.assertLess(float((kept - before).abs().mean()), float((half - before).abs().mean()))

    def test_keep_colors_is_not_fooled_by_a_noisy_source(self):
        # A pale picture with coarse color noise, the way an old phone photo looks. The redraw is the clean picture.
        clean = picture(1, 480, 320, seed=11) * 0.35 + 0.4
        generator = torch.Generator().manual_seed(12)
        blotches = torch.nn.functional.interpolate(torch.randn((1, 3, 60, 40), generator=generator), size=(480, 320), mode="bilinear")
        noisy = (clean + blotches.movedim(1, -1) * 0.06).clamp(0, 1)
        kept = module._keep_colors(clean, noisy, 1.0)
        spread = lambda image: float(module._averaged_lab(image)[..., 1:].std(dim=(1, 2)).norm())
        self.assertLess(abs(spread(kept) / spread(clean) - 1.0), 0.05)
        # the plain spread match takes the noise for color: this is what the fit is for
        from nodes._color_helpers import match_colors
        self.assertGreater(spread(match_colors(clean, noisy, 1.0, method="lab")) / spread(clean), 1.15)

    def test_keep_colors_brings_a_faded_source_back_faded(self):
        fresh = picture(1, 480, 320, seed=13)
        faded = fresh * 0.5 + 0.3
        kept = module._keep_colors(fresh, faded, 1.0)
        # a fade that is a straight line in RGB is a slight curve in LAB: close, not exact
        self.assertLess(float((kept - faded).abs().mean()), 0.02)
        self.assertGreater(float((fresh - faded).abs().mean()), 5 * float((kept - faded).abs().mean()))

    def test_keep_colors_leaves_a_gray_picture_gray(self):
        gray = picture(1, 240, 160, seed=15).mean(dim=-1, keepdim=True).expand(-1, -1, -1, 3)
        tinted = (gray * torch.tensor([1.03, 1.0, 0.97])).clamp(0, 1)
        kept = module._keep_colors(tinted, gray, 1.0)
        chroma = lambda image: float(module._averaged_lab(image)[..., 1:].abs().mean())
        self.assertLess(chroma(kept), 0.3 * chroma(tinted))

    def test_a_batch_of_pictures_and_one_batched_tensor(self):
        source = picture(2, 654, 368, seed=9)
        tiles, stitcher, before, width, height, _ = AusBossTiledUpscale().split(source, 4.0, max_growth=64.0)
        self.assertEqual((len(tiles), tiles[0].shape[0]), (2, 2))
        out = stitch(tiles, stitcher, 0.0)
        self.assertEqual(tuple(out.shape), (2, height, width, 3))
        self.assertLess(float((out - before).abs().max()), 1e-5)
        together = stitch([torch.cat(tiles, dim=0)], stitcher, 0.0)
        self.assertTrue(torch.allclose(together, out))

    def test_wrong_wiring_is_a_clear_error(self):
        tiles, stitcher, *_ = AusBossTiledUpscale().split(picture(1, 654, 368), 8.0, max_growth=64.0)
        with self.assertRaisesRegex(ValueError, "got 3 tiles and the stitcher has 4"):
            stitch(tiles[:3], stitcher)
        with self.assertRaisesRegex(ValueError, "stitcher from Tiled Upscale"):
            stitch(tiles, {"kind": "something else"})


class UpscaleModelTests(unittest.TestCase):
    """The upscale model runs through ComfyUI's own node; here a stand-in doubles the picture."""

    def setUp(self):
        self.saved = sys.modules.get("nodes")
        calls = self.calls = []

        class Doubler:
            @classmethod
            def execute(cls, upscale_model, image):
                calls.append(tuple(image.shape))
                big = resample_batch(image, image.shape[2] * 2, image.shape[1] * 2, "bilinear")
                return types.SimpleNamespace(result=(big,))

        self.core = {"ImageUpscaleWithModel": Doubler}
        self.patch = module._core_nodes
        module._core_nodes = lambda: self.core

    def tearDown(self):
        module._core_nodes = self.patch

    def test_model_runs_until_the_picture_covers_the_redraw(self):
        tiles, stitcher, before, width, height, _ = AusBossTiledUpscale().split(picture(1, 654, 368), 8.0, upscale_model=object(), max_growth=64.0)
        self.assertEqual(len(self.calls), 3)          # 368 wide, doubled three times, covers 2112
        self.assertEqual(len(tiles), 4)
        self.calls.clear()
        AusBossTiledUpscale().split(picture(1, 654, 368), 8.0, upscale_model=object())
        self.assertEqual(len(self.calls), 2)          # a small picture is redrawn at 2 MP: two passes cover 1056
        self.assertEqual((before.shape[2], before.shape[1]), (width, height))

    def test_model_is_left_alone_when_nothing_grows(self):
        AusBossTiledUpscale().split(picture(1, 654, 368), 0, upscale_model=object())
        self.assertEqual(self.calls, [])

    def test_missing_core_node_says_what_to_do(self):
        self.core.clear()
        with self.assertRaisesRegex(RuntimeError, "Upscale Image"):
            AusBossTiledUpscale().split(picture(1, 654, 368), 8.0, upscale_model=object())


if __name__ == "__main__":
    unittest.main()
