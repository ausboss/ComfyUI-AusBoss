"""Layout Boxes: reading the boxes and working out the outputs.

Standard library only (the preview is drawn elsewhere). The same outputs from
ComfyUI's own Create Bounding Boxes, for the same boxes, are checked in
tests/test_layout_boxes_core_parity.py.
"""

from __future__ import annotations

from pathlib import Path
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._layout_boxes_helpers import (
    EMPTY_LAYOUT,
    LayoutError,
    bounding_boxes,
    box_words,
    boxes_from_input,
    canvas_boxes,
    hex_color,
    input_fingerprint,
    parse_layout,
    prompt_elements,
    regions_from_pixel_boxes,
)

W, H = 1344, 768


def layout(*boxes, from_input=None):
    data = {"v": 1, "boxes": list(boxes)}
    if from_input:
        data["from_input"] = from_input
    return json.dumps(data)


def box(x, y, w, h, kind="obj", text="", desc="", palette=()):
    """A box as the canvas writes it: whole canvas pixels divided by the side."""
    return {"x": x / W, "y": y / H, "w": w / W, "h": h / H, "type": kind, "text": text, "desc": desc, "palette": list(palette)}


class ReadingTheBoxes(unittest.TestCase):
    def test_the_canvas_form(self):
        regions, applied = parse_layout(layout(box(320, 96, 512, 640, desc="a cat"), from_input="abc"), W, H)
        self.assertEqual(applied, "abc")
        self.assertEqual(len(regions), 1)
        self.assertEqual(regions[0]["x"], 320 / W)
        self.assertEqual(regions[0]["desc"], "a cat")
        self.assertEqual(regions[0]["type"], "obj")

    def test_empty_and_missing(self):
        for value in (None, "", "   ", EMPTY_LAYOUT, '{"v": 1}'):
            self.assertEqual(parse_layout(value, W, H), ([], ""), value)

    def test_core_form_is_read_against_the_canvas(self):
        core = [{"x": 544, "y": 128, "width": 416, "height": 192, "metadata": {"type": "text", "text": "OPEN", "desc": "neon", "palette": ["#ff0000"]}}]
        regions, applied = parse_layout(core, 1024, 1536)
        self.assertEqual(applied, "")
        self.assertEqual((regions[0]["x"], regions[0]["h"]), (544 / 1024, 192 / 1536))
        self.assertEqual((regions[0]["type"], regions[0]["text"]), ("text", "OPEN"))
        self.assertEqual(parse_layout(json.dumps(core), 1024, 1536)[0], regions)

    def test_a_box_without_four_numbers_is_left_out(self):
        regions, _ = parse_layout(layout({"x": 0.1, "y": 0.1, "w": 0.5}, {"x": "a", "y": 0, "w": 1, "h": 1}, box(0, 0, 64, 64)), W, H)
        self.assertEqual(len(regions), 1)

    def test_broken_text_stops_with_a_plain_message(self):
        with self.assertRaisesRegex(LayoutError, "not valid JSON"):
            parse_layout("{oops", W, H)
        with self.assertRaisesRegex(LayoutError, "should be"):
            parse_layout("42", W, H)


class TheWire(unittest.TestCase):
    def test_nothing_comes_in(self):
        for value in (None, "", "  ", [], "[]"):
            self.assertEqual(boxes_from_input(value, W, H), [], value)

    def test_prompt_elements_become_canvas_pixels(self):
        elements = [{"type": "obj", "bbox": [100, 100, 600, 450], "desc": "a dog"},
                    {"type": "text", "bbox": [700, 900, 900, 100], "text": "HI", "desc": "chalk", "color_palette": ["#fff"]}]
        boxes = boxes_from_input(elements, 1024, 1024)
        self.assertEqual(boxes[0], {"x": 102, "y": 102, "width": 358, "height": 512,
                                    "metadata": {"type": "obj", "text": "", "desc": "a dog", "palette": []}})
        self.assertEqual((boxes[1]["x"], boxes[1]["width"]), (102, 819), "corners in either order")
        self.assertEqual(boxes[1]["metadata"]["text"], "HI")
        self.assertEqual(boxes_from_input(json.dumps(elements), 1024, 1024), boxes, "the same as JSON text")
        self.assertEqual(boxes_from_input(elements[0], 1024, 1024), boxes[:1], "one element")

    def test_pixel_boxes_in_every_shape(self):
        one = {"x": 10, "y": 20, "width": 30, "height": 40}
        meta = {"x": 1, "y": 2, "width": 3, "height": 4, "metadata": {"desc": "m"}}
        self.assertEqual(boxes_from_input(one, W, H), [one])
        self.assertEqual(boxes_from_input([one, meta], W, H), [one, meta])
        self.assertEqual(boxes_from_input([[one], [meta]], W, H), [one], "a BOUNDING_BOX value: the first frame")
        self.assertEqual(boxes_from_input(json.dumps([one]), W, H), [one])

    def test_what_cannot_be_read_stops_the_run(self):
        for value, words in (("{oops", "not valid JSON"), ({"a": 1}, "needs a box"), (5, "not int"),
                             ([5], "not a list of int"), ([{"bbox": [1, 2]}], "needs boxes"),
                             ([{"bbox": [1, 2, "x", 4]}], "four numbers")):
            with self.assertRaisesRegex(LayoutError, words, msg=repr(value)):
                boxes_from_input(value, W, H)

    def test_the_fingerprint_follows_the_value_not_the_canvas(self):
        elements = [{"type": "obj", "bbox": [0, 0, 500, 500], "desc": "a cat"}]
        self.assertEqual(input_fingerprint(elements), input_fingerprint(json.loads(json.dumps(elements))))
        self.assertNotEqual(input_fingerprint(elements), input_fingerprint([dict(elements[0], desc="a dog")]))
        self.assertEqual(len(input_fingerprint(elements)), 16)


class TheOutputs(unittest.TestCase):
    def test_pixel_boxes_come_back_exactly(self):
        regions, _ = parse_layout(layout(box(320, 96, 512, 640), box(0, 0, W, H)), W, H)
        self.assertEqual(bounding_boxes(regions, W, H), [[{"x": 320, "y": 96, "width": 512, "height": 640},
                                                           {"x": 0, "y": 0, "width": W, "height": H}]])
        self.assertEqual(bounding_boxes([], W, H), [], "no boxes, no frame")

    def test_a_box_drawn_backwards_is_turned_round(self):
        region = {"x": 0.5, "y": 0.5, "w": -0.25, "h": -0.5, "type": "obj", "text": "", "desc": "", "palette": []}
        self.assertEqual(bounding_boxes([region], 1000, 1000), [[{"x": 250, "y": 0, "width": 250, "height": 500}]])
        self.assertEqual(prompt_elements([region])[0]["bbox"], [0, 250, 500, 500])

    def test_prompt_elements(self):
        regions, _ = parse_layout(layout(
            box(320, 96, 512, 640, desc="a cat", text="kept out", palette=["#ff3399"]),
            box(0, 0, W, 64, kind="text", text="OPEN", desc="neon", palette=["#a1", "#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]),
        ), W, H)
        cat, sign = prompt_elements(regions)
        self.assertEqual(cat, {"type": "obj", "bbox": [125, 238, 958, 619], "desc": "a cat", "color_palette": ["#FF3399"]})
        self.assertNotIn("text", cat, "only a text box carries text")
        self.assertEqual(list(sign), ["type", "bbox", "text", "desc", "color_palette"], "the order Create Bounding Boxes writes")
        self.assertEqual(sign["bbox"], [0, 0, 83, 1000])
        self.assertEqual(len(sign["color_palette"]), 5)

    def test_places_off_the_canvas_are_held_to_the_grid(self):
        region = {"x": -0.2, "y": 0.9, "w": 1.5, "h": 0.5, "type": "obj", "text": "", "desc": "", "palette": []}
        self.assertEqual(prompt_elements([region])[0]["bbox"], [900, 0, 1000, 1000])

    def test_pixel_boxes_read_into_fractions(self):
        regions = regions_from_pixel_boxes([{"x": 64, "y": 32, "width": 128, "height": 256}, "junk"], 1024, 512)
        self.assertEqual(regions, [{"x": 0.0625, "y": 0.0625, "w": 0.125, "h": 0.5, "type": "obj", "text": "", "desc": "", "palette": []}])
        self.assertEqual(canvas_boxes(regions), regions)


class ThePreviewWords(unittest.TestCase):
    def test_words(self):
        self.assertEqual(box_words({"type": "obj", "desc": "a cat", "text": "x"}), "a cat")
        self.assertEqual(box_words({"type": "text", "text": "OPEN", "desc": "neon"}), '"OPEN" - neon')

    def test_colors(self):
        self.assertEqual(hex_color("#ABC"), (170, 187, 204))
        self.assertEqual(hex_color("#a1b2c3ff"), (161, 178, 195))
        self.assertIsNone(hex_color("teal"))


if __name__ == "__main__":
    unittest.main()
