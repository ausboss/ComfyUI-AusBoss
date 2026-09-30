"""See-through parts of a picture are area to paint.

A cutout's see-through pixels store a colour nobody sees - black, or the old
background - and Image Crop + Rotate + Pad used to blend it over the fill:
an oval PNG reached the model with a dark ring round it, and Stitch Inpaint
pasted part of the ring back. Now a pixel less than 90% as solid as the
picture's most solid pixel is empty, like a corner a turn leaves: fill
colour in the canvas, white in the prompt view and in `original`, marked in
the mask, never pasted back. Every kept pixel is fully solid in its own
colour. A picture at least 90% solid everywhere goes through exactly as
before; OpaqueIdentityTests pins that against the transform as it was.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageFilter
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._inpaint_crop_helpers import (  # noqa: E402
    SEAM_BLEND_IN,
    apply_stitch,
    build_transform_stitcher,
    seam_plan,
)
from nodes._transform_engine import (  # noqa: E402
    TransformSpec,
    _geometry,
    _validate_source,
    fill_rgb,
    see_through_kept,
    transform_pil,
    transform_tensor_batch,
)
from nodes.node_image_crop_rotate_pad import AusBossImageCropRotatePad  # noqa: E402
from nodes.node_video_crop_rotate_pad import AusBossVideoCropRotatePad  # noqa: E402

COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")
if COMFY_ROOT:
    sys.path.append(COMFY_ROOT)
    sys.argv = sys.argv[:1]  # ComfyUI's argument parser reads sys.argv
    import comfy.cli_args  # noqa: E402

    # blend in checks for a cancel through comfy.model_management, which
    # would otherwise claim the GPU; these checks need none.
    comfy.cli_args.args.cpu = True


def reference_transform(image: Image.Image, spec: TransformSpec):
    """The transform as it was before see-through parts were painted: the
    source's alpha blended straight over the fill and the mask its inverse.
    Kept verbatim so a picture with no see-through part is held to it."""
    _validate_source(image)
    spec = spec.normalized()
    rgba = image.convert("RGBA")
    if spec.rotation_degrees == 0.0:
        rotated = rgba.copy()
    else:
        rotated = rgba.rotate(
            -spec.rotation_degrees,
            resample=Image.Resampling.BICUBIC,
            expand=True,
            fillcolor=(*fill_rgb(spec.fill_color), 0),
        )
    geometry = _geometry(rotated, spec)
    cropped = rotated.crop((
        geometry.crop_x,
        geometry.crop_y,
        geometry.crop_x + geometry.crop_width,
        geometry.crop_y + geometry.crop_height,
    ))
    alpha = cropped.getchannel("A")
    fill = fill_rgb(spec.fill_color)
    filled_crop = Image.new("RGB", cropped.size, fill)
    filled_crop.paste(cropped.convert("RGB"), mask=alpha)
    output = Image.new("RGB", (geometry.output_width, geometry.output_height), fill)
    output.paste(filled_crop, (geometry.pad_left, geometry.pad_top))
    mask = Image.new("L", output.size, 255)
    mask.paste(Image.fromarray(255 - np.asarray(alpha, dtype=np.uint8)), (geometry.pad_left, geometry.pad_top))
    if spec.feather > 0:
        original = np.asarray(mask, dtype=np.uint8)
        blurred = np.asarray(mask.filter(ImageFilter.GaussianBlur(spec.feather)), dtype=np.uint16)
        mask = Image.fromarray(np.maximum(original, np.minimum(blurred * 2, 255).astype(np.uint8)))
    return output, mask, geometry


def as_tensor(image: Image.Image) -> torch.Tensor:
    return torch.from_numpy(np.asarray(image, dtype=np.float32).copy() / 255.0).unsqueeze(0)


def run_node(source: Image.Image, *frames: Image.Image, **values):
    frames = frames or (source,)
    with patch("nodes.node_image_crop_rotate_pad.resolve_input_path", return_value=Path("source.png")), patch(
        "nodes.node_image_crop_rotate_pad.load_image_frames", return_value=[frame.copy() for frame in frames]
    ):
        return AusBossImageCropRotatePad().load_transform("source.png", **values)


LAYOUTS = {
    "as loaded": {},
    "padded": dict(pad_left=40, pad_top=12, pad_right=24, pad_bottom=6),
    "padded and feathered": dict(pad_left=32, pad_right=32, feather=24),
    "turned": dict(rotation_degrees=17.3),
    "turned, padded, feathered": dict(rotation_degrees=-9, pad_left=24, pad_right=40, feather=12),
    "turned, cropped and padded": dict(
        rotation_degrees=-18.1, crop_x=10, crop_y=6, crop_width=60, crop_height=50,
        pad_left=30, pad_top=20, pad_right=30, pad_bottom=20, feather=8,
    ),
    "ratio and multiple": dict(crop_aspect_ratio="16:9", canvas_multiple=32, pad_left=10),
    "black fill, turned 90": dict(rotation_degrees=90, pad_top=12, fill_color="#000000", feather=6),
    "stitch settings": dict(pad_bottom=30, stitch_blend=8, stitch_grow=-3, feather=10),
}


def opaque_sources():
    rng = np.random.default_rng(5)
    colours = rng.integers(0, 256, (72, 96, 3), dtype=np.uint8)
    yield "RGB photo", Image.fromarray(colours)
    yield "RGBA, alpha 255", Image.fromarray(np.dstack([colours, np.full((72, 96), 255, np.uint8)]), "RGBA")
    # Generated pictures often carry alpha 249-254 in places; at least 90%
    # solid everywhere means nothing is see-through and nothing changes.
    noise = rng.integers(249, 256, (72, 96), dtype=np.uint8)
    yield "RGBA, alpha 249-255", Image.fromarray(np.dstack([colours, noise]), "RGBA")
    edge = np.full((72, 96), 255, np.uint8)
    edge[:, :3] = 230  # exactly 90% solid: still kept
    yield "RGBA, edge at 90%", Image.fromarray(np.dstack([colours, edge]), "RGBA")


class OpaqueIdentityTests(unittest.TestCase):
    """A picture with no see-through part comes out exactly as before."""

    def test_the_transform_matches_the_old_one_bit_for_bit(self):
        for source_name, source in opaque_sources():
            for layout_name, layout in LAYOUTS.items():
                spec = TransformSpec(**{k: v for k, v in layout.items() if not k.startswith("stitch")})
                with self.subTest(source=source_name, layout=layout_name):
                    output, mask, geometry = transform_pil(source, spec)
                    old_output, old_mask, old_geometry = reference_transform(source, spec)
                    self.assertEqual(geometry, old_geometry)
                    self.assertEqual(output.tobytes(), old_output.tobytes())
                    self.assertEqual(mask.tobytes(), old_mask.tobytes())

    def test_every_node_output_matches_the_old_one(self):
        model = torch.from_numpy(np.random.default_rng(9).random((1, 200, 200, 3), dtype=np.float32))
        for source_name, source in opaque_sources():
            for layout_name, layout in LAYOUTS.items():
                with self.subTest(source=source_name, layout=layout_name):
                    image, mask, stitcher, original, width, height, prompt_image = run_node(source, **layout)
                    spec = TransformSpec(**{k: v for k, v in layout.items() if not k.startswith("stitch")})
                    old_output, old_mask, geometry = reference_transform(source, spec)
                    old_image, old_mask = as_tensor(old_output), as_tensor(old_mask)
                    old_stitcher = build_transform_stitcher(
                        old_image, old_mask, geometry, layout.get("stitch_blend", 32), layout.get("stitch_grow", 0)
                    )
                    self.assertTrue(torch.equal(image, old_image))
                    self.assertTrue(torch.equal(mask, old_mask))
                    self.assertEqual((width, height), (old_output.width, old_output.height))
                    for key in ("canvas", "blend", "generated"):
                        self.assertTrue(torch.equal(stitcher[key], old_stitcher[key]), key)
                    for key in ("source_bbox", "bbox_normalized", "canvas_to_original", "crop_to_canvas"):
                        self.assertEqual(stitcher[key], old_stitcher[key], key)
                    result = model[:, :height, :width].clone()
                    for seam, match in (("classic", 0.0), ("classic", 1.0), (SEAM_BLEND_IN, 0.0), (SEAM_BLEND_IN, 1.0)):
                        self.assertTrue(torch.equal(
                            apply_stitch(stitcher, result, color_match=match, seam=seam),
                            apply_stitch(old_stitcher, result, color_match=match, seam=seam),
                        ), (seam, match))
                    old_original = torch.from_numpy(np.asarray(source.convert("RGB"), dtype=np.float32).copy() / 255.0)
                    self.assertTrue(torch.equal(original[0], old_original))
                    self.assertTrue(torch.equal(prompt_image, image))

    def test_the_video_frame_node_is_unchanged(self):
        for source_name, source in opaque_sources():
            with self.subTest(source=source_name):
                with patch("nodes.node_video_crop_rotate_pad.resolve_video_path", return_value=Path("v.mp4")), patch(
                    "nodes.node_video_crop_rotate_pad.decode_video_frame", return_value=(source.copy(), 0, 0)
                ):
                    outputs = AusBossVideoCropRotatePad().load_transform(
                        "v.mp4", "input folder", "", "frame index", 0, 0, rotation_degrees=11, pad_left=20, feather=8
                    )
                old_output, old_mask, _ = reference_transform(source, TransformSpec(rotation_degrees=11, pad_left=20, feather=8))
                self.assertEqual(len(outputs), 6)
                self.assertTrue(torch.equal(outputs[0], as_tensor(old_output)))
                self.assertTrue(torch.equal(outputs[1], as_tensor(old_mask)))


GREEN = (20, 190, 60)
HIDDEN = (255, 0, 0)  # what a see-through pixel stores: never seen, never pasted


def cutout(width=96, height=72, alpha=None):
    """A green picture whose see-through pixels (below 90% of the most solid
    one) store pure red."""
    if alpha is None:
        alpha = np.zeros((height, width), np.uint8)
        alpha[14:58, 20:76] = 255
    rgb = np.empty((height, width, 3), np.uint8)
    rgb[:] = GREEN
    rgb[alpha.astype(np.int32) * 100 < int(alpha.max()) * 90] = HIDDEN
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


class SeeThroughRuleTests(unittest.TestCase):
    def test_ninety_percent_of_the_most_solid_pixel_is_kept(self):
        alpha = np.array([[0, 25, 128, 229, 230, 254, 255]], np.uint8)
        kept = see_through_kept(Image.fromarray(np.dstack([np.zeros((1, 7, 3), np.uint8), alpha]), "RGBA"))
        self.assertEqual(kept.tolist(), [[False, False, False, False, True, True, True]])
        # Measured against the most solid pixel: here 200, so 180 stays.
        alpha = np.array([[0, 100, 179, 180, 200]], np.uint8)
        kept = see_through_kept(Image.fromarray(np.dstack([np.zeros((1, 5, 3), np.uint8), alpha]), "RGBA"))
        self.assertEqual(kept.tolist(), [[False, False, False, True, True]])

    def test_a_picture_without_see_through_parts_is_left_alone(self):
        self.assertIsNone(see_through_kept(Image.new("RGB", (4, 4))))
        self.assertIsNone(see_through_kept(Image.new("RGBA", (4, 4), (1, 2, 3, 255))))
        self.assertIsNone(see_through_kept(Image.new("RGBA", (4, 4), (1, 2, 3, 230))))
        self.assertIsNotNone(see_through_kept(Image.new("RGBA", (4, 4), (1, 2, 3, 229))))

    def test_see_through_pixels_become_fill_and_area_to_paint(self):
        alpha = np.zeros((8, 10), np.uint8)
        alpha[:, 5:] = 255
        alpha[0, :5] = (10, 100, 200, 229, 230)  # the last one is kept
        image, mask, _, _, _, _, _ = run_node(cutout(10, 8, alpha), feather=0)
        see_through = torch.from_numpy(alpha < 230)
        fill = torch.tensor(fill_rgb("#808080"), dtype=torch.float32) / 255
        self.assertTrue(torch.equal(image[0][see_through], fill.expand(int(see_through.sum()), 3)))
        self.assertTrue(bool((mask[0][see_through] == 1).all()))
        kept = ~see_through
        # Kept pixels are fully solid in their stored colour, 90% or 100%.
        stored = torch.from_numpy(np.asarray(cutout(10, 8, alpha).convert("RGB"), dtype=np.float32) / 255)
        self.assertTrue(torch.equal(image[0][kept], stored[kept]))
        self.assertTrue(bool((mask[0][kept] == 0).all()))

    def test_the_hidden_colour_never_reaches_the_canvas(self):
        # Soft edges: the see-through ramp stores red at every alpha below 90%.
        alpha = np.asarray(Image.fromarray(np.asarray(cutout().getchannel("A"))).filter(ImageFilter.GaussianBlur(6)))
        source = cutout(alpha=alpha)
        for name, layout in LAYOUTS.items():
            with self.subTest(layout=name):
                image, _, stitcher, *_ = run_node(source, **layout)
                fill = fill_rgb(layout.get("fill_color", "#808080"))
                # Green and the fill mix at turned edges; red above both can
                # only come from the hidden colour.
                ceiling = max(fill[0], GREEN[0]) + 0.5
                self.assertLessEqual(float(image[..., 0].max()) * 255, ceiling)
                self.assertLessEqual(float(stitcher["canvas"][..., 0].max()) * 255, ceiling)

    def test_stitch_inpaint_never_pastes_see_through_parts_back(self):
        alpha = np.asarray(Image.fromarray(np.asarray(cutout().getchannel("A"))).filter(ImageFilter.GaussianBlur(4)))
        source = cutout(alpha=alpha)
        see_through = torch.from_numpy(alpha.astype(np.int32) * 100 < 255 * 90)
        self.assertTrue(bool(see_through.any()))
        for blend in (0, 32):
            image, mask, stitcher, *_ = run_node(source, feather=12, stitch_blend=blend)
            model = torch.zeros_like(image)
            model[..., 0] = 1.0
            model[..., 2] = 1.0
            for seam, match in (("classic", 0.0), ("classic", 1.0), (SEAM_BLEND_IN, 0.0), (SEAM_BLEND_IN, 1.0)):
                with self.subTest(blend=blend, seam=seam, match=match):
                    out = apply_stitch(stitcher, model, color_match=match, seam=seam)[0][see_through]
                    if seam == SEAM_BLEND_IN and match == 0:
                        # New area: the model's pixels, bit for bit.
                        self.assertTrue(torch.equal(out, model[0][see_through]))
                    elif blend == 0 and match == 0:
                        self.assertTrue(torch.allclose(out, model[0][see_through], atol=1e-6))
                    elif match == 0:
                        # Whatever share the canvas keeps there is the fill,
                        # never the stored red: magenta keeps its green at 0.
                        self.assertLess(float(out[:, 1].max()), 0.01)
            # blend in reads the see-through parts as new area.
            plan = seam_plan(stitcher)
            self.assertTrue(bool((plan["depth"][0][see_through] < 0).all()))

    def test_what_a_see_through_pixel_stores_changes_nothing(self):
        # The same cutout twice, its see-through pixels storing red in one
        # and blue in the other: every output and every stitch is the same.
        alpha = np.asarray(Image.fromarray(np.asarray(cutout().getchannel("A"))).filter(ImageFilter.GaussianBlur(5)))
        red = cutout(alpha=alpha)
        blue_rgb = np.array(red)
        blue_rgb[alpha.astype(np.int32) * 100 < 255 * 90, :3] = (0, 0, 255)
        blue = Image.fromarray(blue_rgb, "RGBA")
        model = torch.from_numpy(np.random.default_rng(2).random((1, 72, 150, 3), dtype=np.float32))
        for name, layout in LAYOUTS.items():
            with self.subTest(layout=name):
                a, b = run_node(red, **layout), run_node(blue, **layout)
                for index in (0, 1, 3, 6):
                    self.assertTrue(torch.equal(a[index], b[index]), index)
                self.assertTrue(torch.equal(a[2]["canvas"], b[2]["canvas"]))
                result = model[:, : a[5], : a[4]].clone()
                if result.shape[1:3] != a[0].shape[1:3]:
                    result = torch.rand_like(a[0])
                for seam, match in (("classic", 1.0), (SEAM_BLEND_IN, 1.0)):
                    self.assertTrue(torch.equal(
                        apply_stitch(a[2], result, color_match=match, seam=seam),
                        apply_stitch(b[2], result, color_match=match, seam=seam),
                    ))

    def test_a_hole_in_the_middle_is_painted(self):
        alpha = np.full((80, 100), 255, np.uint8)
        yy, xx = np.mgrid[:80, :100]
        hole = (yy - 40) ** 2 / 15**2 + (xx - 50) ** 2 / 22**2 <= 1
        alpha[hole] = 0
        image, mask, stitcher, original, _, _, prompt_image = run_node(cutout(100, 80, alpha), feather=6, stitch_blend=4)
        hole_t = torch.from_numpy(hole)
        self.assertTrue(bool((mask[0][hole_t] == 1).all()))
        self.assertTrue(bool((prompt_image[0][hole_t] == 1).all()))
        self.assertTrue(bool((original[0][hole_t] == 1).all()))
        model = torch.full_like(image, 0.25)
        plan = seam_plan(stitcher)
        kept = {
            "classic": stitcher["blend"][0] == 0,
            SEAM_BLEND_IN: plan["depth"][0] >= max(plan["tone"][1], plan["detail"][1]),
        }
        for seam in ("classic", SEAM_BLEND_IN):
            with self.subTest(seam=seam):
                out = apply_stitch(stitcher, model, seam=seam)
                self.assertTrue(torch.allclose(out[0][hole_t], model[0][hole_t], atol=1e-6))
                # The picture around the hole comes back as it was.
                self.assertTrue(bool(kept[seam].any()))
                self.assertTrue(torch.equal(out[0][kept[seam]], image[0][kept[seam]]))

    def test_a_turned_cutout_marks_both_kinds_of_empty(self):
        source = cutout()
        image, mask, stitcher, original, width, height, prompt_image = run_node(
            source, rotation_degrees=17, pad_left=30, pad_right=30, feather=0
        )
        fill = torch.tensor(fill_rgb("#808080"), dtype=torch.float32) / 255
        # The padding and the corners the turn opens keep the fill in the
        # prompt view; the picture's see-through parts show white.
        self.assertTrue(torch.equal(prompt_image[0, :, :30], image[0, :, :30]))
        self.assertTrue(torch.equal(prompt_image[0, :, -30:], image[0, :, -30:]))
        self.assertTrue(torch.allclose(prompt_image[0, 0, 32], fill, atol=0.5 / 255))
        self.assertTrue(torch.allclose(prompt_image[0, -1, -33], fill, atol=0.5 / 255))
        white = (prompt_image[0] == 1).all(dim=-1)
        self.assertGreater(int(white.sum()), 500)
        # Fully see-through pixels: fill in the canvas, area to paint.
        self.assertTrue(bool(((image[0][white] - fill).abs() < 0.5 / 255).all()))
        self.assertTrue(bool((mask[0][white] == 1).all()))
        # The picture itself is the same in both.
        solid = mask[0] == 0
        self.assertTrue(torch.equal(prompt_image[0][solid], image[0][solid]))
        # And the hidden red is nowhere.
        self.assertLessEqual(float(image[..., 0].max()) * 255, 128.5)
        self.assertLessEqual(float(prompt_image[0][~white][:, 0].max()) * 255, 255)
        self.assertLess(float((prompt_image[..., 0] - prompt_image[..., 1]).max()), 0.01)

    def test_a_picture_faded_throughout_is_kept_whole(self):
        alpha = np.full((40, 60), 128, np.uint8)
        alpha[:, :4] = 0
        image, mask, _, original, _, _, prompt_image = run_node(cutout(60, 40, alpha), feather=0)
        self.assertTrue(bool((mask[0][:, 4:] == 0).all()))
        self.assertTrue(bool((mask[0][:, :4] == 1).all()))
        green = torch.tensor(GREEN, dtype=torch.float32) / 255
        self.assertTrue(torch.allclose(image[0][:, 4:], green.expand(40, 56, 3)))
        self.assertTrue(torch.allclose(original[0][:, 4:], green.expand(40, 56, 3)))
        self.assertTrue(bool((original[0][:, :4] == 1).all()))

    def test_a_fully_see_through_picture_is_all_paint(self):
        image, mask, stitcher, original, _, _, prompt_image = run_node(cutout(30, 20, np.zeros((20, 30), np.uint8)), pad_left=10)
        self.assertTrue(bool((mask == 1).all()))
        fill = torch.tensor(fill_rgb("#808080"), dtype=torch.float32) / 255
        self.assertTrue(torch.equal(image[0], fill.expand(20, 40, 3)))
        self.assertTrue(bool((prompt_image[0][:, 10:] == 1).all()))
        self.assertTrue(torch.equal(prompt_image[0][:, :10], image[0][:, :10]))
        self.assertTrue(bool((original == 1).all()))
        model = torch.rand_like(image)
        self.assertTrue(torch.equal(apply_stitch(stitcher, model, seam=SEAM_BLEND_IN), model))

    def test_each_frame_follows_its_own_alpha(self):
        solid = Image.new("RGBA", (40, 30), (*GREEN, 255))
        alpha = np.full((30, 40), 255, np.uint8)
        alpha[:, :10] = 0
        image, mask, _, original, _, _, prompt_image = run_node(solid, solid, cutout(40, 30, alpha), pad_left=8)
        self.assertTrue(torch.equal(prompt_image[0], image[0]))
        self.assertTrue(bool((prompt_image[1][:, 8:18] == 1).all()))
        self.assertTrue(bool((mask[1][:, 8:18] == 1).all()))
        self.assertTrue(bool((mask[0][:, 8:] == 0).all()))
        self.assertTrue(bool((original[1][:, :10] == 1).all()))

    def test_a_four_channel_batch_follows_the_same_rule(self):
        array = np.asarray(cutout(), dtype=np.float32) / 255
        output, mask, _ = transform_tensor_batch(torch.from_numpy(array).unsqueeze(0), TransformSpec())
        see_through = torch.from_numpy(np.asarray(cutout().getchannel("A")) < 230)
        self.assertTrue(bool((mask[0][see_through] == 1).all()))
        self.assertLessEqual(float(output[..., 0].max()) * 255, 128.5)

    @unittest.skipUnless(COMFY_ROOT, "Set AUSBOSS_COMFY_ROOT for core resize integration")
    def test_the_prompt_image_follows_the_resize(self):
        alpha = np.full((96, 128), 255, np.uint8)
        alpha[:, :40] = 0
        source = cutout(128, 96, alpha)
        image, mask, _, _, width, height, prompt_image = run_node(
            source, pad_right=32, resize_to_megapixels=True, megapixels=0.03, resolution_steps=8
        )
        self.assertEqual(tuple(prompt_image.shape), tuple(image.shape))
        # Well clear of the see-through band the two are the same picture.
        right = int(width * 0.45)
        self.assertLess(float((prompt_image[0, :, right:] - image[0, :, right:]).abs().max()), 1e-6)
        self.assertGreater(float(prompt_image[0, :, : int(width * 0.2)].min()), 0.98)


if __name__ == "__main__":
    unittest.main()
