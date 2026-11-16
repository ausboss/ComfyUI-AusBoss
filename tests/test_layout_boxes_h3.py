"""Layout Boxes 🆎: the `h3_prompt` output (nodes/_layout_boxes_h3.py).
Plain Python, no torch."""

from __future__ import annotations

from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._layout_boxes_h3 import h3_prompt, share_words

SHAPE = (1344, 768)


def box(x, y, w, h, kind="obj", text="", desc="", angle=None):
    region = {"x": x, "y": y, "w": w, "h": h, "type": kind, "text": text, "desc": desc, "palette": []}
    if angle:
        region["angle"] = angle
    return region


TWO_PEOPLE = [box(0.08, 0.25, 0.22, 0.7), box(0.33, 0.3, 0.2, 0.65)]


class H3PromptTests(unittest.TestCase):
    def test_no_boxes_give_no_prompt(self):
        self.assertEqual(h3_prompt([], SHAPE, scene=True), "")

    def test_empty_boxes_take_the_reference_pictures_in_box_order(self):
        words = h3_prompt(TWO_PEOPLE, SHAPE, scene=True)
        self.assertIn("the scene in <Picture 1>", words)
        first, second = words.index("The person from <Picture 2>"), words.index("The person from <Picture 3>")
        self.assertLess(first, second)
        self.assertIn("with the same face, hair and clothes as in <Picture 2>. Placed", words)

    def test_without_a_scene_the_subjects_start_at_picture_one(self):
        words = h3_prompt(TWO_PEOPLE, SHAPE, scene=False)
        self.assertNotIn("<Picture 3>", words)
        self.assertIn("The person from <Picture 1>", words)
        self.assertNotIn("the scene in", words)

    def test_a_described_box_keeps_its_words_and_takes_no_picture(self):
        regions = [box(0.7, 0.55, 0.25, 0.4, desc="a golden retriever lying on the rug"), *TWO_PEOPLE]
        words = h3_prompt(regions, SHAPE, scene=True)
        self.assertIn("A golden retriever lying on the rug. Placed low at the far right", words)
        self.assertIn("<Picture 2>", words)
        self.assertNotIn("<Picture 4>", words)

    def test_places_and_neighbours_are_said_in_words(self):
        words = h3_prompt(TWO_PEOPLE, SHAPE, scene=True)
        self.assertIn("at the far left of the frame", words)
        self.assertIn("right beside the person from <Picture 2>, on its right", words)
        self.assertIn("two thirds of the frame's height and a quarter of its width", words)

    def test_text_boxes_write_their_words_with_the_slant(self):
        regions = [box(0.3, 0.04, 0.4, 0.12, kind="text", text="OPEN", desc="red neon letters", angle=10)]
        words = h3_prompt(regions, SHAPE)
        self.assertIn('The words "OPEN" are written high in the middle of the frame', words)
        self.assertIn("The lettering: red neon letters, tilted about 10 degrees, running downhill", words)

    def test_an_empty_text_box_is_left_out(self):
        self.assertEqual(h3_prompt([box(0.1, 0.1, 0.2, 0.2, kind="text")], SHAPE), "")

    def test_no_numbers_and_no_drawing_words_reach_the_model(self):
        # Coordinates written in an H3 Image prompt come back drawn on the
        # picture, so the prompt has no digit outside its <Picture N> tags.
        regions = [
            *TWO_PEOPLE,
            box(0.6, 0.2, 0.3, 0.75, desc=""),
            box(0.1, 0.02, 0.8, 0.1, kind="text", text="SALE", angle=-30),
        ]
        words = h3_prompt(regions, SHAPE, scene=True)
        bare = re.sub(r"<Picture \d+>", "", words).replace("tilted about 30 degrees", "")
        self.assertIsNone(re.search(r"\d", bare), bare)
        self.assertIsNone(re.search(r"\b(box|boxes|rectangle|outline|grid|coordinate)", bare, re.I), bare)

    def test_share_words(self):
        self.assertEqual(share_words(0.5), "half")
        self.assertEqual(share_words(0.34), "a third")
        self.assertEqual(share_words(0.95), "all")


if __name__ == "__main__":
    unittest.main()
