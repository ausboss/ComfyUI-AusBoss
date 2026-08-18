from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._inpaint_crop_helpers import build_canvas_stitcher
from nodes._krea2_helpers import (
    REFERENCE_MAX_EDGE,
    build_reference_image,
    extract_bbox_norm,
    reference_size,
    snap16,
)


class Snap16Tests(unittest.TestCase):
    """The VAE downsamples by 8 and the DiT patchifies by 2, so a reference
    edge off a multiple of 16 lands on a partial patch."""

    def test_rounds_to_the_nearest_multiple(self):
        self.assertEqual(snap16(16), 16)
        self.assertEqual(snap16(23), 16)
        self.assertEqual(snap16(24), 32)
        self.assertEqual(snap16(384), 384)

    def test_never_returns_zero(self):
        # A zero-size reference would encode to an empty latent.
        self.assertEqual(snap16(0), 16)
        self.assertEqual(snap16(1), 16)
        self.assertEqual(snap16(-40), 16)


class ReferenceSizeTests(unittest.TestCase):
    def test_a_small_reference_is_only_snapped(self):
        self.assertEqual(reference_size(64, 48), (64, 48))
        self.assertEqual(reference_size(70, 50), (64, 48))

    def test_the_long_edge_is_capped_and_aspect_roughly_kept(self):
        width, height = reference_size(1000, 500)
        self.assertLessEqual(max(width, height), REFERENCE_MAX_EDGE)
        self.assertEqual(width % 16, 0)
        self.assertEqual(height % 16, 0)
        self.assertAlmostEqual(width / height, 2.0, delta=0.15)

    def test_a_tall_source_caps_on_height(self):
        width, height = reference_size(500, 1000)
        self.assertEqual(height, 384)
        self.assertLess(width, height)

    def test_zero_max_edge_means_snap_only(self):
        # 1000/16 is exactly 62.5, and round() breaks ties to even: 62 * 16.
        self.assertEqual(reference_size(1000, 500, 0), (992, 496))


class BuildReferenceImageTests(unittest.TestCase):
    def test_an_already_fitting_image_comes_back_unchanged(self):
        image = torch.rand(1, 48, 64, 3)
        out = build_reference_image(image)
        self.assertTrue(torch.equal(out, image))

    def test_it_returns_a_copy_not_the_input(self):
        # Two consumers must not be able to mutate each other's reference.
        image = torch.rand(1, 48, 64, 3)
        out = build_reference_image(image)
        out[0, 0, 0, 0] = 0.5
        self.assertNotEqual(float(image[0, 0, 0, 0]), 0.5)

    def test_a_large_image_is_downscaled_to_multiples_of_16(self):
        out = build_reference_image(torch.rand(1, 500, 1000, 3))
        _batch, height, width, channels = out.shape
        self.assertLessEqual(max(width, height), REFERENCE_MAX_EDGE)
        self.assertEqual((height % 16, width % 16), (0, 0))
        self.assertEqual(channels, 3)

    def test_the_batch_survives(self):
        out = build_reference_image(torch.rand(4, 500, 1000, 3))
        self.assertEqual(out.shape[0], 4)

    def test_a_non_bhwc_tensor_is_rejected_by_name(self):
        with self.assertRaises(ValueError) as caught:
            build_reference_image(torch.rand(48, 64, 3))
        self.assertIn("BHWC", str(caught.exception))


class ExtractBboxNormTests(unittest.TestCase):
    def setUp(self):
        self.canvas = torch.zeros(1, 1024, 2048, 3)
        self.mask = torch.zeros(1, 1024, 2048)

    def test_it_reads_the_recorded_bbox(self):
        stitcher = build_canvas_stitcher(
            self.canvas, self.mask, bbox=(0, 128, 1024, 896)
        )
        self.assertEqual(
            extract_bbox_norm(stitcher), [0.0, 128 / 1024, 0.5, 896 / 1024]
        )

    def test_it_falls_back_to_the_crop_rectangle(self):
        # A stitcher from before the bbox existed, or one from Crop For
        # Inpaint, still says where its region sits.
        stitcher = build_canvas_stitcher(self.canvas, self.mask)
        stitcher["crop_to_canvas"] = (256, 128, 1024, 768)
        self.assertEqual(
            extract_bbox_norm(stitcher),
            [256 / 2048, 128 / 1024, 1280 / 2048, 896 / 1024],
        )

    def test_source_bbox_alone_is_enough(self):
        stitcher = build_canvas_stitcher(self.canvas, self.mask)
        stitcher["source_bbox"] = (256, 128, 1280, 896)
        self.assertEqual(
            extract_bbox_norm(stitcher),
            [256 / 2048, 128 / 1024, 1280 / 2048, 896 / 1024],
        )

    def test_a_full_canvas_stitcher_reports_the_unit_square(self):
        self.assertEqual(
            extract_bbox_norm(build_canvas_stitcher(self.canvas, self.mask)),
            [0.0, 0.0, 1.0, 1.0],
        )

    def test_junk_falls_back_to_the_full_canvas(self):
        # The full frame is what an unpatched model already assumes, so a
        # bad stitcher degrades instead of raising mid-sample.
        for value in (None, {}, {"kind": "something else"}, "not a stitcher", 42):
            self.assertEqual(extract_bbox_norm(value), [0.0, 0.0, 1.0, 1.0])


class Krea2NodeContractTests(unittest.TestCase):
    def test_model_patch_contract(self):
        from nodes.node_krea2_model_patch import (
            NODE_CLASS_MAPPINGS,
            NODE_DISPLAY_NAME_MAPPINGS,
        )

        key = "AUSBOSS_NODES_Krea2OutpaintModelPatch"
        self.assertIn(key, NODE_CLASS_MAPPINGS)
        self.assertEqual(
            NODE_DISPLAY_NAME_MAPPINGS[key], "Krea 2 Outpaint Model Patch 🆎"
        )
        cls = NODE_CLASS_MAPPINGS[key]
        self.assertEqual(cls.CATEGORY, "🆎 AusBoss/Krea2")
        self.assertEqual(cls.RETURN_TYPES, ("MODEL",))
        required = cls.INPUT_TYPES()["required"]
        self.assertEqual(required["model"][0], "MODEL")
        self.assertEqual(required["stitcher"][0], "AUSBOSS_STITCHER")
        self.assertTrue(required["kv_cache"][1]["default"])

    def test_encode_contract(self):
        from nodes.node_krea2_encode import (
            NODE_CLASS_MAPPINGS,
            NODE_DISPLAY_NAME_MAPPINGS,
        )

        key = "AUSBOSS_NODES_Krea2Encode"
        self.assertIn(key, NODE_CLASS_MAPPINGS)
        self.assertEqual(NODE_DISPLAY_NAME_MAPPINGS[key], "Krea 2 Encode 🆎")
        cls = NODE_CLASS_MAPPINGS[key]
        self.assertEqual(cls.CATEGORY, "🆎 AusBoss/Krea2")
        self.assertEqual(cls.RETURN_TYPES, ("CONDITIONING", "CONDITIONING"))
        self.assertEqual(cls.RETURN_NAMES, ("positive", "negative"))
        # Everything but clip and prompt is optional, so the node drops into a
        # plain two-prompt graph with no VAE and no reference wired.
        self.assertEqual(set(cls.INPUT_TYPES()["required"]), {"clip", "prompt"})

    def test_encode_without_a_vae_skips_the_reference(self):
        from nodes.node_krea2_encode import NODE_CLASS_MAPPINGS

        class StubClip:
            def tokenize(self, text, **_kwargs):
                return {"text": text}

            def encode_from_tokens_scheduled(self, tokens):
                return [[tokens["text"], {}]]

        cls = NODE_CLASS_MAPPINGS["AUSBOSS_NODES_Krea2Encode"]
        positive, negative = cls().encode(
            StubClip(), "a house", "blurry", reference=torch.rand(1, 48, 64, 3)
        )
        self.assertEqual(positive[0][0], "a house")
        self.assertEqual(negative[0][0], "blurry")
        self.assertNotIn("reference_latents", positive[0][1])


if __name__ == "__main__":
    unittest.main()
