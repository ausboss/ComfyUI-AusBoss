"""Layout Boxes: reading the boxes and working out the outputs.

Standard library only (the preview is drawn elsewhere). The same outputs from
ComfyUI's own Create Bounding Boxes, for the same boxes, are checked in
tests/test_layout_boxes_core_parity.py.
"""

from __future__ import annotations

from pathlib import Path
import json
import math
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._layout_boxes_helpers import (
    EMPTY_LAYOUT,
    LayoutError,
    angle_of,
    bounding_boxes,
    box_corners,
    box_words,
    boxes_from_input,
    canvas_boxes,
    element_desc,
    hex_color,
    input_fingerprint,
    mask_rects,
    parse_layout,
    prompt_elements,
    read_angle,
    regions_from_pixel_boxes,
    tilt_phrase,
    turned_mask_rows,
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


class TheMask(unittest.TestCase):
    def test_on_the_canvas_it_is_white_inside_the_bboxes(self):
        regions, _ = parse_layout(layout(box(320, 96, 512, 640), box(0, 0, W, 64, kind="text", text="OPEN")), W, H)
        rects = mask_rects(regions, W, H)
        self.assertEqual(rects, [(320, 96, 832, 736), (0, 0, W, 64)])
        frames = bounding_boxes(regions, W, H)[0]
        self.assertEqual(rects, [(b["x"], b["y"], b["x"] + b["width"], b["y"] + b["height"]) for b in frames],
                         "the same pixels as the bboxes output, object and text boxes alike")

    def test_on_a_picture_of_another_size_the_boxes_keep_their_place(self):
        # The canvas is the picture's size on 16 px steps (1008 x 752 for a
        # 1000 x 750 photo); the mask has the photo's own size.
        regions, _ = parse_layout(layout({"x": 0.5, "y": 0.25, "w": 0.25, "h": 0.5}), W, H)
        self.assertEqual(mask_rects(regions, 1000, 750), [(500, 188, 750, 563)])
        self.assertEqual(mask_rects(regions, 4000, 3000), [(2000, 750, 3000, 2250)])

    def test_boxes_are_cut_to_the_picture(self):
        regions = [
            {"x": -0.25, "y": 0.5, "w": 0.5, "h": 1.0},   # off the left and the bottom
            {"x": 0.5, "y": 0.5, "w": -0.25, "h": -0.5},  # drawn backwards
            {"x": 1.2, "y": 0.1, "w": 0.3, "h": 0.3},     # beyond the right edge: no area
            {"x": 0.1, "y": 0.1, "w": 0.0, "h": 0.5},     # a line: no area
            "junk",
        ]
        self.assertEqual(mask_rects(regions, 1000, 1000), [(0, 500, 250, 1000), (250, 0, 500, 500)])

    def test_no_boxes_no_white(self):
        self.assertEqual(mask_rects([], W, H), [])
        self.assertEqual(mask_rects(parse_layout(EMPTY_LAYOUT, W, H)[0], W, H), [])


def turned(x, y, w, h, angle, kind="obj", text="", desc="", width=W, height=H):
    """A box as the canvas writes a turned one: its level place in fractions, and its angle."""
    return {"x": x / width, "y": y / height, "w": w / width, "h": h / height, "type": kind, "text": text,
            "desc": desc, "palette": [], "angle": angle}


def inside(region, width, height, px, py, margin=0.0):
    """Whether the point lies inside the turned box, `margin` pixels in from its sides."""
    (x0, y0), (x1, y1), _, (x3, y3) = box_corners(region, width, height)
    along = math.hypot(x1 - x0, y1 - y0)
    down = math.hypot(x3 - x0, y3 - y0)
    u = ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / along
    v = ((px - x0) * (x3 - x0) + (py - y0) * (y3 - y0)) / down
    return margin <= u <= along - margin and margin <= v <= down - margin


# The tilt words both halves say (js/shared/layout_boxes.mjs tiltPhrase, tests/layout_boxes.test.mjs).
TILT_WORDS = [
    (25.25, "tilted about 25 degrees, running downhill to the right"),
    (-54.5, "tilted about 55 degrees, running uphill to the right"),
    (2, "tilted about 2 degrees, running downhill to the right"),
    (-2, "tilted about 2 degrees, running uphill to the right"),
    (90, "tilted about 90 degrees, running downhill to the right"),
    (1.99, ""),
    (-1.5, ""),
    (0, ""),
]


class TurnedBoxes(unittest.TestCase):
    def test_a_turn_is_kept_in_degrees_from_minus_90_to_90(self):
        for value, angle in ((25, 25.0), (25.2, 25.2), (-55, -55.0), (90, 90.0), (-90, -90.0), (120, -60.0), (-120, 60.0),
                             (270, -90.0), (-270, 90.0), (450, 90.0), ("12.5", 12.5), (None, 0.0), ("x", 0.0), (True, 0.0),
                             (float("nan"), 0.0), (float("inf"), 0.0)):
            self.assertEqual(read_angle(value), angle, value)
        self.assertEqual(math.copysign(1.0, read_angle(-0.0)), 1.0, "no minus zero")
        self.assertEqual(angle_of({"x": 0}), 0.0)
        self.assertEqual(angle_of("junk"), 0.0)

    def test_the_saved_form_keeps_a_turn_and_an_old_layout_reads_level(self):
        regions, _ = parse_layout(layout(turned(320, 96, 512, 64, 25.2, "text", "OPEN"), box(0, 0, 64, 64)), W, H)
        self.assertEqual(regions[0]["angle"], 25.2)
        self.assertNotIn("angle", regions[1], "a level box gets no angle key")
        for angle in (0, 0.0, -0.0, "0", None, "level"):
            level, _ = parse_layout(layout(dict(box(320, 96, 512, 640), angle=angle)), W, H)
            self.assertNotIn("angle", level[0], angle)
        regions, _ = parse_layout(layout(dict(box(0, 0, 64, 64), angle=200)), W, H)
        self.assertEqual(regions[0]["angle"], 20.0, "a turn past half a circle is the same rectangle")
        # A layout saved before boxes could turn gives exactly what it gave: the same regions as with angle 0.
        old = layout(box(320, 96, 512, 640, desc="a cat"), box(0, 0, W, 64, "text", "OPEN", "neon"))
        zero = layout(dict(box(320, 96, 512, 640, desc="a cat"), angle=0), dict(box(0, 0, W, 64, "text", "OPEN", "neon"), angle=0))
        self.assertEqual(parse_layout(old, W, H), parse_layout(zero, W, H))
        regions, _ = parse_layout(old, W, H)
        self.assertEqual(turned_mask_rows(regions, W, H), [], "level boxes have no turned mask")

    def test_the_face_written_form_round_trips(self):
        # What js/shared/layout_boxes.mjs serializeLayout writes for a turned text box.
        text = ('{"v":1,"boxes":[{"x":0.6179435483870968,"y":0.5181451612903226,"w":0.3719758064516129,"h":0.06854838709677419,'
                '"type":"text","text":"No Phones","desc":"bold black letters on a white sign","palette":[],"angle":25.2}]}')
        regions, _ = parse_layout(text, 992, 1488)
        self.assertEqual(regions[0]["angle"], 25.2)
        self.assertEqual(round(regions[0]["w"] * 992), 369)
        self.assertEqual(canvas_boxes(regions)[0].get("angle"), None, "the wire's boxes are level: canvas_boxes carries no angle")

    def test_corners_at_0_25_minus_55_and_90_degrees(self):
        level = turned(300, 250, 400, 100, 0, width=1000, height=1000)
        self.assertEqual(box_corners(level, 1000, 1000), [(300.0, 250.0), (700.0, 250.0), (700.0, 350.0), (300.0, 350.0)])
        quarter = turned(300, 250, 400, 100, 90, width=1000, height=1000)
        self.assertEqual(box_corners(quarter, 1000, 1000), [(550.0, 100.0), (550.0, 500.0), (450.0, 500.0), (450.0, 100.0)],
                         "a quarter turn is exact: the top edge runs straight down")
        for angle in (25, -55, 25.2, -89.9):
            corners = box_corners(turned(300, 250, 400, 100, angle, width=1000, height=1000), 1000, 1000)
            (x0, y0), (x1, y1), (x2, y2), (x3, y3) = corners
            self.assertAlmostEqual(math.hypot(x1 - x0, y1 - y0), 400, places=9)
            self.assertAlmostEqual(math.hypot(x3 - x0, y3 - y0), 100, places=9)
            self.assertAlmostEqual((x1 - x0) * (x3 - x0) + (y1 - y0) * (y3 - y0), 0, places=6, msg="square corners")
            self.assertAlmostEqual((x0 + x2) / 2, 500, places=9, msg="turned about its centre")
            self.assertAlmostEqual((y0 + y2) / 2, 300, places=9)
            self.assertAlmostEqual(math.degrees(math.atan2(y1 - y0, x1 - x0)), angle, places=9, msg="clockwise on the screen")
        down, up = (box_corners(turned(300, 250, 400, 100, a, width=1000, height=1000), 1000, 1000) for a in (25, -55))
        self.assertGreater(down[1][1], down[0][1], "plus runs downhill to the right")
        self.assertLess(up[1][1], up[0][1], "minus runs uphill to the right")
        # On a canvas that is not square the box is turned in pixels, so it stays a true rectangle.
        (x0, y0), (x1, y1), _, (x3, y3) = box_corners(turned(320, 96, 512, 64, 30), W, H)
        self.assertAlmostEqual((x1 - x0) * (x3 - x0) + (y1 - y0) * (y3 - y0), 0, places=6)
        self.assertAlmostEqual(math.hypot(x1 - x0, y1 - y0), 512, places=6)

    def test_the_mask_is_the_turned_rectangle(self):
        quarter = turned(300, 250, 400, 100, 90, width=1000, height=1000)
        rows = turned_mask_rows([quarter], 1000, 1000)
        self.assertEqual(rows, [(row, 450, 550) for row in range(100, 500)], "90 degrees: exactly the upright box")
        for angle, (width, height) in ((25, (1000, 1000)), (-55, (1000, 1000)), (25.25, (992, 1488)), (-10.25, (720, 1080))):
            region = turned(300, 250, 369, 103, angle, width=width, height=height)
            rows = turned_mask_rows([region], width, height)
            area = sum(end - first for _, first, end in rows)
            self.assertLess(abs(area - 369 * 103), 2 * (369 + 103), f"{angle}: the area of the box ({area})")
            white = {(row, x) for row, first, end in rows for x in range(first, end)}
            for row, x in white:
                self.assertTrue(inside(region, width, height, x + 0.5, row + 0.5, margin=-1e-6), (angle, row, x))
            lo_y = min(y for _, y in box_corners(region, width, height))
            hi_y = max(y for _, y in box_corners(region, width, height))
            for row in range(int(lo_y), int(hi_y) + 1):
                for x in range(0, width, 7):
                    if inside(region, width, height, x + 0.5, row + 0.5, margin=0.01):
                        self.assertIn((row, x), white, (angle, row, x))
            self.assertEqual(len(rows), len({row for row, _, _ in rows}), "one run per row")

    def test_the_mask_is_cut_to_the_picture_and_level_boxes_keep_their_rects(self):
        hanging = turned(900, 900, 300, 80, 30, width=1000, height=1000)
        rows = turned_mask_rows([hanging], 1000, 1000)
        self.assertTrue(rows)
        self.assertTrue(all(0 <= row < 1000 and 0 <= first < end <= 1000 for row, first, end in rows))
        level = box(320, 96, 512, 640)
        regions = [level, turned(100, 100, 200, 50, 25)]
        self.assertEqual(mask_rects(regions, W, H), [(320, 96, 832, 736)], "a turned box is not a rect")
        self.assertEqual(turned_mask_rows(regions, W, H), turned_mask_rows(regions[1:], W, H), "a level box is not in the turned rows")

    def test_bboxes_and_elements_get_the_straight_box_around_it(self):
        quarter = turned(300, 250, 400, 100, 90, width=1000, height=1000)
        self.assertEqual(bounding_boxes([quarter], 1000, 1000), [[{"x": 450, "y": 100, "width": 100, "height": 400}]])
        self.assertEqual(prompt_elements([quarter], (1000, 1000))[0]["bbox"], [100, 450, 500, 550])
        slanted = turned(613, 771, 369, 102, 25, "text", "No Phones", "bold black letters", width=992, height=1488)
        corners = box_corners(slanted, 992, 1488)
        xs, ys = [x for x, _ in corners], [y for _, y in corners]
        (frame,) = bounding_boxes([slanted], 992, 1488)
        self.assertEqual(frame, [{"x": round(min(xs)), "y": round(min(ys)), "width": round(max(xs)) - round(min(xs)),
                                  "height": round(max(ys)) - round(min(ys))}])
        element = prompt_elements([slanted], (992, 1488))[0]
        self.assertEqual(element["bbox"], [round(min(ys) / 1488 * 1000), round(min(xs) / 992 * 1000),
                                           round(max(ys) / 1488 * 1000), round(max(xs) / 992 * 1000)])
        # Off the canvas: cut to it, as elements are held to the grid.
        hanging = turned(900, 0, 300, 80, 30, width=1000, height=1000)
        (frame,) = bounding_boxes([hanging], 1000, 1000)
        self.assertEqual((frame[0]["x"] + frame[0]["width"], frame[0]["y"]), (1000, 0))
        self.assertEqual(prompt_elements([hanging], (1000, 1000))[0]["bbox"][3], 1000)
        # Turned on a picture of another shape than the canvas: the box is turned on the picture,
        # then counted in canvas pixels (bboxes) and on the grid (elements).
        on_picture = turned(400, 300, 200, 60, 40, width=1000, height=750)
        (frame,) = bounding_boxes([on_picture], 1024, 1536, (1000, 750))
        corners = box_corners(on_picture, 1000, 750)
        left, right = min(x for x, _ in corners) / 1000, max(x for x, _ in corners) / 1000
        top, bottom = min(y for _, y in corners) / 750, max(y for _, y in corners) / 750
        self.assertEqual(frame, [{"x": round(left * 1024), "y": round(top * 1536), "width": round(right * 1024) - round(left * 1024),
                                  "height": round(bottom * 1536) - round(top * 1536)}])

    def test_a_turned_text_box_says_its_slant(self):
        for angle, words in TILT_WORDS:
            self.assertEqual(tilt_phrase(angle), words, angle)
        slant = "tilted about 25 degrees, running downhill to the right"
        for desc, want in (("", slant), ("   ", slant), ("white letters on a red sign", f"white letters on a red sign, {slant}"),
                           ("white letters,", f"white letters, {slant}"), ("White letters.", f"White letters. {slant[0].upper()}{slant[1:]}."),
                           ("neon, " + slant, "neon, " + slant), ("Neon, " + slant.upper(), "Neon, " + slant.upper())):
            region = turned(0, 0, 64, 32, 25, "text", "OPEN", desc)
            self.assertEqual(element_desc(region), want, desc)
            self.assertEqual(prompt_elements([region])[0]["desc"], want)
        self.assertEqual(element_desc(turned(0, 0, 64, 32, -40, "text", "OPEN", "chalk")), "chalk, tilted about 40 degrees, running uphill to the right")
        self.assertEqual(element_desc(turned(0, 0, 64, 32, 25, "obj", "", "a bicycle")), "a bicycle", "an object box gets no slant")
        self.assertEqual(element_desc(turned(0, 0, 64, 32, 1.5, "text", "OPEN", "chalk")), "chalk", "under 2 degrees is level enough")
        self.assertEqual(element_desc(box(0, 0, 64, 32, "text", "OPEN", "chalk")), "chalk")


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
