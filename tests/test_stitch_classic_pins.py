"""Stitch Inpaint's classic seam is pinned to the pixel.

Published workflows stitch Load Image + Pad and Crop + Rotate + Pad canvases
with Tone match at 1, Crop For Inpaint crops with it at 0.5, and a video
outpaint stitches a clip. People who update the pack must get the same
picture. Each case below builds its stitcher the way its node does, stitches a
fixed patch at color_match 0, 0.5 and 1 through the node, and compares the
image and blend_mask with the output the 2.3.0 code gave.

Blend in with Tone match at 0 is pinned the same way, to the 2.4.0 code:
the published Qwen Image 2.1 Rotate + Outpaint workflow stitches that way.

Tone-matched float32 output varies slightly with CPU kernels and thread
counts, including on unchanged releases. Images are compared with frozen
release tensors at an absolute tolerance of 1e-5 (0.00255 of an 8-bit step),
with no relative tolerance. Masks still use exact hashes. The fixtures come
from released code, never the implementation under review; see
fixtures/stitch_released_images.md for provenance and regeneration.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._inpaint_crop_helpers import build_transform_stitcher
from nodes._transform_engine import TransformSpec, transform_tensor_batch_chunked
from nodes.node_image_crop_rotate_pad import AusBossImageCropRotatePad
from nodes.node_inpaint_crop_stitch import AusBossCropForInpaint, AusBossStitchInpaint
from nodes.node_load_image_pad import AusBossLoadImagePad

STRENGTHS = (0.0, 0.5, 1.0)

IMAGE_ATOL = 1e-5
REFERENCE_IMAGES = ROOT / "tests" / "fixtures" / "stitch_released_images.npz"

# Historical image hashes are retained for --print diagnostics. Only masks
# are byte-exact across CPU backends; images use the release fixtures below.
# (case, color_match) -> (image, blend_mask), first 20 hex digits of SHA-256.
PINS = {
    ("load image + pad", 0.0): ("bceaded74f00fa7af3df", "da3307917bed14a6f6ac"),
    ("load image + pad", 0.5): ("e97736348539d04d3e97", "da3307917bed14a6f6ac"),
    ("load image + pad", 1.0): ("1e5147a3bb1964045e60", "da3307917bed14a6f6ac"),
    ("crop + rotate + pad, turned", 0.0): ("e0cdbaa25fe100cada6d", "890049d995e6b08f8ba8"),
    ("crop + rotate + pad, turned", 0.5): ("361a2276ad4d6c778a1a", "890049d995e6b08f8ba8"),
    ("crop + rotate + pad, turned", 1.0): ("6d6a56a3e2c1484a3a8c", "890049d995e6b08f8ba8"),
    ("crop + rotate + pad, straight", 0.0): ("d310e25379d762bfb4de", "aedec31a1611cfc153fc"),
    ("crop + rotate + pad, straight", 0.5): ("c54bdbdd0ead86bfa68e", "aedec31a1611cfc153fc"),
    ("crop + rotate + pad, straight", 1.0): ("72599a61a790324997bf", "aedec31a1611cfc153fc"),
    ("crop for inpaint", 0.0): ("752af366473fc5d35c33", "77d0a76b178964237dbc"),
    ("crop for inpaint", 0.5): ("bd1f933a34b1c7bc841d", "77d0a76b178964237dbc"),
    ("crop for inpaint", 1.0): ("17c85029002fbc0628de", "77d0a76b178964237dbc"),
    ("video clip", 0.0): ("729e2a1472edcf980813", "2b757c3e23d05f48bf45"),
    ("video clip", 0.5): ("343f18a07c826b110d51", "2b757c3e23d05f48bf45"),
    ("video clip", 1.0): ("9c6ae72b1f31083fdc88", "2b757c3e23d05f48bf45"),
    ("video clip, fewer frames back", 0.0): ("bba989a9d35791119646", "b195c4ca7df23a9ee768"),
    ("video clip, fewer frames back", 0.5): ("cc3cca3802b9c1566307", "b195c4ca7df23a9ee768"),
    ("video clip, fewer frames back", 1.0): ("2fe152cce6686d78d3ba", "b195c4ca7df23a9ee768"),
}


def picture(width: int, height: int, seed: int) -> Image.Image:
    """Smooth colour structure plus fine grain, as 8-bit RGB."""
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    rgb = np.stack([
        0.35 + 0.25 * np.sin(x / 9.0 + seed),
        0.45 + 0.2 * np.cos(y / 7.0 - seed),
        0.3 + 0.2 * np.sin((x + y) / 13.0),
    ], -1)
    rgb += np.random.default_rng(seed).normal(0.0, 0.03, rgb.shape)
    return Image.fromarray((np.clip(rgb, 0.0, 1.0) * 255).round().astype(np.uint8))


def model_output(canvas: torch.Tensor, weight: torch.Tensor, seed: int) -> torch.Tensor:
    """A stand-in for a sampler's result: a faint redraw everywhere, and a
    drifted, textured repaint wherever ``weight`` (BHW) lets it paint."""
    generator = torch.Generator().manual_seed(seed)
    grain = (torch.rand(canvas.shape, generator=generator) - 0.5) * 0.08
    rows = torch.arange(canvas.shape[1], dtype=torch.float32).view(1, -1, 1, 1)
    drift = 0.06 + 0.04 * torch.sin(rows / 11.0)
    painted = (drift + grain) * weight.unsqueeze(-1)
    return (canvas + painted + 0.01 * grain).clamp(0.0, 1.0)


def load_image_pad():
    source = picture(72, 56, 1)
    with patch("nodes.node_load_image_pad.resolve_input_path", return_value=Path("source.png")), \
            patch("nodes.node_load_image_pad.load_image_frames", return_value=[source]):
        image, mask, _w, _h, stitcher, _ref = AusBossLoadImagePad().load_pad(
            "source.png", 24, 16, 40, 0, "color", "#808080", 0.5, 12, 8, 0.0
        )
    return stitcher, model_output(image, mask, 11)


def crop_rotate_pad(**layout):
    source = picture(72, 56, 2)
    with patch("nodes.node_image_crop_rotate_pad.resolve_input_path", return_value=Path("source.png")), \
            patch("nodes.node_image_crop_rotate_pad.load_image_frames", return_value=[source]):
        image, mask, stitcher, *_ = AusBossImageCropRotatePad().load_transform("source.png", **layout)
    return stitcher, model_output(image, mask, 12)


def crop_for_inpaint():
    image = torch.from_numpy(np.asarray(picture(80, 64, 3), dtype=np.float32) / 255.0).unsqueeze(0)
    mask = torch.zeros((1, 64, 80))
    mask[:, 20:44, 30:58] = 1.0
    cropped, _sampling, stitcher = AusBossCropForInpaint().crop(image, mask, 1.5, 16, 8)
    cx, cy, cw, ch = stitcher["crop_to_canvas"]
    return stitcher, model_output(cropped, stitcher["blend"][:, cy : cy + ch, cx : cx + cw], 13)


def video_clip(frames_back: int | None = None):
    # Three frames of a slowly panning picture, transformed and stitched the
    # way Video Crop + Rotate + Pad -> Clip does it (black fill, no feather).
    wide = torch.from_numpy(np.asarray(picture(84, 48, 4), dtype=np.float32) / 255.0)
    frames = torch.stack([wide[:, 2 * index : 2 * index + 72] for index in range(3)])
    spec = TransformSpec(rotation_degrees=6.0, pad_left=16, pad_right=8, fill_color="#000000")
    output, mask, geometry = transform_tensor_batch_chunked(frames, spec, chunk_size=2)
    stitcher = build_transform_stitcher(
        output, mask, geometry, 32, 0, source="Video Crop + Rotate + Pad -> Clip"
    )
    generated = model_output(output, mask, 14)
    return stitcher, generated if frames_back is None else generated[:frames_back]


CASES = {
    "load image + pad": load_image_pad,
    "crop + rotate + pad, turned": lambda: crop_rotate_pad(rotation_degrees=-14.3, feather=12, stitch_blend=0),
    "crop + rotate + pad, straight": lambda: crop_rotate_pad(pad_left=24, pad_right=16, pad_bottom=12, feather=12),
    "crop for inpaint": crop_for_inpaint,
    "video clip": video_clip,
    "video clip, fewer frames back": lambda: video_clip(frames_back=2),
}


def digest(tensor: torch.Tensor) -> str:
    data = tensor.detach().to("cpu", torch.float32).contiguous().numpy()
    head = repr((tuple(data.shape), str(data.dtype))).encode()
    return hashlib.sha256(head + data.tobytes()).hexdigest()[:20]


def stitch(stitcher, patch_image, strength, **extra):
    node = AusBossStitchInpaint()
    return getattr(node, AusBossStitchInpaint.FUNCTION)(
        stitcher=stitcher, inpainted=patch_image, fix_edge_halo=False, color_match=strength, **extra
    )


def measure():
    results = {}
    for name, build in CASES.items():
        for strength in STRENGTHS:
            stitcher, patch_image = build()
            image, blend_mask = stitch(stitcher, patch_image, strength)
            results[(name, strength)] = (digest(image), digest(blend_mask))
    return results


def reference_image(name, strength, seam="classic"):
    index = tuple(CASES).index(name)
    key = f"{seam}_{index}_{strength:g}_image"
    with np.load(REFERENCE_IMAGES, allow_pickle=False) as references:
        return torch.from_numpy(references[key])


def assert_released_image(image, expected):
    # No relative tolerance: bright pixels get no extra allowance. Shapes,
    # dtypes and non-finite values must also match (equal_nan defaults false).
    torch.testing.assert_close(image, expected, rtol=0, atol=IMAGE_ATOL)


class ClassicSeamPinTests(unittest.TestCase):
    def test_every_case_matches_its_pin(self):
        self.assertEqual(len(PINS), len(CASES) * len(STRENGTHS))
        for name, build in CASES.items():
            for strength in STRENGTHS:
                with self.subTest(case=name, color_match=strength):
                    stitcher, patch_image = build()
                    image, blend_mask = stitch(stitcher, patch_image, strength)
                    assert_released_image(image, reference_image(name, strength))
                    self.assertEqual(digest(blend_mask), PINS[(name, strength)][1])

    def test_release_pixels_with_one_thread_and_native_convolution(self):
        # Exercise the reduction/kernel choices that break raw image hashes.
        # Restore the caller's thread/backend settings, including on failure.
        threads = torch.get_num_threads()
        try:
            torch.set_num_threads(1)
            with torch.backends.mkldnn.flags(enabled=False):
                self.test_every_case_matches_its_pin()
        finally:
            torch.set_num_threads(threads)

    def test_reference_rejects_one_changed_pixel_and_nonfinite_output(self):
        expected = reference_image("crop + rotate + pad, turned", 1.0)
        for value in (float(expected[0, 0, 0, 0]) + 1 / 255, float("nan"), float("inf")):
            with self.subTest(value=value):
                changed = expected.clone()
                changed[0, 0, 0, 0] = value
                with self.assertRaises(AssertionError):
                    assert_released_image(changed, expected)

    def test_classic_named_explicitly_is_the_default(self):
        # The Seam choice arrived after these pins; picking classic by name
        # must be the very same stitch as leaving it out.
        optional = AusBossStitchInpaint.INPUT_TYPES()["optional"]
        if "seam" not in optional:
            self.skipTest("this Stitch Inpaint has no Seam choice")
        for name, build in CASES.items():
            stitcher, patch_image = build()
            with self.subTest(case=name):
                plain = stitch(stitcher, patch_image, 1.0)
                named = stitch(stitcher, patch_image, 1.0, seam="classic")
                self.assertTrue(torch.equal(plain[0], named[0]))
                self.assertTrue(torch.equal(plain[1], named[1]))


# Blend in reads the picture's edge, so only the canvas stitchers stitch it;
# (case) -> (image, blend_mask), first 20 hex digits, from the 2.4.0 code.
BLEND_IN_CASES = (
    "load image + pad",
    "crop + rotate + pad, turned",
    "crop + rotate + pad, straight",
    "video clip",
    "video clip, fewer frames back",
)
BLEND_IN_PINS = {
    "load image + pad": ("dcf639cca3ebb067b509", "a6268360da1bf1dfbdc9"),
    "crop + rotate + pad, turned": ("d7719cc807e1473fef42", "d46c2fca7a9cb070e97d"),
    "crop + rotate + pad, straight": ("74682782bb43db4ea1aa", "092bcd5316bb2401f4b9"),
    "video clip": ("ad354f9c5c2c4a826498", "dfe6547464fa28df00a1"),
    "video clip, fewer frames back": ("4ed09429e45d5cc3395a", "84417340317c98964773"),
}


def measure_blend_in():
    results = {}
    for name in BLEND_IN_CASES:
        stitcher, patch_image = CASES[name]()
        image, blend_mask = stitch(stitcher, patch_image, 0.0, seam="blend in")
        results[name] = (digest(image), digest(blend_mask))
    return results


class BlendInToneMatchOffPinTests(unittest.TestCase):
    def test_tone_match_off_is_the_released_blend_in(self):
        optional = AusBossStitchInpaint.INPUT_TYPES()["optional"]
        if "seam" not in optional:
            self.skipTest("this Stitch Inpaint has no Seam choice")
        self.assertEqual(set(BLEND_IN_PINS), set(BLEND_IN_CASES))
        for name in BLEND_IN_CASES:
            with self.subTest(case=name):
                stitcher, patch_image = CASES[name]()
                image, blend_mask = stitch(stitcher, patch_image, 0.0, seam="blend in")
                assert_released_image(image, reference_image(name, 0.0, "blend_in"))
                self.assertEqual(digest(blend_mask), BLEND_IN_PINS[name][1])

    def test_release_pixels_without_mkldnn(self):
        with torch.backends.mkldnn.flags(enabled=False):
            self.test_tone_match_off_is_the_released_blend_in()


if __name__ == "__main__":
    if "--print" in sys.argv:
        for key, value in measure().items():
            print(f"    {key!r}: {value!r},")
        sys.exit(0)
    if "--print-blend-in" in sys.argv:
        for key, value in measure_blend_in().items():
            print(f"    {key!r}: {value!r},")
        sys.exit(0)
    unittest.main()
