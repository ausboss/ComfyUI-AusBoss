"""Layout Boxes gives what ComfyUI's own Create Bounding Boxes gives.

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_layout_boxes_core_parity.py

Both nodes get the same boxes, drawn on their canvas or coming in on the
`bboxes` wire, and must give the same `bboxes` and `elements`. Both
`elements` then go through MOSS-Image Layout Prompt, and the two prompts must
be the same text. The boxes are random but seeded, on canvases of many sizes.

Without a ComfyUI checkout, or with one that does not have these nodes yet,
the tests skip. Nothing runs on a GPU and no model is loaded.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import random
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

SIZES = [(1024, 1024), (1344, 768), (832, 1216), (1000, 1000), (1920, 1088), (1024, 1536), (64, 64), (4096, 2304), (16384, 16384)]
COLORS = ["#ff3399", "#00b4aa", "#ffffff", "#000000", "#a1b2c3", "#123456", "#fedcba"]
WORDS = ["a red bicycle", "OPEN 24 HOURS", "a cat on a sofa", "", "neon, pink", "ICED COFFEE\n2 FOR $3", "écriture à la main"]


def load():
    """(our node class, core's node class, MOSS-Image Layout Prompt class), or a reason to skip."""
    if not COMFY_ROOT:
        return "set AUSBOSS_COMFY_ROOT to a ComfyUI checkout"
    from nodes.node_layout_boxes import AusBossLayoutBoxes  # the pack's own `nodes` first

    sys.path.append(COMFY_ROOT)
    sys.argv = sys.argv[:1]
    try:
        import comfy.cli_args

        comfy.cli_args.args.cpu = True
        from comfy_extras.nodes_bounding_boxes import CreateBoundingBoxes
    except ImportError as exc:
        return f"this ComfyUI has no Create Bounding Boxes ({exc})"
    try:
        from comfy_extras.nodes_moss_image import MOSSImageLayoutPrompt
    except ImportError:
        MOSSImageLayoutPrompt = None
    return AusBossLayoutBoxes, CreateBoundingBoxes, MOSSImageLayoutPrompt


LOADED = load()
SKIP = LOADED if isinstance(LOADED, str) else None


def random_boxes(rng: random.Random, width: int, height: int, count: int) -> list[dict]:
    """Boxes in Create Bounding Boxes' own form: whole canvas pixels, with metadata."""
    boxes = []
    for _ in range(count):
        x0 = rng.randint(0, width - 1)
        y0 = rng.randint(0, height - 1)
        x1 = rng.choice([rng.randint(x0 + 1, width), width])
        y1 = rng.choice([rng.randint(y0 + 1, height), height])
        kind = rng.choice(["obj", "text"])
        boxes.append({"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0, "metadata": {
            "type": kind,
            "text": rng.choice(WORDS) if kind == "text" else rng.choice(["", "left over"]),
            "desc": rng.choice(WORDS),
            "palette": rng.sample(COLORS, rng.randint(0, 7)),
        }})
    return boxes


def as_layout(boxes: list[dict], width: int, height: int, from_input: str = "") -> str:
    """The same boxes as the Layout Boxes canvas writes them: each number divided by its side, once."""
    data = {"v": 1, "boxes": [{
        "x": box["x"] / width, "y": box["y"] / height, "w": box["width"] / width, "h": box["height"] / height,
        **box["metadata"],
    } for box in boxes]}
    if from_input:
        data["from_input"] = from_input
    return json.dumps(data)


def ours(width, height, **inputs):
    node, _core, _moss = LOADED
    return node().draw(width=width, height=height, **inputs)["result"]


def theirs(width, height, **inputs):
    _node, core, _moss = LOADED
    return core.execute(width, height, **inputs).result


@unittest.skipIf(SKIP, SKIP)
class SameAsCreateBoundingBoxes(unittest.TestCase):
    def test_boxes_drawn_on_the_canvas(self):
        rng = random.Random(20261019)
        checked = 0
        for width, height in SIZES:
            for count in (0, 1, 2, 3, 5, 8) * 3:
                boxes = random_boxes(rng, width, height, count)
                mine = ours(width, height, layout=as_layout(boxes, width, height))
                core = theirs(width, height, editor_state=boxes)
                self.assertEqual(mine[1], core[1], f"bboxes, {width}x{height}, {count} boxes")
                self.assertEqual(mine[2], core[2], f"elements, {width}x{height}, {count} boxes")
                self.assertEqual(json.dumps(mine[2]), json.dumps(core[2]), "the same keys in the same order")
                checked += count
        self.assertEqual(checked, 513)

    def test_boxes_coming_in_on_the_wire(self):
        rng = random.Random(7)
        for width, height in SIZES:
            boxes = random_boxes(rng, width, height, 4)
            elements = theirs(width, height, editor_state=boxes)[2]
            plain = [{key: box[key] for key in ("x", "y", "width", "height")} for box in boxes]
            for wire in (elements, json.dumps(elements), elements[0], boxes, [plain], json.dumps(boxes), plain[0], [], ""):
                mine = ours(width, height, bboxes=wire)
                core = theirs(width, height, bboxes=wire)
                self.assertEqual(mine[1:3], core[1:], f"{width}x{height}: {str(wire)[:60]}")

    def test_the_canvas_wins_after_the_wire_filled_it(self):
        # Both nodes fill the canvas from new boxes on the wire once, then use
        # what is on the canvas while the wire brings the same boxes.
        width, height = 1344, 768
        wire = [{"type": "obj", "bbox": [100, 100, 600, 450], "desc": "a dog"}]
        first = ours(width, height, bboxes=wire)
        self.assertEqual(first[2], theirs(width, height, bboxes=wire)[2])
        edited = random_boxes(random.Random(3), width, height, 2)
        _node, core, _moss = LOADED
        applied = core.execute(width, height, bboxes=wire).ui["input_bboxes"]
        mine = LOADED[0]().draw(width=width, height=height, bboxes=wire, layout=as_layout(edited, width, height))
        fingerprint = mine["ui"]["ausboss_layout_boxes"][0]["incoming"]["fingerprint"]
        mine = ours(width, height, bboxes=wire, layout=as_layout(edited, width, height, fingerprint))
        core_out = theirs(width, height, bboxes=wire, editor_state=edited, last_incoming=applied)
        self.assertEqual(mine[1:3], core_out[1:])

    def test_bad_wires_stop_both(self):
        for wire in ("{oops", {"a": 1}, 5, [5], [{"bbox": [1, 2]}], [{"bbox": [1, 2, "x", 4]}]):
            with self.assertRaises(ValueError, msg=repr(wire)):
                theirs(1024, 1024, bboxes=wire)
            with self.assertRaises(ValueError, msg=repr(wire)):
                ours(1024, 1024, bboxes=wire)


@unittest.skipIf(SKIP or (not isinstance(LOADED, str) and LOADED[2] is None), SKIP or "this ComfyUI has no MOSS-Image Layout Prompt")
class SamePromptForMOSSImage(unittest.TestCase):
    def test_the_layout_prompt_is_the_same_text(self):
        _node, _core, moss = LOADED
        rng = random.Random(99)
        for width, height in SIZES:
            for count in (1, 3, 6):
                boxes = random_boxes(rng, width, height, count)
                mine = ours(width, height, layout=as_layout(boxes, width, height))[2]
                core = theirs(width, height, editor_state=boxes)[2]
                for characters in ("", "1", "1, 3"):
                    a = moss.execute("a street at night", mine, width, height, characters).result[0]
                    b = moss.execute("a street at night", core, width, height, characters).result[0]
                    self.assertEqual(a, b, f"{width}x{height}, {count} boxes, characters {characters!r}")


if __name__ == "__main__":
    unittest.main()
