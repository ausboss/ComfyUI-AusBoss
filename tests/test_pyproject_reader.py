"""The pack loads on Python 3.10, where tomllib does not exist (issue #387).

Each check runs in a child interpreter with tomllib (and tomli) hidden, the
way a Python 3.10 install without the backport sees the world.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._pyproject import _plain_project, project_from_text

# Run in a child interpreter: make tomllib and tomli look absent.
HIDE_TOML = textwrap.dedent(
    """
    import sys
    class _NoToml:
        def find_spec(self, name, path=None, target=None):
            if name in ("tomllib", "tomli"):
                raise ModuleNotFoundError(f"No module named {name!r}", name=name)
            return None
    sys.meta_path.insert(0, _NoToml())
    sys.modules.pop("tomllib", None)
    sys.modules.pop("tomli", None)
    """
)


def run_without_toml(body: str) -> subprocess.CompletedProcess:
    code = HIDE_TOML + textwrap.dedent(body)
    return subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=60
    )


class PlainReaderTests(unittest.TestCase):
    def test_matches_tomllib_on_the_real_pyproject(self):
        text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
        real = project_from_text(text)
        plain = _plain_project(text)
        self.assertEqual(plain["name"], real["name"])
        self.assertEqual(plain["version"], real["version"])

    def test_reads_only_the_project_table(self):
        text = textwrap.dedent(
            """
            [tool.other]
            name = "not-this"

            [project]
            name = 'ausboss-nodes'   # single quotes and a comment
            version = "1.2.3"
            license = { text = "MIT License" }

            [project.urls]
            name = "not-this-either"
            """
        )
        self.assertEqual(_plain_project(text), {"name": "ausboss-nodes", "version": "1.2.3"})

    def test_no_project_table(self):
        self.assertEqual(_plain_project('[tool.x]\nversion = "9"\n'), {})


class NoTomllibTests(unittest.TestCase):
    def test_reader_works_without_tomllib(self):
        result = run_without_toml(
            """
            from nodes import _pyproject
            assert _pyproject._toml is None, _pyproject._toml
            project = _pyproject.read_project("pyproject.toml")
            print(project["name"], project["version"])
            """
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith("ausboss-nodes "), result.stdout)

    def test_single_copy_guard_works_without_tomllib(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for name, version in (("ComfyUI-AusBoss", "2.0.0"), ("ausboss-nodes", "3.0.0")):
                folder = root / name
                (folder / "nodes").mkdir(parents=True)
                (folder / "__init__.py").write_text("")
                (folder / "nodes" / "_single_copy.py").write_text("")
                (folder / "pyproject.toml").write_text(
                    f'[project]\nname = "ausboss-nodes"\nversion = "{version}"\n'
                )
            result = run_without_toml(
                f"""
                from nodes._single_copy import other_copy_that_loads
                older = {str(root / "ComfyUI-AusBoss")!r}
                winner = other_copy_that_loads(older, [{str(root)!r}])
                print(winner)
                """
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        # The newer copy is found, so its version was read without tomllib.
        self.assertIn("ausboss-nodes", result.stdout)

    def test_shipped_python_never_imports_tomllib_directly(self):
        offenders = []
        for path in [ROOT / "__init__.py", *sorted((ROOT / "nodes").rglob("*.py"))]:
            if path.name == "_pyproject.py":
                continue
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith(("import tomllib", "from tomllib")):
                    offenders.append(f"{path.relative_to(ROOT)}:{number}")
        self.assertEqual(offenders, [], "use nodes/_pyproject.py so Python 3.10 still loads")


if __name__ == "__main__":
    unittest.main()
