from pathlib import Path
import sys
import os
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from nodes.node_image_crop_rotate_pad import AusBossImageCropRotatePad
from nodes.node_video_crop_rotate_pad import AusBossVideoCropRotatePad
from nodes._inpaint_crop_helpers import apply_stitch

COMFY_ROOT = os.environ.get('AUSBOSS_COMFY_ROOT')
if COMFY_ROOT:
    sys.path.append(COMFY_ROOT)


class TransformOutputTests(unittest.TestCase):
    def setUp(self):
        self.source = Image.fromarray(np.arange(96 * 128 * 3, dtype=np.uint8).reshape(96, 128, 3))

    def assert_outputs(self, outputs):
        image, mask, stitcher, original, width, height = outputs
        self.assertEqual((width, height), (160, 96))
        expected = torch.from_numpy(np.asarray(self.source).astype(np.float32) / 255)
        self.assertTrue(torch.equal(original[0], expected))
        self.assertEqual(tuple(image.shape[1:3]), (96, 160))
        self.assertEqual(tuple(mask.shape), (1, 96, 160))
        generated = torch.ones_like(image)
        stitched = apply_stitch(stitcher, generated)
        kept = stitcher["blend"] == 0
        self.assertTrue(kept.any())
        self.assertTrue(torch.equal(stitched[kept], image[kept]))
        self.assertTrue(torch.equal(stitched[:, :, -32:], image[:, :, -32:]))

    def test_image_outputs_append_stitcher_and_untouched_source(self):
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=[self.source]):
            outputs = AusBossImageCropRotatePad().load_transform('source.png', pad_left=32, feather=0)
        self.assert_outputs(outputs)

    def test_video_frame_has_the_same_outputs(self):
        with patch('nodes.node_video_crop_rotate_pad.resolve_video_path', return_value=Path('source.mp4')), patch('nodes.node_video_crop_rotate_pad.decode_video_frame', return_value=(self.source, 0, 0)):
            outputs = AusBossVideoCropRotatePad().load_transform('source.mp4', 'input folder', '', 'frame index', 0, 0, pad_left=32, feather=0)
        self.assert_outputs(outputs)

    @unittest.skipUnless(COMFY_ROOT, "Set AUSBOSS_COMFY_ROOT for core resize integration")
    def test_stitcher_uses_resized_canvas_dimensions(self):
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=[self.source]):
            image, mask, stitcher, original, width, height = AusBossImageCropRotatePad().load_transform('source.png', pad_left=32, feather=0, resize_to_megapixels=True, megapixels=.05, resolution_steps=16)
        self.assertEqual((width, height), (int(image.shape[2]), int(image.shape[1])))
        self.assertEqual(tuple(stitcher['canvas'].shape), tuple(image.shape))
        self.assertEqual(tuple(original.shape), (1, 96, 128, 3))
        self.assertEqual(tuple(apply_stitch(stitcher, image).shape), tuple(image.shape))

    @unittest.skipUnless(COMFY_ROOT, "Set AUSBOSS_COMFY_ROOT for core resize integration")
    def test_video_frame_resizes_to_a_budget_like_the_image_node(self):
        with patch('nodes.node_video_crop_rotate_pad.resolve_video_path', return_value=Path('source.mp4')), patch('nodes.node_video_crop_rotate_pad.decode_video_frame', return_value=(self.source, 0, 0)):
            image, mask, stitcher, original, width, height = AusBossVideoCropRotatePad().load_transform(
                'source.mp4', 'input folder', '', 'frame index', 0, 0,
                resize_to_megapixels=True, megapixels=.05, resolution_steps=16, pad_left=32, feather=0,
            )
        self.assertEqual((width, height), (int(image.shape[2]), int(image.shape[1])))
        # 0.05 MP x 1024 x 1024 is larger than the 160 x 96 canvas: the
        # budget scales the frame to it either way, aspect kept, to steps of 16.
        budget = 0.05 * 1024 * 1024
        self.assertLess(abs(width * height - budget) / budget, 0.1)
        self.assertEqual((width % 16, height % 16), (0, 0))
        self.assertEqual(tuple(stitcher['canvas'].shape), tuple(image.shape))
        self.assertEqual(tuple(original.shape), (1, 96, 128, 3))


if __name__ == '__main__':
    unittest.main()
