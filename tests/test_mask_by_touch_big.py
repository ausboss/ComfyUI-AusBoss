"""Mask by Touch on a big picture: SAM 3 is asked about a smaller copy, and
what it answers comes back at the picture's own size. ComfyUI's detector and
text reader are stood in for by fakes, so this runs without ComfyUI and
without a model."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _mask_by_touch_helpers as helpers  # noqa: E402
from nodes import node_mask_by_touch as node_module  # noqa: E402
from nodes._mask_by_name_helpers import IF_NOTHING  # noqa: E402
from nodes._mask_by_touch_helpers import WORK_SIDE, WorkView  # noqa: E402

UI = "ausboss_mask_by_touch"
# The big picture, and the long side of the copy SAM 3 is asked about here.
H, W = 300, 240
SIDE = 60
# Things as shares of the picture: (left, top, right, bottom).
PERSON = (0.25, 0.1, 0.75, 0.95)
FACE = (0.4, 0.15, 0.6, 0.3)
THINGS = {"person": [(PERSON, 0.98)], "face": [(FACE, 0.9)]}


def box(thing, height, width):
    left, top, right, bottom = thing
    mask = torch.zeros(height, width)
    mask[round(top * height):round(bottom * height), round(left * width):round(right * width)] = 1.0
    return mask


def same_area(one, other):
    one, other = one.bool(), other.bool()
    return float((one & other).sum()) / max(1.0, float((one | other).sum()))


class SizedSam:
    """Stands in for ComfyUI's SAM3_Detect. It answers at the size of the
    picture it is given, as the real one does."""

    calls: list = []

    @classmethod
    def execute(cls, model, image, conditioning=None, positive_coords=None, negative_coords=None, threshold=0.5, refine_iterations=2, individual_masks=False):
        height, width = int(image.shape[1]), int(image.shape[2])
        call = {"size": (height, width)}
        cls.calls.append(call)
        if conditioning is not None:
            call["word"] = conditioning[0][2].rpartition(":")[0]
            found = THINGS.get(call["word"], [])
            masks = torch.stack([box(thing, height, width) for thing, _ in found]) if found else torch.zeros(0, height, width)
            return types.SimpleNamespace(result=(masks, [[{"score": sure} for _, sure in found]]))
        call["points"] = points = [(point["x"], point["y"]) for point in json.loads(positive_coords)]
        answer = torch.zeros(height, width)
        for thing in (FACE, PERSON):  # the smallest thing that holds every point
            area = box(thing, height, width)
            if all(0 <= y < height and 0 <= x < width and float(area[y, x]) > 0 for x, y in points):
                answer = area
                break
        return types.SimpleNamespace(result=(answer[None], [[]]))


class Encode:
    def encode(self, clip, text):
        return ([["read by", clip, text]],)


class Folders:
    def __init__(self, folder):
        self.folder = folder

    def get_temp_directory(self):
        return self.folder

    def get_save_image_path(self, prefix, folder, _width, _height):
        counter = 1 + sum(1 for name in Path(folder).iterdir() if name.name.startswith(prefix + "_"))
        return folder, prefix, counter, "", prefix


class WorkViewTests(unittest.TestCase):
    def test_a_picture_up_to_the_work_side_is_asked_about_as_it_is(self):
        frame = torch.rand(1, 40, WORK_SIDE, 3)
        view = WorkView(frame)
        self.assertTrue(view.same)
        self.assertIs(view.frame, frame)
        self.assertEqual((view.work_height, view.work_width), (40, WORK_SIDE))
        self.assertEqual(view.point((17, 5)), (17, 5))
        self.assertEqual(view.full_point((17, 5)), (17, 5))
        mask = torch.zeros(40, WORK_SIDE, dtype=torch.bool)
        self.assertIs(view.full(mask), mask)
        self.assertEqual(view.full_box([1, 2, 3, 4]), [1, 2, 3, 4])

    def test_a_bigger_picture_gets_a_copy_with_the_long_side_at_the_work_side(self):
        frame = torch.rand(1, WORK_SIDE * 2, WORK_SIDE + 500, 3)
        view = WorkView(frame)
        self.assertFalse(view.same)
        self.assertEqual(view.work_height, WORK_SIDE)
        self.assertEqual(tuple(view.frame.shape), (1, view.work_height, view.work_width, 3))
        self.assertEqual(view.work_width, round((WORK_SIDE + 500) / 2))
        # Averaged down: the copy's mean is the picture's.
        self.assertAlmostEqual(float(view.frame.mean()), float(frame.mean()), places=3)

    def test_a_place_on_the_copy_leads_back_to_itself(self):
        for height, width in ((4096, 4096), (3840, 2160), (2049, 8192), (5000, 3333)):
            view = WorkView(torch.zeros(1, height, width, 1))
            for x in (0, 1, 7, view.work_width // 3, view.work_width - 2, view.work_width - 1):
                for y in (0, 1, 5, view.work_height // 2, view.work_height - 1):
                    full = view.full_point((x, y))
                    self.assertTrue(0 <= full[0] < width and 0 <= full[1] < height)
                    self.assertEqual(view.point(full), (x, y), f"{width}x{height} at {x},{y}")
            self.assertEqual(view.point((width - 1, height - 1)), (view.work_width - 1, view.work_height - 1))

    def test_an_answer_comes_back_at_the_pictures_own_size(self):
        view = WorkView(torch.zeros(1, 4096, 3000, 3))
        small = box(FACE, view.work_height, view.work_width) > 0.5
        full = view.full(small)
        self.assertEqual(tuple(full.shape), (4096, 3000))
        self.assertEqual(full.dtype, torch.bool)
        self.assertGreater(same_area(full, box(FACE, 4096, 3000)), 0.98)
        x0, y0, x1, y1 = view.full_box(helpers.box_of(small))
        wanted = helpers.box_of(box(FACE, 4096, 3000) > 0.5)
        for got, want in zip((x0, y0, x1, y1), wanted):
            self.assertLessEqual(abs(got - want), 3)


class BigPictureTests(unittest.TestCase):
    def setUp(self):
        SizedSam.calls = []
        node_module._MEMORY.clear()
        node_module._WORDS.clear()
        node_module._TRUST.clear()
        node_module._UNSTEADY.clear()
        node_module._NOTED.clear()
        self.swap(node_module, "_core_nodes", lambda: {"SAM3_Detect": SizedSam, "CLIPTextEncode": Encode})
        self.swap(node_module, "SCOPE_SPACING", 12)
        self.swap(node_module, "SCOPE_SECONDS_BLIND", 1e9)
        self.swap(helpers, "WORK_SIDE", SIDE)
        folder = tempfile.mkdtemp(prefix="ausboss_touch_big_")
        self.addCleanup(shutil.rmtree, folder, True)
        self.swap(node_module, "folder_paths", Folders(folder))
        self.picture = torch.rand(1, H, W, 3) * 0.9
        self.node = node_module.AusBossMaskByTouch()

    def swap(self, module, attribute, value):
        self.addCleanup(setattr, module, attribute, getattr(module, attribute))
        setattr(module, attribute, value)

    def run_node(self, text="", image=None, **overrides):
        values = {"grow": 0, "soften": 0.0, "smooth": 0, "fill_holes": False, "if_nothing": IF_NOTHING[1]}
        values.update(overrides)
        return self.node.pick(self.picture if image is None else image, "sam3 model", "sam3 clip", text, **values)

    def touches(self, *items):
        return json.dumps({"v": 1, "items": list(items)})

    def test_sam3_is_never_given_the_big_picture(self):
        self.run_node(self.touches({"t": "tap", "op": 1, "x": 120, "y": 66}, {"t": "all", "op": 1, "w": "person"}))
        self.assertTrue(SizedSam.calls)
        for call in SizedSam.calls:
            self.assertEqual(call["size"], (SIDE, 48), "the copy: 300 x 240 with its long side at 60")

    def test_a_tap_takes_the_thing_at_its_place_and_the_mask_is_full_size(self):
        out = self.run_node(self.touches({"t": "tap", "op": 1, "x": 120, "y": 66}))  # on the face
        mask = out["result"][0]
        self.assertEqual(tuple(mask.shape), (1, H, W))
        self.assertGreater(same_area(mask[0] > 0.5, box(FACE, H, W)), 0.9)
        # The point was asked where it lies on the copy.
        self.assertEqual(SizedSam.calls[0]["points"], [(120 * 48 // W, 66 * SIDE // H)])

    def test_a_word_takes_every_thing_of_that_name_at_full_size(self):
        out = self.run_node(self.touches({"t": "all", "op": 1, "w": "person"}, {"t": "all", "op": 0, "w": "face"}))
        mask = out["result"][0][0] > 0.5
        wanted = (box(PERSON, H, W) > 0.5) & ~(box(FACE, H, W) > 0.5)
        self.assertGreater(same_area(mask, wanted), 0.93)
        self.assertEqual(out["result"][2], "person")

    def test_a_stroke_is_asked_about_on_the_copy(self):
        stroke = {"t": "find", "op": 1, "r": 8, "pts": [[110, 60], [130, 70]]}  # across the face
        out = self.run_node(self.touches(stroke))
        self.assertGreater(same_area(out["result"][0][0] > 0.5, box(FACE, H, W)), 0.9)
        for call in SizedSam.calls:
            for x, y in call.get("points", []):
                self.assertTrue(0 <= x < 48 and 0 <= y < SIDE)

    def test_what_a_look_lights_up_is_what_a_click_on_it_takes(self):
        note = self.run_node(ask="scope")["ui"][UI][0]
        self.assertEqual((note["width"], note["height"]), (W, H))
        pieces = {piece["name"]: piece for piece in note["pieces"]["list"] if piece["name"]}
        self.assertEqual(set(pieces), {"person", "face"})
        face = pieces["face"]
        # Its own point is a pixel of the picture, inside the thing, and its box is the picture's.
        self.assertGreater(float(box(FACE, H, W)[face["y"], face["x"]]), 0)
        for got, want in zip(face["box"], helpers.box_of(box(FACE, H, W) > 0.5)):
            self.assertLessEqual(abs(got - want), 6)
        self.assertAlmostEqual(face["share"], float(box(FACE, H, W).mean()), delta=0.01)
        # The face picks it as a named touch at that point: nothing is asked again.
        before = len(SizedSam.calls)
        out = self.run_node(self.touches({"t": "name", "op": 1, "w": "face", "x": face["x"], "y": face["y"]}), ask="look")
        self.assertEqual(len(SizedSam.calls), before)
        self.assertGreater(same_area(out["result"][0][0] > 0.5, box(FACE, H, W)), 0.9)
        # A point piece is remembered under the picture's own pixel as well.
        spot = next((piece for piece in note["pieces"]["list"] if not piece["name"]), None)
        if spot is not None:
            self.run_node(self.touches({"t": "tap", "op": 1, "x": spot["x"], "y": spot["y"]}), ask="look")
            self.assertEqual(len(SizedSam.calls), before)

    def test_a_small_picture_is_asked_about_as_it_is(self):
        small = torch.rand(1, 50, 40, 3) * 0.9
        out = self.run_node(self.touches({"t": "tap", "op": 1, "x": 20, "y": 11}), image=small)
        self.assertEqual([call["size"] for call in SizedSam.calls], [(50, 40)])
        self.assertTrue(torch.equal(out["result"][0][0] > 0.5, box(FACE, 50, 40) > 0.5), "exactly what SAM 3 answered")

    def test_paint_stays_exactly_as_painted_on_the_big_picture(self):
        stroke = [[20, 20], [200, 20]]
        out = self.run_node(self.touches({"t": "paint", "op": 1, "r": 5, "pts": stroke}))
        wanted = helpers.stroke_area(tuple(tuple(point) for point in stroke), 5.0, H, W)
        self.assertTrue(torch.equal(out["result"][0][0] > 0.5, wanted))
        self.assertEqual(SizedSam.calls, [], "paint asks SAM 3 nothing")


if __name__ == "__main__":
    unittest.main()
