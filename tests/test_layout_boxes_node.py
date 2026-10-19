"""Layout Boxes 🆎: the node itself (preview, the wire's boxes, the background
for the face). Needs torch and Pillow: run it with ComfyUI's Python."""

from __future__ import annotations

from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import node_layout_boxes
from nodes.node_layout_boxes import UI_KEY, AusBossLayoutBoxes

W, H = 1344, 768


def layout(*boxes, from_input=None):
    data = {"v": 1, "boxes": list(boxes)}
    if from_input:
        data["from_input"] = from_input
    return json.dumps(data)


def box(x, y, w, h, kind="obj", text="", desc="", palette=()):
    return {"x": x / W, "y": y / H, "w": w / W, "h": h / H, "type": kind, "text": text, "desc": desc, "palette": list(palette)}


def fake_folder_paths(temp_dir: str):
    class FakeFolderPaths:
        @staticmethod
        def get_temp_directory():
            return temp_dir

        @staticmethod
        def get_save_image_path(prefix, output_dir, _width, _height):
            return str(output_dir), prefix, 1, "", prefix

    return FakeFolderPaths


class LayoutBoxesNode(unittest.TestCase):
    def setUp(self):
        self.node = AusBossLayoutBoxes()

    def test_the_canvas_boxes_make_all_three_outputs(self):
        out = self.node.draw(width=W, height=H, layout=layout(box(320, 96, 512, 640, desc="a cat"), box(0, 0, W, 64, "text", "OPEN", "neon")))
        preview, frames, elements = out["result"]
        self.assertEqual(tuple(preview.shape), (1, 585, 1024, 3), "the canvas's shape, 1024 on its long side")
        self.assertEqual(preview.dtype, torch.float32)
        self.assertTrue(0.0 <= float(preview.min()) and float(preview.max()) <= 1.0)
        self.assertEqual(frames, [[{"x": 320, "y": 96, "width": 512, "height": 640}, {"x": 0, "y": 0, "width": W, "height": 64}]])
        self.assertEqual([e["type"] for e in elements], ["obj", "text"])
        self.assertEqual(out["ui"][UI_KEY], [{"size": [W, H], "count": 2}])

    def test_no_boxes(self):
        preview, frames, elements = self.node.draw(width=512, height=1024)["result"]
        self.assertEqual(tuple(preview.shape), (1, 1024, 512, 3))
        self.assertEqual((frames, elements), ([], []))

    def test_new_boxes_on_the_wire_win_once(self):
        wire = [{"type": "obj", "bbox": [0, 0, 500, 500], "desc": "from the wire"}]
        drawn = layout(box(640, 384, 128, 128, desc="drawn"))
        first = self.node.draw(width=W, height=H, layout=drawn, bboxes=wire)
        self.assertEqual(first["result"][2][0]["desc"], "from the wire")
        incoming = first["ui"][UI_KEY][0]["incoming"]
        self.assertEqual(incoming["boxes"][0]["desc"], "from the wire")
        # The face put them on the canvas and kept the fingerprint; a change
        # made there is used from then on, while the wire stays the same.
        edited = layout(dict(incoming["boxes"][0], desc="changed on the canvas"), from_input=incoming["fingerprint"])
        again = self.node.draw(width=W, height=H, layout=edited, bboxes=wire)
        self.assertEqual(again["result"][2][0]["desc"], "changed on the canvas")
        other = self.node.draw(width=W, height=H, layout=edited, bboxes=[dict(wire[0], desc="new on the wire")])
        self.assertEqual(other["result"][2][0]["desc"], "new on the wire")

    def test_the_background_goes_to_the_temp_folder_for_the_face(self):
        picture = torch.rand(2, 900, 600, 3)
        with tempfile.TemporaryDirectory() as tmp, patch.object(node_layout_boxes, "folder_paths", fake_folder_paths(tmp)):
            out = self.node.draw(background=picture, width=608, height=896, layout=layout())
            note = out["ui"][UI_KEY][0]
            self.assertEqual(note["picture"], [600, 900])
            self.assertEqual(note["background"]["type"], "temp")
            saved = Path(tmp) / note["background"]["filename"]
            self.assertTrue(saved.is_file())
        self.assertEqual(tuple(out["result"][0].shape), (1, 896, 608, 3), "a small canvas is not blown up")

    def test_a_grey_background_and_a_failed_save_still_run(self):
        picture = torch.rand(1, 64, 96, 1)
        out = self.node.draw(background=picture, width=96, height=64)
        self.assertNotIn("background", out["ui"][UI_KEY][0], "no folder_paths offline: no file, no error")
        self.assertEqual(tuple(out["result"][0].shape), (1, 64, 96, 3))

        class Broken:
            @staticmethod
            def get_temp_directory():
                raise OSError("disk full")

        with patch.object(node_layout_boxes, "folder_paths", Broken):
            out = self.node.draw(background=torch.rand(1, 64, 64, 3), width=64, height=64)
        self.assertNotIn("background", out["ui"][UI_KEY][0])


if __name__ == "__main__":
    unittest.main()
