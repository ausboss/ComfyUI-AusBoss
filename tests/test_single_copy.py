from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._single_copy import (
    NOTICE_ROUTE,
    other_copy_that_loads,
    register_second_copy_notice,
    retire_old_copies,
    second_copy_notice,
)


def make_copy(root: Path, name: str, version: str, guarded: bool = True, pack: str = "ausboss-nodes") -> str:
    folder = root / name
    (folder / "nodes").mkdir(parents=True)
    (folder / "__init__.py").write_text("")
    (folder / "pyproject.toml").write_text(f'[project]\nname = "{pack}"\nversion = "{version}"\n')
    if guarded:
        (folder / "nodes" / "_single_copy.py").write_text("")
    return str(folder)


def loads(folder: str, root: Path) -> bool:
    return other_copy_that_loads(folder, [str(root)]) is None


class SingleCopyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()

    def tearDown(self):
        self._tmp.cleanup()

    def test_a_lone_copy_loads(self):
        a = make_copy(self.root, "ComfyUI-AusBoss", "2.24.0")
        make_copy(self.root, "some-other-pack", "9.0.0", pack="other")
        self.assertTrue(loads(a, self.root))

    def test_exactly_one_of_two_copies_loads_and_it_is_the_newer(self):
        a = make_copy(self.root, "ComfyUI-AusBoss", "2.24.0")
        b = make_copy(self.root, "ausboss-nodes", "2.25.0")
        self.assertFalse(loads(a, self.root))
        self.assertTrue(loads(b, self.root))
        self.assertEqual(other_copy_that_loads(a, [str(self.root)])["version"], "2.25.0")

    def test_same_version_still_picks_one(self):
        a = make_copy(self.root, "ComfyUI-AusBoss", "2.24.0")
        b = make_copy(self.root, "ausboss-nodes", "2.24.0")
        self.assertEqual([loads(a, self.root), loads(b, self.root)].count(True), 1)

    def test_yields_to_an_older_copy_that_cannot_step_aside(self):
        new = make_copy(self.root, "ComfyUI-AusBoss", "2.24.0")
        make_copy(self.root, "ausboss-nodes", "2.22.0", guarded=False)
        self.assertFalse(loads(new, self.root))

    def test_a_disabled_copy_does_not_count(self):
        a = make_copy(self.root, "ComfyUI-AusBoss", "2.24.0")
        make_copy(self.root, "ausboss-nodes.disabled", "2.25.0")
        self.assertTrue(loads(a, self.root))

    def test_a_link_to_the_same_folder_is_one_copy(self):
        a = make_copy(self.root, "ComfyUI-AusBoss", "2.24.0")
        (self.root / "link").symlink_to(a)
        self.assertTrue(loads(a, self.root))
        self.assertTrue(loads(str(self.root / "link"), self.root))

    def test_ten_is_newer_than_nine(self):
        a = make_copy(self.root, "ComfyUI-AusBoss", "2.9.0")
        b = make_copy(self.root, "ausboss-nodes", "2.10.0")
        self.assertFalse(loads(a, self.root))
        self.assertTrue(loads(b, self.root))


class SecondCopyNoticeTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()

    def tearDown(self):
        self._tmp.cleanup()

    def test_an_old_copy_that_cannot_step_aside_is_named_for_deleting(self):
        new = make_copy(self.root, "ausboss-nodes", "2.26.6")
        make_copy(self.root, "ComfyUI-AusBoss", "2.23.0", guarded=False)
        other = other_copy_that_loads(new, [str(self.root)])
        notice = second_copy_notice(new, "2.26.6", other)
        self.assertTrue(notice["older"])
        self.assertIn("old copy", notice["summary"])
        self.assertIn("v2.23.0 in custom_nodes/ComfyUI-AusBoss", notice["detail"])
        self.assertIn("Delete the custom_nodes/ComfyUI-AusBoss folder", notice["detail"])

    def test_a_newer_copy_loading_asks_to_delete_this_one(self):
        old = make_copy(self.root, "ComfyUI-AusBoss", "2.24.0")
        make_copy(self.root, "ausboss-nodes", "2.25.0")
        notice = second_copy_notice(old, "2.24.0", other_copy_that_loads(old, [str(self.root)]))
        self.assertFalse(notice["older"])
        self.assertIn("Delete custom_nodes/ComfyUI-AusBoss,", notice["detail"])


class RetireOldCopiesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()

    def tearDown(self):
        self._tmp.cleanup()

    def test_a_copy_from_before_the_guard_is_turned_off_and_kept(self):
        new = make_copy(self.root, "ausboss-nodes", "2.26.6")
        make_copy(self.root, "ComfyUI-AusBoss", "2.23.0", guarded=False)
        retired = retire_old_copies(new, [str(self.root)])
        self.assertEqual([Path(r["disabled"]).name for r in retired], ["ComfyUI-AusBoss.disabled"])
        self.assertTrue((self.root / "ComfyUI-AusBoss.disabled" / "pyproject.toml").is_file())
        self.assertFalse((self.root / "ComfyUI-AusBoss").exists())
        # With the old copy off, the new one loads.
        self.assertTrue(loads(new, self.root))

    def test_copies_that_can_step_aside_are_left_alone(self):
        new = make_copy(self.root, "ausboss-nodes", "2.26.6")
        make_copy(self.root, "ComfyUI-AusBoss", "2.25.0")
        self.assertEqual(retire_old_copies(new, [str(self.root)]), [])
        self.assertTrue((self.root / "ComfyUI-AusBoss").is_dir())

    def test_other_packs_and_a_lone_copy_are_left_alone(self):
        new = make_copy(self.root, "ausboss-nodes", "2.26.6")
        make_copy(self.root, "some-other-pack", "1.0.0", guarded=False, pack="other")
        self.assertEqual(retire_old_copies(new, [str(self.root)]), [])
        self.assertTrue((self.root / "some-other-pack").is_dir())

    def test_an_existing_disabled_folder_is_not_overwritten(self):
        new = make_copy(self.root, "ausboss-nodes", "2.26.6")
        make_copy(self.root, "ComfyUI-AusBoss", "2.23.0", guarded=False)
        (self.root / "ComfyUI-AusBoss.disabled").mkdir()
        retired = retire_old_copies(new, [str(self.root)])
        self.assertEqual(Path(retired[0]["disabled"]).name, "ComfyUI-AusBoss.2.disabled")

    def test_a_folder_that_cannot_be_renamed_is_reported(self):
        new = make_copy(self.root, "ausboss-nodes", "2.26.6")
        make_copy(self.root, "ComfyUI-AusBoss", "2.23.0", guarded=False)
        with patch("os.rename", side_effect=PermissionError("in use")):
            retired = retire_old_copies(new, [str(self.root)])
        self.assertIsNone(retired[0]["disabled"])
        self.assertIn("in use", retired[0]["error"])
        self.assertTrue((self.root / "ComfyUI-AusBoss").is_dir())

    def test_a_link_is_renamed_not_its_target(self):
        new = make_copy(self.root, "ausboss-nodes", "2.26.6")
        elsewhere = Path(tempfile.mkdtemp())
        try:
            target = make_copy(elsewhere, "checkout", "2.23.0", guarded=False)
            (self.root / "ComfyUI-AusBoss").symlink_to(target)
            retire_old_copies(new, [str(self.root)])
            self.assertTrue((self.root / "ComfyUI-AusBoss.disabled").is_symlink())
            self.assertTrue(Path(target).is_dir())
        finally:
            import shutil

            shutil.rmtree(elsewhere)

    def test_the_prestartup_script_runs_on_its_own(self):
        import runpy
        import shutil

        pack = self.root / "ausboss-nodes"
        shutil.copytree(ROOT / "nodes", pack / "nodes", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy(ROOT / "pyproject.toml", pack / "pyproject.toml")
        shutil.copy(ROOT / "prestartup_script.py", pack / "prestartup_script.py")
        (pack / "__init__.py").write_text("")
        make_copy(self.root, "ComfyUI-AusBoss", "2.23.0", guarded=False)
        fake = type(sys)("folder_paths")
        fake.get_folder_paths = lambda kind: [str(self.root)]
        with patch.dict(sys.modules, {"folder_paths": fake}):
            runpy.run_path(str(pack / "prestartup_script.py"))
        self.assertTrue((self.root / "ComfyUI-AusBoss.disabled").is_dir())


class FakeRoutes:
    def __init__(self):
        self.added = {}

    def get(self, path):
        def add(handler):
            if path in self.added:
                raise AssertionError(f"{path} added twice")
            self.added[path] = handler
            return handler

        return add


class FakeServer:
    def __init__(self):
        self.routes = FakeRoutes()


class SecondCopyRouteTests(unittest.TestCase):
    def test_two_copies_stepping_aside_share_one_route(self):
        import asyncio
        import json

        server = FakeServer()
        self.assertTrue(register_second_copy_notice({"detail": "one"}, server))
        self.assertTrue(register_second_copy_notice({"detail": "two"}, server))
        self.assertEqual(list(server.routes.added), [NOTICE_ROUTE])
        response = asyncio.run(server.routes.added[NOTICE_ROUTE](None))
        self.assertEqual(json.loads(response.body), [{"detail": "one"}, {"detail": "two"}])


class EntryPointTests(unittest.TestCase):
    def test_a_copy_that_steps_aside_serves_only_the_warning(self):
        text = (ROOT / "__init__.py").read_text(encoding="utf-8")
        self.assertIn('WEB_DIRECTORY = "./web_second_copy" if _other_copy else "./js"', text)
        web = ROOT / "web_second_copy"
        self.assertEqual(sorted(p.name for p in web.glob("*.js")), ["index.js"])
        # Served alone, so nothing may reach into the pack's js/ folder.
        for path in web.iterdir():
            self.assertNotIn("../js/", path.read_text(encoding="utf-8"))
            self.assertNotIn("/shared/", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
