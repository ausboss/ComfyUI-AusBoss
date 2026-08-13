from __future__ import annotations

import contextlib
import io
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _color_helpers
from nodes._color_helpers import FALLBACK_RGB, parse_fill_color
from nodes._transform_engine import fill_rgb, normalize_fill_color


class ParseFillColorTests(unittest.TestCase):
    def test_hex_forms(self):
        self.assertEqual(parse_fill_color("#123456"), (0x12, 0x34, 0x56))
        self.assertEqual(parse_fill_color("#FA8"), (0xFF, 0xAA, 0x88))
        self.assertEqual(parse_fill_color("  #808080  "), (128, 128, 128))
        # Bare hex stays supported when unambiguous.
        self.assertEqual(parse_fill_color("808080"), (128, 128, 128))
        self.assertEqual(parse_fill_color("fa8"), (0xFF, 0xAA, 0x88))

    def test_csv_integers(self):
        self.assertEqual(parse_fill_color("10, 20, 30"), (10, 20, 30))
        self.assertEqual(parse_fill_color("10 20 30"), (10, 20, 30))
        self.assertEqual(parse_fill_color("300, -5, 128"), (255, 0, 128))

    def test_csv_floats_auto_detected(self):
        self.assertEqual(parse_fill_color("0.5, 0.5, 0.5"), (128, 128, 128))
        self.assertEqual(parse_fill_color("1, 1, 1"), (255, 255, 255))
        self.assertEqual(parse_fill_color("0, 0, 0"), (0, 0, 0))
        # One value above 1 switches the whole triple to 0-255.
        self.assertEqual(parse_fill_color("0.5, 128, 0.5"), (1, 128, 1))

    def test_bare_grayscale(self):
        self.assertEqual(parse_fill_color("128"), (128, 128, 128))
        self.assertEqual(parse_fill_color("255"), (255, 255, 255))
        self.assertEqual(parse_fill_color("0.5"), (128, 128, 128))
        self.assertEqual(parse_fill_color("0"), (0, 0, 0))

    def test_css_names(self):
        self.assertEqual(parse_fill_color("teal"), (0, 128, 128))
        self.assertEqual(parse_fill_color("White"), (255, 255, 255))
        self.assertEqual(parse_fill_color("rebeccapurple"), (102, 51, 153))

    def test_fallback_warns_once_per_value(self):
        _color_helpers._warned_values.clear()
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertEqual(parse_fill_color("not a color"), FALLBACK_RGB)
            self.assertEqual(parse_fill_color("not a color"), FALLBACK_RGB)
            self.assertEqual(parse_fill_color(""), FALLBACK_RGB)
            self.assertEqual(parse_fill_color(None), FALLBACK_RGB)
            self.assertEqual(parse_fill_color("1, 2"), FALLBACK_RGB)
        output = buffer.getvalue()
        self.assertEqual(output.count("not a color"), 1)
        self.assertIn("mid-gray", output)
        output.encode("ascii")  # warning must stay ASCII

    def test_engine_wiring_uses_tolerant_parser(self):
        self.assertEqual(normalize_fill_color("teal"), "#008080")
        self.assertEqual(normalize_fill_color("10, 20, 30"), "#0a141e")
        self.assertEqual(fill_rgb("0.5"), (128, 128, 128))
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertEqual(normalize_fill_color("definitely broken"), "#808080")


if __name__ == "__main__":
    unittest.main()
