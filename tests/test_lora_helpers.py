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

from nodes import _lora_helpers
from nodes._lora_helpers import base_model_family, patch_total


class StubPatcher:
    def __init__(self, patches):
        self.patches = patches


class StubClip:
    def __init__(self, patches):
        self.patcher = StubPatcher(patches)


class PatchTotalTests(unittest.TestCase):
    def test_counts_patch_entries_not_keys(self):
        self.assertEqual(patch_total(StubPatcher({"a": [1], "b": [1, 1]}), None), 3)

    def test_sums_model_and_clip(self):
        self.assertEqual(patch_total(StubPatcher({"a": [1]}), StubClip({"t": [1, 1]})), 3)

    def test_empty_patchers_are_zero_not_none(self):
        self.assertEqual(patch_total(StubPatcher({}), StubClip({})), 0)

    def test_missing_clip_is_tolerated(self):
        self.assertEqual(patch_total(StubPatcher({"a": [1]}), None), 1)

    def test_unreadable_patcher_disables_the_check(self):
        self.assertIsNone(patch_total(object(), None))


class BaseModelFamilyTests(unittest.TestCase):
    def test_reads_declarative_keys(self):
        self.assertEqual(base_model_family({"modelspec.architecture": "flux-1-dev/lora"}), "Flux")
        self.assertEqual(
            base_model_family({"modelspec.architecture": "stable-diffusion-xl-v1-base/lora"}),
            "SDXL",
        )
        self.assertEqual(base_model_family({"ss_base_model_version": "sd_v1"}), "SD1.5")

    def test_source_filename_never_implies_a_family(self):
        # A filename ending _v1 or containing xl is not an architecture; mining
        # it mislabeled working LoRAs as SD1.5 / SDXL.
        self.assertEqual(base_model_family({"ss_sd_model_name": "krea2_turbo_v1.safetensors"}), "")
        self.assertEqual(base_model_family({"ss_sd_model_name": "mymodel_xl_fix.safetensors"}), "")

    def test_unknown_family_reports_what_the_file_declares(self):
        self.assertEqual(base_model_family({"modelspec.architecture": "krea2/lora"}), "krea2")
        self.assertEqual(base_model_family({"ss_base_model_version": "krea2"}), "krea2")

    def test_no_metadata_is_empty(self):
        self.assertEqual(base_model_family({}), "")


class NoEffectWarningTests(unittest.TestCase):
    def setUp(self):
        _lora_helpers._no_effect_warned.clear()
        self.addCleanup(_lora_helpers._no_effect_warned.clear)

    def _warn(self, name, family=""):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            _lora_helpers._warn_no_effect(name, family)
        return buffer.getvalue()

    def test_names_the_lora_and_stays_ascii(self):
        message = self._warn("anime_outline.safetensors")
        self.assertIn("anime_outline.safetensors", message)
        self.assertIn("matched nothing", message)
        message.encode("ascii")  # Windows cp1252 consoles

    def test_includes_declared_base_model_when_known(self):
        self.assertIn("'krea2'", self._warn("x.safetensors", "krea2"))

    def test_warns_once_per_lora(self):
        self.assertNotEqual(self._warn("x.safetensors"), "")
        self.assertEqual(self._warn("x.safetensors"), "")


if __name__ == "__main__":
    unittest.main()
