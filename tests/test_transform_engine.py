from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import time
import types
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
from nodes._pad_helpers import resolve_pad_geometry
from nodes._transform_engine import (
    _geometry,
    _ratio_box,
    scale_to_megapixels,
    TransformSpec,
    stable_file_fingerprint,
    transform_pil,
    transform_tensor_batch,
)

# (width, height, ratio_width, ratio_height) -> box. The same table sits in
# tests/transform_geometry.test.mjs: the editor's readout must match the run.
RATIO_BOX_FIXTURES = [
    ((3813, 1961, 21, 9), (3813, 1634)),
    ((1000, 562, 16, 9), (1000, 562)),
    ((1000, 1000, 16, 9), (1000, 562)),
    ((1000, 500, 16, 9), (888, 500)),
    ((888, 500, 16, 9), (888, 500)),
    ((1920, 1080, 16, 9), (1920, 1080)),
    ((832, 1216, 1, 1), (832, 832)),
    ((239, 1284, 936, 1284), (239, 327)),
]


# (crop_width, crop_height, pad_left, pad_top, pad_right, pad_bottom, multiple)
# -> (pad_left, pad_top, pad_right, pad_bottom, trim_left, trim_top, width, height).
# The same table sits in tests/transform_geometry.test.mjs: the editor draws
# and reports the canvas the run builds.
CANVAS_FIXTURES = [
    # The report: 1 px left over, and the right edge has no padding.
    ((1916, 821, 3, 246, 0, 336, 24), (4, 246, 0, 349, 0, 0, 1920, 1416)),
    # Nothing padded: each axis is trimmed evenly to the multiple below.
    ((101, 99, 0, 0, 0, 0, 8), (0, 0, 0, 0, 2, 1, 96, 96)),
    ((1824, 2304, 0, 0, 0, 0, 64), (0, 0, 0, 0, 16, 0, 1792, 2304)),
    # Both sides padded: the far one takes the leftover.
    ((2080, 1170, 64, 64, 64, 64, 64), (64, 64, 96, 110, 0, 0, 2240, 1344)),
    # One side padded: it takes the leftover, whichever side it is.
    ((1000, 750, 0, 0, 37, 0, 16), (0, 0, 40, 0, 0, 7, 1040, 736)),
    ((1000, 750, 0, 20, 0, 0, 16), (0, 34, 0, 0, 4, 0, 992, 784)),
    # A picture smaller than one multiple has nothing to trim to.
    ((5, 5, 0, 0, 0, 0, 8), (0, 0, 3, 3, 0, 0, 8, 8)),
    # Already a multiple, or the multiple off: nothing moves.
    ((1024, 768, 0, 0, 0, 0, 64), (0, 0, 0, 0, 0, 0, 1024, 768)),
    ((1001, 333, 7, 0, 0, 5, 1), (7, 0, 0, 5, 0, 0, 1008, 338)),
]


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
        # No seam: the ramp is still near full strength on the first kept
        # column (the old max-with-blur approach dropped to ~127 here).
        self.assertGreaterEqual(int(values[10, 10]), 200)
        # And it decays moving further into kept content.
        self.assertLess(int(values[10, 16]), int(values[10, 11]))

    def test_feather_shapes_only_the_mask(self):
        # The picture meets the fill with the same hard edge at any feather:
        # outpaint models read a faded ramp as content, not as fill.
        source = solid(20, 20, (255, 255, 255, 255))
        for layout in ({"pad_left": 10}, {"rotation_degrees": 17, "pad_right": 6}):
            with self.subTest(layout=layout):
                spec = dict(fill_color="#000000", **layout)
                hard, hard_mask, _ = transform_pil(source, TransformSpec(**spec))
                soft, soft_mask, _ = transform_pil(source, TransformSpec(feather=3, **spec))
                self.assertTrue(np.array_equal(np.asarray(soft), np.asarray(hard)))
                self.assertFalse(np.array_equal(np.asarray(soft_mask), np.asarray(hard_mask)))
        output, _, _ = transform_pil(source, TransformSpec(pad_left=10, feather=3, fill_color="#000000"))
        row = np.asarray(output)[10]
        self.assertEqual(int(row[9].max()), 0)  # padding is the fill color
        self.assertEqual(int(row[10].min()), 255)  # first kept column untouched

    def test_aspect_crop_uses_integer_maths(self):
        for args, expected in RATIO_BOX_FIXTURES:
            with self.subTest(args):
                self.assertEqual(_ratio_box(*args), expected)
        _, _, geometry = transform_pil(solid(3813, 1961), TransformSpec(crop_aspect_ratio="21:9"))
        self.assertEqual((geometry.crop_width, geometry.crop_height), (3813, 1634))

    def test_a_resolved_aspect_crop_resolves_to_itself(self):
        rng = np.random.default_rng(3)
        for _ in range(4000):
            width, height = (int(v) for v in rng.integers(1, 5000, 2))
            ratio = tuple(int(v) for v in rng.integers(1, 40, 2))
            box = _ratio_box(width, height, *ratio)
            self.assertLessEqual(box[0], width)
            self.assertLessEqual(box[1], height)
            self.assertEqual(_ratio_box(*box, *ratio), box)

    def canvas(self, width, height, left, top, right, bottom, multiple):
        return transform_pil(
            solid(width, height),
            TransformSpec(pad_left=left, pad_top=top, pad_right=right, pad_bottom=bottom, canvas_multiple=multiple),
        )

    def test_canvas_multiple_follows_the_shared_fixtures(self):
        for args, expected in CANVAS_FIXTURES:
            with self.subTest(args):
                output, _, geometry = self.canvas(*args)
                self.assertEqual(
                    (
                        geometry.pad_left, geometry.pad_top, geometry.pad_right, geometry.pad_bottom,
                        geometry.crop_x, geometry.crop_y, geometry.output_width, geometry.output_height,
                    ),
                    expected,
                )
                self.assertEqual(output.size, expected[6:])

    def test_canvas_multiple_never_grows_a_strip_on_an_unpadded_edge(self):
        # The leftover from rounding went to the right and bottom whatever was
        # padded: 1916 + 3 rounded to 1920 put 1 px of fill on a right edge
        # nobody padded, and a resize smeared it into the picture's last column.
        pads = [
            (0, 0, 0, 0), (3, 0, 0, 0), (0, 0, 5, 0), (0, 7, 0, 0), (0, 0, 0, 9),
            (3, 246, 0, 336), (10, 0, 20, 0), (0, 30, 0, 40), (4, 0, 0, 6), (1, 2, 3, 4),
        ]
        picture = np.array([30, 80, 140])
        for width, height in [(1916, 821), (101, 99), (333, 517)]:
            for multiple in (2, 8, 16, 24, 32, 64):
                for left, top, right, bottom in pads:
                    with self.subTest(size=(width, height), multiple=multiple, pads=(left, top, right, bottom)):
                        output, mask, geometry = self.canvas(width, height, left, top, right, bottom, multiple)
                        image = np.asarray(output)
                        painted = np.asarray(mask)
                        self.assertEqual((output.width % multiple, output.height % multiple), (0, 0))
                        rows = slice(geometry.pad_top, geometry.pad_top + geometry.crop_height)
                        cols = slice(geometry.pad_left, geometry.pad_left + geometry.crop_width)
                        edges = {
                            "left": (left, geometry.pad_left, image[rows, 0], painted[rows, 0]),
                            "right": (right, geometry.pad_right, image[rows, -1], painted[rows, -1]),
                            "top": (top, geometry.pad_top, image[0, cols], painted[0, cols]),
                            "bottom": (bottom, geometry.pad_bottom, image[-1, cols], painted[-1, cols]),
                        }
                        for side, (asked, resolved, pixels, mask_line) in edges.items():
                            if asked:
                                self.assertGreaterEqual(resolved, asked, side)
                                continue
                            self.assertEqual(resolved, 0, side)
                            self.assertTrue(np.all(pixels == picture), side)
                            self.assertEqual(int(mask_line.max()), 0, side)

    def test_canvas_multiple_is_load_image_pads_rule(self):
        rng = np.random.default_rng(11)
        for _ in range(3000):
            width, height = (int(v) for v in rng.integers(1, 3000, 2))
            left, top, right, bottom = (int(v) * int(rng.integers(0, 2)) for v in rng.integers(0, 400, 4))
            multiple = int(rng.choice([1, 2, 8, 16, 24, 32, 64, 100]))
            spec = TransformSpec(pad_left=left, pad_top=top, pad_right=right, pad_bottom=bottom, canvas_multiple=multiple)
            geometry = _geometry(types.SimpleNamespace(size=(width, height)), spec)
            plan = resolve_pad_geometry(width, height, left, top, right, bottom, multiple)
            self.assertEqual(
                (
                    geometry.pad_left, geometry.pad_top, geometry.pad_right, geometry.pad_bottom,
                    geometry.crop_x, geometry.crop_y, geometry.crop_width, geometry.crop_height,
                    geometry.output_width, geometry.output_height,
                ),
                (
                    plan["left"], plan["top"], plan["right"], plan["bottom"],
                    plan["trim_left"], plan["trim_top"],
                    width - plan["trim_left"] - plan["trim_right"], height - plan["trim_top"] - plan["trim_bottom"],
                    plan["width"], plan["height"],
                ),
            )

    def test_canvas_multiple_trims_the_crop_it_was_given(self):
        # A crop inside the picture is trimmed around its own centre, and the
        # kept pixels are the source's own.
        source = Image.fromarray(np.random.default_rng(5).integers(0, 255, (60, 90, 3), dtype=np.uint8))
        output, mask, geometry = transform_pil(
            source, TransformSpec(crop_x=10, crop_y=4, crop_width=53, crop_height=41, canvas_multiple=16)
        )
        self.assertEqual((geometry.crop_x, geometry.crop_y, geometry.crop_width, geometry.crop_height), (12, 8, 48, 32))
        self.assertTrue(np.array_equal(np.asarray(output), np.asarray(source)[8:40, 12:60]))
        self.assertEqual(int(np.asarray(mask).max()), 0)

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

    def test_repeating_a_frame_request_returns_that_frame(self):
        # A scrub that settles on the frame it already showed asks for the
        # same index twice. The session used to decode "forward" to it and
        # hand back the frame after - the picture jumped one frame on every
        # release.
        path = Path(self.directory, "repeat.mp4")
        self._write_video(path, frames=40, step=6)
        first = decode_video_frame(path, "frame index", 12, 0.0)
        again = decode_video_frame(path, "frame index", 12, 0.0)
        self.assertEqual((first[1], again[1]), (12, 12))
        self.assertTrue(np.array_equal(np.asarray(first[0]), np.asarray(again[0])))
        following = decode_video_frame(path, "frame index", 13, 0.0)
        self.assertEqual(following[1], 13)
        self.assertFalse(np.array_equal(np.asarray(first[0]), np.asarray(following[0])))

    def test_preview_cache_serves_a_revisited_frame_without_decoding(self):
        from nodes import _media_helpers

        path = Path(self.directory, "revisit.mp4")
        self._write_video(path, frames=20, step=12)
        _media_helpers.clear_preview_cache()
        body, index, moment = _media_helpers.cached_preview(path, "frame index", 7, 0.0, 640, 640)
        self.assertEqual(index, 7)
        self.assertGreater(len(body), 0)
        with unittest.mock.patch.object(
            _media_helpers, "decode_video_frame", side_effect=AssertionError("decoded again")
        ):
            hit = _media_helpers.cached_preview(path, "frame index", 7, 0.0, 640, 640)
            # Time mode naming the same frame is the same cache entry.
            fps = float(video_metadata(path)["fps"])
            by_time = _media_helpers.cached_preview(path, "time seconds", 0, 7 / fps, 640, 640)
        self.assertEqual(hit, (body, index, moment))
        self.assertEqual(by_time, (body, index, moment))
        # Another size is another entry, decoded on its own.
        with _media_helpers._PREVIEW_CACHE_LOCK:
            entries = len(_media_helpers._PREVIEW_CACHE)
        _media_helpers.cached_preview(path, "frame index", 7, 0.0, 320, 320)
        with _media_helpers._PREVIEW_CACHE_LOCK:
            self.assertEqual(len(_media_helpers._PREVIEW_CACHE), entries + 1)
        _media_helpers.clear_preview_cache()

    def test_preview_cache_forgets_a_rewritten_file(self):
        from nodes import _media_helpers

        path = Path(self.directory, "rewrite.mp4")
        self._write_video(path, frames=10, step=20)
        _media_helpers.clear_preview_cache()
        before = _media_helpers.cached_preview(path, "frame index", 3, 0.0, 640, 640)
        _media_helpers.close_scrub_sessions()
        self._write_video(path, frames=10, step=1)
        os.utime(path, (time.time() + 5, time.time() + 5))
        after = _media_helpers.cached_preview(path, "frame index", 3, 0.0, 640, 640)
        self.assertNotEqual(before[0], after[0])
        _media_helpers.clear_preview_cache()

    def test_storyboard_tiles_spread_over_the_clip(self):
        from nodes import _media_helpers

        path = Path(self.directory, "spread.mp4")
        # 40 frames at 5 fps: 8 s, so 16 tiles half a second apart.
        self._write_video(path, frames=40, step=6)
        key = _media_helpers._file_key(path)
        with _media_helpers._STORYBOARDS_LOCK:
            _media_helpers._STORYBOARDS[key] = {"status": "building"}
        _media_helpers._build_storyboard(path, key)
        ready = _media_helpers.storyboard_payload(path)
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["count"], 16)
        for step, moment in enumerate(ready["times"]):
            self.assertAlmostEqual(moment, step * 0.5, delta=0.11)

    def test_storyboard_seek_path_reaches_its_targets(self):
        from nodes import _media_helpers

        path = Path(self.directory, "seekboard.mp4")
        self._write_video(path, frames=40, step=6)
        key = _media_helpers._file_key(path)
        with _media_helpers._STORYBOARDS_LOCK:
            _media_helpers._STORYBOARDS[key] = {"status": "building"}
        # Force the long-clip path: keyframe seek plus a capped forward decode.
        with unittest.mock.patch.object(_media_helpers, "_STORYBOARD_SEQUENTIAL_FRAMES", 0):
            _media_helpers._build_storyboard(path, key)
        ready = _media_helpers.storyboard_payload(path)
        self.assertEqual(ready["status"], "ready")
        self.assertGreaterEqual(ready["count"], 12)
        self.assertGreater(ready["times"][-1], 6.0)
        self.assertEqual(ready["times"], sorted(ready["times"]))

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


class ServerFileGateTests(unittest.TestCase):
    def test_nothing_outside_comfyuis_folders_is_readable(self):
        from nodes._media_helpers import resolve_server_file

        for name in (
            str(Path.home() / "video.mp4"),
            r"\\host\share\video.mp4",
            "//host/share/video.mp4",
            "~/video.mp4",
            "output/../video.mp4",
        ):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "whole path is not read"):
                resolve_server_file(name)
        with self.assertRaisesRegex(ValueError, "needs a video"):
            resolve_server_file("")

    def test_comfyuis_folders_are_read_by_folder_and_name(self):
        from nodes import _media_helpers

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            clip = root / "sub" / "clip.mp4"
            clip.parent.mkdir()
            clip.write_bytes(b"")
            with unittest.mock.patch.object(_media_helpers, "_server_folders", lambda: {"output": root}):
                self.assertEqual(_media_helpers.resolve_server_file("output/sub/clip.mp4"), clip)
                # The same file by its whole path, and a folder that is not ComfyUI's.
                for name in (str(clip), "temp/sub/clip.mp4"):
                    with self.subTest(name=name), self.assertRaisesRegex(ValueError, "whole path is not read"):
                        _media_helpers.resolve_server_file(name)

    def test_the_retired_environment_switch_opens_nothing(self):
        from nodes._media_helpers import resolve_server_file

        with tempfile.TemporaryDirectory() as folder, unittest.mock.patch.dict(
            os.environ, {"AUSBOSS_TRANSFORM_LOCAL_PREVIEW": "1"}
        ):
            with self.assertRaisesRegex(ValueError, "whole path is not read"):
                resolve_server_file(str(Path(folder) / "video.mp4"))

    def test_queued_runs_and_previews_explain_the_rule(self):
        from nodes import _media_helpers

        with tempfile.TemporaryDirectory() as folder:
            clip = Path(folder) / "clip.mp4"
            clip.write_bytes(b"")
            with self.assertRaises(ValueError) as caught:
                _media_helpers.resolve_video_path("local path", "", str(clip))
            self.assertIn("input, output or temp", str(caught.exception))
            # The preview routes pass it through: it names no server path.
            self.assertEqual(_media_helpers._safe_route_error(caught.exception), str(caught.exception))



class TestScaleToMegapixels(unittest.TestCase):
    def test_square_megapixel_is_1024(self):
        self.assertEqual(scale_to_megapixels(1024, 1024, 1.0, 1), (1024, 1024))
        self.assertEqual(scale_to_megapixels(512, 512, 4.0, 1), (2048, 2048))

    def test_hd_at_one_megapixel_on_64_grid(self):
        # The everyday case: 1920x1080 to ~1MP on a VAE-friendly grid.
        self.assertEqual(scale_to_megapixels(1920, 1080, 1.0, 64), (1344, 768))

    def test_steps_round_each_dimension_independently(self):
        self.assertEqual(scale_to_megapixels(1000, 707, 1.0, 8), (1216, 864))

    def test_never_below_one_step(self):
        width, height = scale_to_megapixels(100, 100, 0.01, 64)
        self.assertEqual((width, height), (128, 128))


if __name__ == "__main__":
    unittest.main()
