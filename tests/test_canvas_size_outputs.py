"""A result can come back at the picture's own size.

Image Crop + Rotate + Pad rounds a megapixel resize to resolution_steps, so a
1920x1080 picture reaches Qwen as 1920x1088 and the result is 1920x1088. The
node's canvas_width and canvas_height outputs hold the size before that
rounding; wired to Image Resize (width+height, stretch) they put the result
back at exactly that size.
"""

from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch

from PIL import Image
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if os.environ.get("AUSBOSS_COMFY_ROOT"):
    sys.path.append(os.environ["AUSBOSS_COMFY_ROOT"])
from nodes.node_image_crop_rotate_pad import AusBossImageCropRotatePad
from nodes.node_image_resize import AusBossImageResize

SIZES = [(1920, 1080), (1080, 1920), (1000, 563), (1366, 768), (1281, 721), (2048, 1152)]


def load(width, height, **values):
    frame = Image.new("RGB", (width, height), (90, 120, 150))
    with patch("nodes.node_image_crop_rotate_pad.resolve_input_path", return_value=Path("s.png")), patch(
        "nodes.node_image_crop_rotate_pad.load_image_frames", return_value=[frame]
    ):
        return AusBossImageCropRotatePad().load_transform(
            "s.png", resize_to_megapixels=True, megapixels=2.0, resolution_steps=32, **values
        )


@unittest.skipUnless(os.environ.get("AUSBOSS_COMFY_ROOT"), "Set AUSBOSS_COMFY_ROOT for core resize integration")
class CanvasSizeTests(unittest.TestCase):
    def test_the_report_1920x1080_is_rounded_to_1088_by_the_budget(self):
        out = load(1920, 1080)
        self.assertEqual((out[4], out[5]), (1920, 1088))

    def test_canvas_outputs_are_the_size_before_the_budget(self):
        for width, height in SIZES:
            with self.subTest(size=(width, height)):
                out = load(width, height)
                self.assertEqual((out[7], out[8]), (width, height))

    def test_canvas_outputs_follow_a_crop_and_padding(self):
        out = load(400, 300, crop_x=10, crop_y=10, crop_width=200, crop_height=101, pad_left=5, pad_right=6)
        self.assertEqual((out[7], out[8]), (211, 101))

    def test_a_result_comes_back_at_the_exact_size(self):
        for width, height in SIZES:
            with self.subTest(size=(width, height)):
                out = load(width, height)
                result = out[0]  # stands in for the model's picture at the same size
                back = AusBossImageResize().resize(
                    result, "width+height", out[7], out[8], 1024, 1.0, 1.0, "stretch", "#000000", 1, "lanczos"
                )[0]
                self.assertEqual(tuple(back.shape[1:3]), (height, width))


if __name__ == "__main__":
    unittest.main()
