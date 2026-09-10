from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _folder_access_helpers as access


class FakeFolderPaths:
    """A throwaway ComfyUI: its own install, user folder, custom nodes, and
    a model folder that lives outside the install (extra_model_paths)."""

    def __init__(self, base: Path):
        self.base_path = str(base / "ComfyUI")
        self._dirs = {name: base / "ComfyUI" / name for name in ("input", "output", "temp", "user")}
        for folder in self._dirs.values():
            folder.mkdir(parents=True, exist_ok=True)
        custom = base / "ComfyUI" / "custom_nodes"
        shared_loras = base / "shared_models" / "loras"
        custom.mkdir(parents=True)
        shared_loras.mkdir(parents=True)
        self.folder_names_and_paths = {
            "custom_nodes": ([str(custom)], set()),
            "loras": ([str(shared_loras)], {".safetensors"}),
        }

    def get_input_directory(self):
        return str(self._dirs["input"])

    def get_output_directory(self):
        return str(self._dirs["output"])

    def get_temp_directory(self):
        return str(self._dirs["temp"])

    def get_user_directory(self):
        return str(self._dirs["user"])


class FolderAccessCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.base = Path(self._tmp.name).resolve()
        self.fake = FakeFolderPaths(self.base)
        patcher = patch.object(access, "folder_paths", self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.install = self.base / "ComfyUI"
        self.output = self.install / "output"
        self.pictures = self.base / "Pictures"
        self.pictures.mkdir()
        self.config = self.install / "user" / "ausboss" / access.CONFIG_NAME

    def write_config(self, data):
        self.config.parent.mkdir(parents=True, exist_ok=True)
        text = data if isinstance(data, str) else json.dumps(data)
        self.config.write_text(text, encoding="utf-8")

    def read_config(self):
        return json.loads(self.config.read_text(encoding="utf-8"))


class RulesTests(FolderAccessCase):
    def test_comfyuis_own_folders_always_work(self):
        self.assertTrue(access.folder_allowed(self.output / "sets" / "new"))
        self.assertTrue(access.folder_allowed(self.install / "input"))
        self.assertTrue(access.folder_allowed(self.install / "temp"))
        self.assertTrue(access.file_allowed(self.install / "input" / "clip.mp4"))

    def test_other_folders_need_an_approval(self):
        self.assertFalse(access.folder_allowed(self.pictures))
        self.assertFalse(access.file_allowed(self.pictures / "clip.mp4"))
        self.write_config({"approved": [str(self.pictures)]})
        self.assertTrue(access.folder_allowed(self.pictures))
        self.assertTrue(access.folder_allowed(self.pictures / "sets" / "not-yet-created"))
        self.assertTrue(access.file_allowed(self.pictures / "clip.mp4"))
        self.assertFalse(access.folder_allowed(self.base / "Pictures2"))

    def test_folders_holding_comfyui_are_never_usable(self):
        self.write_config({"any_folder": True, "approved": [str(self.base)]})
        for refused in (
            self.install,
            self.install / "custom_nodes" / "some_pack",
            self.install / "models" / "checkpoints",
            self.base,  # contains the install
            Path(self.base.anchor),
            self.base / "shared_models" / "loras" / "sd15",
        ):
            with self.subTest(folder=str(refused)):
                self.assertFalse(access.folder_allowed(refused))
                self.assertTrue(access.holds_comfyui(refused))
        self.assertTrue(access.folder_allowed(self.output))
        self.assertTrue(access.folder_allowed(self.pictures))

    def test_a_symlink_cannot_smuggle_a_path_out(self):
        link = self.pictures / "into_custom_nodes"
        link.symlink_to(self.install / "custom_nodes", target_is_directory=True)
        self.write_config({"approved": [str(self.pictures)]})
        self.assertFalse(access.folder_allowed(link))
        self.assertFalse(access.folder_allowed(link / "some_pack"))

    def test_a_linked_pack_counts_as_comfyui_code(self):
        # A developer's checkout linked into custom_nodes lives outside the
        # install; it is still code ComfyUI runs.
        checkout = self.base / "dev" / "MyPack"
        checkout.mkdir(parents=True)
        (self.install / "custom_nodes" / "MyPack").symlink_to(checkout, target_is_directory=True)
        self.write_config({"approved": [str(self.base / "dev")]})
        self.assertTrue(access.folder_allowed(self.base / "dev" / "renders"))
        self.assertFalse(access.folder_allowed(checkout))
        self.assertFalse(access.folder_allowed(checkout / "nodes"))
        self.assertFalse(access.approve_folder(checkout))
        self.assertIn("holds ComfyUI itself", access.refusal_message(checkout))

    def test_any_folder_is_read_on_every_check(self):
        self.write_config({"any_folder": False})
        self.assertFalse(access.folder_allowed(self.pictures))
        self.write_config({"any_folder": True})
        self.assertTrue(access.folder_allowed(self.pictures))
        self.write_config({"any_folder": "yes"})  # only a real true counts
        self.assertFalse(access.folder_allowed(self.pictures))

    def test_network_paths_are_judged_without_touching_them(self):
        share = "\\\\nas\\renders"
        with patch.object(access, "_real", side_effect=AssertionError("resolved a network path")):
            self.assertFalse(access.folder_allowed(share + "\\job1"))
            self.write_config({"approved": [share]})
            self.assertTrue(access.folder_allowed(share + "\\job1"))
            self.assertTrue(access.folder_allowed('"' + share + '\\job1"'))
            self.assertFalse(access.folder_allowed("\\\\evil\\drop"))
            self.assertFalse(access.folder_allowed("//evil/drop"))

    def test_a_damaged_file_approves_nothing(self):
        self.write_config("{not json")
        self.assertFalse(access.folder_allowed(self.pictures))
        self.assertTrue(access.read_access()["damaged"])
        self.write_config({"approved": "not a list"})
        self.assertFalse(access.folder_allowed(self.pictures))
        self.assertTrue(access.folder_allowed(self.output))


class ApprovalTests(FolderAccessCase):
    def test_approving_records_the_folder_and_keeps_hand_edits(self):
        (self.pictures / "a").mkdir()
        self.write_config({"note": "kept", "approved": [str(self.pictures / "a")]})
        self.assertTrue(access.approve_folder(self.pictures))
        stored = self.read_config()
        self.assertEqual(stored["approved"], [str(self.pictures)])  # the narrower entry folds in
        self.assertEqual(stored["note"], "kept")
        (self.pictures / "b").mkdir()
        self.assertTrue(access.approve_folder(self.pictures / "b"))  # already covered
        self.assertEqual(self.read_config()["approved"], [str(self.pictures)])

    def test_folders_holding_comfyui_and_missing_folders_are_refused(self):
        for refused in (self.install / "custom_nodes", self.install, self.base, self.pictures / "missing"):
            with self.subTest(folder=str(refused)):
                self.assertFalse(access.approve_folder(refused))
        self.assertFalse(self.config.exists())

    def test_a_damaged_file_is_never_overwritten(self):
        self.write_config("{not json")
        self.assertFalse(access.approve_folder(self.pictures))
        self.assertEqual(self.config.read_text(encoding="utf-8"), "{not json")

    def test_comfyuis_own_folders_need_no_entry(self):
        self.assertTrue(access.approve_folder(self.output))
        self.assertFalse(self.config.exists())


class DialogTests(FolderAccessCase):
    def run_choice(self, kind, answer, available=True):
        seen = []

        def ask(kind_, start, extensions):
            seen.append((kind_, start, extensions))
            return answer

        result = asyncio.run(
            access.choose_and_approve(kind, (".mp4",), ask=ask, available=lambda: available)
        )
        return result, seen

    def test_the_dialog_opens_where_approving_changes_nothing(self):
        _, seen = self.run_choice("folder", "")
        self.assertEqual(seen[0][1], str(self.output))
        _, seen = self.run_choice("video", "")
        self.assertEqual(seen[0][1], str(self.install / "input"))
        _, seen = self.run_choice("anything else", "")
        self.assertEqual(seen[0][0], "folder")

    def test_a_chosen_folder_is_approved(self):
        result, _ = self.run_choice("folder", str(self.pictures))
        self.assertEqual(result, {"ok": True, "path": str(self.pictures)})
        self.assertTrue(access.folder_allowed(self.pictures / "sets"))

    def test_a_chosen_video_approves_its_folder(self):
        clips = self.base / "Videos"
        clips.mkdir()
        result, _ = self.run_choice("video", str(clips / "clip.mp4"))
        self.assertEqual(result, {"ok": True, "path": str(clips / "clip.mp4")})
        self.assertTrue(access.file_allowed(clips / "other.mp4"))

    def test_cancel_busy_unavailable_and_refused_are_reported(self):
        self.assertEqual(self.run_choice("folder", "")[0], {"ok": False, "cancelled": True})
        self.assertEqual(self.run_choice("folder", None)[0], {"ok": False, "busy": True})
        unavailable, seen = self.run_choice("folder", str(self.pictures), available=False)
        self.assertTrue(unavailable["unavailable"])
        self.assertIn(str(self.config), unavailable["message"])
        self.assertEqual(seen, [])
        refused, _ = self.run_choice("folder", str(self.install / "custom_nodes"))
        self.assertTrue(refused["refused"])
        self.assertIn("holds ComfyUI", refused["message"])
        self.assertFalse(access.folder_allowed(self.install / "custom_nodes"))

    def test_no_dialog_on_macos_or_a_linux_box_without_a_display(self):
        with patch.object(access.sys, "platform", "darwin"):
            self.assertFalse(access.dialog_available())
        with patch.object(access.sys, "platform", "linux"), patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DISPLAY", None)
            self.assertFalse(access.dialog_available())


class MessageTests(FolderAccessCase):
    def test_a_refusal_names_the_way_to_approve(self):
        with patch.object(access, "dialog_available", lambda: False):
            message = access.refusal_message(self.pictures, "Save Image")
        self.assertTrue(message.startswith("Save Image:"))
        self.assertIn("not approved", message)
        self.assertIn(str(self.config), message)
        self.assertIn("input, output and temp folders always work", message)
        with patch.object(access, "dialog_available", lambda: True):
            self.assertIn("Browse button", access.refusal_message(self.pictures))
        message.encode("ascii")  # safe on a cp1252 console

    def test_the_public_refusal_names_no_server_paths(self):
        with patch.object(access, "dialog_available", lambda: True):
            error = access.refusal(self.pictures)
        self.assertIsInstance(error, ValueError)
        self.assertIn(str(self.config), str(error))  # the owner's full message
        self.assertNotIn(str(self.base), error.public)
        self.assertIn("Browse", error.public)
        self.assertIn("holds ComfyUI", access.refusal(self.install / "custom_nodes").public)

    def test_a_folder_holding_comfyui_gets_its_own_reason(self):
        message = access.refusal_message(self.install / "custom_nodes", "Save Image")
        self.assertIn("holds ComfyUI itself", message)
        self.assertNotIn("not approved", message)


if __name__ == "__main__":
    unittest.main()
