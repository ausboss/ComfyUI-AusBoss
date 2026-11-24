"""The box-edit path costs the box, not the picture, and gives the same pixels.

Crop + Rotate + Pad, Crop For Inpaint and Stitch Inpaint used to grow and
blur masks across the whole frame: a 17 MP photo with a small box drawn on it
spent about 5 s on CPU before the sampler started. The filters now run on a
window around the mask's nonzero pixels, and grows use an exact doubling
running max instead of a wide max pool.

Two kinds of test:

- Pixel match. The old full-frame filters live on here as references and are
  patched back into the helpers. Grows and shrinks must match to the bit.
  A blur on a window can round its last bit differently from the same blur
  on the whole frame (conv2d picks its kernel by size), so blurred values,
  and node outputs that use them, match within FLOAT_ROUNDING; pixels the
  stitch leaves alone stay bit-identical either way.
- Timing. A 17 MP no-op Crop + Rotate + Pad, a box Crop For Inpaint and its
  Stitch Inpaint, each with a bound several times the fixed cost and well
  under the old one, so a slow runner passes and a full-frame regression
  does not.
"""

from __future__ import annotations

from contextlib import ExitStack
import importlib.util
import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as functional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")
if COMFY_ROOT:
    sys.path.append(COMFY_ROOT)
HAS_COMFY = importlib.util.find_spec("comfy") is not None
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _mask_helpers as mask_helpers
from nodes._inpaint_crop_helpers import stitch_blend_from_mask
from nodes._mask_helpers import blur_mask, grow_shrink_mask
from nodes.node_image_crop_rotate_pad import AusBossImageCropRotatePad
from nodes.node_inpaint_crop_stitch import AusBossCropForInpaint, AusBossStitchInpaint


# --- the old full-frame filters, kept as references ---------------------------


def pooled_running_max(values: torch.Tensor, steps: int, dim: int) -> torch.Tensor:
    """The max pool grow_shrink_mask used before, one axis at a time."""
    size = 2 * steps + 1
    grown = values.unsqueeze(1)
    if dim == 2:
        grown = functional.max_pool2d(grown, kernel_size=(1, size), stride=1, padding=(0, steps))
    else:
        grown = functional.max_pool2d(grown, kernel_size=(size, 1), stride=1, padding=(steps, 0))
    return grown.squeeze(1)


def whole_frame(mask, reach, run):
    return run(mask)


def old_filters():
    """Patch the old behaviour back in: whole-frame filters, max pool grows."""
    stack = ExitStack()
    stack.enter_context(patch.object(mask_helpers, "_within_support", whole_frame))
    stack.enter_context(patch.object(mask_helpers, "_running_max", pooled_running_max))
    return stack


def photo(height: int, width: int, seed: int = 0) -> np.ndarray:
    """A smooth picture with grain, like a photo, as HWC uint8."""
    rng = np.random.default_rng(seed)
    rows, cols = np.mgrid[0:height, 0:width]
    picture = np.stack(
        [cols * 255 // max(1, width), rows * 255 // max(1, height), (rows + cols) * 127 // max(1, height + width)],
        axis=-1,
    ).astype(np.int16)
    return np.clip(picture + rng.integers(-20, 20, picture.shape), 0, 255).astype(np.uint8)


def box_mask(height: int, width: int, top: int, left: int, box_h: int, box_w: int, value: float = 1.0):
    mask = torch.zeros((1, height, width), dtype=torch.float32)
    mask[:, top : top + box_h, left : left + box_w] = value
    return mask


# One float32 step at 1.0 is 1.2e-7; a tenth of an 8-bit level is 4e-4.
FLOAT_ROUNDING = 1e-6


def assert_same(case: unittest.TestCase, new, old, where: str = "", tolerance: float = 0.0) -> None:
    if isinstance(new, torch.Tensor):
        case.assertTrue(isinstance(old, torch.Tensor), where)
        case.assertEqual(tuple(new.shape), tuple(old.shape), where)
        if tolerance and new.dtype.is_floating_point:
            diff = float((new - old).abs().max()) if new.numel() else 0.0
            case.assertLessEqual(diff, tolerance, f"{where}: max diff {diff}")
        else:
            case.assertTrue(torch.equal(new, old), f"{where}: max diff {float((new - old).abs().max())}")
    elif isinstance(new, dict):
        case.assertEqual(sorted(new), sorted(old), where)
        for key in new:
            assert_same(case, new[key], old[key], f"{where}.{key}", tolerance)
    elif isinstance(new, (list, tuple)):
        case.assertEqual(len(new), len(old), where)
        for index, (a, b) in enumerate(zip(new, old)):
            assert_same(case, a, b, f"{where}[{index}]", tolerance)
    else:
        case.assertEqual(new, old, where)


# --- pixel match ---------------------------------------------------------------


class FilterMatchTests(unittest.TestCase):
    def masks(self, height, width):
        generator = torch.Generator().manual_seed(height * 1000 + width)
        noise = torch.rand((2, height, width), generator=generator)
        yield "noise", noise
        yield "sparse soft", (noise > 0.9).float() * torch.rand((2, height, width), generator=generator)
        yield "inner box", box_mask(height, width, height // 3, width // 3, max(1, height // 5), max(1, width // 6), 0.7)
        yield "box on the left edge", box_mask(height, width, height // 4, 0, max(1, height // 3), max(1, width // 7))
        yield "box in a corner", box_mask(height, width, height - max(1, height // 6), width - max(1, width // 6), height, width)
        yield "one pixel", box_mask(height, width, height // 2, width // 2, 1, 1)
        yield "empty", torch.zeros((1, height, width))
        frames = torch.zeros((3, height, width))
        frames[0, : height // 4, : width // 4] = 1.0
        frames[2, -max(1, height // 5) :, width // 2 :] = 0.4
        yield "frames in different places", frames

    def test_grow_and_shrink_match_the_max_pool(self):
        for height, width in ((1, 1), (5, 9), (64, 48), (211, 307)):
            for name, mask in self.masks(height, width):
                for pixels in (1, 2, 3, 5, 8, 16, 31, 48, 100, -1, -3, -8, -48):
                    with self.subTest(size=(height, width), mask=name, pixels=pixels):
                        new = grow_shrink_mask(mask, pixels)
                        with old_filters():
                            old = grow_shrink_mask(mask, pixels)
                        assert_same(self, new, old)

    def test_blur_matches_the_whole_frame_blur(self):
        for height, width in ((1, 1), (5, 9), (64, 48), (211, 307)):
            for name, mask in self.masks(height, width):
                for sigma in (0.5, 2.0, 16.0, 48 / 3.0):
                    with self.subTest(size=(height, width), mask=name, sigma=sigma):
                        new = blur_mask(mask, sigma)
                        with old_filters():
                            old = blur_mask(mask, sigma)
                        assert_same(self, new, old, tolerance=FLOAT_ROUNDING)
                        # Where the old blur gave exactly 0, so does the new one.
                        self.assertTrue(torch.equal(new == 0, old == 0))

    def test_the_stitch_blend_matches(self):
        mask = box_mask(300, 220, 40, 60, 90, 70)
        for blend, grow in ((0, 0), (16, 0), (48, 8), (32, -6)):
            with self.subTest(blend=blend, grow=grow):
                new = stitch_blend_from_mask(mask, blend, grow)
                with old_filters():
                    old = stitch_blend_from_mask(mask, blend, grow)
                assert_same(self, new, old, tolerance=FLOAT_ROUNDING)
                self.assertTrue(torch.equal(new == 0, old == 0))


class NodeMatchTests(unittest.TestCase):
    """Whole nodes, every output and the stitcher, before and after."""

    def crop_and_stitch(self, image, mask, **settings):
        crop = AusBossCropForInpaint().crop(image, mask, **settings)
        generated = (crop[0] * 0.85 + 0.1).clamp(0.0, 1.0)
        outputs = [crop]
        for options in ({}, {"color_match": 1.0}):
            outputs.append(AusBossStitchInpaint().stitch(crop[2], generated, **options))
        return outputs

    def test_crop_for_inpaint_and_stitch_match(self):
        height, width = 420, 300
        image = torch.from_numpy(photo(height, width)).float().unsqueeze(0) / 255.0
        cases = {
            "the box-edit settings": dict(
                context_factor=1.0, blend_pixels=48, output_multiple=32, context_pixels=96, mask_grow=8,
                mask_blur=2.0, target_megapixels=0.05, rescale_algorithm="bicubic", keep_inside=True,
            ),
            "defaults": dict(context_factor=1.2, blend_pixels=16, output_multiple=32),
            "shrink and pad past the edge": dict(
                context_factor=2.0, blend_pixels=24, output_multiple=64, mask_grow=-4, mask_blur=6.0,
                keep_inside=False,
            ),
            "inverted": dict(context_factor=1.0, blend_pixels=8, output_multiple=8, invert_mask=True, mask_grow=3),
            "outpaint": dict(context_factor=1.0, blend_pixels=16, output_multiple=8, extend_left=40, extend_down=24, mask_grow=4),
        }
        masks = {
            "inner box": box_mask(height, width, 150, 90, 80, 60),
            "box on the edge": box_mask(height, width, 0, 200, 70, 100),
            "empty": torch.zeros((1, height, width)),
        }
        for case, settings in cases.items():
            for name, mask in masks.items():
                with self.subTest(settings=case, mask=name):
                    new = self.crop_and_stitch(image, mask, **settings)
                    with old_filters():
                        old = self.crop_and_stitch(image, mask, **settings)
                    assert_same(self, new, old, tolerance=FLOAT_ROUNDING)
                    # The stitched picture is the original wherever the old
                    # blend was 0, to the bit.
                    stitcher = old[0][2]
                    ox, oy, ow, oh = stitcher["canvas_to_original"]
                    untouched = stitcher["blend"][0, oy : oy + oh, ox : ox + ow] == 0
                    source = stitcher["canvas"][0, oy : oy + oh, ox : ox + ow]
                    self.assertTrue(torch.equal(new[1][0][0][untouched], source[untouched]))

    def load(self, frames, **values):
        with patch("nodes.node_image_crop_rotate_pad.resolve_input_path", return_value=Path("source.png")), patch(
            "nodes.node_image_crop_rotate_pad.load_image_frames", return_value=frames
        ):
            return AusBossImageCropRotatePad().load_transform("source.png", **values)

    def test_crop_rotate_pad_matches(self):
        opaque = Image.fromarray(photo(180, 140, seed=1), "RGB").convert("RGBA")
        cutout = opaque.copy()
        alpha = np.full((180, 140), 255, np.uint8)
        alpha[30:90, 20:70] = 0
        cutout.putalpha(Image.fromarray(alpha))
        layouts = {
            "nothing to do": {},
            "padded": dict(pad_left=24, pad_bottom=40),
            "turned and cropped": dict(rotation_degrees=-11.0, crop_x=8, crop_y=6, crop_width=120, crop_height=150),
            "feathered pad, wide blend": dict(pad_top=32, pad_right=16, feather=6, stitch_blend=48, stitch_grow=-4),
        }
        if HAS_COMFY:  # the megapixel resize runs through comfy.utils
            layouts["resized"] = dict(pad_left=16, resize_to_megapixels=True, megapixels=0.05)
        for picture_name, picture in (("opaque", opaque), ("see-through", cutout)):
            for painted in ("fill", "keep picture"):
                for layout, values in layouts.items():
                    with self.subTest(picture=picture_name, painted_area=painted, layout=layout):
                        new = self.load([picture], painted_area=painted, **values)
                        with old_filters():
                            old = self.load([picture], painted_area=painted, **values)
                        assert_same(self, new, old, tolerance=FLOAT_ROUNDING)
                        # Two outputs, two tensors: no consumer changes one through the other.
                        self.assertIsNot(new[3], new[2]["original"]["frames"])


# --- timing ----------------------------------------------------------------------

# 3360 x 5024, the size of the photo the slowdown was found on.
BIG_W, BIG_H = 3360, 5024


def best_of(runs: int, call):
    best, result = None, None
    for _ in range(runs):
        start = time.perf_counter()
        result = call()
        took = time.perf_counter() - start
        best = took if best is None else min(best, took)
    return best, result


class BigPictureTimingTests(unittest.TestCase):
    """Bounds for a CI runner; on two CPU threads the old code took several
    times each one (see the PR for the before and after numbers)."""

    @classmethod
    def setUpClass(cls):
        cls.picture = Image.fromarray(photo(BIG_H, BIG_W), "RGB").convert("RGBA")
        cls.image = torch.from_numpy(np.asarray(cls.picture.convert("RGB"), dtype=np.float32) / 255.0).unsqueeze(0)
        cls.mask = box_mask(BIG_H, BIG_W, BIG_H // 3, BIG_W // 3, BIG_H // 6, BIG_W // 5)

    def test_a_no_op_crop_rotate_pad_is_quick(self):
        def run():
            with patch("nodes.node_image_crop_rotate_pad.resolve_input_path", return_value=Path("source.png")), patch(
                "nodes.node_image_crop_rotate_pad.load_image_frames", return_value=[self.picture]
            ):
                return AusBossImageCropRotatePad().load_transform("source.png")

        took, outputs = best_of(2, run)
        self.assertFalse(bool(outputs[1].any()))
        self.assertLess(took, 2.5, f"Crop + Rotate + Pad with nothing to do took {took:.2f} s at 17 MP")

    def test_a_box_crop_and_stitch_are_quick(self):
        settings = dict(
            context_factor=1.0, blend_pixels=48, output_multiple=32, context_pixels=96, mask_grow=8,
            mask_blur=2.0, target_megapixels=1.9, rescale_algorithm="bicubic", keep_inside=True,
        )
        took, crop = best_of(2, lambda: AusBossCropForInpaint().crop(self.image, self.mask, **settings))
        self.assertLess(took, 1.5, f"Crop For Inpaint took {took:.2f} s for a box on a 17 MP picture")
        generated = (crop[0] * 0.9 + 0.05).contiguous()
        took, _ = best_of(2, lambda: AusBossStitchInpaint().stitch(crop[2], generated))
        self.assertLess(took, 1.0, f"Stitch Inpaint took {took:.2f} s for a box on a 17 MP picture")


if __name__ == "__main__":
    unittest.main()
