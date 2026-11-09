from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._single_copy import other_copy_that_loads


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


if __name__ == "__main__":
    unittest.main()
