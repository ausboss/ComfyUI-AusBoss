"""A second install of the pack loads nothing, so ComfyUI still starts.

People install the pack from ComfyUI-Manager (custom_nodes/ausboss-nodes) and
from GitHub (custom_nodes/ComfyUI-AusBoss). With both folders present, the two
copies registered the same server routes, and ComfyUI stopped at startup with
"Added route will never be executed, method HEAD is already registered".

This loads the pack twice, from two folders, in one fresh standard-library
Python with the same stand-ins as tests/test_node_api.py. The second copy must
add no routes, no nodes and no browser files, and must name both folders.
"""

from __future__ import annotations

from pathlib import Path
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parent.parent
ROUTES: list[tuple[str, str]] = []


def stub_server():
    """A PromptServer whose route table records every route, the way aiohttp will add them."""

    class Routes:
        def __getattr__(self, method):
            def register(path, *_args, **_kwargs):
                ROUTES.append((method.upper(), path))
                return lambda handler: handler

            return register

    class Instance:
        routes = Routes()

        def __getattr__(self, _name):
            return lambda *_args, **_kwargs: None

    module = types.ModuleType("server")
    module.PromptServer = type("PromptServer", (), {"instance": Instance()})
    sys.modules["server"] = module


def load_copy(name: str, folder: Path):
    spec = importlib.util.spec_from_file_location(
        name, folder / "__init__.py", submodule_search_locations=[str(folder)]
    )
    pack = importlib.util.module_from_spec(spec)
    sys.modules[name] = pack
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        spec.loader.exec_module(pack)
    return pack, out.getvalue()


def child(tmp: Path, report: Path):
    sys.path.insert(0, str(ROOT / "tests"))
    from test_node_api import StandInFinder, StandInModule

    sys.meta_path.insert(0, StandInFinder())
    sys.modules["aiohttp"] = StandInModule("aiohttp")  # route helpers import aiohttp.web first
    stub_server()
    # The two folder names people end up with: a git clone and Manager's install.
    first, second = tmp / "ComfyUI-AusBoss", tmp / "ausboss-nodes"
    first.symlink_to(ROOT, target_is_directory=True)
    second.symlink_to(ROOT, target_is_directory=True)

    first_pack, _ = load_copy("ComfyUI-AusBoss", first)
    first_routes = list(ROUTES)
    second_pack, second_out = load_copy("ausboss-nodes", second)
    report.write_text(json.dumps({
        "first_nodes": len(first_pack.NODE_CLASS_MAPPINGS),
        "first_web": first_pack.WEB_DIRECTORY,
        "first_routes": len(first_routes),
        "second_nodes": len(second_pack.NODE_CLASS_MAPPINGS),
        "second_web": second_pack.WEB_DIRECTORY,
        "second_routes": len(ROUTES) - len(first_routes),
        "duplicates": sorted({f"{m} {p}" for m, p in ROUTES if ROUTES.count((m, p)) > 1}),
        "second_out": second_out,
    }), encoding="utf-8")


class SecondCopyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "report.json"
            result = subprocess.run(
                [sys.executable, "-S", str(Path(__file__).resolve()), "--child", tmp, str(report)],
                cwd=ROOT, capture_output=True, text=True, timeout=120,
            )
            if result.returncode or not report.exists():
                raise AssertionError(f"Loading two copies failed:\n{result.stdout}\n{result.stderr}")
            cls.found = json.loads(report.read_text(encoding="utf-8"))

    def test_first_copy_loads_as_usual(self):
        self.assertGreater(self.found["first_nodes"], 0)
        self.assertGreater(self.found["first_routes"], 0)
        self.assertEqual(self.found["first_web"], "./js")

    def test_second_copy_adds_no_routes(self):
        self.assertEqual(self.found["duplicates"], [])
        self.assertEqual(self.found["second_routes"], 0)

    def test_second_copy_adds_no_nodes_or_browser_files(self):
        self.assertEqual(self.found["second_nodes"], 0)
        self.assertIsNone(self.found["second_web"])

    def test_second_copy_names_both_folders(self):
        out = self.found["second_out"]
        self.assertIn("ComfyUI-AusBoss", out)
        self.assertIn("ausboss-nodes", out)
        out.encode("ascii")  # cp1252 consoles: the message must be plain ASCII


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--child":
        child(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        unittest.main()
