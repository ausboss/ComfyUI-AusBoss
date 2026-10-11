"""What the pack uses from ComfyUI, checked against a real ComfyUI.

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_comfy_core_contract.py

Without a checkout the tests skip. With one, a ComfyUI update that moves or
renames something a node leans on fails here, by name, before a user meets
it. Nothing is run on a GPU and no model is loaded.

Two parts:

1. Read from the pack's own source, so the list keeps itself: every ComfyUI
   module a node file imports, every name imported from one, and every
   function or value read straight off one (`comfy.utils.ProgressBar`).
2. What is asked for by name while a workflow runs, which no reader of
   imports can find: ComfyUI's own nodes that the pack calls, with the
   inputs it passes them, and a few internals that a node reads with a
   fallback (it keeps working without them, only slower or less quiet).
   A node call that is not in the table fails the test too, so the table
   cannot fall behind the code.
"""

from __future__ import annotations

import ast
import asyncio
import importlib
import inspect
import os
from pathlib import Path
import re
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parent.parent
COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")
SOURCES = [ROOT / "__init__.py", *sorted((ROOT / "nodes").glob("*.py"))]
# The top-level names that are ComfyUI's. `nodes` is left out on purpose:
# the pack's own folder has that name, and node files reach ComfyUI's
# `nodes` module through sys.modules (see CORE_NODES).
COMFY_TOP = ("comfy", "comfy_extras", "comfy_api", "comfy_execution", "folder_paths", "server", "node_helpers", "execution", "latent_preview", "app")

# ComfyUI's own nodes the pack calls: how it calls each, and the inputs it passes.
CORE_NODES = {
    "SAM3_Detect": ("execute", ["model", "image", "conditioning", "positive_coords", "threshold", "refine_iterations", "individual_masks"]),
    "CLIPTextEncode": ("encode", ["clip", "text"]),
    "LoadBackgroundRemovalModel": ("execute", ["bg_removal_name"]),
    "RemoveBackground": ("execute", ["bg_removal_model", "image"]),
    "ImageUpscaleWithModel": ("execute", ["upscale_model", "image"]),
}
# Read with a fallback while a workflow runs: (module, name, what leans on it).
INTERNALS = [
    ("comfy.utils", "PROGRESS_BAR_HOOK", "Mask by Touch holds progress reports back while it looks at a picture"),
    ("comfy_execution.progress", "get_progress_state", "Mask by Touch holds progress reports back while it looks at a picture"),
    ("comfy.model_management", "load_model_gpu", "Mask by Touch asks SAM 3 the quick way"),
    ("comfy.model_management", "current_loaded_models", "Mask by Touch asks SAM 3 the quick way"),
    ("comfy.model_management", "intermediate_dtype", "the pack's tensors take ComfyUI's working type"),
    ("folder_paths", "folder_names_and_paths", "the pack reads ComfyUI's model folders"),
]
# The progress list's own switches, by the names the pack calls.
PROGRESS_SWITCHES = ("enable_handler", "disable_handler")


def comfy_uses(path: Path) -> list[tuple[str, str | None, str]]:
    """(module, name or None, where) for everything `path` takes from ComfyUI."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    where = lambda node: f"{path.relative_to(ROOT).as_posix()}:{node.lineno}"  # noqa: E731
    found, bound, shadowed = [], {}, set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in COMFY_TOP:
                    found.append((alias.name, None, where(node)))
                    bound[alias.asname or alias.name.split(".")[0]] = alias.name if alias.asname else alias.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and (node.module or "").split(".")[0] in COMFY_TOP:
            for alias in node.names:
                found.append((node.module, None if alias.name == "*" else alias.name, where(node)))
                if alias.name != "*":
                    bound[alias.asname or alias.name] = f"{node.module}.{alias.name}"
        elif isinstance(node, ast.arg):
            shadowed.add(node.arg)
        elif isinstance(node, ast.Assign) and not (isinstance(node.value, ast.Constant) and node.value.value is None):
            # `folder_paths = None` after a failed import is the offline
            # stand-in, not another meaning of the name.
            shadowed.update(name.id for target in node.targets for name in ast.walk(target) if isinstance(name, ast.Name))
    inner = {id(node.value) for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute) or id(node) in inner:
            continue
        chain, base = [], node
        while isinstance(base, ast.Attribute):
            chain.append(base.attr)
            base = base.value
        if isinstance(base, ast.Name) and base.id in bound and base.id not in shadowed:
            found.append((bound[base.id], ".".join(reversed(chain)), where(node)))
    return found


def everything_used() -> dict:
    """{(dotted start, path below it or None): [where, ...]} over the pack."""
    uses = {}
    for path in SOURCES:
        for start, name, where in comfy_uses(path):
            uses.setdefault((start, name), []).append(where)
    return uses


def _module(dotted: str):
    """The longest part of `dotted` that is a module, and what is left."""
    parts = dotted.split(".")
    for cut in range(len(parts), 0, -1):
        try:
            return importlib.import_module(".".join(parts[:cut])), parts[cut:]
        except ImportError:
            continue
    raise ImportError(dotted)


def missing(start: str, below: str | None) -> str | None:
    """None when `start` and what the pack reads below it are there; else what is not."""
    try:
        thing, rest = _module(start)
    except ImportError:
        return start
    walked = start if not rest else thing.__name__
    for part in [*rest, *(below.split(".") if below else [])]:
        if not isinstance(thing, types.ModuleType):
            return None      # an object or a class: what it carries is its own business
        walked = f"{thing.__name__}.{part}"
        if hasattr(thing, part):
            thing = getattr(thing, part)
            continue
        try:
            thing = importlib.import_module(walked)
        except ImportError:
            return walked
    return None


def core_node_calls() -> set[str]:
    """The keys of ComfyUI's own nodes that the pack's source asks for."""
    asked = set()
    for path in SOURCES:
        text = path.read_text(encoding="utf-8")
        asked.update(re.findall(r'_core_node\(\s*"([A-Za-z0-9_]+)"', text))
        asked.update(re.findall(r'(?:_core_nodes\(\)|\bcore)\.get\(\s*"([A-Za-z0-9_]+)"', text))
    return asked


_comfy = {}


def comfy_nodes():
    """ComfyUI's `nodes` module with its built-in nodes registered, on the CPU."""
    if "nodes" not in _comfy:
        sys.path.insert(0, COMFY_ROOT)
        argv, sys.argv = sys.argv, [sys.argv[0], "--cpu"]
        try:
            import comfy.options
            comfy.options.enable_args_parsing()
            import nodes
            wanted = inspect.signature(nodes.init_extra_nodes).parameters
            made = nodes.init_extra_nodes(**{name: False for name in ("init_custom_nodes", "init_api_nodes") if name in wanted})
            if inspect.isawaitable(made):
                asyncio.run(made)
        finally:
            sys.argv = argv
        _comfy["nodes"] = nodes
    return _comfy["nodes"]


class SourceTests(unittest.TestCase):
    """These need no ComfyUI: they keep the reading of the source honest."""

    def test_the_pack_does_use_comfyui(self):
        uses = everything_used()
        self.assertGreater(len(uses), 20)
        self.assertIn(("folder_paths", None), uses)

    def test_every_core_node_the_source_calls_is_in_the_table(self):
        self.assertEqual(core_node_calls(), set(CORE_NODES), "a call to one of ComfyUI's nodes was added or removed: bring CORE_NODES in line")

    def test_what_is_gone_is_named_and_what_is_there_is_not(self):
        # On Python's own modules, so it runs without ComfyUI.
        self.assertIsNone(missing("os.path", "join"))
        self.assertIsNone(missing("os", "path.join"))
        self.assertIsNone(missing("json", None))
        self.assertIsNone(missing("pathlib.Path", "home.nothing_is_checked_below_a_class"))
        self.assertEqual(missing("os.path", "no_such_function"), "posixpath.no_such_function" if os.name == "posix" else "ntpath.no_such_function")
        self.assertEqual(missing("json", "no_such_part.deeper"), "json.no_such_part")
        self.assertEqual(missing("no_such_module_at_all", None), "no_such_module_at_all")

    def test_a_name_that_was_given_another_meaning_is_not_followed(self):
        # In this file `server` is one of the names: an argument called
        # `server` must not be read as ComfyUI's module.
        path = ROOT / "tests" / "_contract_sample.py"
        try:
            path.write_text("import server\nimport folder_paths\n\ndef f(server):\n    return server.client_id\n\nx = folder_paths.get_filename_list\n", encoding="utf-8")
            found = {(start, name) for start, name, _where in comfy_uses(path)}
        finally:
            path.unlink(missing_ok=True)
        self.assertIn(("folder_paths", "get_filename_list"), found)
        self.assertNotIn(("server", "client_id"), found)


@unittest.skipUnless(COMFY_ROOT, "set AUSBOSS_COMFY_ROOT to a ComfyUI checkout")
class CoreContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nodes = comfy_nodes()

    def test_everything_the_source_takes_from_comfyui_is_there(self):
        gone = []
        for (start, below), wheres in sorted(everything_used().items(), key=lambda item: (item[0][0], item[0][1] or "")):
            lost = missing(start, below)
            if lost:
                gone.append(f"{lost}  (used at {', '.join(wheres[:3])})")
        self.assertEqual(gone, [], "ComfyUI no longer has:\n  " + "\n  ".join(gone))

    def test_comfyuis_own_nodes_the_pack_calls_take_the_inputs_it_passes(self):
        problems = []
        for key, (method, passed) in CORE_NODES.items():
            node = self.nodes.NODE_CLASS_MAPPINGS.get(key)
            if node is None:
                problems.append(f"{key}: ComfyUI has no node of that key")
                continue
            if not callable(getattr(node, method, None)):
                problems.append(f"{key}: no {method}()")
                continue
            takes = node.INPUT_TYPES()
            names = set(takes.get("required", {})) | set(takes.get("optional", {}))
            for name in passed:
                if name not in names:
                    problems.append(f"{key}: no input '{name}' (it takes {sorted(names)})")
        self.assertEqual(problems, [], "\n  ".join(problems))

    def test_internals_a_node_reads_with_a_fallback_are_still_there(self):
        gone = [f"{module}.{name}: {why}" for module, name, why in INTERNALS if missing(module, name)]
        self.assertEqual(gone, [], "the nodes still work, by their fallback:\n  " + "\n  ".join(gone))

    def test_the_progress_list_still_has_its_switches(self):
        progress = importlib.import_module("comfy_execution.progress")
        lists = [thing for thing in vars(progress).values() if inspect.isclass(thing) and all(callable(getattr(thing, name, None)) for name in PROGRESS_SWITCHES)]
        self.assertTrue(lists, f"no class in comfy_execution.progress has {PROGRESS_SWITCHES}")

    def test_the_model_folders_the_pack_reads_exist(self):
        folder_paths = importlib.import_module("folder_paths")
        known = set(folder_paths.folder_names_and_paths)
        asked, added = set(), set()
        for path in SOURCES:
            text = path.read_text(encoding="utf-8")
            named = re.findall(r'^MODEL_FOLDER\s*=\s*"([a-z_]+)"', text, re.MULTILINE)
            asked.update(re.findall(r'(?:get_filename_list|get_full_path|get_full_path_or_raise|get_folder_paths)\(\s*"([a-z_]+)"', text))
            asked.update(named)
            # A folder the pack registers itself (LaMa's) is its own, not ComfyUI's.
            added.update(re.findall(r'add_model_folder_path\(\s*"([a-z_]+)"', text))
            if re.search(r"(?:add_model_folder_path\(\s*MODEL_FOLDER|folder_names_and_paths\[MODEL_FOLDER\]\s*=)", text):
                added.update(named)
        self.assertIn("background_removal", asked)
        self.assertEqual(sorted(asked - added - known), [], f"ComfyUI has no model folder of that name; it has {sorted(known)}")


if __name__ == "__main__":
    unittest.main()
