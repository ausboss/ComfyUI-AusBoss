from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._single_copy import (
    NOTICE_ROUTE,
    other_copy_that_loads,
    register_second_copy_notice,
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
