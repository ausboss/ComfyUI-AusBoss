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

    def test_lora_info_reports_file_facts(self):
        info = _lora_helpers.lora_info("Krea 2/candid.safetensors")

        stat = self.lora.stat()
        self.assertEqual(info["size_bytes"], stat.st_size)
        self.assertEqual(info["mtime"], stat.st_mtime)

    def test_invalid_sidecar_is_ignored(self):
        self.lora.with_suffix(".civitai.info").write_text("{}", encoding="utf-8")

        self.assertEqual(
            _lora_helpers.load_civitai_cache("Krea 2/candid.safetensors"), {}
        )
        self.assertFalse(_lora_helpers.lora_info("Krea 2/candid.safetensors")["has_civitai"])




class TestMatchLoraName(unittest.TestCase):
    AVAILABLE = [
        "krea2/Beauty.safetensors",
        "styles/Beauty.safetensors",
        "klein/outpaint_v1.safetensors",
    ]

    def test_exact_wins(self):
        self.assertEqual(
            _lora_helpers.match_lora_name("klein/outpaint_v1.safetensors", self.AVAILABLE),
            ("klein/outpaint_v1.safetensors", "exact"),
        )

    def test_case_insensitive_full_path(self):
        self.assertEqual(
            _lora_helpers.match_lora_name("KLEIN/Outpaint_V1.safetensors", self.AVAILABLE),
            ("klein/outpaint_v1.safetensors", "remapped"),
        )

    def test_moved_file_resolves_by_unique_basename(self):
        # The whole point: a file reorganized into another folder (or a
        # workflow from another machine's layout) lands on the same file.
        self.assertEqual(
            _lora_helpers.match_lora_name("old\\path\\outpaint_v1.safetensors", self.AVAILABLE),
            ("klein/outpaint_v1.safetensors", "remapped"),
        )

    def test_extension_ignored_in_basename_match(self):
        self.assertEqual(
            _lora_helpers.match_lora_name("outpaint_v1.ckpt", self.AVAILABLE),
            ("klein/outpaint_v1.safetensors", "remapped"),
        )

    def test_ambiguous_basename_stays_put(self):
        name, status = _lora_helpers.match_lora_name(
            "elsewhere/Beauty.safetensors", self.AVAILABLE
        )
        self.assertEqual((name, status), ("elsewhere/Beauty.safetensors", "ambiguous"))

    def test_missing_is_reported(self):
        self.assertEqual(
            _lora_helpers.match_lora_name("gone.safetensors", self.AVAILABLE)[1],
            "missing",
        )


class MissingRowPolicyTests(unittest.TestCase):
    """on_missing: error (the default) stops before sampling, skip warns and keeps going."""

    ROW = {"name": "gone.safetensors", "strength": 1.0, "strength_clip": 1.0,
           "enabled": True, "triggers": ""}

    def setUp(self):
        _lora_helpers._missing_warned.clear()
        self.addCleanup(_lora_helpers._missing_warned.clear)
        # apply_lora_stack imports comfy.sd lazily; the missing-file branch runs
        # before any of it is used, so an empty stand-in module is enough.
        import types

        fake_comfy = types.ModuleType("comfy")
        fake_sd = types.ModuleType("comfy.sd")
        fake_comfy.sd = fake_sd
        self.modules = patch.dict(sys.modules, {"comfy": fake_comfy, "comfy.sd": fake_sd})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.gone = patch.object(
            _lora_helpers, "resolve_lora_path",
            side_effect=ValueError("LoRA file not found in models/loras: gone.safetensors"),
        )
        self.gone.start()
        self.addCleanup(self.gone.stop)

    def test_missing_rows_ignores_disabled_and_zero_rows(self):
        rows = [
            dict(self.ROW),
            {**self.ROW, "name": "off.safetensors", "enabled": False},
            {**self.ROW, "name": "parked.safetensors", "strength": 0, "strength_clip": 0},
        ]
        self.assertEqual(
            [name for name, _ in _lora_helpers.missing_lora_rows(rows)],
            ["gone.safetensors"],
        )

    def test_skip_warns_once_and_keeps_going(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            model, clip = _lora_helpers.apply_lora_stack(
                "model", None, [dict(self.ROW)], on_missing="skip"
            )
            _lora_helpers.apply_lora_stack("model", None, [dict(self.ROW)], on_missing="skip")
        self.assertEqual((model, clip), ("model", None))
        self.assertEqual(buffer.getvalue().count("skipping 'gone.safetensors'"), 1)

    def test_error_is_the_default_and_names_the_file_and_the_switch(self):
        for kwargs in ({}, {"on_missing": "error"}):
            with self.assertRaises(ValueError) as caught:
                _lora_helpers.apply_lora_stack("model", None, [dict(self.ROW)], **kwargs)
            message = str(caught.exception)
            self.assertIn("gone.safetensors", message)
            self.assertIn("Stop on missing LoRA", message)
            self.assertIn("settings menu", message)
            self.assertIn("on_missing: skip", message)
            message.encode("ascii")  # Windows cp1252 consoles

    def test_node_validation_blocks_by_default_and_passes_in_skip_mode(self):
        try:
            from nodes.node_lora_loader import AusBossLoraLoader
        except Exception as exc:  # pragma: no cover - needs the package importable
            self.skipTest(f"node module not importable offline: {exc}")
        stack = json.dumps([dict(self.ROW)])
        self.assertIs(AusBossLoraLoader.VALIDATE_INPUTS(stack, on_missing="skip"), True)
        for kwargs in ({}, {"on_missing": "error"}):
            verdict = AusBossLoraLoader.VALIDATE_INPUTS(stack, **kwargs)
            self.assertIsInstance(verdict, str)
            self.assertIn("gone.safetensors", verdict)
            self.assertIn("settings menu", verdict)
            verdict.encode("ascii")
        # The input's declared default matches the code paths above.
        on_missing = AusBossLoraLoader.INPUT_TYPES()["optional"]["on_missing"]
        self.assertEqual(on_missing[1]["default"], "error")


if __name__ == "__main__":
    unittest.main()
