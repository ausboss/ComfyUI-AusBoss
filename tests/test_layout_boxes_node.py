"""Layout Boxes 🆎: the node itself (preview, the wire's boxes, the background
for the face). Needs torch and Pillow: run it with ComfyUI's Python."""

from __future__ import annotations

from pathlib import Path
import json
import math
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

    def test_the_canvas_boxes_make_all_four_outputs(self):
        out = self.node.draw(width=W, height=H, layout=layout(box(320, 96, 512, 640, desc="a cat"), box(0, 0, W, 64, "text", "OPEN", "neon")))
        preview, frames, elements, mask = out["result"]
        self.assertEqual(tuple(preview.shape), (1, 585, 1024, 3), "the canvas's shape, 1024 on its long side")
        self.assertEqual(preview.dtype, torch.float32)
        self.assertTrue(0.0 <= float(preview.min()) and float(preview.max()) <= 1.0)
        self.assertEqual(frames, [[{"x": 320, "y": 96, "width": 512, "height": 640}, {"x": 0, "y": 0, "width": W, "height": 64}]])
        self.assertEqual([e["type"] for e in elements], ["obj", "text"])
        self.assertEqual(out["ui"][UI_KEY], [{"size": [W, H], "count": 2}])
        self.assertEqual(tuple(mask.shape), (1, H, W), "the canvas size")
        self.assertEqual(mask.dtype, torch.float32)
        expected = torch.zeros(1, H, W)
        expected[0, 96:736, 320:832] = 1.0
        expected[0, 0:64, :] = 1.0
        self.assertTrue(torch.equal(mask, expected), "1 inside every box, 0 elsewhere")

    def test_no_boxes(self):
        preview, frames, elements, mask = self.node.draw(width=512, height=1024)["result"]
        self.assertEqual(tuple(preview.shape), (1, 1024, 512, 3))
        self.assertEqual((frames, elements), ([], []))
        self.assertEqual(tuple(mask.shape), (1, 1024, 512))
        self.assertEqual(float(mask.abs().sum()), 0.0, "no boxes: all black")

    def test_the_mask_fits_the_background_picture(self):
        # A 1000 x 750 photo: the canvas is 1008 x 752 (16 px steps), and the
        # mask has the photo's own size, the box at the same place on it.
        picture = torch.rand(2, 750, 1000, 3)
        words = {"x": 0.5, "y": 0.25, "w": 0.25, "h": 0.5, "type": "text", "text": "SALE", "desc": "red letters"}
        mask = self.node.draw(background=picture, width=1008, height=752, layout=layout(words))["result"][3]
        self.assertEqual(tuple(mask.shape), (1, 750, 1000), "one mask for the batch, at the picture's size")
        self.assertEqual(int(mask.sum()), 250 * 375)
        self.assertEqual(float(mask[0, 188, 500]), 1.0)
        self.assertEqual(float(mask[0, 562, 749]), 1.0)
        self.assertEqual(float(mask[0, 187, 500]) + float(mask[0, 563, 749]) + float(mask[0, 300, 750]), 0.0)

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

    def test_a_turned_box_makes_a_turned_mask(self):
        # 25, -55 and 90 degrees, apart on a 1344 x 768 canvas; each white area is its turned rectangle.
        boxes = [dict(box(100, 300, 369, 103), angle=25), dict(box(560, 300, 300, 80), angle=-55), dict(box(1000, 250, 200, 100), angle=90)]
        _preview, frames, elements, mask = self.node.draw(width=W, height=H, layout=layout(*boxes))["result"]
        self.assertEqual(tuple(mask.shape), (1, H, W))
        def area(x0, x1):
            return int(mask[0, :, x0:x1].sum())
        self.assertLess(abs(area(0, 520) - 369 * 103), 2 * (369 + 103), "25 degrees")
        self.assertLess(abs(area(520, 940) - 300 * 80), 2 * (300 + 80), "-55 degrees")
        self.assertEqual(area(940, W), 200 * 100, "90 degrees: exactly the upright box")
        self.assertEqual(float(mask[0, 200:400, 1050:1150].min()), 1.0)
        self.assertEqual(float(mask[0, 250:350, 1000:1049].max()), 0.0, "the level box it was drawn as is not white")
        # The turned box's far corner is white; the level rectangle's corner is not.
        a = math.radians(25)
        cx, cy = 100 + 369 / 2, 300 + 103 / 2
        far = (cx + 180 * math.cos(a) - 48 * math.sin(a), cy + 180 * math.sin(a) + 48 * math.cos(a))
        self.assertEqual(float(mask[0, int(far[1]), int(far[0])]), 1.0)
        self.assertEqual(float(mask[0, 302, 466]), 0.0)
        self.assertEqual(frames[0][2], {"x": 1050, "y": 200, "width": 100, "height": 200})
        self.assertEqual([e["desc"] for e in elements], ["", "", ""], "object boxes get no slant")

    def test_with_every_angle_level_every_output_is_as_before(self):
        plain = [box(320, 96, 512, 640, desc="a cat", palette=["#ff3399"]), box(0, 0, W, 64, "text", "OPEN", "neon")]
        before = self.node.draw(width=W, height=H, layout=layout(*plain))["result"]
        for zero in (0, 0.0, -0.0, "0", None):
            after = self.node.draw(width=W, height=H, layout=layout(*[dict(b, angle=zero) for b in plain]))["result"]
            self.assertTrue(torch.equal(before[0], after[0]), f"preview, angle {zero!r}")
            self.assertEqual(before[1], after[1])
            self.assertEqual(before[2], after[2])
            self.assertTrue(torch.equal(before[3], after[3]))

    def test_a_turned_text_box_tells_the_model_its_slant(self):
        sign = dict(box(613, 300, 369, 102, "text", "No Phones", "bold black letters on a white sign"), angle=25.2)
        _preview, frames, elements, _mask = self.node.draw(width=W, height=H, layout=layout(sign))["result"]
        self.assertEqual(elements[0]["desc"], "bold black letters on a white sign, tilted about 25 degrees, running downhill to the right")
        self.assertEqual(elements[0]["text"], "No Phones")
        level = self.node.draw(width=W, height=H, layout=layout(dict(sign, angle=0)))["result"]
        self.assertGreater(frames[0][0]["height"], level[1][0][0]["height"], "bboxes holds the straight box around the turned one")
        self.assertLess(elements[0]["bbox"][0], level[2][0]["bbox"][0])

    def test_on_a_picture_the_box_is_turned_on_the_picture(self):
        # A 1000 x 750 photo with Latent Size's 1024 x 1536 on width and height: the face shows the photo at its own
        # shape, so the box is turned there and the mask is a true rectangle on the photo.
        picture = torch.rand(1, 750, 1000, 3)
        words = {"x": 0.4, "y": 0.4, "w": 0.3, "h": 0.08, "type": "text", "text": "SALE", "desc": "red letters", "angle": -30}
        _preview, frames, _elements, mask = self.node.draw(background=picture, width=1024, height=1536, layout=layout(words))["result"]
        self.assertEqual(tuple(mask.shape), (1, 750, 1000))
        self.assertLess(abs(int(mask.sum()) - 300 * 60), 2 * (300 + 60), "300 x 60 photo pixels, turned")
        cx, cy, a = 550, 330, math.radians(-30)
        for u, v in ((140, 25), (-140, -25), (140, -25), (-140, 25)):
            self.assertEqual(float(mask[0, round(cy + u * math.sin(a) + v * math.cos(a)), round(cx + u * math.cos(a) - v * math.sin(a))]), 1.0, (u, v))
        frame = frames[0][0]
        self.assertTrue(0 < frame["x"] and frame["x"] + frame["width"] < 1024 and frame["height"] > 0.08 * 1536)

    def test_the_preview_draws_the_box_turned(self):
        quarter = dict(box(500, 334, 400, 100), angle=90)
        preview = self.node.draw(width=W, height=H, layout=layout(quarter))["result"][0]
        level = self.node.draw(width=W, height=H, layout=layout(dict(quarter, angle=0)))["result"][0]
        scale = 1024 / W
        def lit(image, x, y):
            return float((image[0, round(y * scale), round(x * scale)] - image[0, 5, 5]).abs().sum()) > 0.05
        self.assertTrue(lit(preview, 700, 240), "inside the upright box, above the level one")
        self.assertFalse(lit(preview, 560, 384), "inside the level box's left end, outside the upright one")
        self.assertTrue(lit(level, 560, 384))
        self.assertFalse(lit(level, 700, 240))

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
