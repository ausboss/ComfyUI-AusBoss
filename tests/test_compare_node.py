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

from nodes import _preview_helpers
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

    def test_compare_saves_temp_previews_and_passes_a_through(self):
        image_a = torch.rand(2, 8, 12, 3)
        image_b = torch.rand(1, 8, 12, 3)
        with tempfile.TemporaryDirectory() as tmp:
            # folder_paths is imported by the shared preview helper now, which
            # is where every node's temp preview is written.
            with patch.object(_preview_helpers, "folder_paths", fake_folder_paths(tmp)):
                result = AusBossCompare().compare(image_a, image_b)

            self.assertIs(result["result"][0], image_a)
            for key in ("a_images", "b_images"):
                (ref,) = result["ui"][key]
                self.assertEqual(ref["type"], "temp")
                self.assertEqual(ref["subfolder"], "ausboss")
                self.assertEqual((ref["width"], ref["height"]), (12, 8))
                saved = Path(tmp) / "ausboss" / ref["filename"]
                with Image.open(saved) as png:
                    self.assertEqual(png.size, (12, 8))

    def test_two_nodes_use_distinct_temp_prefixes(self):
        # Prefixes are randomized per instance so parallel Compare nodes
        # never overwrite each other's previews.
        self.assertNotEqual(AusBossCompare()._prefix, AusBossCompare()._prefix)


if __name__ == "__main__":
    unittest.main()
