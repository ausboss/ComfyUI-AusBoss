from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

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


class _FolderPaths:
    def __init__(self, lora_root: Path, user_root: Path):
        self.lora_root = lora_root
        self.user_root = user_root

    def get_full_path(self, kind: str, name: str) -> str | None:
        if kind != "loras":
            return None
        path = self.lora_root / name
        return str(path) if path.is_file() else None

    def get_folder_paths(self, kind: str) -> list[str]:
        return [str(self.lora_root)] if kind == "loras" else []

    def get_user_directory(self) -> str:
        return str(self.user_root)


class LoraCivitaiSidecarTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.lora_root = base / "models" / "loras"
        self.user_root = base / "user"
        self.lora = self.lora_root / "Krea 2" / "candid.safetensors"
        self.lora.parent.mkdir(parents=True)
        self.lora.write_bytes(b"not a real safetensors file")
        self.folder_paths = _FolderPaths(self.lora_root, self.user_root)
        self.folder_paths_patch = patch.object(_lora_helpers, "folder_paths", self.folder_paths)
        self.folder_paths_patch.start()

    def tearDown(self):
        self.folder_paths_patch.stop()
        self._tmp.cleanup()

    def test_writes_raw_standard_sidecar_beside_the_lora(self):
        payload = {
            "id": 456,
            "modelId": 123,
            "baseModel": "Krea 2",
            "trainedWords": ["candid style"],
            "model": {"name": "Candid Slider", "type": "LORA"},
            "images": [{"url": "https://example.invalid/preview.jpeg"}],
        }

        saved = _lora_helpers.save_civitai_sidecar("Krea 2/candid.safetensors", payload)

        expected = self.lora.with_suffix(".civitai.info")
        self.assertEqual(saved, expected)
        self.assertEqual(json.loads(expected.read_text(encoding="utf-8")), payload)
        self.assertFalse(Path(str(self.lora) + ".civitai.info").exists())

    def test_reads_a_standard_sidecar_created_by_another_comfyui_tool(self):
        payload = {
            "id": "456",
            "modelId": "123",
            "baseModel": "Krea 2",
            "trainedWords": [" candid style ", "film grain"],
            "model": {"name": "Candid Slider"},
        }
        self.lora.with_suffix(".civitai.info").write_text(
            json.dumps(payload), encoding="utf-8"
        )

        cached = _lora_helpers.load_civitai_cache("Krea 2/candid.safetensors")
        info = _lora_helpers.lora_info("Krea 2/candid.safetensors")

        self.assertEqual(cached["title"], "Candid Slider")
        self.assertEqual(cached["trained_words"], ["candid style", "film grain"])
        self.assertEqual(cached["model_id"], 123)
        self.assertEqual(cached["version_id"], 456)
        self.assertTrue(info["has_civitai"])
        self.assertEqual(info["civitai_triggers"], ["candid style", "film grain"])
        self.assertEqual(info["civitai_model_id"], 123)
        self.assertEqual(info["civitai_version_id"], 456)

    def test_invalid_sidecar_is_ignored(self):
        self.lora.with_suffix(".civitai.info").write_text("{}", encoding="utf-8")

        self.assertEqual(
            _lora_helpers.load_civitai_cache("Krea 2/candid.safetensors"), {}
        )
        self.assertFalse(_lora_helpers.lora_info("Krea 2/candid.safetensors")["has_civitai"])


if __name__ == "__main__":
    unittest.main()
