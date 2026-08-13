from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import unittest.mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _transform_inputs
from nodes._transform_inputs import (
    ASPECT_RATIOS,
    aspect_ratio_options,
    load_custom_aspect_ratios,
    transform_inputs,
)


class AspectPresetTests(unittest.TestCase):
    def setUp(self):
        _transform_inputs._warned_presets.clear()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = Path(self._tmp.name) / "ausboss_presets.json"

    def write(self, payload):
        self.path.write_text(payload, encoding="utf-8")

    def test_missing_file_is_silent(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertEqual(load_custom_aspect_ratios(self.path), [])
            self.assertEqual(aspect_ratio_options(self.path), ASPECT_RATIOS)
        self.assertEqual(buffer.getvalue(), "")

    def test_valid_file_extends_without_duplicates(self):
        self.write(json.dumps({"crop_aspect_ratios": ["16:10", "1:1", "5:4", "16:10"]}))
        self.assertEqual(load_custom_aspect_ratios(self.path), ["16:10", "1:1", "5:4"])
        options = aspect_ratio_options(self.path)
        self.assertEqual(options, ASPECT_RATIOS + ["16:10", "5:4"])
        self.assertEqual(options.count("1:1"), 1)

    def test_malformed_json_warns_once_and_falls_back(self):
        self.write("{not json")
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertEqual(load_custom_aspect_ratios(self.path), [])
            self.assertEqual(load_custom_aspect_ratios(self.path), [])
            self.assertEqual(aspect_ratio_options(self.path), ASPECT_RATIOS)
        output = buffer.getvalue()
        self.assertEqual(output.count("[AusBoss]"), 1)
        output.encode("ascii")  # warning must stay ASCII

    def test_wrong_shape_warns_and_falls_back(self):
        self.write(json.dumps(["1:1", "16:9"]))
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertEqual(load_custom_aspect_ratios(self.path), [])
        self.assertIn("crop_aspect_ratios", buffer.getvalue())

    def test_invalid_entries_are_skipped_with_warning(self):
        self.write(json.dumps({"crop_aspect_ratios": ["16:10", "banana", "0:1", "-1:2", 7]}))
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertEqual(load_custom_aspect_ratios(self.path), ["16:10"])
        self.assertIn("banana", buffer.getvalue())

    def test_example_file_parses_and_matches_builtins(self):
        example = ROOT / "ausboss_presets_example.json"
        entries = load_custom_aspect_ratios(example)
        self.assertEqual(entries, [item for item in ASPECT_RATIOS if item not in ("free", "source")])
        self.assertEqual(aspect_ratio_options(example), ASPECT_RATIOS)

    def test_transform_inputs_uses_preset_options(self):
        with unittest.mock.patch.object(_transform_inputs, "PRESETS_PATH", self.path):
            self.write(json.dumps({"crop_aspect_ratios": ["16:10"]}))
            options = transform_inputs()["crop_aspect_ratio"][0]
        self.assertEqual(options, ASPECT_RATIOS + ["16:10"])


if __name__ == "__main__":
    unittest.main()
