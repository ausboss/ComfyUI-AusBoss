from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
import unittest.mock

import av
import numpy as np
from PIL import Image
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._media_helpers import decode_video_frame, video_metadata
from nodes._transform_engine import (
    TransformSpec,
    stable_file_fingerprint,
    transform_pil,
    transform_tensor_batch,
)


def solid(width=12, height=8, color=(30, 80, 140, 255)):
    return Image.new("RGBA", (width, height), color)


class TransformEngineTests(unittest.TestCase):
    def test_identity_preserves_dimensions_and_pixels(self):
        source = solid()
        output, mask, geometry = transform_pil(source, TransformSpec())
        self.assertEqual(output.size, source.size)
        self.assertEqual(geometry.output_width, 12)
        self.assertEqual(np.asarray(mask).max(), 0)
        self.assertTrue(np.all(np.asarray(output) == np.array([30, 80, 140])))

    def test_source_alpha_is_part_of_mask(self):
        source = solid(5, 5)
        source.putpixel((2, 2), (255, 0, 0, 0))
        _, mask, _ = transform_pil(source, TransformSpec())
        self.assertEqual(mask.getpixel((2, 2)), 255)
        self.assertEqual(mask.getpixel((0, 0)), 0)

    def test_positive_and_negative_rotation_boundaries(self):
        for angle in (-90, 90, 179.9, -179.9):
            with self.subTest(angle=angle):
                output, mask, geometry = transform_pil(solid(11, 7), TransformSpec(rotation_degrees=angle))
                self.assertEqual(output.size, mask.size)
                self.assertGreaterEqual(geometry.rotated_width, 7)
                self.assertGreaterEqual(geometry.rotated_height, 7)
                if abs(angle) % 90 > 0.01:
                    self.assertGreater(np.asarray(mask).max(), 0)

    def test_crop_clamps_to_rotated_source(self):
        output, _, geometry = transform_pil(
            solid(20, 10), TransformSpec(crop_x=18, crop_y=9, crop_width=999, crop_height=999)
        )
        self.assertEqual(output.size, (2, 1))
        self.assertEqual((geometry.crop_x, geometry.crop_y), (18, 9))

    def test_ratio_is_enforced_in_backend(self):
        output, _, _ = transform_pil(
            solid(100, 100), TransformSpec(crop_aspect_ratio="16:9")
        )
        self.assertEqual(output.size, (100, 56))

    def test_every_padding_side_changes_output_and_mask(self):
        cases = {
            "pad_left": ((7, 4), (0, 1)),
            "pad_top": ((5, 6), (1, 0)),
            "pad_right": ((7, 4), (6, 1)),
            "pad_bottom": ((5, 6), (1, 5)),
        }
        for field, (expected_size, generated_pixel) in cases.items():
            with self.subTest(field=field):
                output, mask, _ = transform_pil(solid(5, 4), TransformSpec(**{field: 2}))
                self.assertEqual(output.size, expected_size)
                self.assertEqual(mask.getpixel(generated_pixel), 255)

    def test_fill_color_is_used_for_padding_and_rotation_voids(self):
        output, _, _ = transform_pil(
            solid(4, 3, (255, 0, 0, 255)),
            TransformSpec(rotation_degrees=45, pad_left=2, fill_color="#123456"),
        )
        self.assertEqual(output.getpixel((0, 0)), (0x12, 0x34, 0x56))

    def test_feather_keeps_generated_pixels_and_softens_boundary(self):
        _, mask, _ = transform_pil(solid(20, 20), TransformSpec(pad_left=10, feather=3))
        values = np.asarray(mask)
        self.assertEqual(values[:, :5].min(), 255)
        self.assertTrue(np.any((values[:, 10:15] > 0) & (values[:, 10:15] < 255)))

    def test_canvas_multiple_rounds_only_right_and_bottom(self):
        output, mask, geometry = transform_pil(
            solid(101, 99), TransformSpec(canvas_multiple=8)
        )
        self.assertEqual(output.size, (104, 104))
        self.assertEqual((geometry.pad_left, geometry.pad_top), (0, 0))
        self.assertEqual((geometry.pad_right, geometry.pad_bottom), (3, 5))
        self.assertEqual(mask.getpixel((103, 103)), 255)

    def test_tensor_batch_preserves_bhwc_and_bhw(self):
        source = torch.zeros((3, 9, 7, 3), dtype=torch.float32)
        output, mask, _ = transform_tensor_batch(source, TransformSpec(pad_bottom=1))
        self.assertEqual(tuple(output.shape), (3, 10, 7, 3))
        self.assertEqual(tuple(mask.shape), (3, 10, 7))
        self.assertEqual(output.dtype, source.dtype)

    def test_invalid_shape_and_oversized_padding_are_actionable(self):
        with self.assertRaisesRegex(ValueError, "expected BHWC"):
            transform_tensor_batch(torch.zeros((4, 4, 3)), TransformSpec())
        with self.assertRaisesRegex(ValueError, "pad_left"):
            transform_pil(solid(), TransformSpec(pad_left=40000))

    def test_fingerprint_changes_with_inputs_and_file_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "source.bin")
            path.write_bytes(b"one")
            first = stable_file_fingerprint(path, {"crop": 0})
            second = stable_file_fingerprint(path, {"crop": 1})
            self.assertNotEqual(first, second)
            time.sleep(0.01)
            path.write_bytes(b"two-two")
            os.utime(path, None)
            self.assertNotEqual(first, stable_file_fingerprint(path, {"crop": 0}))


class VideoDecodeTests(unittest.TestCase):
    def setUp(self):
        self._tempdir = tempfile.TemporaryDirectory()
        self.directory = Path(self._tempdir.name)

    def tearDown(self):
        # Persistent scrub sessions hold the file open (locked on Windows);
        # release them before the temporary directory is removed.
        from nodes import _media_helpers

        _media_helpers.close_scrub_sessions()
        self._tempdir.cleanup()

    def _write_video(self, path: Path, frames: int = 5, step: int = 45):
        container = av.open(str(path), mode="w")
        stream = container.add_stream("mpeg4", rate=5)
        stream.width = 16
        stream.height = 16
        stream.pix_fmt = "yuv420p"
        for index in range(frames):
            array = np.zeros((16, 16, 3), dtype=np.uint8)
            array[..., 0] = (index * step) % 256
            frame = av.VideoFrame.from_ndarray(array, format="rgb24")
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
        container.close()

    def test_first_middle_last_frame_decoding(self):
        path = Path(self.directory, "frames.mp4")
        self._write_video(path)
        metadata = video_metadata(path)
        self.assertEqual(metadata["width"], 16)
        self.assertGreaterEqual(metadata["frame_count"], 5)
        reds = []
        for index in (0, 2, 4):
            frame, actual_index, _ = decode_video_frame(path, "frame index", index, 0.0)
            self.assertEqual(actual_index, index)
            reds.append(float(np.asarray(frame)[..., 0].mean()))
        self.assertLess(reds[0], reds[1])
        self.assertLess(reds[1], reds[2])

    def test_keyframe_seek_agrees_with_sequential_scan(self):
        # 64 frames at GOP defaults spans several keyframes, so mid and late
        # targets exercise the container.seek fast path against ground truth.
        from nodes._media_helpers import _decode_sequential

        path = Path(self.directory, "long.mp4")
        self._write_video(path, frames=64, step=4)
        fps = float(video_metadata(path)["fps"] or 0.0)
        self.assertGreater(fps, 0)
        for target in (0, 7, 33, 63):
            with self.subTest(target=target):
                fast_frame, fast_index, fast_time = decode_video_frame(
                    path, "frame index", target, 0.0
                )
                slow_frame, slow_index, slow_time = _decode_sequential(path, target, fps)
                self.assertEqual(fast_index, slow_index)
                self.assertAlmostEqual(fast_time, slow_time, places=4)
                self.assertTrue(
                    np.array_equal(np.asarray(fast_frame), np.asarray(slow_frame))
                )

    def test_time_seek_mode_lands_on_matching_frame(self):
        path = Path(self.directory, "timed.mp4")
        self._write_video(path, frames=25, step=10)
        # 5 fps: 2.0 seconds is exactly frame 10.
        _, actual_index, actual_time = decode_video_frame(path, "time seconds", 0, 2.0)
        self.assertEqual(actual_index, 10)
        self.assertAlmostEqual(actual_time, 2.0, places=3)

    def test_out_of_range_index_clamps_to_last_frame(self):
        path = Path(self.directory, "short.mp4")
        self._write_video(path, frames=6, step=40)
        _, actual_index, _ = decode_video_frame(path, "frame index", 999999, 0.0)
        self.assertEqual(actual_index, 5)

    def test_session_forward_and_backward_decode_match_fresh_decode(self):
        from nodes import _media_helpers

        path = Path(self.directory, "session.mp4")
        self._write_video(path, frames=40, step=6)
        fps = float(video_metadata(path)["fps"] or 0.0)
        decode_video_frame(path, "frame index", 5, 0.0)
        # Forward within the gap uses the persistent session's decoder
        # state; backward forces a re-seek on the same open container.
        for target in (9, 2):
            with self.subTest(target=target):
                fast = decode_video_frame(path, "frame index", target, 0.0)
                fresh = _media_helpers._decode_sequential(path, target, fps)
                self.assertEqual(fast[1], fresh[1])
                self.assertTrue(np.array_equal(np.asarray(fast[0]), np.asarray(fresh[0])))

    def test_storyboard_builds_ready_payload(self):
        import base64
        from io import BytesIO

        from nodes import _media_helpers

        path = Path(self.directory, "board.mp4")
        self._write_video(path, frames=30, step=8)
        key = _media_helpers._file_key(path)
        # Seed "building" so storyboard_payload does not spawn its
        # background thread; the build below is fully deterministic.
        with _media_helpers._STORYBOARDS_LOCK:
            _media_helpers._STORYBOARDS[key] = {"status": "building"}
        self.assertEqual(_media_helpers.storyboard_payload(path)["status"], "building")
        _media_helpers._build_storyboard(path, key)
        ready = _media_helpers.storyboard_payload(path)
        self.assertEqual(ready["status"], "ready")
        self.assertGreaterEqual(ready["count"], 1)
        self.assertEqual(ready["times"], sorted(ready["times"]))
        sprite_bytes = base64.b64decode(ready["sprite"].split(",", 1)[1])
        with Image.open(BytesIO(sprite_bytes)) as sprite:
            self.assertEqual(
                sprite.size, (ready["tile_width"] * ready["count"], ready["tile_height"])
            )

    def test_metadata_cache_hits_and_invalidates_on_file_change(self):
        from nodes import _media_helpers

        path = Path(self.directory, "cached.mp4")
        self._write_video(path, frames=4)
        first = _media_helpers.cached_video_metadata(path)
        with unittest.mock.patch.object(
            _media_helpers, "video_metadata", side_effect=AssertionError("cache miss")
        ):
            # Same file state: served from cache, video_metadata untouched.
            self.assertEqual(_media_helpers.cached_video_metadata(path), first)
        self._write_video(path, frames=8)
        os.utime(path, None)
        refreshed = _media_helpers.cached_video_metadata(path)
        self.assertGreaterEqual(int(refreshed["frame_count"]), 8)


class LocalPreviewGateTests(unittest.TestCase):
    def test_disabled_by_default_outside_managed_folders(self):
        from nodes._media_helpers import local_preview_allowed

        with unittest.mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AUSBOSS_TRANSFORM_LOCAL_PREVIEW", None)
            self.assertFalse(local_preview_allowed(str(Path.home() / "video.mp4")))
            self.assertFalse(local_preview_allowed(""))

    def test_environment_flag_enables_previews(self):
        from nodes._media_helpers import local_preview_allowed

        with unittest.mock.patch.dict(
            os.environ, {"AUSBOSS_TRANSFORM_LOCAL_PREVIEW": "1"}
        ):
            self.assertTrue(local_preview_allowed(str(Path.home() / "video.mp4")))


if __name__ == "__main__":
    unittest.main()
