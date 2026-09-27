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
from nodes._color_helpers import rgb_to_lab
from nodes._inpaint_crop_helpers import apply_stitch, stitch_blend_from_mask

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


class FeatheredStitchTests(unittest.TestCase):
    """Feather shapes the mask; the canvas and the stitcher keep real pixels.

    The transform used to fade the picture into the fill colour across the
    feather ramp and hand that faded canvas to the stitcher, so color match
    measured drift against it and pulled the fill toward grey.
    """

    COLOUR = (46, 150, 72)
    LAYOUTS = {
        "straight pads": dict(pad_left=32, pad_top=24, pad_right=32, pad_bottom=24),
        "rotated": dict(rotation_degrees=17),
        "rotated and padded": dict(rotation_degrees=-9, pad_left=24, pad_right=40),
    }

    def load(self, source, **values):
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=[source]):
            return AusBossImageCropRotatePad().load_transform('source.png', **values)

    def test_color_match_keeps_the_fill_of_a_perfect_continuation(self):
        # A model that continues a flat green picture perfectly paints the
        # whole canvas that green; color match 1 must find no drift to fix.
        source = Image.new('RGB', (128, 96), self.COLOUR)
        colour = torch.tensor(self.COLOUR, dtype=torch.float32) / 255
        # Rotated AND padded is left out: the seam reading then counts the
        # rotation corners inside the crop as picture, feather or not.
        for name in ("straight pads", "rotated"):
            layout = self.LAYOUTS[name]
            with self.subTest(layout=name):
                image, mask, stitcher, *_ = self.load(source, feather=24, **layout)
                continuation = colour.expand_as(image).clone()
                stitched = apply_stitch(stitcher, continuation, color_match=1.0)
                fill = mask > 0.5
                error = (rgb_to_lab(stitched) - rgb_to_lab(continuation)).norm(dim=-1)
                self.assertTrue(fill.any())
                self.assertLess(float(error[fill].max()), 0.5)
                self.assertLess(float(error.max()), 1.0)

    def test_identity_round_trip_stays_exact(self):
        source = Image.fromarray(np.random.default_rng(3).integers(0, 256, (96, 128, 3), dtype=np.uint8))
        for name, layout in self.LAYOUTS.items():
            with self.subTest(layout=name):
                image, mask, stitcher, *_ = self.load(source, feather=24, **layout)
                hard, *_ = self.load(source, feather=0, **layout)
                # The feathered canvas is the unfeathered one, pixel for pixel.
                self.assertTrue(torch.equal(image, hard))
                self.assertTrue(torch.equal(apply_stitch(stitcher, image), image))

    def test_stitch_blend_and_grow_reach_the_stitcher(self):
        source = Image.new('RGB', (128, 96), self.COLOUR)
        _, mask, stitcher, *_ = self.load(source, pad_left=32, feather=8)
        self.assertTrue(torch.equal(stitcher['blend'], stitch_blend_from_mask(mask, 32, 0)))
        _, mask, stitcher, *_ = self.load(source, pad_left=32, feather=8, stitch_blend=6, stitch_grow=-3)
        self.assertTrue(torch.equal(stitcher['blend'], stitch_blend_from_mask(mask, 6, -3)))
        _, mask, stitcher, *_ = self.load(source, pad_left=32, feather=0, stitch_blend=0)
        self.assertTrue(torch.equal(stitcher['blend'], mask))


if __name__ == '__main__':
    unittest.main()
