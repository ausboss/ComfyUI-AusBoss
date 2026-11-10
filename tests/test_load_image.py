"""Load Image: the size plan as numbers, and the node on real files."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _media_helpers  # noqa: E402
from nodes._load_image_helpers import (  # noqa: E402
    SIZE_MODES,
    apply_load_size,
    plan_load_size,
)
from nodes.node_load_image import (  # noqa: E402
    NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS,
    AusBossLoadImage,
)

TABLE = ROOT / "tests" / "fixtures" / "load_size_cases.json"


class PlanTests(unittest.TestCase):
    def test_the_table_the_browser_is_held_to_is_what_the_planner_gives(self):
        table = json.loads(TABLE.read_text(encoding="utf-8"))
        self.assertGreater(len(table["rows"]), 200)
        for row in table["rows"]:
            source_w, source_h, size, megapixels, longest_side, scale, width, height, multiple, enlarge = row[:10]
            plan = plan_load_size(source_w, source_h, size, megapixels, longest_side, scale, width, height, multiple, enlarge)
            got = [plan["resize_width"], plan["resize_height"], plan["crop_x"], plan["crop_y"], plan["width"], plan["height"]]
            self.assertEqual(got, row[10:], row[:10])

    def test_off_gives_the_picture_back_whatever_else_is_set(self):
        plan = plan_load_size(913, 1631, "off", megapixels=4.0, multiple=64, enlarge=False)
        self.assertEqual((plan["width"], plan["height"], plan["crop_x"], plan["crop_y"]), (913, 1631, 0, 0))

    def test_each_choice_keeps_its_promise(self):
        plan = plan_load_size(912, 1632, "megapixels", megapixels=2.0, multiple=1)
        self.assertAlmostEqual(plan["width"] * plan["height"] / 1e6, 2.0, delta=0.01)
        self.assertAlmostEqual(plan["width"] / plan["height"], 912 / 1632, delta=0.002)
        plan = plan_load_size(912, 1632, "longest side", longest_side=2048, multiple=1)
        self.assertEqual((plan["width"], plan["height"]), (1144, 2048))
        plan = plan_load_size(1920, 1080, "longest side", longest_side=1280, multiple=1)
        self.assertEqual((plan["width"], plan["height"]), (1280, 720))
        plan = plan_load_size(1920, 1080, "scale", scale=0.5, multiple=1)
        self.assertEqual((plan["width"], plan["height"]), (960, 540))
        plan = plan_load_size(1920, 1080, "fit inside", width=1024, height=1024, multiple=1)
        self.assertEqual((plan["width"], plan["height"]), (1024, 576))
        plan = plan_load_size(1920, 1080, "crop to fill", width=1024, height=1024, multiple=1)
        self.assertEqual((plan["width"], plan["height"]), (1024, 1024))
        self.assertEqual((plan["resize_width"], plan["resize_height"]), (1821, 1024))
        self.assertEqual((plan["crop_x"], plan["crop_y"]), (398, 0))

    def test_round_to_gives_multiples_and_fit_inside_stays_in_its_box(self):
        for size in SIZE_MODES[1:]:
            plan = plan_load_size(1000, 777, size, megapixels=1.3, longest_side=1111, scale=1.37, width=900, height=700, multiple=64)
            self.assertEqual((plan["width"] % 64, plan["height"] % 64), (0, 0), size)
        plan = plan_load_size(1920, 1080, "fit inside", width=1000, height=1000, multiple=64)
        self.assertLessEqual(plan["width"], 1000)
        self.assertLessEqual(plan["height"], 1000)

    def test_with_enlarge_off_nothing_comes_out_bigger_than_the_file(self):
        for size in SIZE_MODES[1:]:
            for multiple in (1, 8, 16):
                plan = plan_load_size(640, 480, size, megapixels=4.0, longest_side=4096, scale=3.0, width=2048, height=2048, multiple=multiple, enlarge=False)
                self.assertLessEqual(plan["width"], 640, (size, multiple))
                self.assertLessEqual(plan["height"], 480, (size, multiple))
                self.assertLessEqual(plan["resize_width"], 640, (size, multiple))
        # Crop to fill still gives the box's shape, cut from the file as it is.
        plan = plan_load_size(800, 600, "crop to fill", width=1024, height=1024, multiple=1, enlarge=False)
        self.assertEqual((plan["width"], plan["height"], plan["resize_width"], plan["resize_height"], plan["crop_x"]), (600, 600, 800, 600, 100))
        # A picture that is big enough is resized as usual.
        plan = plan_load_size(4000, 3000, "longest side", longest_side=1024, multiple=1, enlarge=False)
        self.assertEqual((plan["width"], plan["height"]), (1024, 768))

    def test_bad_input_is_named(self):
        with self.assertRaisesRegex(ValueError, "size must be one of"):
            plan_load_size(100, 100, "stretch")
        with self.assertRaisesRegex(ValueError, "larger than 0x0"):
            plan_load_size(0, 100, "off")

    def test_a_plan_that_changes_nothing_hands_the_same_tensors_back(self):
        image, mask = torch.rand(1, 20, 30, 3), torch.zeros(1, 20, 30)
        out_image, out_mask = apply_load_size(image, mask, plan_load_size(30, 20, "off"), "lanczos")
        self.assertIs(out_image, image)
        self.assertIs(out_mask, mask)


class NodeTests(unittest.TestCase):
    def setUp(self):
        # The temp folder stands in for ComfyUI's input folder.
        self.folder = tempfile.mkdtemp(prefix="ausboss_load_image_")
        self.addCleanup(shutil.rmtree, self.folder, True)
        stand_in = SimpleNamespace(
            get_input_directory=lambda: self.folder,
            get_annotated_filepath=lambda name: os.path.join(self.folder, name),
        )
        patcher = patch.object(_media_helpers, "folder_paths", stand_in)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, name="pic.png", width=96, height=64, mode="RGB"):
        path = Path(self.folder) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        values = np.zeros((height, width, 4), dtype=np.uint8)
        values[..., 0] = np.linspace(0, 255, width, dtype=np.uint8)[None, :]
        values[..., 1] = np.linspace(0, 255, height, dtype=np.uint8)[:, None]
        values[..., 2] = 90
        values[..., 3] = 255
        values[: height // 2, : width // 2, 3] = 0  # the top left quarter is see-through
        Image.fromarray(values).convert(mode).save(path)
        return name

    def run_node(self, name, **values):
        return AusBossLoadImage().load(name, **values)

    def test_the_node_is_registered_under_its_permanent_key(self):
        self.assertIs(NODE_CLASS_MAPPINGS["AUSBOSS_NODES_LoadImage"], AusBossLoadImage)
        self.assertEqual(NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_LoadImage"], "Load Image \U0001f18e")
        spec = AusBossLoadImage.INPUT_TYPES()
        self.assertEqual(
            list(spec["required"]),
            ["image", "size", "megapixels", "longest_side", "scale", "width", "height", "multiple", "method", "enlarge"],
        )
        self.assertEqual(spec["required"]["size"][0], list(SIZE_MODES))
        self.assertEqual(spec["required"]["size"][1]["default"], "off")
        self.assertEqual(len(AusBossLoadImage.RETURN_TYPES), len(AusBossLoadImage.RETURN_NAMES))
        self.assertEqual(len(AusBossLoadImage.RETURN_TYPES), len(AusBossLoadImage.OUTPUT_TOOLTIPS))
        for name, (_, options) in spec["required"].items():
            self.assertTrue(options.get("tooltip"), name)

    def test_with_size_off_the_file_comes_out_as_it_is(self):
        name = self.write()
        image, mask, width, height, filename, original_w, original_h = self.run_node(name)
        self.assertEqual(tuple(image.shape), (1, 64, 96, 3))
        self.assertEqual(tuple(mask.shape), (1, 64, 96))
        self.assertEqual((width, height, original_w, original_h), (96, 64, 96, 64))
        self.assertEqual(filename, "pic")
        wanted = np.asarray(Image.open(Path(self.folder) / name).convert("RGB"), dtype=np.float32) / 255.0
        self.assertTrue(np.array_equal(image[0].numpy(), wanted), "every pixel as the file has it")
        self.assertEqual(float(mask.max()), 0.0, "no transparency: an all black mask")

    def test_a_see_through_picture_gives_its_mask_the_way_the_stock_loader_does(self):
        name = self.write("cut.png", mode="RGBA")
        _, mask, *_ = self.run_node(name)
        self.assertEqual(float(mask[0, 5, 5]), 1.0, "see-through is white")
        self.assertEqual(float(mask[0, 60, 90]), 0.0, "solid is black")

    def test_every_size_choice_gives_the_planned_size_for_picture_and_mask(self):
        name = self.write("cut.png", mode="RGBA")
        for size in SIZE_MODES[1:]:
            with self.subTest(size=size):
                values = {"megapixels": 0.02, "longest_side": 160, "scale": 1.5, "width": 80, "height": 80, "multiple": 8}
                image, mask, width, height, _, original_w, original_h = self.run_node(name, size=size, **values)
                plan = plan_load_size(96, 64, size, **values)
                self.assertEqual((width, height), (plan["width"], plan["height"]))
                self.assertEqual(tuple(image.shape), (1, height, width, 3))
                self.assertEqual(tuple(mask.shape), (1, height, width))
                self.assertEqual((original_w, original_h), (96, 64))
                self.assertGreaterEqual(float(image.min()), 0.0)
                self.assertLessEqual(float(image.max()), 1.0)
                self.assertGreaterEqual(float(mask.min()), 0.0)
                self.assertLessEqual(float(mask.max()), 1.0)

    def test_crop_to_fill_cuts_the_middle(self):
        name = self.write("wide.png", width=200, height=100)
        image, _, width, height, *_ = self.run_node(name, size="crop to fill", width=100, height=100, multiple=1, method="nearest")
        self.assertEqual((width, height), (100, 100))
        whole, *_ = self.run_node(name)
        self.assertTrue(torch.equal(image, whole[:, :, 50:150, :]), "the middle of the file, untouched")

    def test_enlarge_off_leaves_a_small_file_alone(self):
        name = self.write()
        image, _, width, height, *_ = self.run_node(name, size="longest side", longest_side=1024, multiple=1, enlarge=False)
        self.assertEqual((width, height), (96, 64))
        whole, *_ = self.run_node(name)
        self.assertTrue(torch.equal(image, whole))

    def test_a_file_in_a_subfolder_gives_its_bare_name(self):
        name = self.write("shots/day one/hero.final.png")
        *_, filename, _, _ = self.run_node(name)
        self.assertEqual(filename, "hero.final")

    def test_every_frame_of_an_animation_comes_through(self):
        frames = [Image.new("RGB", (40, 30), (index * 60, 20, 20)) for index in range(3)]
        path = Path(self.folder) / "turn.gif"
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=80, loop=0)
        image, mask, width, height, *_ = self.run_node("turn.gif", size="scale", scale=2.0, multiple=1)
        self.assertEqual(tuple(image.shape), (3, 60, 80, 3))
        self.assertEqual(tuple(mask.shape), (3, 60, 80))
        self.assertEqual((width, height), (80, 60))

    def test_a_missing_or_outside_file_stops_before_the_run_with_the_nodes_name(self):
        self.assertIs(AusBossLoadImage.VALIDATE_INPUTS(image=self.write()), True)
        for name in ("", "gone.png", "../secret.png", "//fileserver/share/pic.png"):
            verdict = AusBossLoadImage.VALIDATE_INPUTS(image=name)
            self.assertIsInstance(verdict, str, name)
            self.assertTrue(verdict.startswith("Load Image: "), verdict)

    def test_a_changed_file_or_setting_runs_the_node_again(self):
        name = self.write()
        first = AusBossLoadImage.IS_CHANGED(name, size="off")
        self.assertEqual(first, AusBossLoadImage.IS_CHANGED(name, size="off"))
        self.assertNotEqual(first, AusBossLoadImage.IS_CHANGED(name, size="scale"))
        path = Path(self.folder) / name
        Image.new("RGB", (10, 10), (1, 2, 3)).save(path)
        os.utime(path, ns=(1, 1))
        self.assertNotEqual(first, AusBossLoadImage.IS_CHANGED(name, size="off"))


if __name__ == "__main__":
    unittest.main()
