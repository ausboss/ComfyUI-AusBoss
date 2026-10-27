"""Mask by Touch: what the node does with clicks, names, strokes and what
SAM 3 answers. ComfyUI's own detector and text reader are stood in for by
fakes with a few things in them, so these run without ComfyUI and without a
model."""

from __future__ import annotations

import json
import math
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest

import numpy
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import node_mask_by_touch as node_module  # noqa: E402
from nodes._mask_by_name_helpers import IF_NOTHING  # noqa: E402
from nodes._mask_by_touch_helpers import (  # noqa: E402
    NEEDS_SAM3,
    NOTHING_PICKED,
    NOT_A_PICTURE,
    NOT_SAM3,
    NOT_TOUCHES,
    NO_TEXT_READER,
    OTHER_PICTURE,
    WORDS_FIRST,
    WORDS_MORE,
    picture_key,
    scope_points,
    stroke_area,
    touch_stamp,
    unpack_planes,
)

H, W = 120, 160
UI = "ausboss_mask_by_touch"


def block(top, left, tall, wide):
    mask = torch.zeros(H, W)
    mask[top:top + tall, left:left + wide] = 1.0
    return mask


def share(thing):
    return round(float(thing.sum()) / (H * W), 5)


GLASSES = block(30, 60, 8, 30)
FACE = block(20, 55, 30, 40)
PERSON = block(15, 40, 100, 70)
MUG = block(80, 120, 25, 25)
# The mug comes back with a far-off speck, as SAM 3's answers often do.
MUG_AS_ANSWERED = MUG.clone()
MUG_AS_ANSWERED[2:4, 2:4] = 1.0
POSTER = block(5, 120, 12, 30)
# What a point finds, smallest first: the smallest thing that holds every point asked.
SCENE = [("glasses", GLASSES, GLASSES), ("poster", POSTER, POSTER), ("mug", MUG, MUG_AS_ANSWERED), ("face", FACE, FACE), ("person", PERSON, PERSON)]
WALL = (5, 5)  # nothing is there

HAND_LEFT = block(70, 42, 8, 8)
HAND_RIGHT = block(70, 100, 8, 8)
SHIRT = block(60, 50, 40, 50)
SHIRT_AGAIN = block(60, 50, 40, 48)  # nearly the same area
WINDOW = block(60, 5, 50, 30)
PANE = block(70, 10, 20, 20)  # a window inside the window
EARRING = block(52, 57, 3, 3)
# What a word finds: every thing of that name, the surest first.
NAMED = {
    "person": [(PERSON, 0.98)],
    "face": [(FACE, 0.9)],
    "hand": [(HAND_LEFT, 0.9), (HAND_RIGHT, 0.85)],
    "shirt": [(SHIRT, 0.7)],
    "eyeglasses": [(GLASSES, 0.97)],
    "cup": [(MUG_AS_ANSWERED, 0.96)],
    "window": [(WINDOW, 0.9), (PANE, 0.8)],
    "blouse": [(SHIRT_AGAIN, 0.95)],  # asked later, and surer than "shirt"
    "earring": [(EARRING, 0.75)],
    "sunglasses": [(GLASSES, 0.6)],  # asked later, and less sure than "eyeglasses"
}
# The pieces a whole look ends with, smallest first.
LOOKED = [
    ("earring", EARRING, 0.75), ("hand", HAND_LEFT, 0.9), ("hand", HAND_RIGHT, 0.85), ("eyeglasses", GLASSES, 0.97),
    (None, POSTER, None), ("window", PANE, 0.8), ("cup", MUG, 0.96), ("face", FACE, 0.9), ("window", WINDOW, 0.9),
    ("blouse", SHIRT_AGAIN, 0.95), ("person", PERSON, 0.98),
]


def lowered(frame):
    """A picture whose first pixel is white shows the scene 10 px lower."""
    return 10 if float(frame[0, 0, 0]) > 0.99 else 0


class FakeSam:
    """Stands in for ComfyUI's SAM3_Detect, asked about points or a word."""

    calls: list = []

    @classmethod
    def execute(cls, model, image, conditioning=None, positive_coords=None, negative_coords=None, threshold=0.5, refine_iterations=2, individual_masks=False):
        call = {"frames": int(image.shape[0]), "threshold": threshold, "passes": refine_iterations, "individual": individual_masks, "negative": negative_coords, "model": model}
        cls.calls.append(call)
        if conditioning is not None:
            _, call["clip"], call["text"] = conditioning[0]
            call["word"] = call["text"].rpartition(":")[0]
            stacks, boxes = [], []
            for frame in image:
                found = NAMED.get(call["word"], [])
                stacks.append(torch.stack([torch.roll(thing, lowered(frame), 0) for thing, _ in found]) if found else torch.zeros(0, H, W))
                boxes.append([{"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "score": sure} for _, sure in found])
            return types.SimpleNamespace(result=(torch.cat(stacks), boxes))
        call["points"] = points = [(point["x"], point["y"]) for point in json.loads(positive_coords)]
        masks = []
        for frame in image:
            down = lowered(frame)
            answer = torch.zeros(H, W)
            for _name, where, answered in SCENE:
                if all(0 <= y - down < H and float(where[y - down, x]) > 0 for x, y in points):
                    answer = torch.roll(answered, shifts=down, dims=0)
                    break
            masks.append(answer)
        return types.SimpleNamespace(result=(torch.stack(masks), [[] for _ in image]))


class FakeEncode:
    """Stands in for ComfyUI's CLIPTextEncode."""

    calls: list = []

    def encode(self, clip, text):
        FakeEncode.calls.append(text)
        return ([["read by", clip, text]],)


class FakeFolders:
    """Stands in for ComfyUI's folder_paths: a temp folder and numbered names."""

    def __init__(self, folder):
        self.folder = folder

    def get_temp_directory(self):
        return self.folder

    def get_save_image_path(self, prefix, folder, _width, _height):
        counter = 1 + sum(1 for name in Path(folder).iterdir() if name.name.startswith(prefix + "_"))
        return folder, prefix, counter, "", prefix


def touches(*items, key=None):
    data = {"v": 1, "items": list(items)}
    if key is not None:
        data["key"] = key
    return json.dumps(data)


def tap(x, y, op=1):
    return {"t": "tap", "op": op, "x": x, "y": y}


def name(word, x, y, op=1):
    return {"t": "name", "op": op, "w": word, "x": x, "y": y}


def every(word, op=1):
    return {"t": "all", "op": op, "w": word}


def find(pts, r=4, op=1):
    return {"t": "find", "op": op, "r": r, "pts": pts}


def paint(pts, r=4, op=1):
    return {"t": "paint", "op": op, "r": r, "pts": pts}


def asked(kind):
    """The words, or the lists of points, SAM 3 was asked about, in order."""
    return [call[kind] for call in FakeSam.calls if kind in call]


class TouchCase(unittest.TestCase):
    detector = FakeSam
    encoder = FakeEncode

    def setUp(self):
        FakeSam.calls = []
        FakeEncode.calls = []
        node_module._MEMORY.clear()
        node_module._WORDS.clear()
        node_module._TRUST.clear()
        node_module._UNSTEADY.clear()
        node_module._NOTED.clear()
        self.swap("_core_nodes", lambda: {"SAM3_Detect": self.detector, "CLIPTextEncode": self.encoder})
        # The test picture is small: let the look ask as many points as a big one gets.
        self.swap("SCOPE_SPACING", 1)
        # A look here ends when everything is asked, unless a test cuts it short.
        self.swap("SCOPE_SECONDS_BLIND", 1e9)
        folder = tempfile.mkdtemp(prefix="ausboss_touch_test_")
        self.addCleanup(shutil.rmtree, folder, True)
        self.folder = Path(folder)
        self.swap("folder_paths", FakeFolders(folder))
        self.picture = torch.rand(1, H, W, 3) * 0.9
        self.node = node_module.AusBossMaskByTouch()

    def swap(self, attribute, value):
        self.addCleanup(setattr, node_module, attribute, getattr(node_module, attribute))
        setattr(node_module, attribute, value)

    def run_node(self, text="", node=None, image=None, model="sam3 model", clip="sam3 clip", **overrides):
        values = {"grow": 0, "soften": 0.0, "smooth": 0, "fill_holes": False, "if_nothing": IF_NOTHING[0]}
        values.update(overrides)
        picture = self.picture if image is None else image
        return (node or self.node).pick(picture, model, clip, text, **values)

    def note(self, out):
        return out["ui"][UI][0]

    def area(self, out):
        return out["result"][0][0] > 0.5

    def short_looks(self, questions):
        """From here on a look asks this many questions and hands back, as
        where ComfyUI's queue cannot be read and its short time is over."""
        self.swap("_jobs_waiting", lambda: None)
        self.swap("SCOPE_SECONDS_BLIND", -1.0)
        self.swap("SCOPE_FLOOR", questions)

    def look(self, **overrides):
        """Looks until everything is asked; the last note."""
        while True:
            note = self.note(self.run_node("", ask="scope", **overrides))
            if not note["pieces"]["more"]:
                return note

    def opened(self, entry):
        """A file the note names, read whole: (format, mode, size, pixels)."""
        with Image.open(self.folder / entry["subfolder"] / entry["filename"]) as picture:
            return types.SimpleNamespace(
                format=picture.format, mode=picture.mode, size=picture.size, info=dict(picture.info),
                pixels=torch.from_numpy(numpy.asarray(picture).copy()),
            )

    def pieces_of(self, note):
        planes = [self.opened(entry).pixels for entry in note["pieces"]["planes"]]
        return unpack_planes(planes, len(note["pieces"]["list"]))

    def touch_for(self, entry):
        """What the node's face stores for a click on a lit piece."""
        if entry["kind"] == "name":
            return name(entry["name"], entry["x"], entry["y"])
        return tap(entry["x"], entry["y"])


class PickTests(TouchCase):
    def test_a_tap_a_stroke_and_paint_give_the_area_and_the_note(self):
        stroke = [[125, 85], [140, 100]]
        text = touches(tap(75, 34), find([[50, 80], [100, 80]]), paint(stroke, r=3, op=0), key=picture_key(self.picture))
        out = self.run_node(text)
        mask, cut, names = out["result"]
        self.assertEqual(names, "", "a tap, a stroke and paint have no name")
        expected = torch.maximum(GLASSES, PERSON).bool() & ~stroke_area(stroke, 3, H, W)
        self.assertEqual((mask.dtype, tuple(mask.shape)), (torch.float32, (1, H, W)))
        self.assertTrue(torch.equal(mask[0] > 0.5, expected))
        self.assertEqual(tuple(cut.shape), (1, H, W, 4))
        self.assertTrue(torch.equal(cut[..., :3], self.picture))
        self.assertTrue(torch.equal(cut[0, ..., 3], mask[0]))
        note = self.note(out)
        self.assertEqual(sorted(note), ["areas", "fine", "height", "items", "key", "picture", "pieces", "scale", "selection", "share", "stamp", "width"])
        self.assertIsNone(note["fine"], "no fine edge while Fine edges is off")
        self.assertEqual((note["key"], note["width"], note["height"], note["scale"]), (picture_key(self.picture), W, H, 1.0))
        self.assertEqual(note["stamp"], touch_stamp(text))
        self.assertEqual(
            note["items"],
            [
                {"ok": True, "share": share(GLASSES), "as": "thing"},
                {"ok": True, "share": share(PERSON), "as": "thing"},
                {"ok": True, "share": round(float(stroke_area(stroke, 3, H, W).sum()) / (H * W), 5), "as": "paint", "did": False},
            ],
        )
        self.assertEqual(note["share"], round(float(mask[0].mean()), 5))
        self.assertIsNone(note["pieces"], "not looked at yet")
        self.assertNotIn("images", out["ui"], "the face draws its own picture")
        self.assertEqual(FakeEncode.calls, [], "points need no text reader")

    def test_sam3_is_asked_about_a_point_the_way_a_workflow_would_ask_it(self):
        self.run_node(touches(tap(75, 34)))
        (call,) = FakeSam.calls
        self.assertEqual(call["points"], [(75, 34)])
        self.assertEqual((call["threshold"], call["passes"], call["individual"], call["negative"]), (0.5, 2, False, None))
        self.assertEqual((call["frames"], call["model"]), (1, "sam3 model"))

    def test_the_face_gets_the_picture_and_the_raw_selection_as_files(self):
        big = torch.rand(1, 300, 2048, 3) * 0.9
        text = touches(paint([[100, 50], [1900, 250]], r=40))
        out = self.run_node(text, image=big, grow=20, soften=6.0)
        note = self.note(out)
        self.assertEqual((note["width"], note["height"], note["scale"]), (2048, 300, 0.5))
        picture = self.opened(note["picture"])
        self.assertEqual((picture.format, picture.size, picture.mode), ("JPEG", (1024, 150), "RGB"))
        selection = self.opened(note["selection"])
        self.assertEqual((selection.format, selection.size, selection.mode), ("PNG", (1024, 150), "L"))
        self.assertEqual(torch.unique(selection.pixels).tolist(), [0, 255], "255 inside, and nothing in between")
        self.assertNotIn("icc_profile", selection.info)
        self.assertEqual(note["picture"]["type"], "temp")
        # The selection is the raw one: before grow and soften.
        raw = stroke_area([[100, 50], [1900, 250]], 40, 300, 2048)
        self.assertLess(float(raw.float().mean()), note["share"])
        self.assertAlmostEqual(float((selection.pixels > 0).float().mean()), float(raw.float().mean()), places=2)

    def test_the_picture_is_written_once_and_each_selection_gets_a_new_name(self):
        first = self.note(self.run_node(touches(tap(75, 34))))
        second = self.note(self.run_node(touches(tap(130, 90))))
        self.assertEqual(first["picture"], second["picture"])
        self.assertNotEqual(first["selection"]["filename"], second["selection"]["filename"])
        other = node_module.AusBossMaskByTouch()
        third = self.note(self.run_node(touches(tap(75, 34)), node=other))
        self.assertNotEqual(third["picture"]["filename"], first["picture"]["filename"], "two nodes never share a file")
        (self.folder / first["picture"]["filename"]).unlink()
        again = self.note(self.run_node(touches(tap(75, 34)), grow=1))
        self.assertTrue((self.folder / again["picture"]["filename"]).is_file(), "a picture that is gone is written again")

    def test_without_a_temp_folder_the_mask_still_comes_back(self):
        self.swap("folder_paths", None)
        out = self.run_node(touches(tap(75, 34)))
        self.assertTrue(torch.equal(self.area(out), GLASSES.bool()))
        note = self.note(out)
        self.assertEqual((note["picture"], note["selection"]), (None, None))
        self.assertEqual(note["items"], [{"ok": True, "share": share(GLASSES), "as": "thing"}])

    def test_a_taps_answer_loses_its_far_off_speck(self):
        out = self.run_node(touches(tap(130, 90)))
        self.assertTrue(torch.equal(self.area(out), MUG.bool()))
        self.assertEqual(float(out["result"][0][0, 2, 2]), 0.0)

    def test_a_tap_that_finds_nothing_changes_nothing(self):
        out = self.run_node(touches(tap(75, 34), tap(*WALL), tap(900, 900), {"t": "lasso"}))
        self.assertTrue(torch.equal(self.area(out), GLASSES.bool()))
        nothing = {"ok": False, "share": 0.0, "as": "none"}
        self.assertEqual(self.note(out)["items"][1:], [nothing, nothing, nothing])
        self.assertEqual(len(FakeSam.calls), 2, "a tap off the picture and a kind not known ask nothing")

    def test_a_find_over_empty_space_is_the_paint_itself(self):
        stroke = [[45, 5], [80, 8]]
        found = self.run_node(touches(find(stroke, r=5)))
        painted = self.run_node(touches(paint(stroke, r=5)))
        self.assertTrue(torch.equal(found["result"][0], painted["result"][0]))
        self.assertGreater(float(found["result"][0].sum()), 0.0)
        self.assertEqual(self.note(found)["items"], self.note(painted)["items"])
        self.assertEqual(self.note(found)["items"][0]["as"], "paint")
        self.assertIs(self.note(found)["items"][0]["ok"], True, "it still does something")

    def test_a_stroke_takes_the_thing_under_it_not_the_paint(self):
        out = self.run_node(touches(find([[122, 82], [140, 100]], r=2)))
        self.assertTrue(torch.equal(self.area(out), MUG.bool()), "the whole mug, and its speck is not touched")
        self.assertEqual(asked("points"), [[(124, 84), (129, 89), (133, 93), (138, 98)], [(126, 86), (136, 96)]])

    def test_take_away_removes_and_the_order_counts(self):
        person_without_face = self.run_node(touches(tap(50, 100), tap(60, 45, op=0)))
        self.assertTrue(torch.equal(self.area(person_without_face), PERSON.bool() & ~FACE.bool()))
        face_back = self.run_node(touches(tap(60, 45, op=0), tap(50, 100)))
        self.assertTrue(torch.equal(self.area(face_back), PERSON.bool()))

    def test_the_edge_settings_shape_the_mask(self):
        exact = self.run_node(touches(tap(130, 90)))["result"][0][0]
        grown = self.run_node(touches(tap(130, 90)), grow=3)["result"][0][0]
        self.assertEqual((float(exact[78, 130]), float(grown[78, 130]), float(grown[76, 130])), (0.0, 1.0, 0.0))
        self.assertEqual(float(self.run_node(touches(tap(130, 90)), grow=-3)["result"][0][0, 81, 130]), 0.0)
        soft = self.run_node(touches(tap(130, 90)), soften=3.0)["result"][0][0]
        self.assertTrue(0.05 < float(soft[80, 130]) < 0.95)
        ring = touches(tap(50, 100), tap(60, 45, op=0), paint([[52, 90]], r=1, op=0))
        open_ring = self.run_node(ring, fill_holes=True)["result"][0][0]
        self.assertEqual(float(open_ring[45, 60]), 0.0, "the face is a big opening: it stays open")
        self.assertEqual(float(open_ring[90, 52]), 1.0, "the pinhole is closed")
        self.assertEqual(float(self.run_node(ring)["result"][0][0, 90, 52]), 0.0)


class NameTests(TouchCase):
    """A `name` touch: the thing called by a word at a point."""

    def test_a_name_takes_the_thing_of_that_name_at_the_point(self):
        text = touches(name("shirt", 75, 80), key=picture_key(self.picture))
        out = self.run_node(text)
        self.assertTrue(torch.equal(self.area(out), SHIRT.bool()), "the shirt, where a tap there takes the whole person")
        self.assertEqual(self.note(out)["items"], [{"ok": True, "share": share(SHIRT), "as": "thing"}])
        self.assertTrue(torch.equal(self.area(self.run_node(touches(tap(75, 80)))), PERSON.bool()))

    def test_sam3_is_asked_about_a_word_the_way_mask_by_name_asks(self):
        self.run_node(touches(name("hand", 45, 73)))
        self.assertEqual(FakeEncode.calls, ["hand:16"], "up to 16 matches: a bare word returns one")
        (call,) = FakeSam.calls
        self.assertEqual((call["text"], call["clip"], call["model"]), ("hand:16", "sam3 clip", "sam3 model"))
        self.assertEqual((call["threshold"], call["passes"], call["individual"], call["frames"]), (0.5, 2, True, 1))

    def test_of_two_of_a_kind_the_one_at_the_point_is_taken(self):
        left = self.run_node(touches(name("hand", 45, 73)))
        right = self.run_node(touches(name("hand", 104, 75)))
        self.assertTrue(torch.equal(self.area(left), HAND_LEFT.bool()))
        self.assertTrue(torch.equal(self.area(right), HAND_RIGHT.bool()))
        both = self.run_node(touches(name("hand", 45, 73), name("hand", 104, 75)))
        self.assertTrue(torch.equal(self.area(both), (HAND_LEFT + HAND_RIGHT).bool()))

    def test_of_a_thing_inside_a_thing_of_the_same_name_the_smallest_at_the_point_is_taken(self):
        self.assertTrue(torch.equal(self.area(self.run_node(touches(name("window", 15, 75)))), PANE.bool()))
        self.assertTrue(torch.equal(self.area(self.run_node(touches(name("window", 30, 100)))), WINDOW.bool()))

    def test_a_name_that_is_not_at_the_point_changes_nothing(self):
        out = self.run_node(touches(tap(75, 34), name("hand", 75, 80), name("unicorn", 75, 80), name("hand", 900, 900)))
        self.assertTrue(torch.equal(self.area(out), GLASSES.bool()))
        nothing = {"ok": False, "share": 0.0, "as": "none"}
        self.assertEqual(self.note(out)["items"][1:], [nothing, nothing, nothing])
        self.assertEqual(asked("word"), ["hand", "unicorn"], "a point off the picture asks nothing, and hand is asked once")

    def test_an_empty_word_does_nothing_and_a_word_is_cleaned_before_it_is_asked(self):
        with self.assertRaises(RuntimeError) as stopped:
            self.run_node(touches(name("", 75, 80), name(" ,:() ", 75, 80)))
        self.assertEqual(str(stopped.exception), NOTHING_PICKED)
        self.assertEqual((FakeSam.calls, FakeEncode.calls), ([], []))
        out = self.run_node(touches(name(" ( eyeglasses ), ", 75, 34)))
        self.assertTrue(torch.equal(self.area(out), GLASSES.bool()))
        self.assertEqual(FakeEncode.calls, ["eyeglasses:16"], "the text reader's own signs are gone")
        self.run_node(touches(name("x" * 200, 75, 34)), if_nothing="empty mask")
        self.assertEqual(FakeEncode.calls[-1], "x" * 60 + ":16")

    def test_a_name_can_take_away(self):
        out = self.run_node(touches(tap(50, 100), name("face", 60, 45, op=0), name("hand", 45, 73, op=0)))
        self.assertTrue(torch.equal(self.area(out), PERSON.bool() & ~FACE.bool() & ~HAND_LEFT.bool()))

    def test_the_matches_of_a_word_are_remembered_per_picture_and_the_word_is_read_once(self):
        first = self.run_node(touches(name("hand", 45, 73)))
        self.run_node(touches(name("hand", 104, 75)), grow=2)
        self.run_node(touches(name("hand", 45, 73)), node=node_module.AusBossMaskByTouch())
        self.assertEqual(asked("word"), ["hand"], "the other hand, new settings and another node ask nothing")
        self.run_node(touches(name("hand", 45, 73)), image=self.picture.flip(1), if_nothing="empty mask")
        self.assertEqual(asked("word"), ["hand", "hand"], "another picture is asked anew")
        self.assertEqual(FakeEncode.calls, ["hand:16"], "but the word reads the same for every picture")
        self.run_node(touches(name("hand", 45, 73)), clip="another text reader")
        self.run_node(touches(name("hand", 45, 73)), model=types.SimpleNamespace(model=object()))
        self.assertEqual((len(asked("word")), FakeEncode.calls), (4, ["hand:16", "hand:16"]), "another reader or model is asked anew")
        self.assertTrue(torch.equal(self.area(first), HAND_LEFT.bool()))

    def test_a_batch_asks_the_word_of_every_picture(self):
        lower = self.picture.clone()
        lower[0, 0, 0] = 1.0  # the fake shows this one's scene 10 px lower
        out = self.run_node(touches(name("hand", 45, 82)), image=torch.cat([self.picture, lower]))
        mask = out["result"][0]
        self.assertTrue(torch.equal(mask[0] > 0.5, torch.zeros(H, W, dtype=torch.bool)), "no hand there in the first picture")
        self.assertTrue(torch.equal(mask[1] > 0.5, torch.roll(HAND_LEFT, 10, 0).bool()))
        self.assertEqual(self.note(out)["items"], [{"ok": False, "share": 0.0, "as": "none"}], "the note describes the first picture")
        self.assertEqual([call["frames"] for call in FakeSam.calls], [1, 1])

    def test_a_name_without_a_text_reader_says_what_to_wire_and_points_need_none(self):
        with self.assertRaises(RuntimeError) as needs:
            self.run_node(touches(name("hand", 45, 73)), clip=None)
        self.assertEqual(str(needs.exception), NO_TEXT_READER)
        self.assertIn("Nothing is wired into clip", NO_TEXT_READER)
        self.assertTrue(torch.equal(self.area(self.run_node(touches(tap(75, 34)), clip=None)), GLASSES.bool()))

    def test_a_text_reader_that_is_not_sam3s_gets_wiring_advice(self):
        class CannotRead(FakeEncode):
            def encode(self, clip, text):
                raise RuntimeError("clip input is invalid")

        self.swap("_core_nodes", lambda: {"SAM3_Detect": FakeSam, "CLIPTextEncode": CannotRead})
        with self.assertRaises(RuntimeError) as advice:
            self.run_node(touches(name("hand", 45, 73)))
        self.assertTrue(str(advice.exception).startswith(NOT_SAM3))
        self.assertIn("Wire model and clip from a Load Checkpoint that loads the SAM 3 file", str(advice.exception))
        self.assertIn("clip input is invalid", str(advice.exception))

        class CannotUse(FakeSam):
            @classmethod
            def execute(cls, conditioning=None, **kwargs):
                if conditioning is not None:
                    raise RuntimeError("mat1 and mat2 shapes cannot be multiplied (77x768 and 1024x256)")
                return FakeSam.execute(**kwargs)

        self.swap("_core_nodes", lambda: {"SAM3_Detect": CannotUse, "CLIPTextEncode": FakeEncode})
        with self.assertRaises(RuntimeError) as advice:
            self.run_node(touches(name("hand", 45, 73)))
        self.assertTrue(str(advice.exception).startswith(NOT_SAM3))
        self.assertIn("77x768", str(advice.exception))
        self.assertTrue(torch.equal(self.area(self.run_node(touches(tap(75, 34)))), GLASSES.bool()), "a point still works")

        self.swap("_core_nodes", lambda: {"SAM3_Detect": FakeSam})
        with self.assertRaises(RuntimeError) as needs:
            self.run_node(touches(name("face", 60, 45)))
        self.assertEqual(str(needs.exception), NEEDS_SAM3)

    def test_an_answer_that_does_not_add_up_is_not_used(self):
        class OneScoreShort(FakeSam):
            @classmethod
            def execute(cls, **kwargs):
                out = FakeSam.execute(**kwargs)
                return types.SimpleNamespace(result=(out.result[0], [out.result[1][0][:-1]]))

        self.swap("_core_nodes", lambda: {"SAM3_Detect": OneScoreShort, "CLIPTextEncode": FakeEncode})
        with self.assertRaises(RuntimeError) as advice:
            self.run_node(touches(name("hand", 45, 73)))
        self.assertIn("does not add up", str(advice.exception))


class NothingPickedTests(TouchCase):
    def test_nothing_picked_stops_the_run_with_a_plain_message(self):
        for text in ("", touches(), touches(tap(*WALL)), touches(tap(75, 34), tap(75, 34, op=0)), touches(name("hand", 75, 80))):
            with self.assertRaises(RuntimeError) as stopped:
                self.run_node(text)
            self.assertEqual(str(stopped.exception), NOTHING_PICKED)

    def test_nothing_picked_can_pass_an_empty_mask_on_instead(self):
        out = self.run_node("", if_nothing="empty mask")
        mask, cut, _ = out["result"]
        self.assertEqual((float(mask.sum()), tuple(mask.shape)), (0.0, (1, H, W)))
        self.assertEqual(float(cut[..., 3].sum()), 0.0)
        note = self.note(out)
        self.assertEqual((note["selection"], note["items"], note["share"]), (None, [], 0.0))
        self.assertEqual(note["stamp"], "811c9dc5")

    def test_a_request_from_the_face_never_stops_the_run(self):
        self.swap("SCOPE_SECONDS_BLIND", -1.0)
        for ask in ("look", "scope", "scope:3,3", "anything"):
            note = self.note(self.run_node("", ask=ask))
            self.assertEqual(self.opened(note["picture"]).size, (W, H))
            self.assertIsNone(note["selection"])

    def test_picks_made_on_another_picture_are_not_this_pictures(self):
        text = touches(tap(75, 34), name("face", 60, 45), key="160x120-0000000000000000")
        with self.assertRaises(RuntimeError) as stopped:
            self.run_node(text)
        self.assertEqual(str(stopped.exception), OTHER_PICTURE, "the picks are there, on another picture")
        out = self.run_node(text, if_nothing="empty mask")
        self.assertEqual(float(out["result"][0].sum()), 0.0, "empty mask still lets the run go on")
        note = self.note(self.run_node(text, ask="look"))
        self.assertEqual((note["items"], note["key"], note["stamp"]), ([], picture_key(self.picture), touch_stamp(text)))
        self.assertEqual(FakeSam.calls, [])
        self.assertEqual(len(self.note(self.run_node(touches(tap(75, 34), key=picture_key(self.picture))))["items"]), 1)

    def test_text_that_is_not_touches_stops_before_any_search(self):
        for ask in ("", "look"):
            with self.assertRaises(ValueError) as stopped:
                self.run_node("{not json", ask=ask)
            self.assertEqual(str(stopped.exception), NOT_TOUCHES)
        with self.assertRaises(ValueError) as stopped:
            self.run_node(touches(tap(1, 1)), image=torch.zeros(H, W, 3))
        self.assertEqual(str(stopped.exception), NOT_A_PICTURE)
        self.assertEqual(FakeSam.calls, [])


class MemoryTests(TouchCase):
    def test_the_same_question_is_asked_once(self):
        text = touches(tap(75, 34), find([[50, 80], [100, 80]]))
        first = self.run_node(text)
        count = len(FakeSam.calls)
        self.assertEqual(count, 3, "one tap, and a stroke's two questions")
        again = self.run_node(text, grow=4, soften=1.0)
        self.assertEqual(len(FakeSam.calls), count, "new edge settings ask SAM 3 nothing")
        self.assertTrue(torch.equal(first["result"][0], self.run_node(text)["result"][0]))
        self.assertGreater(float(again["result"][0].sum()), float(first["result"][0].sum()))
        self.run_node(touches(tap(75, 34), find([[50, 80], [100, 80]]), tap(130, 90)))
        self.assertEqual(len(FakeSam.calls), count + 1, "only the new pick is asked")

    def test_answers_are_shared_by_nodes_and_kept_apart_by_picture_and_model(self):
        text = touches(tap(75, 34))
        self.run_node(text)
        self.run_node(text, node=node_module.AusBossMaskByTouch())
        self.run_node(text, clip="another text reader")
        self.assertEqual(len(FakeSam.calls), 1, "a second node on the same picture asks nothing, whatever reads its words")
        self.run_node(text, image=self.picture.flip(2))
        self.assertEqual(len(FakeSam.calls), 2, "another picture is asked anew")
        self.run_node(text, model=types.SimpleNamespace(model=object()))
        self.assertEqual(len(FakeSam.calls), 3, "another model is asked anew")

    def test_a_batch_asks_the_same_picks_of_every_picture(self):
        lower = self.picture.clone()
        lower[0, 0, 0] = 1.0  # the fake shows this one's scene 10 px lower
        batch = torch.cat([self.picture, lower])
        out = self.run_node(touches(tap(130, 95), paint([[10, 10]], r=2)), image=batch)
        mask = out["result"][0]
        self.assertEqual(tuple(mask.shape), (2, H, W))
        dot = stroke_area([[10, 10]], 2, H, W)
        self.assertTrue(torch.equal(mask[0] > 0.5, MUG.bool() | dot))
        self.assertTrue(torch.equal(mask[1] > 0.5, torch.roll(MUG, 10, 0).bool() | dot), "found where it is in that picture")
        self.assertEqual([call["frames"] for call in FakeSam.calls], [1, 1], "one picture a question")
        note = self.note(out)
        self.assertEqual(note["key"], picture_key(self.picture), "the note describes the first picture")
        self.assertEqual(note["items"][0]["share"], share(MUG))
        self.run_node(touches(tap(130, 95), paint([[10, 10]], r=2)), image=batch, grow=2)
        self.assertEqual(len(FakeSam.calls), 2, "each picture's answer is remembered")

    def test_a_batch_stops_only_when_no_picture_has_anything(self):
        lower = self.picture.clone()
        lower[0, 0, 0] = 1.0
        batch = torch.cat([self.picture, lower])
        mask = self.run_node(touches(tap(130, 112)), image=batch)["result"][0]
        self.assertEqual((float(mask[0].sum()), float(mask[1].sum())), (0.0, float(MUG.sum())))
        with self.assertRaises(RuntimeError):
            self.run_node(touches(tap(*WALL)), image=batch)


class PiecesTests(TouchCase):
    def test_a_look_names_the_things_and_points_find_what_no_word_found(self):
        out = self.run_node("", ask="scope")
        note = self.note(out)
        pieces = note["pieces"]
        self.assertEqual(sorted(pieces), ["list", "more", "planes", "words"])
        self.assertIs(pieces["more"], False)
        self.assertEqual(pieces["words"], [104, 104], "every word of the list was asked")
        self.assertEqual(
            [(entry["name"], entry["share"], entry["sure"], entry["kind"]) for entry in pieces["list"]],
            [(word, share(thing), sure, "point" if word is None else "name") for word, thing, sure in LOOKED],
            "smallest first: each thing once, by the word SAM 3 was surest of; the poster by a point",
        )
        masks = self.pieces_of(note)
        for mask, entry, (_, thing, _) in zip(masks, pieces["list"], LOOKED):
            self.assertEqual(sorted(entry), ["box", "kind", "name", "share", "sure", "x", "y"])
            self.assertTrue(torch.equal(mask, thing.bool()), "the mug without its speck too")
            self.assertTrue(bool(thing[entry["y"], entry["x"]]), "its own point lies on it")
            rows, columns = torch.nonzero(thing.sum(1)).flatten(), torch.nonzero(thing.sum(0)).flatten()
            self.assertEqual(entry["box"], [int(columns[0]), int(rows[0]), int(columns[-1]) + 1, int(rows[-1]) + 1])
        plane = self.opened(pieces["planes"][0])
        self.assertEqual((plane.format, plane.mode, plane.size), ("PNG", "RGB", (W, H)), "no see-through channel")
        self.assertNotIn("icc_profile", plane.info)
        self.assertEqual(float(out["result"][0].sum()), 0.0)

    def test_the_questions_go_words_points_more_words_the_other_points(self):
        self.run_node("", ask="scope")
        points = node_module._scope_plan(W, H)
        self.assertGreater(len(points), 350)
        kinds = ["word" if "word" in call else "point" for call in FakeSam.calls]
        self.assertEqual(kinds, ["word"] * 40 + ["point"] * 48 + ["word"] * 64 + ["point"] * (len(points) - 48))
        self.assertEqual(asked("word"), list(WORDS_FIRST) + list(WORDS_MORE))
        self.assertEqual(asked("points"), [[point] for point in points])
        self.assertEqual(len(node_module._scope_queue(W, H)), 104 + len(points))
        self.assertEqual((len(WORDS_FIRST), len(WORDS_MORE)), (40, 64))
        self.assertEqual(len(set(WORDS_FIRST) | set(WORDS_MORE)), 104, "no word is asked twice")

    def test_the_text_reader_reads_the_next_words_together(self):
        order = []

        class Encode(FakeEncode):
            def encode(self, clip, text):
                order.append(("read", text.rpartition(":")[0]))
                return super().encode(clip, text)

        class Sam(FakeSam):
            @classmethod
            def execute(cls, conditioning=None, **kwargs):
                if conditioning is not None:
                    order.append(("ask", conditioning[0][2].rpartition(":")[0]))
                return FakeSam.execute(conditioning=conditioning, **kwargs)

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Sam, "CLIPTextEncode": Encode})
        self.run_node("", ask="scope")
        ahead = node_module.WORDS_AHEAD
        self.assertEqual(order[:ahead], [("read", word) for word in WORDS_FIRST[:ahead]])
        self.assertEqual(order[ahead:2 * ahead], [("ask", word) for word in WORDS_FIRST[:ahead]])
        self.assertEqual(order[2 * ahead], ("read", WORDS_FIRST[ahead]))
        self.assertEqual(len(FakeEncode.calls), 104)
        # Another picture: the words are read already.
        self.run_node("", ask="scope", image=self.picture.flip(2))
        self.assertEqual(len(FakeEncode.calls), 104)

    def test_a_touch_on_a_piece_that_was_shown_gives_exactly_that_piece_and_asks_nothing(self):
        note = self.note(self.run_node("", ask="scope"))
        shown = self.pieces_of(note)
        count = len(FakeSam.calls)
        for index, entry in enumerate(note["pieces"]["list"]):
            out = self.run_node(touches(self.touch_for(entry), key=note["key"]))
            self.assertTrue(torch.equal(self.area(out), shown[index]), entry)
            selection = self.opened(self.note(out)["selection"]).pixels > 0
            self.assertTrue(torch.equal(selection, shown[index]), "the face's copy is the same, pixel for pixel")
            self.assertEqual(self.note(out)["items"], [{"ok": True, "share": entry["share"], "as": "thing"}])
        self.assertEqual(len(FakeSam.calls), count, "the touch costs nothing after the look")

    def test_a_named_piece_has_a_point_that_means_that_piece(self):
        note = self.note(self.run_node("", ask="scope"))
        entries = {(entry["name"], entry["share"]): entry for entry in note["pieces"]["list"]}
        big, pane = entries[("window", share(WINDOW))], entries[("window", share(PANE))]
        self.assertTrue(bool(WINDOW[big["y"], big["x"]]) and not bool(PANE[big["y"], big["x"]]), "the big window's point is not in the pane")
        self.assertTrue(abs(pane["x"] - 19.5) <= 1 and abs(pane["y"] - 79.5) <= 1, "in the middle of the pane, away from its edge")
        left, right = (entry for entry in note["pieces"]["list"] if entry["name"] == "hand")
        self.assertTrue(abs(left["x"] - 45.5) <= 1 and abs(left["y"] - 73.5) <= 1 and abs(right["x"] - 103.5) <= 1 and abs(right["y"] - 73.5) <= 1)
        self.assertEqual((left["sure"], right["sure"]), (0.9, 0.85))
        # The same word at each point means that piece and no other.
        for entry, thing in ((big, WINDOW), (pane, PANE), (left, HAND_LEFT), (right, HAND_RIGHT)):
            self.assertTrue(torch.equal(self.area(self.run_node(touches(self.touch_for(entry)))), thing.bool()))

    def test_two_words_for_one_area_are_one_piece_by_the_surer_word(self):
        note = self.look()
        names = [entry["name"] for entry in note["pieces"]["list"]]
        self.assertNotIn("sunglasses", names, "less sure than eyeglasses for the same area")
        self.assertIn("eyeglasses", names)
        self.assertNotIn("shirt", names, "blouse was surer for nearly the same area")
        self.assertIn("blouse", names)
        self.assertEqual(names.count(None), 1, "points that found the person, the face, the mug or the glasses again add no piece")

    def test_a_surer_word_takes_the_place_of_a_piece_that_was_shown(self):
        self.short_looks(60)
        first = self.note(self.run_node("", ask="scope"))
        self.assertIs(first["pieces"]["more"], True)
        self.assertEqual(first["pieces"]["words"], [40, 104], "the first words, and 20 points")
        shirt = next(entry for entry in first["pieces"]["list"] if entry["name"] == "shirt")
        self.assertEqual((shirt["share"], shirt["sure"]), (share(SHIRT), 0.7))
        last = self.look()
        blouse = next(entry for entry in last["pieces"]["list"] if entry["name"] == "blouse")
        self.assertEqual((blouse["share"], blouse["sure"]), (share(SHIRT_AGAIN), 0.95))
        self.assertNotIn("shirt", [entry["name"] for entry in last["pieces"]["list"]])
        # What was clicked while "shirt" was lit is still the shirt.
        out = self.run_node(touches(self.touch_for(shirt)))
        self.assertTrue(torch.equal(self.area(out), SHIRT.bool()))

    def test_a_named_piece_is_kept_however_small_or_big_and_a_point_piece_is_not(self):
        everything = torch.ones(H, W)
        everything[:, :10] = 0.0
        self.addCleanup(NAMED.pop, "wall")
        NAMED["wall"] = [(everything, 0.96)]
        dot = block(100, 150, 3, 3)
        for position, thing in ((0, ("dot", dot, dot)), (len(SCENE), ("backdrop", everything, everything))):
            self.addCleanup(SCENE.remove, thing)
            SCENE.insert(position, thing)
        note = self.look()
        by_name = {entry["name"]: entry for entry in note["pieces"]["list"]}
        self.assertEqual(by_name["earring"]["share"], share(EARRING), "9 pixels, and kept: a word pointed at it")
        self.assertEqual(by_name["wall"]["share"], share(everything), "nearly the whole picture, and kept")
        points = [entry for entry in note["pieces"]["list"] if entry["kind"] == "point"]
        self.assertEqual([entry["share"] for entry in points], [share(POSTER)], "no 9-pixel dot and no backdrop from a point")

    def test_a_name_for_nearly_the_whole_picture_is_shown_only_when_sam3_is_sure(self):
        # "The whole picture is a mirror", and SAM 3 only fairly sure: the
        # pointer must not say "mirror" over everything nothing else covers.
        everything = torch.ones(H, W)
        everything[:, :10] = 0.0
        self.addCleanup(NAMED.pop, "mirror")
        NAMED["mirror"] = [(everything, 0.81)]
        note = self.look()
        self.assertNotIn("mirror", [entry["name"] for entry in note["pieces"]["list"]])
        # Typed, it is what the user asked for, and is found.
        out = self.run_node(json.dumps({"v": 1, "items": [{"t": "all", "w": "mirror", "op": 1}]}))
        self.assertTrue(torch.equal(self.area(out), everything.bool()))

    def test_a_tap_made_before_the_look_is_the_piece_the_look_shows(self):
        on_the_poster = next(point for point in node_module._scope_plan(W, H) if float(POSTER[point[1], point[0]]) > 0)
        tapped = self.area(self.run_node(touches(tap(*on_the_poster))))
        note = self.note(self.run_node("", ask="scope"))
        poster = next(index for index, entry in enumerate(note["pieces"]["list"]) if (entry["x"], entry["y"]) == on_the_poster)
        self.assertTrue(torch.equal(self.pieces_of(note)[poster], tapped))
        self.assertEqual(asked("points").count([on_the_poster]), 1, "asked once, by the tap")

    def test_a_small_picture_is_asked_about_fewer_points(self):
        self.swap("SCOPE_SPACING", 16)
        plan = node_module._scope_plan(W, H)
        self.assertEqual(plan, scope_points(W, H, (W * H) // 256), "about one point for every 16 x 16 pixels")
        self.assertTrue(70 <= len(plan) <= 85)
        self.assertEqual(node_module._scope_plan(912, 1632), scope_points(912, 1632, node_module.SCOPE_POINTS))
        self.assertEqual(len(node_module._scope_plan(8, 8)), 1)
        self.assertEqual(len(node_module._scope_queue(8, 8)), 105, "every word, and the one point")
        note = self.note(self.run_node("", ask="scope"))
        self.assertEqual(len(asked("points")), len(plan))
        self.assertIs(note["pieces"]["more"], False)

    def test_an_ordinary_run_returns_the_pieces_found_so_far(self):
        self.assertIsNone(self.note(self.run_node("", ask="look"))["pieces"], "null means: not looked at yet")
        scoped = self.note(self.run_node("", ask="scope"))["pieces"]
        plain = self.note(self.run_node(touches(tap(75, 34))))["pieces"]
        self.assertEqual(plain, scoped, "the same files, not written again")
        other = self.note(self.run_node(touches(tap(75, 34)), node=node_module.AusBossMaskByTouch()))["pieces"]
        self.assertEqual(other["list"], scoped["list"], "another node on the same picture has them too")
        self.assertNotEqual(other["planes"], scoped["planes"])

    def test_a_picture_with_nothing_in_it_has_no_pieces_which_is_not_null(self):
        class Blind(FakeSam):
            @classmethod
            def execute(cls, model, image, conditioning=None, **_):
                if conditioning is not None:
                    return types.SimpleNamespace(result=(torch.zeros(0, H, W), [[]]))
                return types.SimpleNamespace(result=(torch.zeros(image.shape[0], H, W), [[]]))

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Blind, "CLIPTextEncode": FakeEncode})
        self.assertEqual(self.note(self.run_node("", ask="scope"))["pieces"], {"planes": [], "list": [], "more": False, "words": [104, 104]})

    def test_over_120_pieces_the_point_pieces_go_first_and_five_planes_hold_the_rest(self):
        saved = dict(NAMED)
        self.addCleanup(NAMED.update, saved)
        self.addCleanup(NAMED.clear)
        NAMED.clear()
        tiles = [block(row * 6, column * 6, 4, 4) for row in range(20) for column in range(8)]  # 160 small things
        for number, word in enumerate(WORDS_FIRST[:10]):
            NAMED[word] = [(tile, 0.99 - 0.001 * (number * 16 + slot)) for slot, tile in enumerate(tiles[number * 16:number * 16 + 16])]
        note = self.look()
        pieces = note["pieces"]
        self.assertEqual((len(pieces["list"]), len(pieces["planes"])), (120, 5))
        self.assertEqual({entry["kind"] for entry in pieces["list"]}, {"name"}, "the point pieces went first")
        self.assertEqual(min(entry["sure"] for entry in pieces["list"]), 0.871, "then the names SAM 3 was least sure of")
        shown = self.pieces_of(note)
        for index in (0, 23, 24, 119):
            entry = pieces["list"][index]
            self.assertTrue(torch.equal(self.area(self.run_node(touches(self.touch_for(entry)))), shown[index]))


class RoundTests(TouchCase):
    """A look goes through the whole list, gives way to any job that waits,
    and the next look goes on where it stopped."""

    def test_one_look_asks_everything_while_no_job_waits(self):
        self.swap("_jobs_waiting", lambda: 0)
        clock = [0.0]
        self.swap("time", types.SimpleNamespace(perf_counter=lambda: clock[0]))

        class Slow(FakeSam):
            @classmethod
            def execute(cls, **kwargs):
                clock[0] += 1.0  # far longer than a round used to be
                return FakeSam.execute(**kwargs)

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Slow, "CLIPTextEncode": FakeEncode})
        note = self.note(self.run_node("", ask="scope"))
        self.assertIs(note["pieces"]["more"], False)
        self.assertEqual(len(FakeSam.calls), len(node_module._scope_queue(W, H)), "no time limit: one run, the whole list")
        self.assertEqual([(entry["name"], entry["share"]) for entry in note["pieces"]["list"]], [(word, share(thing)) for word, thing, _ in LOOKED])

    def test_a_look_cut_short_hands_back_and_the_next_goes_on(self):
        self.short_looks(50)
        total = len(node_module._scope_queue(W, H))
        seen, rounds = {}, 0
        while True:
            before = len(FakeSam.calls)
            note = self.note(self.run_node("", ask="scope"))
            rounds += 1
            pieces = note["pieces"]
            self.assertLessEqual(len(FakeSam.calls) - before, 50, "a look that is cut short hands back")
            self.assertEqual(pieces["words"], [sum(1 for call in FakeSam.calls if "word" in call), 104])
            for mask, entry in zip(self.pieces_of(note), pieces["list"]):
                ident = (entry["name"], entry["x"], entry["y"])
                if ident in seen:
                    self.assertTrue(torch.equal(seen[ident], mask), "a piece keeps its point and its shape")
                seen[ident] = mask
            self.assertEqual([entry["share"] for entry in pieces["list"]], sorted(entry["share"] for entry in pieces["list"]))
            if not pieces["more"]:
                break
        self.assertEqual(rounds, math.ceil(total / 50))
        self.assertEqual(len(FakeSam.calls), total, "every question is asked once over the rounds")
        self.assertEqual([(entry["name"], entry["share"]) for entry in pieces["list"]], [(word, share(thing)) for word, thing, _ in LOOKED])
        self.run_node("", ask="scope")
        self.assertEqual(len(FakeSam.calls), total, "nothing is left to ask")

    def test_a_round_stops_as_soon_as_another_job_waits(self):
        # A click arrives while the 6th question is asked, and waits from then on.
        self.swap("_jobs_waiting", lambda: 1 if len(FakeSam.calls) >= 6 else 0)
        first = self.note(self.run_node("", ask="scope"))
        self.assertEqual(asked("word"), list(WORDS_FIRST[:6]), "the question in hand is finished, then the round ends")
        self.assertIs(first["pieces"]["more"], True)
        self.assertEqual([entry["name"] for entry in first["pieces"]["list"]], ["hand", "hand", "face", "shirt", "person"], "what was found so far comes back")
        # While something waits, every round still asks one question, so the list always ends.
        self.note(self.run_node("", ask="scope"))
        self.assertEqual(asked("word"), list(WORDS_FIRST[:7]))
        self.note(self.run_node("", ask="scope:130,90"))
        self.assertEqual(asked("points"), [[(130, 90)]], "the pointer's place first")
        self.assertEqual(asked("word"), list(WORDS_FIRST[:8]), "and one question of the list")

    def test_reading_words_ahead_stops_when_a_job_waits(self):
        self.swap("_jobs_waiting", lambda: 1)
        self.note(self.run_node("", ask="scope"))
        self.assertEqual((len(FakeEncode.calls), asked("word")), (1, ["person"]), "the word in hand is read and asked, no more")

    def test_where_the_queue_cannot_be_read_rounds_are_short(self):
        self.swap("_jobs_waiting", lambda: None)
        self.swap("SCOPE_SECONDS_BLIND", -1.0)
        note = self.note(self.run_node("", ask="scope"))
        self.assertEqual(len(FakeSam.calls), 1, "its short time is over after the first question")
        self.assertIs(note["pieces"]["more"], True)
        self.swap("SCOPE_SECONDS_BLIND", 1e9)
        self.assertIs(self.note(self.run_node("", ask="scope"))["pieces"]["more"], False)

    def test_the_real_settings(self):
        self.doCleanups()  # what setUp changed for the tests is put back
        self.assertFalse(hasattr(node_module, "SCOPE_SECONDS"), "a look has no time limit where the queue can be read")
        self.assertEqual((node_module.SCOPE_SECONDS_BLIND, node_module.SCOPE_FLOOR), (1.0, 1))
        self.assertEqual((node_module.LOOK_TELL_SECONDS, node_module.LOOK_EVENT), (1.5, "ausboss.mask_by_touch.look"))
        self.assertIs(node_module.QUIET, True)
        self.assertEqual((node_module.SCOPE_POINTS, node_module.SCOPE_FIRST_POINTS, node_module.WORDS_AHEAD), (400, 48, 16))

    def test_a_slow_first_answer_does_not_use_up_a_look_that_is_timed(self):
        # Where the queue cannot be read a look is timed. Loading SAM 3 takes
        # longer than that: the time starts after it.
        clock = [0.0]
        self.swap("time", types.SimpleNamespace(perf_counter=lambda: clock[0]))
        self.swap("_jobs_waiting", lambda: None)
        self.swap("SCOPE_SECONDS_BLIND", 3.0)

        class Slow(FakeSam):
            @classmethod
            def execute(cls, **kwargs):
                clock[0] += 5.0 if not FakeSam.calls else 0.5
                return FakeSam.execute(**kwargs)

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Slow, "CLIPTextEncode": FakeEncode})
        self.note(self.run_node("", ask="scope"))
        self.assertEqual(len(FakeSam.calls), 8, "the loading answer, then three seconds of half-second answers")
        self.note(self.run_node("", ask="scope"))
        self.assertEqual(len(FakeSam.calls), 15, "a warm look: three seconds from its start")

    def test_the_queue_is_only_looked_at(self):
        class Queue:
            def __init__(self):
                self.queue = [("a job",), ("another",)]

            def __setattr__(self, key, value):
                if key != "queue" or hasattr(self, "queue"):
                    raise AssertionError("the queue was changed")
                object.__setattr__(self, key, value)

        server = types.ModuleType("server")
        server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(prompt_queue=Queue()))
        self.addCleanup(sys.modules.pop, "server", None)
        sys.modules["server"] = server
        self.assertEqual(node_module._jobs_waiting(), 2)
        self.assertEqual(server.PromptServer.instance.prompt_queue.queue, [("a job",), ("another",)])
        server.PromptServer = types.SimpleNamespace(instance=None)
        self.assertIsNone(node_module._jobs_waiting(), "another ComfyUI: it cannot be read")
        del sys.modules["server"]
        self.assertIsNone(node_module._jobs_waiting())

    def test_the_server_is_only_asked_to_send(self):
        sent = []
        server = types.ModuleType("server")
        instance = types.SimpleNamespace(client_id="a page", send_sync=lambda *args: sent.append(args))
        server.PromptServer = types.SimpleNamespace(instance=instance)
        self.addCleanup(sys.modules.pop, "server", None)
        sys.modules["server"] = server
        self.assertIs(node_module._tell(5, {"key": "k"}, True), True)
        self.assertEqual(sent, [("ausboss.mask_by_touch.look", {"node": "5", "note": {"key": "k"}, "end": True}, "a page")], "to the page that asked")
        self.assertIs(node_module._tell(None, {}, True), False, "no id: nobody to tell")
        server.PromptServer = types.SimpleNamespace(instance=None)
        self.assertIs(node_module._tell(5, {}, True), False, "no page to tell")
        del sys.modules["server"]
        self.assertIs(node_module._tell(5, {}, True), False, "outside ComfyUI")
        self.assertEqual(len(sent), 1)

    def test_a_first_look_stopped_half_way_is_gone_on_with(self):
        class Stopped(BaseException):
            pass

        left = [30]

        def check():
            left[0] -= 1
            if left[0] < 0:
                raise Stopped()

        self.swap("raise_if_interrupted", check)
        with self.assertRaises(Stopped):
            self.run_node("", ask="scope")
        self.swap("raise_if_interrupted", lambda: None)
        self.assertEqual(len(FakeSam.calls), 30)
        waiting = self.note(self.run_node("", ask="look"))["pieces"]
        self.assertEqual((waiting["list"], waiting["more"], waiting["words"]), ([], True, [30, 104]), "nothing to show yet, and it says more is left")
        last = self.note(self.run_node("", ask="scope"))
        self.assertEqual([(entry["name"], entry["share"]) for entry in last["pieces"]["list"]], [(word, share(thing)) for word, thing, _ in LOOKED])
        self.assertEqual(len(FakeSam.calls), len(node_module._scope_queue(W, H)), "the 30 words are not asked again")

    def test_a_round_stopped_half_way_loses_nothing(self):
        class Stopped(BaseException):
            pass

        self.short_looks(20)
        first = self.note(self.run_node("", ask="scope"))
        self.assertIs(first["pieces"]["more"], True)
        # The user stops the second round after 250 more questions.
        left = [250]

        def check():
            left[0] -= 1
            if left[0] < 0:
                raise Stopped()

        self.swap("SCOPE_FLOOR", 1000)
        self.swap("raise_if_interrupted", check)
        with self.assertRaises(Stopped):
            self.run_node("", ask="scope")
        self.swap("raise_if_interrupted", lambda: None)
        last = self.note(self.run_node("", ask="scope"))
        self.assertIs(last["pieces"]["more"], False)
        self.assertEqual([(entry["name"], entry["share"]) for entry in last["pieces"]["list"]], [(word, share(thing)) for word, thing, _ in LOOKED])
        for mask, (_, thing, _) in zip(self.pieces_of(last), LOOKED):
            self.assertTrue(torch.equal(mask, thing.bool()))
        self.assertGreater(len(last["pieces"]["list"]), len(first["pieces"]["list"]), "the stopped round had found something")
        total = len(node_module._scope_queue(W, H))
        self.assertTrue(total <= len(FakeSam.calls) <= total + 2, "only a point piece the stopped round kept is asked for again")

    def test_the_pointers_place_is_asked_first(self):
        self.short_looks(3)
        note = self.note(self.run_node("", ask="scope:130,8"))
        self.assertEqual(FakeSam.calls[0]["points"], [(130, 8)])
        self.assertEqual(asked("word"), list(WORDS_FIRST[:3]))
        poster = next(entry for entry in note["pieces"]["list"] if entry["kind"] == "point")
        self.assertEqual((poster["x"], poster["y"], poster["share"], poster["name"], poster["sure"]), (130, 8, share(POSTER), None, None))
        self.assertIs(note["pieces"]["more"], True)
        before = len(FakeSam.calls)
        self.run_node(touches(tap(130, 8)))
        self.assertEqual(len(FakeSam.calls), before, "a click there afterwards costs nothing")

    def test_a_small_thing_under_the_pointer_is_a_piece_and_one_point_is_asked_once_all_is_looked_at(self):
        dot = block(100, 150, 2, 2)
        self.addCleanup(SCENE.remove, ("dot", dot, dot))
        SCENE.insert(0, ("dot", dot, dot))
        note = self.note(self.run_node("", ask="scope"))
        self.assertIs(note["pieces"]["more"], False)
        self.assertEqual(len(note["pieces"]["list"]), len(LOOKED), "too small for a point piece unless it is pointed at")
        before = len(FakeSam.calls)
        pointed = self.note(self.run_node("", ask="scope:151,101"))
        self.assertEqual(len(FakeSam.calls), before + 1, "just that one point")
        self.assertEqual(
            pointed["pieces"]["list"][0],
            {"x": 151, "y": 101, "share": round(4 / (H * W), 5), "box": [150, 100, 152, 102], "kind": "point", "name": None, "sure": None},
        )
        self.assertEqual(pointed["pieces"]["words"], [104, 104])
        self.assertIs(pointed["pieces"]["more"], False)
        self.assertTrue(torch.equal(self.pieces_of(pointed)[0], dot.bool()))
        self.assertNotEqual(pointed["pieces"]["planes"], note["pieces"]["planes"], "a new list is a new file")
        # A point outside the picture, or not two whole numbers, is a plain look.
        for ask in ("scope:999,5", "scope:a,b"):
            self.assertEqual(self.note(self.run_node("", ask=ask))["pieces"], pointed["pieces"])
        # The pointer on a named piece: the point's answer is the same area, so nothing is added.
        again = self.note(self.run_node("", ask="scope:75,34"))
        self.assertEqual(again["pieces"], pointed["pieces"])
        self.assertEqual(len(FakeSam.calls), before + 2)


class ModelTests(TouchCase):
    CLIP = types.SimpleNamespace(patcher="sam3 text reader")

    def use_memory(self, management):
        self.swap("_model_management", lambda: management)

    def test_free_vram_unloads_sam3_and_its_text_reader_and_only_when_asked(self):
        unloaded = []
        self.use_memory(types.SimpleNamespace(unload_model_and_clones=unloaded.append))
        self.run_node(touches(tap(75, 34)), clip=self.CLIP)
        self.assertEqual(unloaded, [], "off by default: SAM 3 stays loaded for the next pick")
        mask = self.run_node(touches(tap(75, 34)), clip=self.CLIP, free_vram=True)["result"][0]
        self.assertEqual(unloaded, ["sam3 model", "sam3 text reader"], "only the two it was given")
        self.assertTrue(torch.equal(mask[0] > 0.5, GLASSES.bool()))
        self.swap("SCOPE_SECONDS_BLIND", -1.0)
        for ask in ("scope", "scope:3,3", "look"):
            self.run_node(touches(tap(75, 34)), clip=self.CLIP, free_vram=True, ask=ask)
        self.assertEqual(len(unloaded), 2, "a run the face asked for keeps SAM 3 for the next click")
        spec = node_module.AusBossMaskByTouch.INPUT_TYPES()["optional"]["free_vram"][1]
        self.assertIs(spec["default"], False)

    def test_free_vram_also_unloads_when_the_run_stops_and_never_fails_a_run(self):
        unloaded = []
        self.use_memory(types.SimpleNamespace(unload_model_and_clones=unloaded.append))
        with self.assertRaises(RuntimeError):
            self.run_node("", clip=self.CLIP, free_vram=True)
        self.assertEqual(unloaded, ["sam3 model", "sam3 text reader"])

        def refuses(_patcher):
            raise RuntimeError("cannot unload")

        for management in (types.SimpleNamespace(), None, types.SimpleNamespace(unload_model_and_clones=refuses)):
            self.use_memory(management)
            for clip in (self.CLIP, None, "a text reader without a patcher"):
                mask = self.run_node(touches(tap(75, 34)), clip=clip, free_vram=True)["result"][0]
                self.assertTrue(torch.equal(mask[0] > 0.5, GLASSES.bool()))

    def test_without_comfyuis_sam3_it_says_what_it_needs(self):
        self.swap("_core_nodes", lambda: {})
        for text in (touches(tap(75, 34)), touches(name("face", 60, 45))):
            with self.assertRaises(RuntimeError) as needs:
                self.run_node(text)
            self.assertEqual(str(needs.exception), NEEDS_SAM3)
        self.assertEqual(float(self.run_node(touches(paint([[10, 10]], r=3)))["result"][0].sum()), float(stroke_area([[10, 10]], 3, H, W).sum()), "paint needs no model")

    def test_a_model_that_is_not_sam3_gets_wiring_advice_not_a_stack_trace(self):
        class Broken(FakeSam):
            @classmethod
            def execute(cls, **_kwargs):
                raise AttributeError("'Flux' object has no attribute 'forward_segment'")

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Broken, "CLIPTextEncode": FakeEncode})
        for text in (touches(tap(75, 34)), touches(name("face", 60, 45))):
            with self.assertRaises(RuntimeError) as advice:
                self.run_node(text)
            self.assertIn("Load Checkpoint that loads the SAM 3 file", str(advice.exception))
            self.assertIn("forward_segment", str(advice.exception))
            self.assertIn("Mask by Touch", str(advice.exception))

        class WrongShape(FakeSam):
            @classmethod
            def execute(cls, **_kwargs):
                return types.SimpleNamespace(result=(torch.zeros(1, 7, 7), [[]]))

        self.swap("_core_nodes", lambda: {"SAM3_Detect": WrongShape, "CLIPTextEncode": FakeEncode})
        with self.assertRaises(RuntimeError) as advice:
            self.run_node(touches(tap(75, 34)))
        self.assertIn("not one mask the size of the picture", str(advice.exception))

    def test_a_stop_by_the_user_and_a_full_gpu_are_passed_on_as_they_are(self):
        class InterruptProcessingException(BaseException):
            pass

        for error in (InterruptProcessingException(), RuntimeError("CUDA out of memory")):
            class Raises(FakeSam):
                @classmethod
                def execute(cls, **_kwargs):
                    raise error

            class RaisesToo(FakeEncode):
                def encode(self, clip, text):
                    raise error

            for core in ({"SAM3_Detect": Raises, "CLIPTextEncode": FakeEncode}, {"SAM3_Detect": FakeSam, "CLIPTextEncode": RaisesToo}):
                self.swap("_core_nodes", lambda core=core: core)
                node_module._WORDS.clear()  # the word is read anew
                with self.assertRaises(type(error)) as passed:
                    self.run_node(touches(name("face", 60, 45)))
                self.assertIs(passed.exception, error)


class Reader:
    """Stands in for SAM 3's picture reader: counts how often it reads."""

    def __init__(self):
        self.reads = []

    def forward(self, images, tracker_mode=None):
        self.reads.append(tracker_mode)
        return [images.mean()]


class QuickTests(TouchCase):
    """Asking SAM 3 the quick way: the picture is read once and the model's
    load is checked once per run, and only after both are proven harmless,
    for points and for words apart."""

    def setUp(self):
        super().setUp()
        self.reader = Reader()
        detector = types.SimpleNamespace(backbone={"vision_backbone": self.reader})
        self.model = types.SimpleNamespace(model=types.SimpleNamespace(diffusion_model=types.SimpleNamespace(detector=detector)))
        self.clip = types.SimpleNamespace(patcher="the text reader", cond_stage_model=object())
        self.loads = []
        self.management = types.SimpleNamespace(current_loaded_models=[], load_model_gpu=self.load)
        self.swap("_model_management", lambda: self.management)
        test = self

        class AsCore(FakeSam):
            """Loads the model and reads the picture, as ComfyUI does: twice
            for a point; for a word once, and twice the cut-out of each match."""

            spoiled = False
            unsteady = 0

            @classmethod
            def execute(cls, model, image, conditioning=None, **kwargs):
                test.management.load_model_gpu(model)
                quick = "forward" in vars(test.reader)
                out = FakeSam.execute(model, image, conditioning=conditioning, **kwargs)
                if conditioning is None:
                    for _ in range(2):
                        test.reader.forward(image, tracker_mode="interactive")
                else:
                    test.reader.forward(image, tracker_mode="propagation")
                    for match in out.result[0]:
                        for _ in range(2):
                            test.reader.forward(image * match[None, :, :, None], tracker_mode="interactive")
                if (cls.spoiled and quick) or cls.unsteady:
                    cls.unsteady += 1 if cls.unsteady else 0
                    if out.result[0].shape[0]:
                        out.result[0][:, 0, (cls.unsteady + 1) % W] = 1.0
                return out

        class ReadsAsCore(FakeEncode):
            """Loading the text reader puts it in front of SAM 3."""

            def encode(self, clip, text):
                test.management.current_loaded_models.insert(0, types.SimpleNamespace(model=getattr(clip, "patcher", clip)))
                return super().encode(clip, text)

        self.detector, self.encoder = AsCore, ReadsAsCore

    def load(self, model):
        self.loads.append(model)
        self.management.current_loaded_models.insert(0, types.SimpleNamespace(model=model))

    def quick(self, **overrides):
        return self.run_node(model=self.model, clip=self.clip, **overrides)

    def trust(self):
        return {kind: value for (_, kind), value in node_module._TRUST.items()}

    def three_taps(self):
        return touches(tap(75, 34), tap(130, 90), tap(50, 100))

    def three_names(self):
        return touches(name("face", 60, 45), name("cup", 130, 90), name("person", 50, 100))

    def test_the_first_run_proves_it_for_points_and_later_runs_use_it(self):
        out = self.quick(text=self.three_taps())
        self.assertTrue(torch.equal(self.area(out), (GLASSES + MUG + PERSON).bool()))
        self.assertEqual(self.trust(), {"point": True})
        # 1st question plain (a load, two reads); 2nd with it on (a load, one
        # read); the 1st again as the proof and the 3rd: nothing new.
        self.assertEqual((len(self.loads), len(self.reader.reads), len(FakeSam.calls)), (2, 3, 4))
        self.loads.clear()
        self.reader.reads.clear()
        self.quick(text=touches(tap(60, 45), tap(131, 91), tap(51, 101)))
        self.assertEqual((len(self.loads), len(self.reader.reads)), (1, 1), "one load and one read for a whole run")

    def test_words_are_proven_apart_from_points(self):
        self.quick(text=self.three_taps())
        self.loads.clear()
        self.reader.reads.clear()
        out = self.quick(text=self.three_names())
        self.assertTrue(torch.equal(self.area(out), (FACE + MUG + PERSON).bool()))
        self.assertEqual(self.trust(), {"point": True, "word": True})
        # face the plain way: a load, the picture, its cut-out twice. Then the
        # quick way: a load, the picture, the cup's cut-out; face again for
        # the proof: its cut-out; person: its cut-out, and a load, because
        # reading the word "person" put the text reader in front.
        self.assertEqual(len(self.loads), 3)
        self.assertEqual(self.reader.reads, ["propagation", "interactive", "interactive", "propagation", "interactive", "interactive", "interactive"])
        self.assertEqual(asked("word"), ["face", "cup", "face", "person"])

    def test_a_question_that_finds_nothing_proves_nothing(self):
        out = self.quick(text=touches(tap(*WALL), tap(6, 6), tap(75, 34), tap(130, 90)), if_nothing="empty mask")
        self.assertTrue(torch.equal(self.area(out), (GLASSES + MUG).bool()))
        self.assertEqual(self.trust(), {"point": True})
        # Three plain questions until one finds something, then the proof.
        self.assertEqual((len(self.loads), len(FakeSam.calls)), (4, 5))

    def test_a_whole_look_costs_a_load_for_each_batch_of_words_and_a_read_for_each_match(self):
        # Both kinds of question are proven first, on words the look does not ask.
        for word, thing in (("one", FACE), ("two", MUG)):
            self.addCleanup(NAMED.pop, word)
            NAMED[word] = [(thing, 0.9)]
        self.quick(text=self.three_taps())
        self.quick(text=touches(name("one", 60, 45), name("two", 130, 90)), image=self.picture.flip(1))
        self.assertEqual(self.trust(), {"point": True, "word": True})
        self.loads.clear()
        self.reader.reads.clear()
        note = self.note(self.quick(ask="scope"))
        self.assertEqual([entry["name"] for entry in note["pieces"]["list"]], [word for word, _, _ in LOOKED])
        # SAM 3 is loaded again after each batch of words the text reader read
        # (it came in front), not for each of the 503 questions.
        batches = math.ceil(len(WORDS_FIRST) / node_module.WORDS_AHEAD) + math.ceil(len(WORDS_MORE) / node_module.WORDS_AHEAD)
        self.assertEqual(len(self.loads), batches)
        matches = sum(len(found) for found in NAMED.values())
        self.assertEqual(self.reader.reads.count("propagation"), 1, "the whole picture is read once for all the words")
        self.assertLessEqual(self.reader.reads.count("interactive"), matches + 3, "a cut-out is read once, not twice; the picture once more for points")

    def test_everything_is_put_back_after_a_run_also_one_that_stops(self):
        plain_load = self.management.load_model_gpu
        self.quick(text=self.three_taps())
        self.quick(text=self.three_names())
        self.assertNotIn("forward", vars(self.reader))
        self.assertIs(self.management.load_model_gpu.__func__, plain_load.__func__)
        with self.assertRaises(RuntimeError):
            self.quick(text=touches(tap(*WALL), tap(6, 6), tap(7, 7)))
        self.assertNotIn("forward", vars(self.reader))
        self.assertIs(self.management.load_model_gpu.__func__, plain_load.__func__)

    def test_another_picture_is_read_again_and_another_model_is_loaded_as_always(self):
        self.quick(text=self.three_taps())
        self.reader.reads.clear()
        lower = self.picture.clone()
        lower[0, 0, 0] = 1.0
        self.quick(text=self.three_taps(), image=torch.cat([self.picture.flip(2), lower]))
        self.assertEqual(len(self.reader.reads), 2, "once for each of the two pictures")
        with node_module._loaded_once(self.model):
            self.loads.clear()
            for _ in range(3):
                self.management.load_model_gpu("another model")
                self.management.load_model_gpu(self.model)
            self.assertEqual(self.loads.count("another model"), 3)
            self.assertEqual(self.loads.count(self.model), 3, "loaded again each time another model came in front")

    def test_if_it_changes_an_answer_it_is_never_used_again(self):
        self.detector.spoiled = True
        out = self.quick(text=self.three_taps())
        self.assertTrue(torch.equal(self.area(out), (GLASSES + MUG + PERSON).bool()), "the answers are the plain ones")
        self.assertEqual(self.trust(), {"point": False, "word": False}, "for words too: something is wrong here")
        self.loads.clear()
        self.reader.reads.clear()
        self.quick(text=touches(tap(60, 45), tap(131, 91), tap(51, 101)))
        self.assertEqual((len(self.loads), len(self.reader.reads)), (3, 6), "every question the plain way")

    def test_if_it_changes_a_words_answer_it_is_never_used_again(self):
        self.quick(text=self.three_taps())
        self.detector.spoiled = True
        out = self.quick(text=self.three_names())
        self.assertTrue(torch.equal(self.area(out), (FACE + MUG + PERSON).bool()), "the answers are the plain ones")
        self.assertEqual(self.trust(), {"point": False, "word": False})

    def test_a_sam3_that_never_repeats_an_answer_is_asked_the_plain_way(self):
        self.detector.unsteady = 1
        for run in range(3):
            self.quick(text=touches(tap(75 + run, 34), tap(130 + run, 90), tap(50 + run, 100)))
            self.assertNotIn("forward", vars(self.reader))
        self.assertEqual(self.trust(), {"point": False}, "after three tries it is left off")

    def test_a_question_that_fails_with_it_on_is_asked_again_the_plain_way(self):
        self.quick(text=self.three_taps())
        plain_execute = self.detector.execute.__func__
        failed = []

        def fails_when_quick(cls, model, image, **kwargs):
            if "forward" in vars(self.reader):
                failed.append(1)
                raise RuntimeError("Expected all tensors to be on the same device")
            return plain_execute(cls, model, image, **kwargs)

        self.detector.execute = classmethod(fails_when_quick)
        out = self.quick(text=touches(tap(60, 45), tap(131, 91)))
        self.assertTrue(torch.equal(self.area(out), (FACE + MUG).bool()))
        self.assertEqual((len(failed), self.trust()), (1, {"point": False, "word": False}))

    def test_a_wrong_text_reader_does_not_cost_the_quick_way(self):
        self.quick(text=self.three_taps())
        self.quick(text=self.three_names())
        plain_execute = self.detector.execute.__func__

        def cannot_use(cls, model, image, conditioning=None, **kwargs):
            if conditioning is not None and conditioning[0][1] == "wrong":
                raise RuntimeError("mat1 and mat2 shapes cannot be multiplied")
            return plain_execute(cls, model, image, conditioning=conditioning, **kwargs)

        self.detector.execute = classmethod(cannot_use)
        with self.assertRaises(RuntimeError) as advice:
            self.run_node(touches(tap(61, 46), name("hand", 45, 73)), model=self.model, clip="wrong")
        self.assertTrue(str(advice.exception).startswith(NOT_SAM3))
        self.assertEqual(self.trust(), {"point": True, "word": True}, "the wiring was wrong, not the quick way")
        self.assertNotIn("forward", vars(self.reader))

    def test_it_can_be_switched_off(self):
        self.swap("QUICK", False)
        self.quick(text=self.three_taps())
        self.assertEqual((len(self.loads), len(self.reader.reads), node_module._TRUST), (3, 6, {}))

    def test_without_the_parts_it_needs_it_asks_the_plain_way(self):
        self.swap("_model_management", lambda: None)
        bare = types.SimpleNamespace(model=object())
        out = self.run_node(self.three_taps(), model=bare)
        self.assertTrue(torch.equal(self.area(out), (GLASSES + MUG + PERSON).bool()))
        self.assertEqual(self.trust(), {"point": False})


class AllTests(TouchCase):
    """An `all` touch: every thing SAM 3 calls by a word, joined."""

    def test_all_takes_every_thing_of_that_name(self):
        out = self.run_node(touches(every("hand"), key=picture_key(self.picture)))
        self.assertTrue(torch.equal(self.area(out), (HAND_LEFT + HAND_RIGHT).bool()))
        self.assertEqual(self.note(out)["items"], [{"ok": True, "share": share(HAND_LEFT + HAND_RIGHT), "as": "thing", "count": 2}])
        (call,) = FakeSam.calls
        self.assertEqual((call["text"], call["threshold"], call["passes"], call["individual"]), ("hand:16", 0.5, 2, True), "asked as the list's words are")

    def test_things_inside_each_other_are_joined_and_counted(self):
        out = self.run_node(touches(every("window")))
        self.assertTrue(torch.equal(self.area(out), WINDOW.bool()), "the pane lies inside the window")
        self.assertEqual(self.note(out)["items"][0]["count"], 2)

    def test_all_can_take_away(self):
        out = self.run_node(touches(tap(50, 100), every("hand", op=0)))
        self.assertTrue(torch.equal(self.area(out), PERSON.bool() & ~(HAND_LEFT + HAND_RIGHT).bool()))
        self.assertEqual(self.note(out)["items"][1], {"ok": True, "share": share(HAND_LEFT + HAND_RIGHT), "as": "thing", "count": 2, "did": True})

    def test_a_word_nothing_is_called_by_does_nothing(self):
        out = self.run_node(touches(tap(75, 34), every("unicorn"), every(""), every(" ,:() ")))
        self.assertTrue(torch.equal(self.area(out), GLASSES.bool()))
        nothing = {"ok": False, "share": 0.0, "as": "none", "count": 0}
        self.assertEqual(self.note(out)["items"][1:], [nothing, nothing, nothing])
        self.assertEqual(asked("word"), ["unicorn"], "an empty word asks nothing")
        with self.assertRaises(RuntimeError) as stopped:
            self.run_node(touches(every("unicorn")))
        self.assertEqual(str(stopped.exception), NOTHING_PICKED)

    def test_the_word_is_cleaned_and_only_all_has_a_count(self):
        out = self.run_node(touches(every(" ( hand ), "), tap(75, 34), name("face", 60, 45), paint([[10, 10]], r=2)))
        self.assertEqual(FakeEncode.calls, ["hand:16", "face:16"])
        self.assertEqual(["count" in item for item in self.note(out)["items"]], [True, False, False, False])

    def test_all_shares_what_a_name_and_a_look_asked(self):
        self.run_node(touches(name("hand", 45, 73)))
        self.run_node(touches(every("hand")))
        self.assertEqual(asked("word"), ["hand"], "asked once for both kinds of touch")
        self.look()
        count = len(FakeSam.calls)
        out = self.run_node(touches(every("window"), every("cup")))
        self.assertEqual(len(FakeSam.calls), count, "after a look it costs nothing")
        self.assertTrue(torch.equal(self.area(out), (WINDOW + MUG).bool()), "the cup without its speck, as the piece shows it")

    def test_a_batch_asks_the_word_of_every_picture(self):
        lower = self.picture.clone()
        lower[0, 0, 0] = 1.0  # the fake shows this one's scene 10 px lower
        mask = self.run_node(touches(every("hand")), image=torch.cat([self.picture, lower]))["result"][0]
        both = (HAND_LEFT + HAND_RIGHT).bool()
        self.assertTrue(torch.equal(mask[0] > 0.5, both))
        self.assertTrue(torch.equal(mask[1] > 0.5, torch.roll(both, 10, 0)))

    def test_all_without_a_text_reader_says_what_to_wire(self):
        with self.assertRaises(RuntimeError) as needs:
            self.run_node(touches(every("hand")), clip=None)
        self.assertEqual(str(needs.exception), NO_TEXT_READER)


class InvertTests(TouchCase):
    def test_invert_turns_the_mask_round(self):
        text = touches(tap(130, 90))
        plain = self.run_node(text)
        out = self.run_node(text, invert=True)
        mask, cut, _ = out["result"]
        self.assertTrue(torch.equal(mask, 1.0 - plain["result"][0]), "white where nothing was picked")
        self.assertTrue(torch.equal(cut[0, ..., 3], mask[0]), "the cut-out follows the mask")
        note = self.note(out)
        self.assertEqual(note["share"], round(1.0 - share(MUG), 5), "the share is the mask's")
        self.assertEqual(note["items"], self.note(plain)["items"])
        selection = self.opened(note["selection"]).pixels > 0
        self.assertTrue(torch.equal(selection, MUG.bool()), "the face's selection stays what was picked")

    def test_it_is_turned_round_after_the_edge_steps(self):
        text = touches(tap(130, 90))
        grown = self.run_node(text, grow=3)["result"][0]
        turned = self.run_node(text, grow=3, invert=True)["result"][0]
        self.assertTrue(torch.equal(turned, 1.0 - grown))
        self.assertEqual((float(turned[0, 78, 130]), float(turned[0, 76, 130])), (0.0, 1.0), "the grown edge is left out too")
        soft = self.run_node(text, soften=3.0)["result"][0]
        self.assertTrue(torch.allclose(self.run_node(text, soften=3.0, invert=True)["result"][0], 1.0 - soft))

    def test_invert_does_not_make_everything_out_of_nothing(self):
        with self.assertRaises(RuntimeError) as stopped:
            self.run_node("", invert=True)
        self.assertEqual(str(stopped.exception), NOTHING_PICKED)
        out = self.run_node(touches(tap(*WALL)), invert=True, if_nothing="empty mask")
        self.assertEqual(float(out["result"][0].sum()), 0.0, "an empty mask stays empty")
        self.assertEqual(float(out["result"][1][..., 3].sum()), 0.0)
        self.assertEqual(float(self.run_node("", invert=True, ask="look")["result"][0].sum()), 0.0)

    def test_in_a_batch_only_a_picture_with_something_picked_is_turned_round(self):
        lower = self.picture.clone()
        lower[0, 0, 0] = 1.0
        mask = self.run_node(touches(tap(130, 112)), image=torch.cat([self.picture, lower]), invert=True)["result"][0]
        self.assertEqual(float(mask[0].sum()), 0.0, "nothing there in the first picture")
        self.assertTrue(torch.equal(mask[1] > 0.5, ~torch.roll(MUG, 10, 0).bool()))

    def test_it_is_off_unless_asked_for(self):
        spec = node_module.AusBossMaskByTouch.INPUT_TYPES()["optional"]["invert"]
        self.assertEqual((spec[0], spec[1]["default"]), ("BOOLEAN", False))
        self.assertTrue(torch.equal(self.area(self.run_node(touches(tap(130, 90)))), MUG.bool()))


class NamesTests(TouchCase):
    """The third output: the names of what is picked."""

    def names(self, *items, **overrides):
        return self.run_node(touches(*items), **{"if_nothing": "empty mask", **overrides})["result"][2]

    def test_the_names_come_in_the_order_they_were_picked_each_once(self):
        self.assertEqual(
            self.names(name("shirt", 75, 80), tap(130, 90), name("hand", 45, 73), name("hand", 104, 75), every("window"), name("shirt", 75, 80)),
            "shirt, hand, window",
        )

    def test_taps_strokes_and_paint_add_no_name(self):
        self.assertEqual(self.names(tap(75, 34), find([[122, 82], [140, 100]], r=2), paint([[10, 10]], r=3)), "")
        self.assertEqual(self.names(), "")

    def test_a_name_that_found_nothing_is_not_a_name_of_what_is_picked(self):
        self.assertEqual(self.names(tap(75, 34), name("hand", 75, 80), every("unicorn"), name("", 75, 80)), "")

    def test_a_name_taken_away_again_is_left_out(self):
        self.assertEqual(self.names(name("shirt", 75, 80), name("face", 60, 45), name("shirt", 75, 80, op=0)), "face")
        self.assertEqual(self.names(every("hand"), name("face", 60, 45), every("hand", op=0)), "face")
        self.assertEqual(self.names(name("hand", 45, 73), every("hand", op=0), tap(75, 34)), "")
        # Picked again afterwards: it is the last thing picked.
        self.assertEqual(self.names(name("shirt", 75, 80), name("face", 60, 45), name("shirt", 75, 80, op=0), name("shirt", 75, 80)), "face, shirt")

    def test_taking_one_of_two_away_keeps_the_name(self):
        self.assertEqual(self.names(name("hand", 45, 73), name("hand", 104, 75), name("hand", 104, 75, op=0)), "hand", "the left hand is still picked")
        self.assertEqual(self.names(every("hand"), name("hand", 45, 73, op=0)), "hand")
        self.assertEqual(self.names(every("hand"), name("hand", 45, 73, op=0), name("hand", 104, 75, op=0)), "")
        # Taking away a hand that was never picked changes nothing.
        self.assertEqual(self.names(name("hand", 45, 73), name("hand", 104, 75, op=0)), "hand")

    def test_taking_away_by_paint_or_by_another_word_leaves_the_name(self):
        self.assertEqual(self.names(name("face", 60, 45), paint([[75, 34]], r=30, op=0), name("eyeglasses", 75, 34, op=0)), "face")

    def test_a_look_and_a_batch_return_the_names_too(self):
        self.assertEqual(self.run_node(touches(name("face", 60, 45)), ask="scope")["result"][2], "face")
        lower = self.picture.clone()
        lower[0, 0, 0] = 1.0
        self.assertEqual(self.names(name("hand", 45, 82), every("cup"), image=torch.cat([self.picture, lower])), "cup", "the names are the first picture's")


class Bar:
    """Stands in for ComfyUI's progress bar: it picks up the function that
    reports its steps when it is made, as comfy.utils.ProgressBar does."""

    def __init__(self, total, utils):
        self.total, self.hook = total, utils.PROGRESS_BAR_HOOK

    def update_absolute(self, value, total=None):
        if self.hook is not None:
            self.hook(value, self.total if total is None else total, None)


class QuietTests(TouchCase):
    """A look sends the page no progress reports; any other run does."""

    def setUp(self):
        super().setUp()
        self.sent = []
        test = self
        webui = types.SimpleNamespace(enabled=True, name="webui")
        other = types.SimpleNamespace(enabled=True, name="cli")

        class Registry:
            handlers = {"webui": webui, "cli": other}

            def update_progress(self, node_id, value, total, image=None):
                if webui.enabled:
                    test.sent.append("progress_state")

            def disable_handler(self, name):
                self.handlers[name].enabled = False

            def enable_handler(self, name):
                self.handlers[name].enabled = True

        self.registry, self.webui, self.other = Registry(), webui, other

        def hook(value, total, preview, prompt_id=None, node_id=None):
            node_module.raise_if_interrupted()
            test.registry.update_progress(node_id, value, total, preview)
            test.sent.append("progress")

        self.hook = hook
        self.utils = types.ModuleType("comfy.utils")
        self.utils.PROGRESS_BAR_HOOK = hook
        progress = types.ModuleType("comfy_execution.progress")
        progress.get_progress_state = lambda: self.registry
        for module_name, module in (("comfy.utils", self.utils), ("comfy_execution.progress", progress)):
            self.addCleanup(sys.modules.pop, module_name, None)
            sys.modules[module_name] = module
        self.swap("progress_bar", lambda total: Bar(total, self.utils))

        class Reports(FakeSam):
            """Reports "done" after every question, as SAM 3 Detect does."""

            @classmethod
            def execute(cls, **kwargs):
                out = FakeSam.execute(**kwargs)
                Bar(1, test.utils).update_absolute(1)
                return out

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Reports, "CLIPTextEncode": FakeEncode})

    def as_it_was(self):
        return self.utils.PROGRESS_BAR_HOOK is self.hook and self.webui.enabled and self.other.enabled

    def test_a_look_sends_no_progress_and_an_ordinary_run_does(self):
        note = self.note(self.run_node("", ask="scope"))
        self.assertIs(note["pieces"]["more"], False)
        self.assertGreater(len(FakeSam.calls), 400)
        self.assertEqual(self.sent, [], "hundreds of questions, and not one report")
        self.assertTrue(self.as_it_was(), "put back on the way out")
        self.run_node(touches(tap(3, 3), tap(4, 4)), if_nothing="empty mask")
        self.assertEqual(self.sent, ["progress_state", "progress"] * 2, "an ordinary run reports as SAM 3 Detect does")

    def test_a_look_with_the_pointers_place_is_quiet_too(self):
        self.short_looks(5)
        self.run_node("", ask="scope:130,8")
        self.assertEqual((len(FakeSam.calls), self.sent), (6, []))
        self.assertTrue(self.as_it_was())

    def test_only_the_pages_reports_are_held_back(self):
        seen = []

        class Watches(FakeSam):
            @classmethod
            def execute(cls, **kwargs):
                seen.append((self.utils.PROGRESS_BAR_HOOK is self.hook, self.webui.enabled, self.other.enabled))
                return FakeSam.execute(**kwargs)

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Watches, "CLIPTextEncode": FakeEncode})
        self.short_looks(2)
        self.run_node("", ask="scope")
        self.assertEqual(set(seen), {(False, False, True)}, "the page's handler is off, another handler is left alone")

    def test_everything_is_put_back_when_the_look_fails(self):
        class Fails(FakeSam):
            @classmethod
            def execute(cls, **kwargs):
                if len(FakeSam.calls) >= 3:
                    raise RuntimeError("CUDA out of memory")
                return FakeSam.execute(**kwargs)

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Fails, "CLIPTextEncode": FakeEncode})
        with self.assertRaises(RuntimeError):
            self.run_node("", ask="scope")
        self.assertTrue(self.as_it_was())
        self.assertEqual(self.sent, [])

    def test_a_handler_that_was_off_stays_off(self):
        self.webui.enabled = False
        self.short_looks(2)
        self.run_node("", ask="scope")
        self.assertIs(self.webui.enabled, False)
        self.assertIs(self.utils.PROGRESS_BAR_HOOK, self.hook)

    def test_a_stop_by_the_user_still_stops_a_quiet_look(self):
        class Stopped(BaseException):
            pass

        stop = [False]

        def check():
            if stop[0]:
                raise Stopped()

        class StopsInside(FakeSam):
            @classmethod
            def execute(cls, **kwargs):
                out = FakeSam.execute(**kwargs)
                stop[0] = len(FakeSam.calls) >= 4
                Bar(1, self.utils).update_absolute(1)  # where ComfyUI's report checks for a stop
                return out

        self.swap("raise_if_interrupted", check)
        self.swap("_core_nodes", lambda: {"SAM3_Detect": StopsInside, "CLIPTextEncode": FakeEncode})
        with self.assertRaises(Stopped):
            self.run_node("", ask="scope")
        self.assertEqual((len(FakeSam.calls), self.sent), (4, []))
        self.assertTrue(self.as_it_was())

    def test_it_can_be_switched_off(self):
        self.swap("QUIET", False)
        self.short_looks(4)
        self.run_node("", ask="scope")
        total = len(node_module._scope_queue(W, H))
        self.assertEqual(self.sent, ["progress_state", "progress"] * 8, "SAM 3 Detect's report and the look's own bar, for each question")
        reports = []
        self.swap("progress_bar", lambda _total: types.SimpleNamespace(update_absolute=lambda value, total: reports.append((value, total))))
        self.run_node("", ask="scope")
        self.assertEqual(reports, [(number, total) for number in range(5, 9)], "the bar says how far the list is")

    def test_another_comfyui_without_these_parts_just_looks(self):
        for module_name in ("comfy.utils", "comfy_execution.progress"):
            del sys.modules[module_name]
        self.assertIs(self.note(self.run_node("", ask="scope"))["pieces"]["more"], False)
        # A ComfyUI whose parts are not the ones this was written for.
        sys.modules["comfy.utils"] = types.ModuleType("comfy.utils")
        odd = types.ModuleType("comfy_execution.progress")
        odd.get_progress_state = lambda: types.SimpleNamespace(handlers=None)
        sys.modules["comfy_execution.progress"] = odd
        with node_module._quiet() as held:
            self.assertIs(held, False, "nothing to hold back, and nothing breaks")
        self.assertIs(self.note(self.run_node("", ask="scope", image=self.picture.flip(1)))["pieces"]["more"], False)


class TellTests(TouchCase):
    """While it looks, the node tells its face what it has found."""

    def setUp(self):
        super().setUp()
        self.swap("SCOPE_SPACING", 16)  # fewer points: a shorter list
        self.sent = []
        self.server = types.SimpleNamespace(client_id="the page that asked", send_sync=lambda event, data, sid=None: self.sent.append((event, data, sid)))
        self.swap("_server", lambda: self.server)
        self.swap("_jobs_waiting", lambda: 0)
        # Every question takes half a second.
        self.clock = [0.0]
        self.swap("time", types.SimpleNamespace(perf_counter=lambda: self.clock[0]))
        test = self

        class Slow(FakeSam):
            @classmethod
            def execute(cls, **kwargs):
                test.clock[0] += 0.5
                return FakeSam.execute(**kwargs)

        self.swap("_core_nodes", lambda: {"SAM3_Detect": Slow, "CLIPTextEncode": FakeEncode})

    def notes(self):
        return [data["note"] for _, data, _ in self.sent]

    def test_a_look_tells_about_every_second_and_a_half_and_at_its_end(self):
        asked_at = []
        send = self.server.send_sync
        self.server.send_sync = lambda *args: (asked_at.append(len(FakeSam.calls)), send(*args))
        out = self.run_node(touches(tap(130, 90)), ask="scope", unique_id=7)
        total = len(node_module._scope_queue(W, H))
        self.assertEqual(len(FakeSam.calls), total + 1, "the tap, then the whole list in one run")
        self.assertEqual(asked_at, list(range(4, total + 1, 3)) + [total + 1], "after every third half-second question, and at the end")
        for event, data, sid in self.sent:
            self.assertEqual((event, sid), ("ausboss.mask_by_touch.look", "the page that asked"))
            self.assertEqual(sorted(data), ["end", "node", "note"])
            self.assertEqual(data["node"], "7", "the node's id, as text")
            json.dumps(data)  # it has to travel as JSON
        self.assertEqual([data["end"] for _, data, _ in self.sent], [False] * (len(self.sent) - 1) + [True])
        final = self.note(out)
        self.assertEqual(self.sent[-1][1]["note"], final, "the last one is the note the run returns")
        self.assertIs(final["pieces"]["more"], False)
        self.assertEqual([entry["name"] for entry in final["pieces"]["list"]], [word for word, _, _ in LOOKED])
        notes = self.notes()
        for note in notes:
            self.assertEqual(sorted(note), sorted(final))
            for field in ("key", "width", "height", "scale", "stamp", "picture", "selection", "items", "share"):
                self.assertEqual(note[field], final[field], "what is picked is the same in every one")
            self.assertEqual(len(self.pieces_of(note)), len(note["pieces"]["list"]), "its planes are written")
        self.assertEqual([note["pieces"]["more"] for note in notes], [True] * (len(notes) - 1) + [False])
        words = [note["pieces"]["words"] for note in notes]
        self.assertEqual(words[0], [3, 104], "three words asked when the first one goes out")
        self.assertEqual(words, sorted(words))
        self.assertEqual(words[-1], [104, 104])

    def test_what_is_told_is_what_was_found_by_then(self):
        self.run_node("", ask="scope", unique_id="12")
        first, second = self.notes()[:2]
        self.assertEqual([entry["name"] for entry in first["pieces"]["list"]], ["face", "person"], "person, face, hair were asked")
        self.assertEqual([entry["name"] for entry in second["pieces"]["list"]], ["hand", "hand", "face", "shirt", "person"], "and hand, shirt, t-shirt")
        shown = self.pieces_of(first)
        self.assertTrue(torch.equal(shown[0], FACE.bool()) and torch.equal(shown[1], PERSON.bool()))
        # A piece that was told keeps its point and its shape.
        last = self.notes()[-1]
        face = next(entry for entry in last["pieces"]["list"] if entry["name"] == "face")
        self.assertEqual(face, first["pieces"]["list"][0])

    def test_the_piece_under_the_pointer_is_told_at_once(self):
        self.run_node("", ask="scope:130,8", unique_id=7)
        _, data, _ = self.sent[0]
        self.assertEqual((data["end"], data["note"]["pieces"]["words"], data["note"]["pieces"]["more"]), (False, [0, 104], True))
        (poster,) = data["note"]["pieces"]["list"]
        self.assertEqual((poster["x"], poster["y"], poster["kind"], poster["share"]), (130, 8, "point", share(POSTER)))
        self.assertTrue(torch.equal(self.pieces_of(data["note"])[0], POSTER.bool()))

    def test_a_look_that_gives_way_to_a_job_still_ends_with_the_event(self):
        self.swap("_jobs_waiting", lambda: 1 if len(FakeSam.calls) >= 5 else 0)
        out = self.run_node("", ask="scope", unique_id=7)
        self.assertEqual(len(FakeSam.calls), 5)
        self.assertEqual([(data["end"], data["note"]["pieces"]["words"]) for _, data, _ in self.sent], [(False, [3, 104]), (True, [5, 104])])
        self.assertIs(self.sent[-1][1]["note"]["pieces"]["more"], True, "more is left: the face asks again")
        self.assertEqual(self.sent[-1][1]["note"], self.note(out))

    def test_a_look_with_nothing_left_to_ask_ends_with_the_event_too(self):
        self.run_node("", ask="scope", unique_id=7)
        count = len(FakeSam.calls)
        self.sent.clear()
        out = self.run_node("", ask="scope", unique_id=7)
        self.assertEqual(len(FakeSam.calls), count)
        self.assertEqual([(event, data["end"], data["note"] == self.note(out)) for event, data, _ in self.sent], [("ausboss.mask_by_touch.look", True, True)])

    def test_only_a_look_tells(self):
        self.run_node(touches(tap(130, 90)), unique_id=7)
        self.run_node("", ask="look", unique_id=7)
        self.assertEqual(self.sent, [])

    def test_without_its_id_or_a_page_the_look_runs_and_tells_nobody(self):
        told = self.note(self.run_node("", ask="scope", unique_id=7))
        self.sent.clear()
        node_module._MEMORY.clear()
        untold = self.note(self.run_node("", ask="scope"))
        self.assertEqual(self.sent, [], "no id: nobody to tell")
        self.assertEqual(untold["pieces"]["list"], told["pieces"]["list"])
        node_module._MEMORY.clear()
        self.swap("_server", lambda: None)
        self.assertEqual(self.note(self.run_node("", ask="scope", unique_id=7))["pieces"]["list"], told["pieces"]["list"])

    def test_a_page_that_cannot_be_told_never_stops_the_look(self):
        def broken(*_args):
            raise ConnectionError("the page is gone")

        self.server.send_sync = broken
        note = self.note(self.run_node("", ask="scope", unique_id=7))
        self.assertIs(note["pieces"]["more"], False)
        self.assertEqual([entry["name"] for entry in note["pieces"]["list"]], [word for word, _, _ in LOOKED])


class FineEdgeTests(TouchCase):
    """Fine edges in the node: the helper is a stand-in here (its own tests
    are tests/test_fine_edge_helpers.py). What the node asks of it and does
    with its answer is what these hold."""

    FILE = "birefnet.safetensors"

    def setUp(self):
        super().setUp()
        self.calls = []
        self.fail_with = None

        def stand_in(image, picked, choice, turned=False, keep_hard=None, keys=None):
            self.calls.append({
                "picked": picked.clone(), "model": choice, "turned": turned, "frames": tuple(image.shape),
                "keep_hard": None if keep_hard is None else keep_hard.clone(), "keys": keys,
            })
            if self.fail_with is not None:
                raise self.fail_with
            # A soft answer that is easy to tell: the picked area at 0.75, and red for the clean colours.
            clean = torch.zeros(*picked.shape, 3)
            clean[..., 0] = 1.0
            return picked.float() * 0.75, clean

        self.swap("find_fine_edges", stand_in)
        self.text = touches(tap(75, 34), key=picture_key(self.picture))

    def test_off_never_asks_and_the_note_has_no_fine_edge(self):
        for value in ("off", "", None):
            out = self.run_node(self.text, **({} if value is None else {"fine_edges": value}))
            self.assertIsNone(self.note(out)["fine"])
        self.assertEqual(self.calls, [])

    def test_the_mask_is_the_fine_edge_and_the_cut_out_wears_the_clean_colours(self):
        out = self.run_node(self.text, fine_edges=self.FILE)
        mask, cut, _names = out["result"]
        self.assertEqual(len(self.calls), 1)
        self.assertEqual((self.calls[0]["model"], self.calls[0]["turned"]), (self.FILE, False))
        self.assertEqual(self.calls[0]["keys"], [picture_key(self.picture)], "so each picture's subject is asked for once")
        self.assertTrue(torch.equal(self.calls[0]["picked"][0], GLASSES.bool()), "asked about the tidied pick, on or off")
        self.assertTrue(torch.allclose(mask[0], GLASSES * 0.75), "the mask is the soft answer")
        self.assertEqual(tuple(cut.shape), (1, H, W, 4))
        inside = GLASSES.bool()
        self.assertTrue(torch.allclose(cut[0][inside][:, :3], torch.tensor([1.0, 0.0, 0.0]).expand(int(inside.sum()), 3)), "clean colours, not the picture's")
        self.assertTrue(torch.equal(cut[0, ..., 3], mask[0]))

    def test_grow_moves_the_plain_area_and_lays_it_over_the_fine_edge(self):
        plain = self.run_node(self.text, fine_edges=self.FILE)["result"][0][0]
        grown = self.run_node(self.text, fine_edges=self.FILE, grow=3)["result"][0][0]
        hard_grown = self.run_node(self.text, grow=3)["result"][0][0]
        self.assertTrue(torch.equal(grown, hard_grown), "solid out to the new line: no soft values pushed about")
        shrunk = self.run_node(self.text, fine_edges=self.FILE, grow=-2)["result"][0][0]
        hard_shrunk = self.run_node(self.text, grow=-2)["result"][0][0]
        self.assertTrue(torch.allclose(shrunk, hard_shrunk * 0.75), "cut back to the new line, as soft as it was inside")
        self.assertEqual(sorted(set(plain.unique().tolist())), [0.0, 0.75])
        soft = self.run_node(self.text, fine_edges=self.FILE, soften=2.0)["result"][0][0]
        self.assertGreater(int(((soft > 0) & (soft < 0.7)).sum()), 0)

    def test_what_was_painted_is_marked_to_stay_exactly_as_painted(self):
        stroke = [[125, 85], [140, 100]]
        text = touches(tap(75, 34), paint(stroke, r=3), key=picture_key(self.picture))
        self.run_node(text, fine_edges=self.FILE)
        keep = self.calls[0]["keep_hard"]
        self.assertEqual(tuple(keep.shape), (1, H, W))
        self.assertTrue(torch.equal(keep[0], stroke_area(stroke, 3, H, W)), "the paint, and nothing SAM 3 found")
        # A thing found after the paint, on the same spot, is a found thing again.
        again = touches(paint([[75, 34], [80, 36]], r=3), tap(75, 34), key=picture_key(self.picture))
        self.run_node(again, fine_edges=self.FILE)
        self.assertFalse(bool((self.calls[1]["keep_hard"][0] & GLASSES.bool()).any()))
        # Paint that takes away is paint too.
        away = touches(tap(75, 34), paint([[75, 34], [80, 36]], r=3, op=0), key=picture_key(self.picture))
        self.run_node(away, fine_edges=self.FILE)
        self.assertTrue(bool(self.calls[2]["keep_hard"][0][34, 75]))

    def test_the_note_carries_the_fine_edge_for_the_nodes_own_picture(self):
        note = self.note(self.run_node(self.text, fine_edges=self.FILE, grow=2, soften=1.5))
        self.assertEqual(sorted(note["fine"]), ["file", "made"])
        self.assertEqual(note["fine"]["made"], "2|1.500|0|0|0|birefnet.safetensors", "the line the face writes too")
        picture = self.opened(note["fine"]["file"])
        self.assertEqual((picture.format, picture.mode, picture.size), ("PNG", "RGBA", (W, H)))
        mask = self.run_node(self.text, fine_edges=self.FILE, grow=2, soften=1.5)["result"][0][0]
        self.assertTrue(torch.equal(picture.pixels[..., 3], mask.mul(255.0).round().to(torch.uint8)), "its see-through channel is the mask")

    def test_invert_asks_for_the_colours_of_everything_else(self):
        out = self.run_node(self.text, fine_edges=self.FILE, invert=True)
        self.assertTrue(self.calls[0]["turned"])
        mask = out["result"][0][0]
        self.assertTrue(torch.allclose(mask, 1.0 - GLASSES * 0.75))
        self.assertEqual(self.note(out)["fine"]["made"].split("|")[4], "1")

    def test_a_look_for_pieces_makes_no_fine_edge(self):
        note = self.note(self.run_node(self.text, fine_edges=self.FILE, ask="scope"))
        self.assertEqual(self.calls, [], "a look returns no mask anyone uses")
        self.assertIsNone(note["fine"])

    def test_nothing_picked_makes_no_fine_edge(self):
        note = self.note(self.run_node("", fine_edges=self.FILE, if_nothing=IF_NOTHING[1]))
        self.assertEqual(self.calls, [])
        self.assertIsNone(note["fine"])

    def test_a_run_of_the_workflow_stops_with_the_reason(self):
        self.fail_with = FileNotFoundError("This needs ComfyUI's background-removal model.")
        with self.assertRaisesRegex(FileNotFoundError, "background-removal model"):
            self.run_node(self.text, fine_edges=self.FILE)

    def test_a_look_from_the_nodes_own_picture_goes_on_with_the_plain_edge_and_says_why(self):
        self.fail_with = FileNotFoundError("This needs ComfyUI's background-removal model.")
        out = self.run_node(self.text, fine_edges=self.FILE, ask="look")
        self.assertTrue(torch.equal(self.area(out), GLASSES.bool()), "the plain edge")
        self.assertEqual(self.note(out)["fine"], {"trouble": "This needs ComfyUI's background-removal model."})

    def test_the_line_of_settings_is_the_one_the_face_writes(self):
        self.assertEqual(node_module.fine_made(0, 0.0, 0, True, False, "birefnet.safetensors"), "0|0.000|0|1|0|birefnet.safetensors")
        self.assertEqual(node_module.fine_made(12, 0.5, 3, False, True, "a/b.safetensors"), "12|0.500|3|0|1|a/b.safetensors")


class SubjectTests(TouchCase):
    """The picture's main subject and its background as picks. ComfyUI's
    background-removal model is a stand-in: it calls the person the subject."""

    def setUp(self):
        super().setUp()
        self.asked_of = []
        self.fail_with = None

        def stand_in(frame, choice, key=None):
            self.asked_of.append((choice, key, tuple(frame.shape)))
            if self.fail_with is not None:
                raise self.fail_with
            return PERSON * 0.9

        self.swap("subject_matte", stand_in)

    def test_the_subject_is_a_pick_like_any_other(self):
        out = self.run_node(touches({"t": "subject", "op": 1}, key=picture_key(self.picture)))
        self.assertTrue(torch.equal(self.area(out), PERSON.bool()))
        self.assertEqual(out["result"][2], "", "it has no name to give out")
        note = self.note(out)
        self.assertEqual(note["items"], [{"ok": True, "share": share(PERSON), "as": "thing"}])
        self.assertEqual(self.asked_of, [("off", picture_key(self.picture), (1, H, W, 3))], "asked with the picture's key, of the model Fine edges names")

    def test_the_background_is_everything_but_the_subject(self):
        out = self.run_node(touches({"t": "background", "op": 1}, key=picture_key(self.picture)))
        self.assertTrue(torch.equal(self.area(out), ~PERSON.bool()))

    def test_they_add_and_take_away_with_the_other_picks(self):
        text = touches({"t": "subject", "op": 1}, tap(75, 34, op=0), key=picture_key(self.picture))
        self.assertTrue(torch.equal(self.area(self.run_node(text)), PERSON.bool() & ~GLASSES.bool()))
        text = touches(tap(75, 34), {"t": "subject", "op": 0}, key=picture_key(self.picture))
        self.assertTrue(torch.equal(self.area(self.run_node(text, if_nothing=IF_NOTHING[1])), GLASSES.bool() & ~PERSON.bool()))

    def test_the_model_fine_edges_names_is_the_one_asked(self):
        self.swap("find_fine_edges", lambda image, picked, choice, **more: (picked.float(), image[..., :3].float()))
        self.run_node(touches({"t": "subject", "op": 1}, key=picture_key(self.picture)), fine_edges="other.safetensors")
        self.assertEqual(self.asked_of[0][0], "other.safetensors")

    def test_without_the_model_a_run_stops_with_the_reason(self):
        self.fail_with = FileNotFoundError("This needs ComfyUI's background-removal model.")
        with self.assertRaisesRegex(FileNotFoundError, "background-removal model"):
            self.run_node(touches({"t": "subject", "op": 1}, key=picture_key(self.picture)))

    def test_without_the_model_a_look_goes_on_without_that_pick_and_says_why(self):
        self.fail_with = FileNotFoundError("This needs ComfyUI's background-removal model.")
        out = self.run_node(touches(tap(75, 34), {"t": "subject", "op": 1}, key=picture_key(self.picture)), ask="look")
        self.assertTrue(torch.equal(self.area(out), GLASSES.bool()), "the other pick is still there")
        note = self.note(out)
        self.assertEqual(note["items"][1], {"ok": False, "share": 0.0, "as": "none"})
        self.assertEqual(note["fine"], {"trouble": "This needs ComfyUI's background-removal model."})


class QuietNameTests(TouchCase):
    def test_a_word_the_face_did_not_show_is_picked_but_not_given_out(self):
        look = self.look()
        entry = next(piece for piece in look["pieces"]["list"] if piece["kind"] == "name")
        shown = name(entry["name"], entry["x"], entry["y"])
        quiet = dict(shown, q=1)
        loud = self.run_node(touches(shown, key=picture_key(self.picture)))
        hush = self.run_node(touches(quiet, key=picture_key(self.picture)))
        self.assertEqual(loud["result"][2], entry["name"])
        self.assertEqual(hush["result"][2], "", "no name is given out")
        self.assertTrue(torch.equal(self.area(loud), self.area(hush)), "the same thing is picked")


class BrushTests(TouchCase):
    """The brush of the node's Paint and Erase: a soft edge, and what the face is told."""

    LINE = [[40, 60], [120, 60]]

    def test_a_soft_mark_fades_and_a_hard_one_stays_exact(self):
        hard = self.run_node(touches(paint(self.LINE, r=10)), if_nothing=IF_NOTHING[1])["result"][0][0]
        self.assertTrue(torch.equal(hard > 0.5, stroke_area(self.LINE, 10, H, W)), "a hard brush is exactly as before")
        self.assertTrue(bool(((hard == 0) | (hard == 1)).all()))
        soft_mark = dict(paint(self.LINE, r=10), s=100)
        soft = self.run_node(touches(soft_mark))["result"][0][0]
        self.assertGreater(float(soft[60, 80]), 0.9, "solid along the middle")
        self.assertTrue(0.2 < float(soft[54, 80]) < 0.85, "fading half way out")
        self.assertLess(float(soft[49, 80]), 0.1, "little left at the ring")
        self.assertEqual(float(soft[20, 80]), 0.0)

    def test_a_brush_too_hard_to_blur_is_the_hard_stroke(self):
        mark = dict(paint(self.LINE, r=2), s=1)
        out = self.run_node(touches(mark))["result"][0][0]
        self.assertTrue(torch.equal(out > 0.5, stroke_area(self.LINE, 2, H, W)))

    def test_a_soft_erase_thins_what_is_picked(self):
        text = touches(paint([[20, 60], [140, 60]], r=30), dict(paint([[30, 60], [130, 60]], r=10, op=0), s=100))
        out = self.run_node(text)["result"][0][0]
        self.assertLess(float(out[60, 80]), 0.1, "rubbed out along the stroke")
        self.assertTrue(0.05 < float(out[66, 80]) < 0.95, "thinned at its soft edge")
        self.assertEqual(float(out[80, 80]), 1.0, "and whole further off")

    def test_the_selection_the_face_reads_is_grey_where_a_soft_brush_painted(self):
        hard = self.note(self.run_node(touches(paint(self.LINE, r=10))))
        values = set(self.opened(hard["selection"]).pixels.unique().tolist())
        self.assertEqual(values, {0, 255})
        soft = self.note(self.run_node(touches(dict(paint(self.LINE, r=10), s=100))))
        values = self.opened(soft["selection"]).pixels
        self.assertTrue(bool(((values > 10) & (values < 245)).any()))

    def test_the_chip_a_touch_is_in_changes_nothing(self):
        plain = self.run_node(touches(tap(75, 34), paint(self.LINE, r=6)))["result"][0]
        numbered = self.run_node(touches(dict(tap(75, 34), g=1), dict(paint(self.LINE, r=6), g=1)))["result"][0]
        self.assertTrue(torch.equal(plain, numbered))

    def test_a_take_away_says_whether_it_took_anything(self):
        note = self.note(self.run_node(touches(tap(75, 34), paint([[5, 110], [20, 110]], op=0), paint([[60, 31], [90, 31]], r=2, op=0))))
        self.assertEqual([item.get("did") for item in note["items"]], [None, False, True])

    def test_each_picked_thing_comes_with_its_own_area_for_the_face(self):
        text = touches(tap(75, 34), paint(self.LINE, r=4), tap(30, 70, op=0), find([[50, 80], [100, 80]]))
        note = self.note(self.run_node(text))
        # Paint the face draws itself, and what takes away is no chip: neither is sent.
        self.assertEqual(note["areas"]["items"], [0, 3])
        planes = [self.opened(entry).pixels for entry in note["areas"]["planes"]]
        areas = unpack_planes(planes, 2)
        self.assertTrue(torch.equal(areas[0], GLASSES.bool()))
        self.assertTrue(torch.equal(areas[1], PERSON.bool()))
        # The same touches again: the same files.
        self.assertEqual(self.note(self.run_node(text))["areas"], note["areas"])
        self.assertIsNone(self.note(self.run_node(touches(paint(self.LINE))))["areas"])


class ContractTests(unittest.TestCase):
    cls = node_module.AusBossMaskByTouch

    def test_inputs_and_outputs_are_the_contracts(self):
        inputs = self.cls.INPUT_TYPES()
        self.assertEqual(list(inputs["required"]), ["image", "model", "clip", "touches", "grow", "soften", "smooth", "fill_holes", "if_nothing"])
        self.assertEqual(list(inputs["optional"]), ["free_vram", "invert", "ask", "fine_edges"])
        # Off until the user picks a model file: an API prompt without it runs as before.
        self.assertEqual((optional_first := inputs["optional"]["fine_edges"])[1]["default"], "off")
        self.assertEqual(optional_first[0][0], "off", "off is always offered, and comes first")
        self.assertEqual(inputs["hidden"], {"unique_id": "UNIQUE_ID"}, "ComfyUI hands the node its own id")
        required, optional = inputs["required"], inputs["optional"]
        self.assertEqual((required["image"][0], required["model"][0], required["clip"][0]), ("IMAGE", "MODEL", "CLIP"))
        self.assertEqual(required["clip"][1]["tooltip"], "SAM 3's text reader: CLIP from the same Load Checkpoint.")
        self.assertEqual((required["touches"][0], required["touches"][1]["default"], required["touches"][1]["multiline"]), ("STRING", "", False))
        grow = required["grow"][1]
        self.assertEqual((required["grow"][0], grow["default"], grow["min"], grow["max"]), ("INT", 0, -128, 256))
        soften = required["soften"][1]
        self.assertEqual((required["soften"][0], soften["default"], soften["min"], soften["max"], soften["step"]), ("FLOAT", 0.0, 0.0, 100.0, 0.1))
        smooth = required["smooth"][1]
        self.assertEqual((required["smooth"][0], smooth["default"], smooth["min"], smooth["max"]), ("INT", 0, 0, 64))
        self.assertEqual((required["fill_holes"][0], required["fill_holes"][1]["default"]), ("BOOLEAN", True))
        self.assertEqual((required["if_nothing"][0], required["if_nothing"][1]["default"]), (list(IF_NOTHING), "stop the run"))
        self.assertEqual((optional["ask"][0], optional["ask"][1]["default"]), ("STRING", ""))
        self.assertEqual((optional["invert"][0], optional["invert"][1]["default"]), ("BOOLEAN", False))
        self.assertEqual((self.cls.RETURN_TYPES, self.cls.RETURN_NAMES), (("MASK", "IMAGE", "STRING"), ("mask", "cut_out", "names")))
        self.assertEqual(self.cls.CATEGORY, "\U0001f18e AusBoss/Mask")

    def test_the_function_takes_the_inputs_in_their_order(self):
        import inspect

        names = list(inspect.signature(self.cls.pick).parameters)[1:]
        inputs = self.cls.INPUT_TYPES()
        self.assertEqual(names, list(inputs["required"]) + list(inputs["optional"]) + list(inputs["hidden"]))

    def test_every_input_and_output_says_what_it_is(self):
        inputs = self.cls.INPUT_TYPES()
        for group in ("required", "optional"):
            for input_name, entry in inputs[group].items():
                self.assertTrue(entry[1].get("tooltip"), input_name)
        self.assertEqual(len(self.cls.OUTPUT_TOOLTIPS), len(self.cls.RETURN_TYPES))
        self.assertTrue(self.cls.DESCRIPTION.startswith("Click a thing on the picture, or paint over it"))
        self.assertIn("wire model and clip from a Load Checkpoint that loads the SAM 3 file", self.cls.DESCRIPTION)
        for alias in ("ausboss", "quick select", "magic wand", "click to mask", "segment", "sam", "sam3", "select", "pick", "brush mask", "inpaint mask"):
            self.assertIn(alias, self.cls.SEARCH_ALIASES)

    def test_it_is_an_output_node_and_a_request_from_its_face_always_runs(self):
        self.assertIs(self.cls.OUTPUT_NODE, True)
        for ask in ("scope", "scope:1,2", "look"):
            value = self.cls.IS_CHANGED(ask=ask, touches="", grow=0)
            self.assertNotEqual(value, value, "never equal to itself: ComfyUI runs the node again")
        self.assertEqual(self.cls.IS_CHANGED(ask="", touches="x"), self.cls.IS_CHANGED(touches="y"), "an ordinary run is remembered by its inputs")
        self.assertFalse(hasattr(self.cls, "VALIDATE_INPUTS"))

    def test_the_key_is_a_literal_and_the_name_carries_the_pack_signature(self):
        self.assertEqual(list(node_module.NODE_CLASS_MAPPINGS), ["AUSBOSS_NODES_MaskByTouch"])
        self.assertEqual(node_module.NODE_DISPLAY_NAME_MAPPINGS, {"AUSBOSS_NODES_MaskByTouch": "Mask by Touch \U0001f18e"})


if __name__ == "__main__":
    unittest.main()
