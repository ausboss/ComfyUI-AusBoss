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
    fill_reference_holes,
    placement_warning,
    reference_size,
    snap16,
    source_pixel_bbox,
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


class FillReferenceHolesTests(unittest.TestCase):
    """AnyPaint was trained with the new area of its reference in the
    picture's own median colour. A gray pad next to a dark picture is not
    that, and the model paints it back as a gray frame."""

    def dark_canvas(self):
        # A dark teal picture on the left, the gray pad on the right.
        image = torch.full((1, 48, 96, 3), 0.5)
        image[:, :, :64] = torch.tensor([0.1, 0.2, 0.25])
        image[:, :4, :8] = torch.tensor([0.9, 0.9, 0.9])  # a highlight
        mask = torch.zeros(1, 48, 96)
        mask[:, :, 64:] = 1.0
        return image, mask

    def test_the_new_area_takes_the_median_of_the_picture(self):
        image, mask = self.dark_canvas()
        out = fill_reference_holes(image, mask)
        expected = torch.tensor([0.1, 0.2, 0.25])
        self.assertTrue(torch.allclose(out[0, :, 64:], expected.expand(48, 32, 3)))

    def test_the_picture_itself_is_untouched(self):
        image, mask = self.dark_canvas()
        out = fill_reference_holes(image, mask)
        self.assertTrue(torch.equal(out[:, :, :64], image[:, :, :64]))

    def test_it_returns_a_copy(self):
        image, mask = self.dark_canvas()
        out = fill_reference_holes(image, mask)
        self.assertEqual(float(image[0, 0, 80, 0]), 0.5)
        self.assertIsNot(out, image)

    def test_a_feathered_edge_below_half_stays_picture(self):
        # The pad mask ramps a few pixels into the picture; only the part
        # above 0.5 is new area.
        image, mask = self.dark_canvas()
        mask[:, :, 60:64] = 0.4
        out = fill_reference_holes(image, mask)
        self.assertTrue(torch.equal(out[:, :, 60:64], image[:, :, 60:64]))

    def test_nothing_marked_changes_nothing(self):
        image, _mask = self.dark_canvas()
        out = fill_reference_holes(image, torch.zeros(1, 48, 96))
        self.assertTrue(torch.equal(out, image))

    def test_everything_marked_falls_back_to_mid_gray(self):
        image, _mask = self.dark_canvas()
        out = fill_reference_holes(image, torch.ones(1, 48, 96))
        self.assertTrue(torch.allclose(out, torch.full_like(image, 0.5)))

    def test_a_mask_of_another_size_is_fitted(self):
        image, _mask = self.dark_canvas()
        small = torch.zeros(1, 24, 48)
        small[:, :, 32:] = 1.0
        out = fill_reference_holes(image, small)
        expected = torch.tensor([0.1, 0.2, 0.25])
        self.assertTrue(torch.allclose(out[0, :, 66:], expected.expand(48, 30, 3)))

    def test_a_plain_hw_mask_serves_the_whole_batch(self):
        image, mask = self.dark_canvas()
        batch = torch.cat([image, image * 0.5])
        out = fill_reference_holes(batch, mask[0])
        self.assertTrue(torch.allclose(out[0, 0, 90], torch.tensor([0.1, 0.2, 0.25])))
        self.assertTrue(torch.allclose(out[1, 0, 90], torch.tensor([0.05, 0.1, 0.125])))

    def test_junk_is_rejected_by_name(self):
        image, mask = self.dark_canvas()
        with self.assertRaises(ValueError):
            fill_reference_holes(image[0], mask)
        with self.assertRaises(ValueError):
            fill_reference_holes(image, "mask")


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


class PlacementWarningTests(unittest.TestCase):
    """The reference implementation spans one whole canvas axis and splits
    anything else into two passes. One pass on a two-axis canvas is outside
    what the weights do, so it has to be said out loud."""

    def stitcher(self, canvas_w, canvas_h, bbox):
        canvas = torch.zeros(1, canvas_h, canvas_w, 3)
        mask = torch.zeros(1, canvas_h, canvas_w)
        return build_canvas_stitcher(canvas, mask, bbox=bbox)

    def test_a_horizontal_extend_is_fine(self):
        # Source spans the full height: pad left and right only.
        s = self.stitcher(1416, 1024, (231, 0, 1255, 1024))
        self.assertIsNone(placement_warning(s))

    def test_a_vertical_extend_is_fine(self):
        # Source spans the full width: pad top and bottom only.
        s = self.stitcher(720, 1568, (0, 0, 720, 1280))
        self.assertIsNone(placement_warning(s))

    def test_padding_both_axes_warns(self):
        s = self.stitcher(864, 1760, (29, 0, 833, 1429))
        message = placement_warning(s)
        self.assertIsNotNone(message)
        self.assertIn("BOTH", message)
        self.assertIn("60px spare width", message)    # 864 - (833 - 29)
        self.assertIn("331px spare height", message)  # 1760 - 1429

    def test_a_rounding_sliver_still_warns(self):
        # Padded only at the bottom, but canvas_multiple rounded the width up
        # by 11px. A sliver breaks the span exactly like a deliberate pad does,
        # which is the trap the message has to name.
        s = self.stitcher(832, 1792, (0, 0, 821, 1459))
        message = placement_warning(s)
        self.assertIsNotNone(message)
        self.assertIn("canvas multiple", message)

    def test_a_sliver_inside_the_tolerance_is_ignored(self):
        s = self.stitcher(728, 1568, (0, 0, 720, 1280))  # 8px spare width
        self.assertIsNone(placement_warning(s))

    def test_the_message_stays_ascii(self):
        # Import-time and console output on a cp1252 Windows console.
        s = self.stitcher(864, 1760, (29, 0, 833, 1429))
        placement_warning(s).encode("ascii")

    def test_no_bbox_means_no_opinion(self):
        canvas = torch.zeros(1, 64, 64, 3)
        plain = build_canvas_stitcher(canvas, torch.zeros(1, 64, 64))
        self.assertIsNone(placement_warning(plain))
        for junk in (None, {}, {"kind": "other"}, 7):
            self.assertIsNone(placement_warning(junk))

    def test_source_pixel_bbox_rebuilds_from_normalized_only(self):
        canvas = torch.zeros(1, 1024, 1416, 3)
        s = build_canvas_stitcher(canvas, torch.zeros(1, 1024, 1416), bbox=(231, 0, 1255, 1024))
        del s["source_bbox"]
        self.assertEqual(source_pixel_bbox(s), (231, 0, 1255, 1024, 1416, 1024))


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

    def encode_with_stubs(self, **kwargs):
        """Run the encode with a stub CLIP, VAE and node_helpers; return what
        the vision tower and the VAE were handed."""
        from nodes import node_krea2_encode as module

        seen = {"vision": [], "vae": []}

        class StubClip:
            def tokenize(self, text, images=None, **_kwargs):
                if images:
                    seen["vision"].extend(images)
                return {"text": text}

            def encode_from_tokens_scheduled(self, tokens):
                return [[tokens["text"], {}]]

        class StubVae:
            def encode(self, pixels):
                seen["vae"].append(pixels)
                return torch.zeros(1, 16, pixels.shape[1] // 8, pixels.shape[2] // 8)

        class StubHelpers:
            @staticmethod
            def conditioning_set_values(conditioning, values, append=False):
                return [[text, {**extra, **values}] for text, extra in conditioning]

        saved = module.node_helpers
        module.node_helpers = StubHelpers
        try:
            module.NODE_CLASS_MAPPINGS["AUSBOSS_NODES_Krea2Encode"]().encode(
                StubClip(), "a room", vae=StubVae(), vlm_reference=True, **kwargs
            )
        finally:
            module.node_helpers = saved
        return seen

    def test_a_wired_mask_refills_the_reference_for_the_vae_and_the_vision_tower(self):
        canvas = torch.full((1, 48, 96, 3), 0.5)
        canvas[:, :, :64] = torch.tensor([0.1, 0.2, 0.25])
        mask = torch.zeros(1, 48, 96)
        mask[:, :, 64:] = 1.0
        seen = self.encode_with_stubs(reference=canvas, mask=mask)
        dark = torch.tensor([0.1, 0.2, 0.25])
        self.assertTrue(torch.allclose(seen["vision"][0][0, 10, 90], dark))
        self.assertTrue(torch.allclose(seen["vae"][0][0, 10, 90], dark))
        # The canvas the rest of the graph uses keeps its gray.
        self.assertEqual(float(canvas[0, 10, 90, 0]), 0.5)

    def test_without_a_mask_the_reference_is_used_as_given(self):
        canvas = torch.full((1, 48, 96, 3), 0.5)
        canvas[:, :, :64] = 0.1
        seen = self.encode_with_stubs(reference=canvas)
        self.assertTrue(torch.allclose(seen["vae"][0][0, 10, 90], torch.full((3,), 0.5)))
        self.assertTrue(torch.allclose(seen["vision"][0][0, 10, 90], torch.full((3,), 0.5)))

    def test_the_mask_is_the_last_optional_input(self):
        # Saved workflows keep links by slot: a new input only goes at the end.
        from nodes.node_krea2_encode import NODE_CLASS_MAPPINGS

        optional = list(NODE_CLASS_MAPPINGS["AUSBOSS_NODES_Krea2Encode"].INPUT_TYPES()["optional"])
        self.assertEqual(optional[-1], "mask")
        self.assertEqual(
            optional[:-1], ["negative_prompt", "vae", "reference", "extra_image", "vlm_reference"]
        )


if __name__ == "__main__":
    unittest.main()
