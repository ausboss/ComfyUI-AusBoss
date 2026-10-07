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


class SeamColorMatchTests(unittest.TestCase):
    """color_match reads each padded seam off picture pixels only.

    A rotated crop keeps its void corners inside the source rectangle, and
    the seam reading used to count their fill as picture: a model that
    continued a flat green picture perfectly came back up to 33 dE off.
    """

    COLOUR = (46, 150, 72)
    LAYOUTS = {
        "rotated and padded": dict(rotation_degrees=-9, pad_left=24, pad_right=40),
        "rotated to a canvas multiple": dict(rotation_degrees=17, canvas_multiple=64),
        "rotated, cropped and padded": dict(
            rotation_degrees=-18.1, crop_x=10, crop_y=6, crop_width=120, crop_height=100,
            pad_left=40, pad_top=30, pad_right=40, pad_bottom=30,
        ),
    }

    def load(self, *frames, **values):
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=list(frames)):
            return AusBossImageCropRotatePad().load_transform('source.png', feather=0, **values)

    def fill_error(self, stitched, expected, mask):
        from nodes._color_helpers import rgb_to_lab

        error = (rgb_to_lab(stitched) - rgb_to_lab(expected)).norm(dim=-1)
        fill = mask > 0.5
        self.assertTrue(fill.any())
        return float(error[fill].max()), float(error.max())

    def test_a_perfect_continuation_keeps_its_fill(self):
        source = Image.new('RGB', (128, 96), self.COLOUR)
        colour = torch.tensor(self.COLOUR, dtype=torch.float32) / 255
        for name, layout in self.LAYOUTS.items():
            with self.subTest(layout=name):
                image, mask, stitcher, *_ = self.load(source, **layout)
                continuation = colour.expand_as(image).clone()
                stitched = apply_stitch(stitcher, continuation, color_match=1.0)
                fill_max, overall_max = self.fill_error(stitched, continuation, mask)
                self.assertLess(fill_max, 0.5)
                self.assertLess(overall_max, 1.0)
                self.assertIs(stitcher['generated'], mask)

    def test_a_drifted_fill_comes_back_to_the_picture(self):
        source = Image.new('RGB', (128, 96), self.COLOUR)
        colour = torch.tensor(self.COLOUR, dtype=torch.float32) / 255
        for name, layout in self.LAYOUTS.items():
            with self.subTest(layout=name):
                image, mask, stitcher, *_ = self.load(source, **layout)
                continuation = colour.expand_as(image).clone()
                # The sampler continued the green 0.06 brighter everywhere it
                # generated and mixed that into the band by the mask, as
                # samplers do.
                drifted = continuation + 0.06 * stitcher['blend'].unsqueeze(-1)
                self.assertGreater(self.fill_error(apply_stitch(stitcher, drifted), continuation, mask)[0], 5.0)
                stitched = apply_stitch(stitcher, drifted, color_match=1.0)
                self.assertLess(self.fill_error(stitched, continuation, mask)[0], 1.0)

    def test_the_source_stays_bit_identical_and_older_stitchers_still_stitch(self):
        source = Image.fromarray(np.random.default_rng(5).integers(0, 256, (192, 256, 3), dtype=np.uint8))
        image, mask, stitcher, *_ = self.load(source, **self.LAYOUTS["rotated and padded"])
        generated = torch.rand(image.shape, generator=torch.Generator().manual_seed(6))
        older = {key: value for key, value in stitcher.items() if key != 'generated'}
        kept = stitcher['blend'] == 0
        self.assertTrue(kept.any())
        for current in (stitcher, older):
            stitched = apply_stitch(current, generated, color_match=1.0)
            self.assertTrue(torch.equal(stitched[kept], image[kept]))

    def test_a_shorter_batch_trims_the_mask_with_the_blend(self):
        # A video model hands back fewer frames than the stitcher holds.
        source = Image.new('RGB', (128, 96), self.COLOUR)
        image, mask, stitcher, *_ = self.load(source, source, source, **self.LAYOUTS["rotated and padded"])
        self.assertEqual(stitcher['generated'].shape[0], 3)
        colour = torch.tensor(self.COLOUR, dtype=torch.float32) / 255
        continuation = colour.expand_as(image[:2]).clone()
        stitched = apply_stitch(stitcher, continuation, color_match=1.0)
        self.assertEqual(tuple(stitched.shape), tuple(continuation.shape))
        self.assertLess(self.fill_error(stitched, continuation, mask[:2])[0], 0.5)

    def test_load_image_pad_color_match_is_unchanged(self):
        # Pinned: the published Qwen 2.1 Outpaint workflow stitches Load
        # Image + Pad (feather 32) with color_match 1, and people who update
        # the pack must get the same picture. These are the padded bands'
        # mean colours from before the transform stitcher gained its mask.
        from nodes.node_load_image_pad import AusBossLoadImagePad

        y, x = np.mgrid[0:96, 0:128].astype(np.float32)
        pattern = np.stack([
            0.35 + 0.25 * np.sin(x / 9.0),
            0.45 + 0.2 * np.cos(y / 7.0),
            0.3 + 0.2 * np.sin((x + y) / 13.0),
        ], -1)
        source = Image.fromarray((pattern * 255).round().astype(np.uint8))
        with patch('nodes.node_load_image_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_load_image_pad.load_image_frames', return_value=[source]):
            image, _, _, _, stitcher, _ = AusBossLoadImagePad().load_pad('source.png', 24, 16, 40, 8, 'color', '#808080', 0.5, 32, 8, 0.0)
        self.assertNotIn('generated', stitcher)
        rows = torch.arange(image.shape[1], dtype=torch.float32).view(1, -1, 1, 1)
        drift = 0.06 + 0.04 * torch.sin(rows / 11.0)
        inpainted = (image + drift * stitcher['blend'].unsqueeze(-1)).clamp(0, 1)
        stitched = apply_stitch(stitcher, inpainted, color_match=1.0)
        self.assertEqual(stitcher['source_bbox'], (24, 16, 152, 112))
        bands = {
            'left': (stitched[:, :, :24], (0.504521, 0.488853, 0.362618)),
            'top': (stitched[:, :16], (0.453719, 0.476223, 0.33837)),
            'right': (stitched[:, :, 152:], (0.471721, 0.495965, 0.318072)),
            'bottom': (stitched[:, 112:], (0.435199, 0.536332, 0.34287)),
        }
        for side, (band, expected) in bands.items():
            with self.subTest(side=side):
                mean = band.double().mean(dim=(0, 1, 2))
                self.assertTrue(torch.allclose(mean, torch.tensor(expected, dtype=torch.float64), atol=2e-6), mean)


class TransformOutputTests(unittest.TestCase):
    def setUp(self):
        self.source = Image.fromarray(np.arange(96 * 128 * 3, dtype=np.uint8).reshape(96, 128, 3))

    def assert_outputs(self, outputs):
        image, mask, stitcher, original, width, height = outputs[:6]
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
        # prompt_image, appended last: the image itself for an opaque picture.
        self.assertEqual(len(outputs), 7)
        self.assertTrue(torch.equal(outputs[6], outputs[0]))
        self.assertIsNot(outputs[6], outputs[0])

    def test_video_frame_has_the_same_outputs(self):
        with patch('nodes.node_video_crop_rotate_pad.resolve_video_path', return_value=Path('source.mp4')), patch('nodes.node_video_crop_rotate_pad.decode_video_frame', return_value=(self.source, 0, 0)):
            outputs = AusBossVideoCropRotatePad().load_transform('source.mp4', 'input folder', '', 'frame index', 0, 0, pad_left=32, feather=0)
        self.assert_outputs(outputs)

    def test_resize_inputs_are_optional_for_old_api_prompts(self):
        inputs = AusBossImageCropRotatePad.INPUT_TYPES()
        resize = ["resize_to_megapixels", "megapixels", "resize_method", "resolution_steps"]
        # The resize inputs keep their widget positions; the stitch settings
        # follow, then painted_area, the newest.
        self.assertEqual(list(inputs["optional"]), resize + ["stitch_blend", "stitch_grow", "painted_area"])
        self.assertFalse(set(resize) & set(inputs["required"]))

    @unittest.skipUnless(COMFY_ROOT, "Set AUSBOSS_COMFY_ROOT for core resize integration")
    def test_stitcher_uses_resized_canvas_dimensions(self):
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=[self.source]):
            image, mask, stitcher, original, width, height, _ = AusBossImageCropRotatePad().load_transform('source.png', pad_left=32, feather=0, resize_to_megapixels=True, megapixels=.05, resolution_steps=16)
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
        # Rotated AND padded holds the rotation corners inside the crop; the
        # seam reading skips them (SeamColorMatchTests), feathered or not.
        for name, layout in self.LAYOUTS.items():
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
