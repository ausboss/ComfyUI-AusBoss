from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _preview_helpers, node_compare
from nodes._compare_helpers import pair_pictures
from nodes.node_compare import AusBossCompare, first_frame_to_pil


def fake_folder_paths(temp_dir: str):
    class FakeFolderPaths:
        @staticmethod
        def get_temp_directory():
            return temp_dir

        @staticmethod
        def get_save_image_path(prefix, output_dir, _width, _height):
            folder = Path(output_dir) / "ausboss"
            folder.mkdir(parents=True, exist_ok=True)
            return str(folder), prefix, 1, "ausboss", prefix

    return FakeFolderPaths


class CompareNodeTests(unittest.TestCase):
    def test_first_frame_conversion_and_validation(self):
        batch = torch.zeros(3, 4, 6, 3)
        batch[0, :, :, 0] = 1.0  # first frame is pure red
        preview = first_frame_to_pil(batch)
        self.assertEqual((preview.width, preview.height), (6, 4))
        self.assertEqual(preview.getpixel((0, 0)), (255, 0, 0))
        with self.assertRaisesRegex(ValueError, "BHWC"):
            first_frame_to_pil(torch.zeros(4, 6, 3))
        with self.assertRaisesRegex(ValueError, "empty"):
            first_frame_to_pil(torch.zeros(0, 4, 6, 3))

    def test_compare_saves_temp_previews_and_passes_both_through(self):
        image_a = torch.rand(2, 8, 12, 3)
        image_b = torch.rand(1, 8, 12, 3)
        with tempfile.TemporaryDirectory() as tmp:
            # folder_paths is imported by the shared preview helper now, which
            # is where every node's temp preview is written.
            with patch.object(_preview_helpers, "folder_paths", fake_folder_paths(tmp)), \
                    patch.object(node_compare, "folder_paths", fake_folder_paths(tmp)):
                result = AusBossCompare().compare(image_a, image_b)

            # image_a stays the first output, so saved links keep their slot;
            # image_b was appended after it.
            self.assertEqual(AusBossCompare.RETURN_NAMES, ("image_a", "image_b"))
            self.assertEqual(len(AusBossCompare.OUTPUT_TOOLTIPS), 2)
            self.assertIs(result["result"][0], image_a)
            self.assertIs(result["result"][1], image_b)
            for key in ("a_images", "b_images"):
                (ref,) = result["ui"][key]
                self.assertEqual(ref["type"], "temp")
                self.assertEqual(ref["subfolder"], "ausboss")
                self.assertEqual((ref["width"], ref["height"]), (12, 8))
                saved = Path(tmp) / "ausboss" / ref["filename"]
                with Image.open(saved) as png:
                    self.assertEqual(png.size, (12, 8))
            # The run's key stands for exactly these two files; Erase's Save
            # sends the key back and never a file name.
            (key,) = result["ui"]["pair"]
            self.assertEqual(
                pair_pictures(key)[:2],
                tuple(Path(tmp) / "ausboss" / result["ui"][name][0]["filename"] for name in ("a_images", "b_images")),
            )
            # No name wired in: the one typed on the node will be used.
            self.assertEqual((result["ui"]["save_name"], pair_pictures(key)[2]), ([""], ""))

    def test_a_see_through_picture_keeps_its_clear_parts_in_the_preview(self):
        image_a = torch.ones(1, 8, 12, 4)
        image_a[0, :, :4, 3] = 0.0
        image_b = torch.rand(1, 8, 12, 3)
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(_preview_helpers, "folder_paths", fake_folder_paths(tmp)), \
                    patch.object(node_compare, "folder_paths", fake_folder_paths(tmp)):
                result = AusBossCompare().compare(image_a, image_a)
                (ref_a,) = result["ui"]["a_images"]
                with Image.open(Path(tmp) / "ausboss" / ref_a["filename"]) as png:
                    self.assertEqual(png.mode, "RGBA")
                    self.assertEqual(png.getpixel((0, 0))[3], 0)
                result = AusBossCompare().compare(image_a, image_b)
            # The panel shows the clear parts over a checkerboard; an opaque B has no flag.
            self.assertTrue(result["ui"]["a_images"][0]["alpha"])
            self.assertNotIn("alpha", result["ui"]["b_images"][0])

    def test_a_wired_filename_names_the_saved_files(self):
        image = torch.rand(1, 8, 12, 3)
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(_preview_helpers, "folder_paths", fake_folder_paths(tmp)), \
                    patch.object(node_compare, "folder_paths", fake_folder_paths(tmp)):
                result = AusBossCompare().compare(image, image, filename="sets/a/photo 12.jpg")
                self.assertEqual(result["ui"]["save_name"], ["photo 12"])
                self.assertEqual(pair_pictures(result["ui"]["pair"][0])[2], "photo 12")
                self.assertIs(result["result"][0], image)
        optional = AusBossCompare.INPUT_TYPES()["optional"]["filename"]
        self.assertEqual(optional[0], "STRING")
        self.assertTrue(optional[1]["forceInput"])
        self.assertEqual(list(AusBossCompare.INPUT_TYPES()["required"]), ["image_a", "image_b"])

    def test_two_nodes_use_distinct_temp_prefixes(self):
        # Prefixes are randomized per instance so parallel Compare nodes
        # never overwrite each other's previews.
        self.assertNotEqual(AusBossCompare()._prefix, AusBossCompare()._prefix)


if __name__ == "__main__":
    unittest.main()
