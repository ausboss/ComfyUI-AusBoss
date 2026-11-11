from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._text_lines_helpers import split_items, strip_marker
from nodes.node_text_lines import AusBossTextLines


class SplitItemsTests(unittest.TestCase):
    def test_each_line_is_an_item_and_empty_lines_are_skipped(self):
        text = "a red car\n\n   \na blue boat  \r\n\tgreen hills\n"
        self.assertEqual(split_items(text), ["a red car", "a blue boat", "green hills"])

    def test_blank_line_keeps_lines_together(self):
        text = "first line\nsecond line\n\n\nnext item\n  \nlast"
        self.assertEqual(
            split_items(text, "blank line"),
            ["first line\nsecond line", "next item", "last"],
        )

    def test_limit_keeps_the_first_items(self):
        self.assertEqual(split_items("a\nb\nc\nd", limit=2), ["a", "b"])
        self.assertEqual(split_items("a\nb", limit=0), ["a", "b"])
        self.assertEqual(split_items("a\nb", limit=9), ["a", "b"])

    def test_numbers_and_bullets_come_off(self):
        cases = {
            "1. close-up, soft smile": "close-up, soft smile",
            "2) medium shot": "medium shot",
            "#3: from above": "from above",
            "- a bullet": "a bullet",
            "* a star": "a star",
            "• a dot": "a dot",
            "[prompt 4] from the side": "from the side",
            "【prompt_5】 looking back": "looking back",
            "(6) arms crossed": "arms crossed",
            "Prompt 7: laughing": "laughing",
            "Shot 8 - wide": "wide",
            "12. twelve": "twelve",
        }
        for line, want in cases.items():
            self.assertEqual(strip_marker(line), want, line)

    def test_text_that_only_starts_like_a_marker_stays(self):
        for line in [
            "2 women on a beach",
            "1.5x zoom on the face",
            "10:30 at night, a diner",
            "3D render of a robot",
            "*bold* light from the left",
            "-90 degrees, seen from below",
            "1920s street, a man in a hat",
            "shot from below",
            "Image 1: the woman, in the coat from image 2",
        ]:
            self.assertEqual(strip_marker(line), line, line)

    def test_numbering_stays_when_asked(self):
        self.assertEqual(split_items("1. a\n- b", remove_numbering=False), ["1. a", "- b"])

    def test_a_line_that_is_only_a_marker_is_skipped(self):
        self.assertEqual(split_items("1.\n2. real\n-"), ["real"])

    def test_nothing_gives_nothing(self):
        self.assertEqual(split_items(""), [])
        self.assertEqual(split_items(None), [])
        self.assertEqual(split_items("\n \n"), [])


class TextLinesNodeTests(unittest.TestCase):
    def test_outputs_lines_numbers_and_count(self):
        lines, numbers, count = AusBossTextLines().split("1. one\n2. two\n\n3. three")
        self.assertEqual(lines, ["one", "two", "three"])
        self.assertEqual(numbers, [1, 2, 3])
        self.assertEqual(count, 3)

    def test_the_line_and_number_outputs_are_lists(self):
        self.assertEqual(AusBossTextLines.OUTPUT_IS_LIST, (True, True, False))
        self.assertEqual(AusBossTextLines.RETURN_NAMES, ("line", "number", "count"))

    def test_no_lines_stops_the_run_with_plain_words(self):
        with self.assertRaises(ValueError) as caught:
            AusBossTextLines().split("  \n")
        self.assertIn("no lines to run", str(caught.exception))

    def test_inputs_and_their_order(self):
        inputs = AusBossTextLines.INPUT_TYPES()
        self.assertEqual(list(inputs), ["required"])
        self.assertEqual(list(inputs["required"]), ["text", "split", "remove_numbering", "limit"])


if __name__ == "__main__":
    unittest.main()
