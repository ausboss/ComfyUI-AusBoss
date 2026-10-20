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
from nodes._inpaint_crop_helpers import apply_stitch, stitch_blend_from_mask, transform_picture_box

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


class UnpaddedEdgeTests(unittest.TestCase):
    """An edge nobody padded stays picture through Divisible by and the resize.

    The run that showed it: a 1916 x 821 picture, 3 px of padding on the
    left, bands top and bottom, Divisible by 24, resized to 1 MP. 1916 + 3
    rounded up to 1920 and the 1 px left over went to the right edge, which
    had no padding. The resize smeared that strip of fill into the picture's
    last column, and the stitched result kept it as a light line.
    """

    DARK = 6
    RUN = dict(
        pad_left=3, pad_top=246, pad_right=0, pad_bottom=336, feather=0, canvas_multiple=24,
        fill_color="#808080", resize_to_megapixels=True, megapixels=1.0, resize_method="lanczos",
        resolution_steps=32,
    )

    def source(self):
        return Image.new('RGB', (1916, 821), (self.DARK,) * 3)

    def assert_right_edge_is_picture(self, image, mask, stitcher):
        self.assertEqual(tuple(image.shape[1:3]), (864, 1184))
        _, y0, x1, y1 = stitcher['source_bbox']
        self.assertEqual(x1, 1184)
        rows = slice(y0 + 4, y1 - 4)
        levels = image[0, rows, -4:, :].mean(dim=(0, 2)) * 255
        # The last column of the kept rows is the picture, like the three before it.
        self.assertLess(abs(float(levels[-1] - levels[:3].mean())), 1.0, levels)
        self.assertEqual(float(mask[0, rows, -1].max()), 0.0)
        # A model that hands the canvas back as it got it leaves no line either.
        stitched = apply_stitch(stitcher, image)
        self.assertLess(float((stitched[0, rows, -4:] - self.DARK / 255).abs().max()) * 255, 1.0)

    @unittest.skipUnless(COMFY_ROOT, "Set AUSBOSS_COMFY_ROOT for core resize integration")
    def test_the_image_node_leaves_no_line_on_the_unpadded_edge(self):
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=[self.source()]):
            image, mask, stitcher, *_ = AusBossImageCropRotatePad().load_transform('source.png', **self.RUN)
        self.assert_right_edge_is_picture(image, mask, stitcher)

    @unittest.skipUnless(COMFY_ROOT, "Set AUSBOSS_COMFY_ROOT for core resize integration")
    def test_the_video_frame_node_leaves_no_line_on_the_unpadded_edge(self):
        with patch('nodes.node_video_crop_rotate_pad.resolve_video_path', return_value=Path('source.mp4')), patch('nodes.node_video_crop_rotate_pad.decode_video_frame', return_value=(self.source(), 0, 0)):
            image, mask, stitcher, *_ = AusBossVideoCropRotatePad().load_transform(
                'source.mp4', 'input folder', '', 'frame index', 0, 0, **self.RUN
            )
        self.assert_right_edge_is_picture(image, mask, stitcher)

    def test_without_a_resize_the_unpadded_edge_has_no_fill(self):
        run = {**self.RUN, "resize_to_megapixels": False}
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=[self.source()]):
            image, mask, stitcher, *_ = AusBossImageCropRotatePad().load_transform('source.png', **run)
        self.assertEqual(tuple(image.shape[1:3]), (1416, 1920))
        self.assertEqual(stitcher['source_bbox'], (4, 246, 1920, 1067))
        self.assertTrue(torch.all(image[0, 246:1067, 4:] == self.DARK / 255))
        self.assertEqual(float(mask[0, 246:1067, 4:].max()), 0.0)


class PictureBoxTests(unittest.TestCase):
    """Where the kept picture sits on a resized canvas: the box the resize
    pastes into and the stitcher carries."""

    class Geometry:
        def __init__(self, left, top, width, height, right, bottom):
            self.pad_left, self.pad_top, self.crop_width, self.crop_height = left, top, width, height
            self.output_width, self.output_height = left + width + right, top + height + bottom

    def test_the_box_is_the_crop_scaled_with_the_canvas(self):
        geometry = self.Geometry(4, 246, 1916, 821, 0, 349)
        self.assertEqual(transform_picture_box(geometry, 1920, 1416), (4, 246, 1920, 1067))
        self.assertEqual(transform_picture_box(geometry, 1184, 864), (2, 150, 1184, 651))

    def test_the_box_is_never_empty_and_never_leaves_the_canvas(self):
        rng = np.random.default_rng(4)
        for _ in range(4000):
            left, top, right, bottom = (int(v) for v in rng.integers(0, 3000, 4))
            width, height = (int(v) for v in rng.integers(1, 2000, 2))
            canvas = tuple(int(v) for v in rng.integers(1, 1500, 2))
            x0, y0, x1, y1 = transform_picture_box(self.Geometry(left, top, width, height, right, bottom), *canvas)
            self.assertTrue(0 <= x0 < x1 <= canvas[0], (x0, x1, canvas))
            self.assertTrue(0 <= y0 < y1 <= canvas[1], (y0, y1, canvas))


@unittest.skipUnless(COMFY_ROOT, "Set AUSBOSS_COMFY_ROOT for core resize integration")
class ResizeThenPadTests(unittest.TestCase):
    """With Resize on, the picture is resized by itself and padded after.

    The padded canvas used to be resized as one picture. Along every seam
    that left a column part fill, with a part mask: at stitch blend 0 the
    paste kept it as a line, and a band under a pixel wide came out as
    nothing but that column.
    """

    DARK = 6
    METHODS = ("lanczos", "bilinear", "area", "bicubic", "nearest-exact")

    def load(self, source, **values):
        run = dict(feather=0, fill_color="#808080", resize_to_megapixels=True, megapixels=1.0, resolution_steps=32)
        run.update(values)
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=[source]):
            return AusBossImageCropRotatePad().load_transform('source.png', **run)

    def flat(self, width=1916, height=821):
        return Image.new('RGB', (width, height), (self.DARK,) * 3)

    def assert_clean_seams(self, image, mask, stitcher):
        x0, y0, x1, y1 = stitcher['source_bbox']
        dark, grey = self.DARK / 255, 128 / 255
        inside = torch.zeros(mask.shape[1:], dtype=torch.bool)
        inside[y0:y1, x0:x1] = True
        # The box is the picture and nothing else; around it is fill to paint.
        self.assertLess(float((image[0][inside] - dark).abs().max()) * 255, 0.5)
        self.assertLess(float((image[0][~inside] - grey).abs().max()) * 255, 0.5)
        self.assertTrue(torch.equal(mask[0], (~inside).float()))

    def test_every_seam_is_a_clean_step(self):
        for method in self.METHODS:
            for left in (1, 2, 3, 8, 64):
                with self.subTest(method=method, pad_left=left):
                    image, mask, stitcher, *_ = self.load(
                        self.flat(), pad_left=left, pad_top=246, pad_bottom=336, resize_method=method, stitch_blend=0
                    )
                    self.assert_clean_seams(image, mask, stitcher)
                    # A hard paste of a perfect continuation leaves no line.
                    stitched = apply_stitch(stitcher, torch.full_like(image, self.DARK / 255))
                    self.assertLess(float((stitched - self.DARK / 255).abs().max()) * 255, 0.5)

    def test_a_band_under_half_a_pixel_is_left_out(self):
        # 1 px at a 0.31 scale: no band, and the picture reaches the edge.
        image, mask, stitcher, *_ = self.load(self.flat(), pad_left=1, megapixels=0.15, resolution_steps=8)
        self.assertEqual(stitcher['source_bbox'][0], 0)
        self.assertEqual(float(mask.max()), 0.0)
        self.assertLess(float((image - self.DARK / 255).abs().max()) * 255, 0.5)

    def test_the_picture_is_resized_alone_into_the_stitchers_box(self):
        import comfy.utils

        pixels = np.random.default_rng(8).integers(0, 256, (300, 420, 3), dtype=np.uint8)
        for method in self.METHODS:
            with self.subTest(method=method):
                image, _, stitcher, *_ = self.load(
                    Image.fromarray(pixels), pad_left=37, pad_bottom=90, megapixels=0.2, resolution_steps=16,
                    resize_method=method,
                )
                x0, y0, x1, y1 = stitcher['source_bbox']
                source = torch.from_numpy(pixels.astype(np.float32) / 255)[None].movedim(-1, 1)
                alone = comfy.utils.common_upscale(source, x1 - x0, y1 - y0, method, "disabled").movedim(1, -1).clamp(0, 1)
                self.assertTrue(torch.equal(image[:, y0:y1, x0:x1], alone))

    def test_without_padding_the_whole_canvas_resizes_as_it_always_did(self):
        import comfy.utils

        pixels = np.random.default_rng(9).integers(0, 256, (300, 420, 3), dtype=np.uint8)
        image, mask, *_ = self.load(Image.fromarray(pixels), megapixels=0.2, resolution_steps=16)
        source = torch.from_numpy(pixels.astype(np.float32) / 255)[None].movedim(-1, 1)
        whole = comfy.utils.common_upscale(source, image.shape[2], image.shape[1], "lanczos", "disabled").movedim(1, -1).clamp(0, 1)
        self.assertTrue(torch.equal(image, whole))
        self.assertEqual(float(mask.max()), 0.0)

    def test_the_feather_is_resized_with_the_picture(self):
        # 48 px of feather at a 0.62 scale: the ramp reaches about 30 px in,
        # and still starts on the first row of the picture.
        image, mask, stitcher, *_ = self.load(self.flat(), pad_top=246, feather=48)
        _, y0, _, y1 = stitcher['source_bbox']
        column = mask[0, :, mask.shape[2] // 2]
        self.assertTrue(torch.all(column[:y0] == 1.0))
        self.assertTrue(torch.all(column[y0:-1] >= column[y0 + 1:]))
        self.assertGreater(float(column[y0 + 8]), 0.2)
        self.assertEqual(float(column[y0 + 120]), 0.0)
        # The feather shapes only the mask: the picture's edge is still picture.
        self.assertLess(float((image[0, y0:y1] - self.DARK / 255).abs().max()) * 255, 0.5)

    def test_a_turned_picture_keeps_its_own_corners_in_the_mask(self):
        image, mask, stitcher, *_ = self.load(self.flat(640, 360), rotation_degrees=17, pad_left=50, megapixels=0.3)
        x0, y0, x1, y1 = stitcher['source_bbox']
        self.assertGreater(x0, 0)
        self.assertTrue(torch.all(mask[0, :, :x0] == 1.0))
        self.assertTrue(torch.all(image[0, :, :x0] == 128 / 255))
        box = mask[0, y0:y1, x0:x1]
        self.assertTrue(0.0 <= float(box.min()) and float(box.max()) <= 1.0)
        # Corners to paint, the picture kept, and soft edges between them.
        self.assertEqual(float(box[0, 0]), 1.0)
        self.assertEqual(float(box[box.shape[0] // 2, box.shape[1] // 2]), 0.0)

    def test_the_video_frame_node_resizes_the_same_way(self):
        with patch('nodes.node_video_crop_rotate_pad.resolve_video_path', return_value=Path('source.mp4')), patch('nodes.node_video_crop_rotate_pad.decode_video_frame', return_value=(self.flat(), 0, 0)):
            image, mask, stitcher, *_ = AusBossVideoCropRotatePad().load_transform(
                'source.mp4', 'input folder', '', 'frame index', 0, 0,
                pad_left=2, pad_top=246, feather=0, fill_color="#808080",
                resize_to_megapixels=True, megapixels=1.0, resolution_steps=32,
            )
        self.assert_clean_seams(image, mask, stitcher)


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


class WiredSourceTests(unittest.TestCase):
    """Pictures wired into source_image take the file's place, in bulk."""

    LAYOUT = dict(
        rotation_degrees=-9.5, crop_x=6, crop_y=4, crop_width=100, crop_height=70,
        pad_left=24, pad_top=8, pad_right=40, pad_bottom=0, canvas_multiple=8, feather=6,
    )

    @staticmethod
    def picture(width=128, height=96, seed=5, alpha=False):
        rng = np.random.default_rng(seed)
        channels = 4 if alpha else 3
        array = rng.integers(0, 256, size=(height, width, channels), dtype=np.uint8)
        if alpha:
            # A see-through hole, and the rest solid.
            array[..., 3] = 255
            array[20:50, 30:70, 3] = 0
        return Image.fromarray(array, 'RGBA' if alpha else 'RGB')

    @staticmethod
    def wire(*pictures):
        return torch.stack([torch.from_numpy(np.asarray(p, dtype=np.float32) / 255.0) for p in pictures])

    def from_file(self, picture, **values):
        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', return_value=Path('source.png')), patch('nodes.node_image_crop_rotate_pad.load_image_frames', return_value=[picture]):
            return AusBossImageCropRotatePad().load_transform('source.png', **values)

    def wired(self, batch, **values):
        def unread(*_args, **_kwargs):
            raise AssertionError('a wired run must not read the file')

        with patch('nodes.node_image_crop_rotate_pad.resolve_input_path', side_effect=unread), patch('nodes.node_image_crop_rotate_pad.folder_paths', None):
            return AusBossImageCropRotatePad().load_transform('gone.png', source_image=batch, **values)

    def assertSameOutputs(self, wired, filed):
        self.assertEqual(len(wired), len(filed))
        for index, (left, right) in enumerate(zip(wired, filed)):
            with self.subTest(output=AusBossImageCropRotatePad.RETURN_NAMES[index]):
                if isinstance(left, torch.Tensor):
                    self.assertTrue(torch.equal(left, right))
                elif isinstance(left, dict):
                    self.assertTrue(torch.equal(left['image'], right['image']))
                    self.assertTrue(torch.equal(left['blend'], right['blend']))
                else:
                    self.assertEqual(left, right)

    def test_source_image_is_an_appended_optional_input(self):
        types = AusBossImageCropRotatePad.INPUT_TYPES()
        self.assertEqual(list(types['optional'])[-1], 'source_image')
        self.assertEqual(types['optional']['source_image'][0], 'IMAGE')
        self.assertEqual(list(types['required'])[0], 'image')
        self.assertEqual(types['hidden'], {'unique_id': 'UNIQUE_ID'})

    def test_a_wired_picture_gives_what_the_same_file_gives(self):
        picture = self.picture()
        for values in ({}, self.LAYOUT, {**self.LAYOUT, 'resize_to_megapixels': True, 'megapixels': 0.02, 'resolution_steps': 16}):
            with self.subTest(values=values):
                self.assertSameOutputs(self.wired(self.wire(picture), **values), self.from_file(picture, **values))

    def test_a_wired_cutout_is_see_through_like_its_png(self):
        picture = self.picture(alpha=True)
        for painted_area in ('fill', 'keep picture'):
            with self.subTest(painted_area=painted_area):
                wired = self.wired(self.wire(picture), painted_area=painted_area, **self.LAYOUT)
                self.assertSameOutputs(wired, self.from_file(picture, painted_area=painted_area, **self.LAYOUT))

    def test_a_wired_batch_gets_the_same_framing_on_every_picture(self):
        pictures = [self.picture(seed=seed) for seed in (1, 2, 3)]
        image, mask, _stitcher, original, width, height, prompt_image = self.wired(self.wire(*pictures), **self.LAYOUT)
        self.assertEqual(tuple(image.shape), (3, height, width, 3))
        self.assertEqual(tuple(original.shape), (3, 96, 128, 3))
        for index, picture in enumerate(pictures):
            alone = self.from_file(picture, **self.LAYOUT)
            self.assertTrue(torch.equal(image[index], alone[0][0]))
            self.assertTrue(torch.equal(mask[index], alone[1][0]))
        self.assertTrue(torch.equal(prompt_image, image))

    def test_a_wired_run_hands_the_editor_its_picture_and_true_size(self):
        import tempfile
        import nodes.node_image_crop_rotate_pad as module

        with tempfile.TemporaryDirectory() as tmp:
            fake = type('FolderPaths', (), {'get_temp_directory': staticmethod(lambda: tmp)})
            with patch.object(module, 'folder_paths', fake):
                node = AusBossImageCropRotatePad()
                runs = [
                    node.load_transform('gone.png', source_image=self.wire(self.picture(2400, 1800, seed=seed)), unique_id='12:5', **self.LAYOUT)
                    for seed in (1, 2)
                ]
            for out in runs:
                self.assertEqual(out['ui']['ausboss_transform_wired_size'], [[2400, 1800]])
                self.assertEqual(
                    out['ui']['ausboss_transform_wired'],
                    [{'filename': '12_5.jpg', 'subfolder': module.STAGE_PREVIEW_SUBFOLDER, 'type': 'temp'}],
                )
                self.assertEqual(len(out['result']), 7)
            # One file per node, overwritten by the next picture.
            folder = Path(tmp) / module.STAGE_PREVIEW_SUBFOLDER
            self.assertEqual([path.name for path in folder.iterdir()], ['12_5.jpg'])
            with Image.open(folder / '12_5.jpg') as preview:
                self.assertEqual(preview.size, (1600, 1200))
                last = np.asarray(self.picture(2400, 1800, seed=2).resize((1600, 1200)), dtype=np.float32)
                self.assertLess(float(np.abs(np.asarray(preview.convert('RGB'), dtype=np.float32) - last).mean()), 12.0)
        # A file-driven run keeps returning the plain tuple.
        self.assertIsInstance(self.from_file(self.picture()), tuple)

    def test_validation_skips_the_file_when_a_picture_is_wired(self):
        import inspect

        self.assertIsNone(inspect.getfullargspec(AusBossImageCropRotatePad.VALIDATE_INPUTS).varkw)
        # ComfyUI passes a linked input to validation as None; an unwired
        # optional input is left out.
        self.assertIs(AusBossImageCropRotatePad.VALIDATE_INPUTS(image='gone.png', source_image=None), True)
        self.assertIn('Image Crop + Rotate + Pad', AusBossImageCropRotatePad.VALIDATE_INPUTS(image='gone.png'))

    def test_a_wire_that_is_not_a_picture_says_so(self):
        with self.assertRaisesRegex(ValueError, "source_image"):
            self.wired(torch.zeros((1, 8, 8, 2)))


if __name__ == '__main__':
    unittest.main()
