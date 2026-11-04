"""Small CPU-only regressions for short audio and unusual image batches."""

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import av
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _mask_helpers
from nodes._color_helpers import COLOR_MATCH_METHODS, match_colors
from nodes._h3_prompt_helpers import find_beats
from nodes._image_save_helpers import encode_image
from nodes._krea2_helpers import build_reference_image, fill_reference_holes
from nodes._mask_by_name_helpers import cut_out
from nodes._resize_helpers import resample_batch
from nodes._video_save_helpers import _rgb_uint8, encode_video, even_frames
from nodes.node_color_match import AusBossColorMatch
from nodes.node_h3_prompt_writer import AusBossH3PromptWriter
from nodes.node_image_resize import AusBossImageResize
from nodes.node_krea2_encode import AusBossKrea2Encode
from nodes.node_realign_to_source import AusBossRealignToSource
from nodes.node_refine_mask import AusBossRefineMask
from nodes.node_tiled_upscale import AusBossTiledUpscale


def resize(image, mask=None, interpolation="bilinear"):
    return AusBossImageResize().resize(
        image, "width+height", 4, 4, 0, 0, 1, "stretch", "#000000", 1,
        interpolation, mask=mask,
    )


class ShortMusicTests(unittest.TestCase):
    def test_onsets_shorter_than_the_smoothing_window_have_no_beats(self):
        for count in (3072, 12032):
            with self.subTest(samples=count):
                self.assertEqual(find_beats(torch.linspace(-1, 1, count).numpy(), 22050), [])

    def test_prompt_writer_accepts_a_short_non_silent_song(self):
        song = {"waveform": torch.linspace(-1, 1, 3072).reshape(1, 1, -1), "sample_rate": 22050}
        text = AusBossH3PromptWriter().write(
            "@1 walks.", 5, picture_1=torch.zeros(1, 2, 2, 3), song=song,
        )[0]
        self.assertIn("fully_copy", text)


class ImageBatchTests(unittest.TestCase):
    def test_resize_rejects_incompatible_mask_batches(self):
        image = torch.zeros(2, 4, 4, 3)
        with self.assertRaisesRegex(ValueError, "[Mm]ask batch.*(one|1|match|image batch)"):
            resize(image, torch.ones(3, 4, 4))
        for count in (1, 2):
            with self.subTest(masks=count):
                output, mask, _, _ = resize(image, torch.ones(count, 4, 4))
                self.assertEqual(output.shape[0], 2)
                self.assertEqual(mask.shape[0], count)

    def test_resize_rejects_empty_images_even_when_no_resize_is_needed(self):
        for size in (2, 4):
            with self.subTest(size=size), self.assertRaisesRegex(ValueError, "Image Resize.*(empty|at least one)"):
                resize(torch.zeros(0, size, size, 3), interpolation="lanczos")

    def test_resize_rejects_empty_masks(self):
        with self.assertRaisesRegex(ValueError, "empty|at least one"):
            resize(torch.zeros(1, 4, 4, 3), torch.zeros(0, 4, 4))

    def test_shared_resampler_rejects_empty_batches(self):
        with self.assertRaisesRegex(ValueError, "Cannot resize an empty"):
            resample_batch(torch.zeros(0, 2, 2, 3), 4, 4, "lanczos")

    def test_tiled_upscale_rejects_empty_images_before_using_a_model(self):
        for model in (None, object()):
            with self.subTest(model_connected=model is not None):
                with self.assertRaisesRegex(ValueError, "Tiled Upscale.*(empty|at least one)"):
                    AusBossTiledUpscale().split(torch.zeros(0, 2, 2, 3), 0, upscale_model=model)

    def test_color_match_expands_grayscale_images_and_references(self):
        for method in COLOR_MATCH_METHODS:
            for image_channels, reference_channels in ((1, 3), (3, 1), (1, 1)):
                with self.subTest(method=method, image=image_channels, reference=reference_channels):
                    image = torch.linspace(.1, .4, 4).reshape(1, 2, 2, 1).expand(-1, -1, -1, image_channels)
                    reference = torch.linspace(.6, .9, 4).reshape(1, 2, 2, 1).expand(-1, -1, -1, reference_channels)
                    expected = match_colors(image.expand(-1, -1, -1, 3), reference.expand(-1, -1, -1, 3), 1, method=method)
                    result = match_colors(image, reference, 1, method=method)
                    self.assertEqual(tuple(result.shape), (1, 2, 2, 3))
                    self.assertTrue(torch.allclose(result, expected))
                    self.assertTrue(torch.isfinite(result).all())

    def test_color_match_rejects_empty_images_and_references(self):
        for count, ref_count in ((0, 1), (1, 0), (0, 0)):
            for strength in (0, 1):
                with self.subTest(images=count, references=ref_count, strength=strength):
                    with self.assertRaisesRegex(ValueError, "empty|at least one"):
                        AusBossColorMatch().match(
                            torch.zeros(count, 2, 2, 3), strength,
                            reference=torch.zeros(ref_count, 2, 2, 3), method="mkl",
                        )

    def test_realign_rejects_empty_edited_and_source_batches(self):
        for count, source_count in ((0, 1), (1, 0), (0, 0)):
            with self.subTest(edited=count, source=source_count):
                with self.assertRaisesRegex(ValueError, "Realign to Source.*(empty|at least one)"):
                    AusBossRealignToSource().realign(
                        torch.zeros(count, 2, 2, 3), torch.zeros(source_count, 2, 2, 3),
                        "zoom + shift", "edge", 20,
                    )

    def test_grayscale_cutout_is_rgba_with_the_original_mask(self):
        image = torch.linspace(.1, .4, 4).reshape(1, 2, 2, 1)
        mask = torch.tensor([[[1., 0.], [.5, 1.]]])
        result = cut_out(image, mask)
        self.assertEqual(tuple(result.shape), (1, 2, 2, 4))
        self.assertTrue(torch.equal(result[..., :3], image.expand(-1, -1, -1, 3)))
        self.assertTrue(torch.equal(result[..., 3], mask))


class MediaSaveTests(unittest.TestCase):
    def test_png_roundtrips_grayscale_and_bfloat16(self):
        for channels, dtype, mode in ((1, torch.float32, "L"), (3, torch.bfloat16, "RGB")):
            with self.subTest(channels=channels, dtype=dtype), tempfile.TemporaryDirectory() as tmp:
                frame = torch.tensor([[0., .25], [.5, 1.]], dtype=dtype).unsqueeze(-1).expand(-1, -1, channels)
                path = Path(tmp) / "image.png"
                encode_image(path, frame, "png", None)
                with Image.open(path) as image:
                    self.assertEqual(image.mode, mode)
                    self.assertEqual(image.size, (2, 2))
                    self.assertEqual(image.convert("L").tobytes(), bytes([0, 63, 127, 255]))

    def test_video_grayscale_conversion_preserves_every_channel(self):
        frame = torch.tensor([[0., .25], [.5, 1.]]).unsqueeze(-1)
        array = _rgb_uint8(frame)
        self.assertEqual(array.shape, (2, 2, 3))
        expected = torch.tensor([[0, 64], [128, 255]], dtype=torch.uint8)
        for channel in range(3):
            self.assertTrue(torch.equal(torch.from_numpy(array[..., channel]), expected))

    def test_software_h264_encodes_and_decodes_grayscale(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gray.mp4"
            self.assertEqual(encode_video(path, torch.full((1, 2, 2, 1), .5), 16, None, 19), (2, 2, 1))
            with av.open(str(path)) as container:
                frames = list(container.decode(video=0))
            self.assertEqual(len(frames), 1)
            self.assertEqual((frames[0].width, frames[0].height), (2, 2))

    def test_singleton_video_dimensions_are_padded_before_even_crop(self):
        for height, width in ((1, 1), (1, 3), (3, 1), (3, 5)):
            with self.subTest(height=height, width=width):
                frames = torch.arange(height * width * 3).reshape(1, height, width, 3).float()
                result = even_frames(frames)
                expected = frames.repeat(1, 2 if height == 1 else 1, 2 if width == 1 else 1, 1)
                expected = expected[:, :max(2, height - height % 2), :max(2, width - width % 2)]
                self.assertTrue(torch.equal(result, expected))
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "tiny.mp4"
                    size = (result.shape[2], result.shape[1], 1)
                    self.assertEqual(encode_video(path, frames / max(1, frames.max().item()), 16, None, 19), size)
                    with av.open(str(path)) as container:
                        decoded = list(container.decode(video=0))
                    self.assertEqual(len(decoded), 1)
                    self.assertEqual((decoded[0].width, decoded[0].height), size[:2])


class MaskBatchTests(unittest.TestCase):
    def test_refine_rejects_empty_batches_with_and_without_filling(self):
        for fill in (False, True):
            with self.subTest(fill=fill), self.assertRaisesRegex(ValueError, "Mask Refine.*(empty|at least one)"):
                AusBossRefineMask().refine(torch.zeros(0, 2, 2), 0, 0, fill, 0, 0, 1, "off", preview=False)

    def test_krea_preprocessing_rejects_an_empty_mask_before_encoding(self):
        with self.assertRaisesRegex(ValueError, "empty|at least one"):
            AusBossKrea2Encode().encode(
                object(), "", reference=torch.zeros(1, 2, 2, 3), mask=torch.zeros(0, 2, 2),
            )

    def test_krea_preprocessing_rejects_empty_reference_batches(self):
        image = torch.zeros(0, 2, 2, 3)
        for operation in (lambda: build_reference_image(image), lambda: fill_reference_holes(image, torch.zeros(1, 2, 2))):
            with self.assertRaisesRegex(ValueError, "empty|at least one"):
                operation()

    @unittest.skipIf(_mask_helpers._scipy_fill_holes is None, "SciPy is not installed")
    def test_diagonal_border_connection_is_preserved_with_either_hole_filler(self):
        mask = torch.tensor([[[0., 1., 1.], [1., 0., 1.], [1., 1., 1.]]])
        for limit in (0, 20):
            with self.subTest(limit=limit):
                scipy_result = _mask_helpers.refine_mask(mask, 0, 0, True, max_hole_size=limit)[0]
                with patch.object(_mask_helpers, "_scipy_fill_holes", None), patch.object(_mask_helpers, "_scipy_label", None):
                    fallback = _mask_helpers.refine_mask(mask, 0, 0, True, max_hole_size=limit)[0]
                self.assertTrue(torch.equal(fallback, mask))
                self.assertTrue(torch.equal(scipy_result, fallback))

    @unittest.skipIf(_mask_helpers._scipy_label is None, "SciPy is not installed")
    def test_diagonally_joined_holes_share_one_size_limit(self):
        mask = torch.ones(1, 4, 4)
        mask[0, 1, 1] = mask[0, 2, 2] = 0
        scipy_result = _mask_helpers.fill_mask_holes(mask, 7)  # One pixel fits; two do not.
        with patch.object(_mask_helpers, "_scipy_fill_holes", None), patch.object(_mask_helpers, "_scipy_label", None):
            fallback = _mask_helpers.fill_mask_holes(mask, 7)
        self.assertTrue(torch.equal(fallback, mask))
        self.assertTrue(torch.equal(scipy_result, fallback))


if __name__ == "__main__":
    unittest.main()
