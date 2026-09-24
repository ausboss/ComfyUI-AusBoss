from __future__ import annotations

import asyncio
import contextlib
import io
import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._transform_engine import (
    TransformSpec,
    transform_tensor_batch,
    transform_tensor_batch_chunked,
)
from nodes._inpaint_crop_helpers import STITCHER_KIND, apply_stitch, stitch_blend_from_mask
from nodes._transform_inputs import resize_inputs, transform_inputs
from nodes.node_inpaint_crop_stitch import AusBossStitchInpaint
from nodes.node_video_crop_rotate_pad_clip import AusBossVideoCropRotatePadClip, snap_frame_count
from test_video_load_helpers import FPS, FRAMES, HEIGHT, WIDTH, ensure_core_video_api, write_test_video


def transform_defaults(**overrides) -> dict:
    values = {name: spec[1]["default"] for name, spec in transform_inputs().items()}
    values.update({name: spec[1]["default"] for name, spec in resize_inputs().items()})
    values.update(overrides)
    return values


class ClipDefaultsTests(unittest.TestCase):
    def test_a_fresh_clip_node_is_outpaint_ready(self):
        # The in-context video models the clip feeds paint pure black behind
        # a hard edge; a grey or feathered band comes back untouched.
        required = AusBossVideoCropRotatePadClip.INPUT_TYPES()["required"]
        self.assertEqual(required["feather"][1]["default"], 0)
        self.assertEqual(required["fill_color"][1]["default"], "#000000")
        self.assertEqual(transform_inputs()["feather"][1]["default"], 24)


class ChunkedTransformTests(unittest.TestCase):
    def test_chunks_match_the_single_pass_transform(self):
        torch.manual_seed(7)
        batch = torch.rand((5, 40, 56, 3))
        spec = TransformSpec(rotation_degrees=12.5, pad_left=9, pad_top=4, feather=6, canvas_multiple=8)
        whole_out, whole_mask, whole_geometry = transform_tensor_batch(batch, spec)
        out, mask, geometry = transform_tensor_batch_chunked(batch, spec, chunk_size=2)
        self.assertEqual(geometry, whole_geometry)
        self.assertTrue(torch.equal(out, whole_out))
        self.assertTrue(torch.equal(mask, whole_mask))

    def test_empty_batch_is_reported(self):
        with self.assertRaisesRegex(ValueError, "no decodable frames"):
            transform_tensor_batch_chunked(torch.zeros((0, 8, 8, 3)), TransformSpec())


class VideoClipNodeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.video = Path(cls._tmp.name) / "clip.mp4"
        write_test_video(cls.video, with_audio=True)
        # Local path mode reads only ComfyUI's input/output/temp folders;
        # the fixture's temporary folder stands in for one.
        from nodes import _media_helpers

        root = Path(cls._tmp.name).resolve()
        cls._env = unittest.mock.patch.object(_media_helpers, "_comfy_managed_roots", lambda: [root])
        cls._env.start()

    @classmethod
    def tearDownClass(cls):
        cls._env.stop()
        cls._tmp.cleanup()

    def run_node(self, **overrides):
        values = transform_defaults()
        args = {
            "video": "",
            "source_mode": "local path",
            "local_path": str(self.video),
            "start_seconds": 0.0,
            "end_seconds": 0.0,
            **values,
        }
        args.update(overrides)
        return asyncio.run(AusBossVideoCropRotatePadClip().load_transform(**args))

    def test_linked_frame_bounds_override_stale_timeline_and_cap(self):
        out = self.run_node(start_seconds=9, end_seconds=2, start_frame=6, end_frame=18,
                            max_frames=1, frame_load_cap=4)
        self.assertEqual(out[3], 4)
        self.assertAlmostEqual(out[7], 4 / FPS)
        reference = self.run_node(start_seconds=6 / FPS, end_seconds=18 / FPS, max_frames=4)
        self.assertTrue(torch.equal(out[0], reference[0]))

    def test_force_rate_preserves_time_drops_or_repeats_frames(self):
        original = self.run_node()
        for rate in (FPS / 2, FPS * 2):
            out = self.run_node(force_rate=rate)
            self.assertEqual(out[3], int(FRAMES * rate / FPS))
            self.assertEqual(out[4], rate)
            self.assertAlmostEqual(out[7], original[7])
            if rate > FPS:
                self.assertTrue(torch.equal(out[0][0], out[0][1]))
            else:
                self.assertTrue(torch.equal(out[0][1], original[0][2]))

    def test_force_rate_cap_and_thinning_apply_before_snap(self):
        out = self.run_node(start_frame=3, end_frame=21, force_rate=24,
                            every_nth=2, frame_load_cap=10, frame_snap="4n+1")
        self.assertEqual(out[3], 9)
        self.assertEqual(out[4], 12)
        self.assertAlmostEqual(out[7], 0.75)
        self.assertAlmostEqual(out[2]["waveform"].shape[-1] / out[2]["sample_rate"], 0.75, delta=0.01)

    def test_linked_bounds_do_not_validate_stale_widget_window(self):
        self.assertIs(AusBossVideoCropRotatePadClip.VALIDATE_INPUTS(
            "", "local path", str(self.video), 9, 2, force_rate=None, input_types={"start_frame": "INT", "force_rate": "INT"}), True)
        self.assertIsNot(AusBossVideoCropRotatePadClip.VALIDATE_INPUTS(
            "", "local path", str(self.video), 0, 0, input_types={"start_frame": "STRING"}), True)

    def test_invalid_force_rate_and_backwards_frame_bounds_fail(self):
        for rate in (-1, float("nan"), 1001):
            with self.assertRaises(ValueError):
                self.run_node(force_rate=rate)
        with self.assertRaises(ValueError):
            self.run_node(start_frame=18, end_frame=6)

    def test_fixed_frames_move_as_one_window_and_override_limits(self):
        out = self.run_node(start_seconds=99, end_seconds=0.1, end_frame=1,
                            fixed_frames=12, frame_load_cap=2, max_frames=1, frame_snap="8n+1")
        reference = self.run_node(start_seconds=1, end_seconds=2)
        self.assertEqual(out[3], 12)
        self.assertTrue(torch.equal(out[0], reference[0]))
        self.assertTrue(torch.equal(out[9], reference[9]))
        self.assertEqual(out[8]["canvas"].shape[0], 12)
        self.assertAlmostEqual(out[7], 1)
        self.assertAlmostEqual(out[2]["waveform"].shape[-1] / out[2]["sample_rate"], 1, delta=0.01)

    def test_fixed_frames_uses_output_rate_after_thinning(self):
        for rate, nth, count in [(24, 2, 12), (24, 1, 24), (0, 2, 6), (10, 1, 9)]:
            out = self.run_node(start_frame=23, fixed_frames=count, force_rate=rate, every_nth=nth)
            self.assertEqual(out[3], count)
            self.assertEqual(out[4], (rate or FPS) / nth)
            self.assertAlmostEqual(out[7], count / out[4])
            self.assertAlmostEqual(out[2]["waveform"].shape[-1] / out[2]["sample_rate"], out[7], delta=0.01)

    def test_fixed_frames_too_long_is_explicit_and_zero_preserves_free_trim(self):
        with self.assertRaisesRegex(ValueError, "source is only"):
            self.run_node(fixed_frames=FRAMES + 1)
        free = self.run_node(start_seconds=0.5, end_seconds=1, fixed_frames=0)
        self.assertEqual(free[3], 6)
        self.assertIs(AusBossVideoCropRotatePadClip.VALIDATE_INPUTS(
            "", "local path", str(self.video), 9, 2, fixed_frames=12), True)
        self.assertIn("source is only", AusBossVideoCropRotatePadClip.VALIDATE_INPUTS(
            "", "local path", str(self.video), 0, 0, fixed_frames=FRAMES + 1))

    def test_padding_applies_to_every_frame_and_lands_in_the_mask(self):
        frames, mask, audio, count, fps, width, height, duration = self.run_node(pad_left=16, feather=0)[:8]
        self.assertEqual(tuple(frames.shape), (FRAMES, HEIGHT, WIDTH + 16, 3))
        self.assertEqual(tuple(mask.shape), (FRAMES, HEIGHT, WIDTH + 16))
        self.assertTrue(torch.all(mask[:, :, :16] == 1.0))
        self.assertTrue(torch.all(mask[:, :, 16:] == 0.0))
        # Fill color #808080 in the new band, on every frame.
        self.assertTrue(torch.allclose(frames[:, :, :16], torch.full((FRAMES, HEIGHT, 16, 3), 128 / 255)))
        self.assertEqual((count, width, height), (FRAMES, WIDTH + 16, HEIGHT))
        self.assertAlmostEqual(fps, float(FPS))
        self.assertAlmostEqual(duration, FRAMES / FPS)
        self.assertGreater(audio["waveform"].shape[-1], 0)

    def test_trim_thinning_and_crop_compose(self):
        frames, mask, _, count, fps, width, height, duration = self.run_node(
            start_seconds=0.5, end_seconds=1.5, every_nth=2, crop_x=8, crop_width=32, feather=0
        )[:8]
        self.assertEqual(count, 6)
        self.assertEqual(tuple(frames.shape), (6, HEIGHT, 32, 3))
        self.assertEqual((width, height), (32, HEIGHT))
        self.assertAlmostEqual(fps, FPS / 2)
        self.assertAlmostEqual(duration, 1.0)
        self.assertEqual(float(mask.max()), 0.0)

    def test_preview_position_never_changes_the_fingerprint(self):
        common = dict(video="", source_mode="local path", local_path=str(self.video), start_seconds=0.0, end_seconds=0.0)
        values = transform_defaults(pad_right=8)
        one = AusBossVideoCropRotatePadClip.IS_CHANGED(**common, frame_index=0, frame_time=0.0, **values)
        two = AusBossVideoCropRotatePadClip.IS_CHANGED(**common, frame_index=17, frame_time=1.4, seek_mode="time seconds", **values)
        self.assertEqual(one, two)
        trimmed = AusBossVideoCropRotatePadClip.IS_CHANGED(**{**common, "end_seconds": 1.0}, **values)
        self.assertNotEqual(one, trimmed)
        padded = AusBossVideoCropRotatePadClip.IS_CHANGED(**common, **transform_defaults(pad_right=9))
        self.assertNotEqual(one, padded)

    def test_validate_rejects_a_backwards_window(self):
        message = AusBossVideoCropRotatePadClip.VALIDATE_INPUTS(
            "", "local path", str(self.video), start_seconds=2.0, end_seconds=1.0
        )
        self.assertIn("start_seconds", str(message))
        self.assertIs(AusBossVideoCropRotatePadClip.VALIDATE_INPUTS("", "local path", str(self.video), 0.0, 0.0), True)

    def test_pad_fit_preserves_source_pixels_and_mask(self):
        original = self.run_node(feather=0)[0]
        frames, mask, _, _, _, width, height, _ = self.run_node(
            crop_aspect_ratio="free", crop_width=WIDTH, crop_height=HEIGHT,
            pad_top=17, pad_bottom=18, feather=0,
        )[:8]
        self.assertEqual((width, height), (WIDTH, HEIGHT + 35))
        self.assertTrue(torch.equal(frames[:, 17:17 + HEIGHT], original))
        self.assertTrue(torch.all(mask[:, 17:17 + HEIGHT] == 0))
        self.assertTrue(torch.all(mask[:, :17] == 1))
        self.assertTrue(torch.all(mask[:, -18:] == 1))

    def test_limit_shortens_audio_and_duration_together(self):
        _, _, audio, count, fps, _, _, duration = self.run_node(
            start_seconds=0.5, end_seconds=1.5, every_nth=2, max_frames=3,
        )[:8]
        self.assertEqual(count, 3)
        self.assertAlmostEqual(duration, count / fps)
        self.assertAlmostEqual(audio["waveform"].shape[-1] / audio["sample_rate"], duration, delta=0.01)

    def test_frame_snap_keeps_a_video_model_count_and_the_audio_follows(self):
        free = self.run_node(start_seconds=0.0, end_seconds=0.0)
        self.assertEqual(free[3], FRAMES)
        snapped = self.run_node(start_seconds=0.0, end_seconds=0.0, frame_snap="4n+1")
        frames, mask, audio, count, fps, _, _, duration, stitcher, original = snapped
        self.assertEqual(original.shape[0], count)
        self.assertEqual(tuple(original.shape[1:3]), (HEIGHT, WIDTH))
        self.assertEqual(count, ((FRAMES - 1) // 4) * 4 + 1)
        self.assertEqual(frames.shape[0], count)
        self.assertEqual(mask.shape[0], count)
        self.assertEqual(stitcher["canvas"].shape[0], count)
        self.assertAlmostEqual(duration, count / fps)
        self.assertAlmostEqual(audio["waveform"].shape[-1] / audio["sample_rate"], duration, delta=0.01)

    def test_frame_snap_rules(self):
        self.assertEqual(snap_frame_count(78, "8n+1"), 73)
        self.assertEqual(snap_frame_count(97, "8n+1"), 97)
        self.assertEqual(snap_frame_count(78, "4n+1"), 77)
        self.assertEqual(snap_frame_count(78, "free"), 78)
        self.assertEqual(snap_frame_count(5, "8n+1"), 1)
        self.assertEqual(snap_frame_count(0, "8n+1"), 0)
        self.assertEqual(snap_frame_count(30, "nonsense"), 30)

    def test_frame_snap_changes_the_fingerprint(self):
        common = dict(video="", source_mode="local path", local_path=str(self.video), start_seconds=0.0, end_seconds=0.0)
        values = transform_defaults()
        one = AusBossVideoCropRotatePadClip.IS_CHANGED(**common, **values)
        two = AusBossVideoCropRotatePadClip.IS_CHANGED(**common, frame_snap="8n+1", **values)
        self.assertNotEqual(one, two)

    def test_stitcher_pastes_the_source_back_over_a_generated_clip(self):
        out = self.run_node(pad_left=16, pad_right=8, feather=0, stitch_blend=4)
        frames, mask, stitcher = out[0], out[1], out[8]
        self.assertEqual(stitcher["kind"], STITCHER_KIND)
        self.assertTrue(torch.equal(stitcher["canvas"], frames))
        self.assertEqual(tuple(stitcher["blend"].shape), tuple(mask.shape))
        self.assertEqual(stitcher["source_bbox"], (16, 0, 16 + WIDTH, HEIGHT))
        # The paste covers the bands (to within the blur kernel's float sum)
        # and ramps a few pixels into the source; beyond the ramp it is zero.
        self.assertTrue(torch.all(stitcher["blend"][:, :, :16] >= 0.999))
        self.assertTrue(torch.all(stitcher["blend"][:, :, 16 + 12 : -(8 + 12)] == 0.0))
        generated = torch.rand_like(frames)
        stitched = apply_stitch(stitcher, generated)
        self.assertEqual(tuple(stitched.shape), tuple(frames.shape))
        self.assertTrue(torch.equal(stitched[:, :, 32:-24], frames[:, :, 32:-24]))
        self.assertTrue(torch.allclose(stitched[:, :, :16], generated[:, :, :16], atol=1e-5))
        self.assertTrue(torch.allclose(stitched[:, :, -8:], generated[:, :, -8:], atol=1e-5))

    def test_stitcher_without_padding_returns_the_frames_untouched(self):
        out = self.run_node(feather=0)
        frames, stitcher = out[0], out[8]
        self.assertEqual(float(stitcher["blend"].max()), 0.0)
        self.assertTrue(torch.equal(apply_stitch(stitcher, torch.rand_like(frames)), frames))

    def test_a_shorter_generated_clip_stitches_with_a_matching_mask(self):
        # frame_snap "free" keeps every frame, but LTX hands back 8n+1: the
        # stitch keeps the leading frames and blend_mask has to match them.
        out = self.run_node(pad_left=16, feather=0, stitch_blend=4)
        frames, stitcher = out[0], out[8]
        self.assertEqual(stitcher["blend"].shape[0], FRAMES)  # one mask per frame
        kept = snap_frame_count(FRAMES, "8n+1")
        self.assertLess(kept, FRAMES)
        generated = torch.rand_like(frames[:kept])
        with contextlib.redirect_stdout(io.StringIO()):
            stitched, blend_mask = AusBossStitchInpaint().stitch(stitcher, generated)
        self.assertEqual(tuple(stitched.shape), (kept, *frames.shape[1:]))
        self.assertTrue(torch.equal(blend_mask, stitcher["blend"][:kept]))
        self.assertTrue(torch.equal(stitched[:, :, 32:], frames[:kept, :, 32:]))

    def test_stitch_grow_moves_the_paste_boundary(self):
        base = self.run_node(pad_left=16, feather=0, stitch_blend=0)[8]["blend"]
        grown = self.run_node(pad_left=16, feather=0, stitch_blend=0, stitch_grow=6)[8]["blend"]
        shrunk = self.run_node(pad_left=16, feather=0, stitch_blend=0, stitch_grow=-6)[8]["blend"]
        self.assertTrue(torch.all(base[:, :, :16] == 1.0) and torch.all(base[:, :, 16:] == 0.0))
        self.assertTrue(torch.all(grown[:, :, :22] == 1.0) and torch.all(grown[:, :, 22:] == 0.0))
        self.assertTrue(torch.all(shrunk[:, :, :10] == 1.0) and torch.all(shrunk[:, :, 10:] == 0.0))

    def test_stitch_settings_change_the_fingerprint(self):
        common = dict(video="", source_mode="local path", local_path=str(self.video), start_seconds=0.0, end_seconds=0.0)
        values = transform_defaults(pad_left=8)
        one = AusBossVideoCropRotatePadClip.IS_CHANGED(**common, **values)
        two = AusBossVideoCropRotatePadClip.IS_CHANGED(**common, stitch_blend=48, **values)
        self.assertNotEqual(one, two)

    def test_resize_keeps_frames_and_masks_aligned(self):
        if not ensure_core_video_api(self):
            self.skipTest("Set AUSBOSS_COMFY_ROOT to test ComfyUI's resize implementation.")
        out = self.run_node(
            max_frames=2, pad_left=8, resize_to_megapixels=True,
            megapixels=0.01, resolution_steps=8,
        )
        frames, mask, _, count, _, width, height, _ = out[:8]
        self.assertEqual(count, 2)
        self.assertEqual(tuple(frames.shape[1:3]), (height, width))
        self.assertEqual(tuple(mask.shape), (count, height, width))
        self.assertEqual(width % 8, 0)
        self.assertEqual(height % 8, 0)
        stitcher = out[8]
        self.assertEqual(tuple(stitcher["canvas"].shape), tuple(frames.shape))
        self.assertEqual(tuple(stitcher["blend"].shape), (count, height, width))
        x0, _, x1, _ = stitcher["source_bbox"]
        self.assertTrue(0 < x0 < x1 <= width)


if __name__ == "__main__":
    unittest.main()
