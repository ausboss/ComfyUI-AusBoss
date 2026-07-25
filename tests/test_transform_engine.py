from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

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
    def _write_video(self, path: Path):
        container = av.open(str(path), mode="w")
        stream = container.add_stream("mpeg4", rate=5)
        stream.width = 16
        stream.height = 16
        stream.pix_fmt = "yuv420p"
        for index in range(5):
            array = np.zeros((16, 16, 3), dtype=np.uint8)
            array[..., 0] = index * 45
            frame = av.VideoFrame.from_ndarray(array, format="rgb24")
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
        container.close()

    def test_first_middle_last_frame_decoding(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "frames.mp4")
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


if __name__ == "__main__":
    unittest.main()
