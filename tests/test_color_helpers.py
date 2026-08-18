from __future__ import annotations

import contextlib
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

import torch

from nodes import _color_helpers
from nodes._color_helpers import (
    COLOR_MATCH_METHODS,
    FALLBACK_RGB,
    match_colors,
    parse_fill_color,
)
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


class FillColorWarningNamesTheWidgetTests(unittest.TestCase):
    """An unreadable colour has to be reported against the control it came
    from: the message used to say "Transform: ... fill_color" whichever node
    called, and the once-per-value guard then silenced every other node."""

    def setUp(self):
        _color_helpers._warned_values.clear()
        self.addCleanup(_color_helpers._warned_values.clear)

    def capture(self, value, **kwargs):
        printed = []
        with patch("builtins.print", lambda *args: printed.append(" ".join(map(str, args)))):
            rgb = parse_fill_color(value, **kwargs)
        return rgb, printed

    def test_the_default_label_still_names_the_transform_widget(self):
        rgb, printed = self.capture("dark navy")
        self.assertEqual(rgb, FALLBACK_RGB)
        self.assertIn("Transform fill_color", printed[0])

    def test_each_caller_names_its_own_node_and_widget(self):
        _rgb, pad = self.capture("dark navy", source="Align Image pad_color")
        self.assertIn("Align Image pad_color", pad[0])
        self.assertNotIn("Transform", pad[0])
        _rgb, transform = self.capture("forest green")
        self.assertIn("Transform fill_color", transform[0])

    def test_one_node_warning_does_not_silence_another(self):
        _rgb, first = self.capture("dark navy", source="Align Image pad_color")
        _rgb, second = self.capture("dark navy")
        self.assertTrue(first and second)
        # Still once per node, though.
        _rgb, repeat = self.capture("dark navy", source="Align Image pad_color")
        self.assertEqual(repeat, [])


class ColorMatchMethodTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(0)
        self.image = torch.rand(2, 24, 32, 3)
        self.reference = torch.rand(1, 24, 32, 3) * 0.5 + 0.25

    def test_every_method_runs_and_keeps_the_shape(self):
        for method in COLOR_MATCH_METHODS:
            out = match_colors(self.image, self.reference, 1.0, None, method)
            self.assertEqual(out.shape, self.image.shape, method)

    def test_mkl_moves_the_covariance_onto_the_reference(self):
        out = match_colors(self.image, self.reference, 1.0, None, "mkl")
        pixels = out[0].reshape(-1, 3)
        ref_pixels = self.reference[0].reshape(-1, 3)
        cov_error = (torch.cov(pixels.T) - torch.cov(ref_pixels.T)).abs().max()
        self.assertLess(cov_error.item(), 0.01)
        mean_error = (pixels.mean(0) - ref_pixels.mean(0)).abs().max()
        self.assertLess(mean_error.item(), 0.02)

    def test_histogram_aligns_the_quantiles(self):
        out = match_colors(self.image, self.reference, 1.0, None, "histogram")
        sorted_out, _ = out[0, ..., 0].reshape(-1).sort()
        sorted_ref, _ = self.reference[0, ..., 0].reshape(-1).sort()
        self.assertLess((sorted_out - sorted_ref).abs().max().item(), 0.02)

    def test_mask_scopes_and_invert_flips_every_method(self):
        mask = torch.zeros(1, 24, 32)
        mask[:, :, :16] = 1.0
        for method in COLOR_MATCH_METHODS:
            out = match_colors(self.image, self.reference, 1.0, mask, method)
            self.assertTrue(
                torch.equal(out[:, :, 16:, :], self.image[:, :, 16:, :]), method
            )
            inverted = match_colors(
                self.image, self.reference, 1.0, mask, method, invert_mask=True
            )
            self.assertTrue(
                torch.equal(inverted[:, :, :16, :], self.image[:, :, :16, :]), method
            )

    def test_unknown_method_raises(self):
        with self.assertRaises(ValueError):
            match_colors(self.image, self.reference, 1.0, None, "vibes")
