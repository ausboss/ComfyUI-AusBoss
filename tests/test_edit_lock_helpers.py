"""Edit Lock: a local edit keeps the rest of the picture, a whole-picture edit is left alone."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._edit_lock_helpers import (  # noqa: E402
    WHOLE_PICTURE,
    EditLock,
    box_blur,
    broad_change,
    change_core,
    describe,
    difference,
    measure_redraw,
    quiet_level,
    restore_pixels,
    soften,
)
from nodes.node_edit_lock import (  # noqa: E402
    NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS,
    AusBossEditLock,
    AusBossEditLockRestore,
)

H, W = 96, 80
BOX = (slice(30, 60), slice(20, 50))  # where the planted edit sits


def latents(seed: int = 0, video: bool = True):
    gen = torch.Generator().manual_seed(seed)
    # a real latent is smooth from cell to cell, so these are too
    source, other = (box_blur(torch.randn(1, 24, H, W, generator=gen), 4) for _ in range(2))
    source, other = source / source.std(), other / other.std()
    redraw = 0.15 * torch.randn(1, 24, H, W, generator=gen)  # the model's own redraw noise
    if video:
        return source[:, :, None], other[:, :, None], redraw[:, :, None]
    return source, other, redraw


def local_prediction(source, other, redraw, tint: float = 0.0):
    pred = source + redraw + tint
    pred[..., BOX[0], BOX[1]] = other[..., BOX[0], BOX[1]]
    return pred


def lock_for(source, mode="auto", tolerance=1.0):
    lock = EditLock(mode=mode, tolerance=tolerance)
    lock.latent = source.clone()
    lock.source = torch.zeros(1, H * 16, W * 16, 3)
    return lock


def run(lock, pred, sigma=1.0, steps=None):
    args = {"denoised": pred, "sigma": torch.tensor([sigma])}
    if steps is not None:
        # the sampler's own list of noise levels, the way ComfyUI hands it to the hook
        args["model_options"] = {"transformer_options": {"sample_sigmas": torch.tensor(steps)}}
    return lock.step(args)


SIX = [1.0, 0.97, 0.89, 0.75, 0.53, 0.23, 0.0]


class EditLockTests(unittest.TestCase):
    def test_local_edit_keeps_the_rest(self):
        for video in (True, False):
            source, other, redraw = latents(video=video)
            pred = local_prediction(source, other, redraw, tint=0.2)
            lock = lock_for(source)
            out = run(lock, pred)
            self.assertEqual(lock.status, "locked")
            self.assertEqual(out.shape, pred.shape)
            # far from the edit the original is back exactly, tint and redraw noise gone
            self.assertTrue(torch.equal(out[..., :12, :], source[..., :12, :].to(out.dtype)))
            self.assertTrue(torch.equal(out[..., 80:, :], source[..., 80:, :].to(out.dtype)))
            # inside the edit the model's prediction is untouched
            inner = (slice(36, 54), slice(26, 44))
            self.assertTrue(torch.equal(out[..., inner[0], inner[1]], pred[..., inner[0], inner[1]]))
            kept = lock.kept_share()
            self.assertGreater(kept, 0.7)
            self.assertLess(kept, 0.92)
            self.assertIn("kept", describe(lock))

    def test_report_says_what_to_do_when_nearly_all_was_kept(self):
        source, other, redraw = latents(video=False)
        lock = lock_for(source)
        run(lock, local_prediction(source, other, redraw))
        self.assertNotIn("set lock to off", describe(lock))
        # a faint change everywhere (rain) and one small clear spot: nearly all of it is kept
        pred = source + redraw
        pred[..., 40:46, 30:36] = other[..., 40:46, 30:36]
        lock = lock_for(source)
        run(lock, pred)
        self.assertGreater(lock.kept_share(), 0.95)
        self.assertIn("set lock to off", describe(lock))

    def test_it_watches_first_and_locks_when_the_noise_is_down(self):
        source, other, redraw = latents(video=False)
        lock = lock_for(source)
        # the model's own redraw noise fades from step to step, as it does in a real run
        for sigma, fade in ((1.0, 1.0), (0.97, 0.8), (0.89, 0.7)):
            pred = local_prediction(source, other, redraw * fade)
            out = run(lock, pred, sigma, SIX)
            self.assertEqual(lock.status, "watching")
            self.assertIsNone(lock.pixel_mask(H * 16, W * 16))
            # nothing is put back yet, and with no zoom to undo the prediction passes as it is
            self.assertTrue(torch.equal(out, pred))
        pred = local_prediction(source, other, redraw * 0.65)
        out = run(lock, pred, 0.75, SIX)
        self.assertEqual(lock.status, "locked")
        self.assertGreater(lock.top, 4.0)
        self.assertTrue(torch.equal(out[..., :12, :], source[..., :12, :]))
        inner = (slice(36, 54), slice(26, 44))
        self.assertTrue(torch.equal(out[..., inner[0], inner[1]], pred[..., inner[0], inner[1]]))

    def test_a_faint_change_everywhere_is_let_through(self):
        source, _, redraw = latents(video=False)
        rain = 0.25 * box_blur(torch.randn(1, 24, H, W, generator=torch.Generator().manual_seed(5)), 1)
        for mode, status in (("auto", "soft"), ("always", "locked")):
            lock = lock_for(source, mode=mode)
            # nothing shows at the first look; then the rain comes in everywhere, and no spot changes clearly
            for sigma, fade, wet in ((1.0, 1.0, 0.0), (0.97, 0.9, 0.5), (0.89, 0.8, 1.0)):
                run(lock, source + redraw * fade + rain * wet, sigma, SIX)
                self.assertEqual(lock.status, "watching")
            pred = source + redraw * 0.7 + rain * 1.5
            out = run(lock, pred, 0.75, SIX)
            self.assertEqual(lock.status, status)
            self.assertLess(lock.top, 4.0)
            if mode == "auto":
                self.assertLess(float((out - pred).abs().max()), 1e-4)
                self.assertIn("stepped aside", describe(lock))

    def test_a_wide_faint_change_with_no_peak_is_not_locked_in_patches(self):
        source, _, redraw = latents(video=False)
        gen = torch.Generator().manual_seed(9)
        snow = torch.zeros(1, 24, H, W)
        snow[..., :, :34] = 0.25 * torch.randn(1, 24, H, 34, generator=gen)  # faint, over two fifths of the picture
        theta = torch.tensor([[[1 / 1.015, 0.0, 0.0], [0.0, 1 / 1.015, 0.0]]])
        grid = torch.nn.functional.affine_grid(theta, list(source.shape), align_corners=False)
        zoomed = torch.nn.functional.grid_sample(source, grid, mode="bilinear", padding_mode="border", align_corners=False)
        for mode, status in (("auto", "soft"), ("always", "locked")):
            lock = lock_for(source, mode=mode)
            for sigma, fade in ((1.0, 1.0), (0.97, 0.8), (0.89, 0.7)):
                run(lock, source + redraw * fade, sigma, SIX)
            pred = source + redraw * 0.65 + snow
            out = run(lock, pred, 0.75, SIX)
            self.assertEqual(lock.status, status)
            self.assertGreater(lock.wide, 0.10)
            self.assertLess(lock.peak, 4.0)
            if mode == "always":
                self.assertLess(lock.kept_share(), 0.8)
                continue
            self.assertIsNone(lock.pixel_mask(H * 16, W * 16))
            self.assertLess(float((out - pred).abs().max()), 1e-4)
            self.assertIn("held the picture in place", describe(lock))
            # for the rest of the run only the zoom is undone
            out = run(lock, zoomed, 0.53, SIX)
            self.assertEqual(lock.status, "soft")
            smooth = lambda x: box_blur(x, 2)[..., 6:-6, 6:-6]
            self.assertLess(float((smooth(out) - smooth(source)).abs().mean()),
                            float((smooth(zoomed) - smooth(source)).abs().mean()) * 0.35)

    def test_the_last_step_decides_when_the_noise_never_gets_that_low(self):
        source, other, redraw = latents(video=False)
        lock = lock_for(source)
        two = [1.0, 0.92, 0.0]
        run(lock, local_prediction(source, other, redraw), 1.0, two)
        self.assertEqual(lock.status, "watching")
        run(lock, local_prediction(source, other, redraw * 0.8), 0.92, two)
        self.assertEqual(lock.status, "locked")
        # a one-step run decides at once
        lock = lock_for(source)
        run(lock, local_prediction(source, other, redraw), 1.0, [1.0, 0.0])
        self.assertEqual(lock.status, "locked")

    def test_the_zoom_is_undone_while_it_watches(self):
        source, other, redraw = latents(video=False)
        theta = torch.tensor([[[1 / 1.015, 0.0, 0.0], [0.0, 1 / 1.015, 0.0]]])
        grid = torch.nn.functional.affine_grid(theta, list(source.shape), align_corners=False)
        zoomed = torch.nn.functional.grid_sample(source, grid, mode="bilinear", padding_mode="border", align_corners=False)
        lock = lock_for(source)
        out = run(lock, zoomed, 1.0, SIX)
        self.assertEqual(lock.status, "watching")
        # read on smoothed copies: this is about where things sit, and resampling costs fine detail either way
        smooth = lambda x: box_blur(x, 2)[..., 6:-6, 6:-6]
        off_before = float((smooth(zoomed) - smooth(source)).abs().mean())
        off_after = float((smooth(out) - smooth(source)).abs().mean())
        self.assertLess(off_after, off_before * 0.35)

    def test_whole_picture_edit_is_left_alone(self):
        source, other, _ = latents()
        pred = 0.3 * source + other  # a new picture over the old one
        lock = lock_for(source)
        out = run(lock, pred)
        self.assertEqual(lock.status, "whole picture")
        self.assertTrue(torch.equal(out, pred))
        self.assertIsNone(lock.pixel_mask(H * 16, W * 16))
        # and it stays aside for the rest of the run
        self.assertTrue(torch.equal(run(lock, pred, 0.8), pred))
        self.assertIn("stepped aside", describe(lock))

    def test_a_slightly_larger_redraw_is_measured_and_is_not_an_edit(self):
        source, other, redraw = latents(video=False)
        # drawn 1.5% wider, 1% taller and half a cell to the right
        theta = torch.tensor([[[1 / 1.015, 0.0, -1.0 / W], [0.0, 1 / 1.01, 0.0]]])
        grid = torch.nn.functional.affine_grid(theta, list(source.shape), align_corners=False)
        zoomed = torch.nn.functional.grid_sample(source, grid, mode="bilinear", padding_mode="border", align_corners=False)
        move = measure_redraw(local_prediction(zoomed, other, redraw), source)
        self.assertAlmostEqual(float(move[0]), 1 / 1.015 - 1, delta=0.002)
        self.assertAlmostEqual(float(move[1]), 1 / 1.01 - 1, delta=0.002)
        self.assertAlmostEqual(float(move[2]), -0.5, delta=0.15)
        self.assertAlmostEqual(float(move[3]), 0.0, delta=0.15)
        self.assertLess(float(measure_redraw(source + redraw, source).abs().max()), 0.02)
        self.assertLess(float(broad_change(zoomed + redraw, source)), WHOLE_PICTURE / 2)
        lock = lock_for(source)
        out = run(lock, local_prediction(zoomed, other, redraw))
        self.assertEqual(lock.status, "locked")
        # the zoom did not read as an edit: only the planted box is free, and the rest is the original, unzoomed
        self.assertGreater(lock.kept_share(), 0.7)
        self.assertTrue(torch.equal(out[..., :12, :], source[..., :12, :]))
        # an even tint is not one either; new light across the picture is
        self.assertLess(float(broad_change(source + redraw + 0.6, source)), WHOLE_PICTURE / 2)
        self.assertGreater(float(broad_change(source + redraw + 0.6 * other, source)), WHOLE_PICTURE)

    def test_always_locks_a_whole_picture_edit(self):
        source, other, _ = latents()
        lock = lock_for(source, mode="always")
        run(lock, 0.3 * source + other)
        self.assertEqual(lock.status, "locked")

    def test_changed_stays_changed_and_a_new_run_starts_clean(self):
        source, other, redraw = latents()
        lock = lock_for(source)
        run(lock, local_prediction(source, other, redraw), 1.0)
        first = lock.mask.clone()
        run(lock, source + redraw, 0.8)  # a later step that agrees with the original everywhere
        self.assertTrue(torch.all(lock.mask >= first))
        run(lock, source + redraw, 1.0)  # the noise level went up: a new run
        self.assertLess(float(lock.mask.max()), 0.5)

    def test_given_mask_is_used_as_is(self):
        source, other, redraw = latents()
        lock = lock_for(source)
        mask = torch.zeros(1, H * 16, W * 16)
        mask[:, : H * 8] = 1.0  # the top half may change
        lock.user_mask = mask
        pred = 0.3 * source + other  # would count as a whole-picture edit
        out = run(lock, pred)
        self.assertEqual(lock.status, "locked")
        self.assertTrue(torch.equal(out[..., :40, :], pred[..., :40, :]))
        self.assertTrue(torch.equal(out[..., 56:, :], source[..., 56:, :]))
        self.assertIn("your mask", describe(lock))

    def test_other_sizes_video_and_wrong_vae_do_nothing(self):
        source, other, redraw = latents()
        pred = local_prediction(source, other, redraw)
        lock = lock_for(source[..., :48, :40].clone())
        self.assertTrue(torch.equal(run(lock, pred), pred))
        self.assertEqual(lock.status, "size")
        lock = lock_for(source)
        clip = pred.expand(-1, -1, 5, -1, -1)
        self.assertTrue(torch.equal(run(lock, clip), clip))
        self.assertEqual(lock.status, "video")
        lock = lock_for(source[:, :16].clone())
        self.assertTrue(torch.equal(run(lock, pred), pred))
        self.assertEqual(lock.status, "vae")
        for status in ("size", "video", "vae"):
            lock.status = status
            self.assertIn("did nothing", describe(lock))

    def test_a_grid_one_cell_off_still_locks(self):
        source, other, redraw = latents(video=False)
        lock = lock_for(torch.nn.functional.interpolate(source, size=(H + 2, W + 1), mode="bilinear"))
        run(lock, local_prediction(source, other, redraw))
        self.assertEqual(lock.status, "locked")
        self.assertGreater(lock.kept_share(), 0.7)

    def test_tolerance_moves_the_line(self):
        source, other, redraw = latents(video=False)
        pred = source + redraw
        pred[..., BOX[0], BOX[1]] += 0.45 * other[..., BOX[0], BOX[1]]  # a faint change
        magnitude = difference(pred, source)
        quiet = quiet_level(magnitude)
        loose = change_core(magnitude, quiet, 0.5)
        strict = change_core(magnitude, quiet, 2.0)
        self.assertGreater(float(loose[..., 40:50, 30:40].mean()), 0.9)
        self.assertEqual(float(strict.max()), 0.0)

    def test_faint_change_counts_only_beside_a_clear_one(self):
        quiet = torch.tensor([1.0])
        magnitude = torch.ones(1, 1, 40, 40)
        magnitude[..., 5:15, 5:15] = 2.2      # faint, alone: redraw noise
        magnitude[..., 22:34, 22:34] = 2.2    # faint ...
        magnitude[..., 26:30, 26:30] = 4.0    # ... around a clear change
        core = change_core(magnitude, quiet)
        self.assertEqual(float(core[..., 5:15, 5:15].max()), 0.0)
        self.assertEqual(float(core[..., 22:34, 22:34].min()), 1.0)
        self.assertEqual(float(core.sum()), 144.0)
        # what an earlier step held stays, and faint change that touches it joins
        held = torch.zeros_like(core)
        held[..., 8:10, 8:10] = 1.0
        again = change_core(torch.ones(1, 1, 40, 40), quiet, held=held)
        self.assertEqual(float(again.sum()), 4.0)
        joined = change_core(magnitude, quiet, held=held)
        self.assertEqual(float(joined[..., 5:15, 5:15].min()), 1.0)
        soft = soften(core)
        self.assertTrue(torch.all(soft[..., 22:34, 22:34] == 1.0))
        self.assertGreater(float(soft[0, 0, 21, 28]), 0.5)
        self.assertEqual(float(soft[0, 0, 2, 2]), 0.0)

    def test_restore_gives_the_original_pixels_back(self):
        gen = torch.Generator().manual_seed(1)
        original = torch.rand(1, 128, 160, 3, generator=gen)
        result = torch.rand(2, 128, 160, 3, generator=gen)
        mask = torch.zeros(1, 128, 160)
        mask[:, 40:80, 60:100] = 1.0
        out, edit = restore_pixels(result, original, mask, 8)
        self.assertEqual(out.shape, result.shape)
        self.assertEqual(edit.shape, (2, 128, 160))
        self.assertTrue(torch.equal(out[:, :16], original[:, :16].expand(2, -1, -1, -1)))
        self.assertTrue(torch.equal(out[:, 40:80, 60:100], result[:, 40:80, 60:100]))
        # the fade lies outside the edit
        self.assertTrue(torch.all(edit[:, 40:80, 60:100] == 1.0))
        self.assertGreater(float(edit[0, 36, 80]), 0.0)
        # another size: the original is resized to the result
        small = torch.rand(1, 64, 80, 3, generator=gen)
        out, _ = restore_pixels(result, small, mask, 0)
        self.assertEqual(out.shape, result.shape)

    def test_restore_node_passes_through_when_nothing_was_locked(self):
        lock = EditLock()
        lock.status = "whole picture"
        image = torch.rand(1, 32, 48, 3)
        out, mask, report = AusBossEditLockRestore().restore(image, lock, 16)
        self.assertTrue(torch.equal(out, image))
        self.assertEqual(mask.shape, (1, 32, 48))
        self.assertTrue(torch.all(mask == 1.0))
        self.assertIn("stepped aside", report)

    def test_restore_node_after_a_locked_run(self):
        source, other, redraw = latents()
        lock = lock_for(source)
        lock.source = torch.rand(1, H * 4, W * 4, 3)
        run(lock, local_prediction(source, other, redraw))
        image = torch.rand(1, H * 4, W * 4, 3)
        out, mask, report = AusBossEditLockRestore().restore(image, lock, 4)
        self.assertTrue(torch.equal(out[:, :24], lock.source[:, :24]))
        self.assertTrue(torch.equal(out[:, 150:210, 110:170], image[:, 150:210, 110:170]))
        self.assertGreater(float(mask[0, 180, 140]), 0.99)
        self.assertIn("kept", report)

    def test_mappings(self):
        keys = {"AUSBOSS_NODES_EditLock", "AUSBOSS_NODES_EditLockRestore"}
        self.assertEqual(set(NODE_CLASS_MAPPINGS), keys)
        self.assertEqual(set(NODE_DISPLAY_NAME_MAPPINGS), keys)
        self.assertIs(NODE_CLASS_MAPPINGS["AUSBOSS_NODES_EditLock"], AusBossEditLock)
        for name in NODE_DISPLAY_NAME_MAPPINGS.values():
            self.assertTrue(name.endswith(" 🆎"))


if __name__ == "__main__":
    unittest.main()
