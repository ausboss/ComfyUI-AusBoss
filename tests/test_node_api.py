"""Released node inputs and outputs only ever grow.

Saved workflows keep widget values by position and links by slot index, and
an API prompt must supply every required input. So an input may only be
appended as optional and an output only appended; nothing is renamed,
reordered, removed or made required. tests/fixtures/node_api.json pins the
current API. After a deliberate, compatible change (or a new node), refresh
it with ComfyUI's Python:

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_node_api.py --update

Without ComfyUI (in CI) the same comparison runs on an offline load of the
pack: a fresh standard-library Python with torch, NumPy, Pillow, PyAV and
SciPy replaced by stand-ins that accept anything. Input and output names
come from the node code itself, so the stand-ins cannot change them; with
ComfyUI, a test checks that the offline load describes the pack exactly as
the real one does.
"""

from __future__ import annotations

from pathlib import Path
import importlib.abc
import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "tests" / "fixtures" / "node_api.json"
COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")

# The libraries node modules import when they load. Everything else the
# pack touches (ComfyUI's own modules, optional extras) is imported inside
# functions or behind an ImportError fallback.
OFFLINE_STAND_INS = ("torch", "numpy", "PIL", "av", "scipy")


def stub_server():
    # Route registration needs a running PromptServer; reading the API does not.
    class Routes:
        def __getattr__(self, _name):
            return lambda *_args, **_kwargs: (lambda handler: handler)

    class Instance:
        routes = Routes()

        def __getattr__(self, _name):
            return lambda *_args, **_kwargs: None

    module = types.ModuleType("server")
    module.PromptServer = type("PromptServer", (), {"instance": Instance()})
    sys.modules["server"] = module


def load_pack():
    """Import the pack the way ComfyUI does, fail-soft loader included."""
    sys.path.insert(0, COMFY_ROOT)
    sys.argv = sys.argv[:1]  # ComfyUI's argument parser reads sys.argv
    # Reading the API needs no GPU. CPU mode keeps the test off the card and
    # lets it run with the GPU hidden (CUDA_VISIBLE_DEVICES="").
    import comfy.cli_args

    comfy.cli_args.args.cpu = True
    stub_server()
    spec = importlib.util.spec_from_file_location(
        "ausboss_node_api", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
    )
    pack = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = pack
    spec.loader.exec_module(pack)
    return pack


class StandIn:
    """Any attribute, call, item, base class or number a module-level line asks for."""

    def __init__(self, *_args, **_kwargs):
        pass

    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return StandIn()

    def __call__(self, *args, **kwargs):
        # Used as a decorator (@torch.no_grad()), it hands the function back.
        if len(args) == 1 and not kwargs and callable(args[0]) and not isinstance(args[0], StandIn):
            return args[0]
        return StandIn()

    def __mro_entries__(self, _bases):
        return (StandIn,)

    def __getitem__(self, _key):
        return StandIn()

    def __iter__(self):
        return iter(())

    def __bool__(self):
        return False

    def __len__(self):
        return 0

    def __index__(self):
        return 0

    __int__ = __index__

    def __float__(self):
        return 0.0

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def __or__(self, _other):
        return StandIn()

    __ror__ = __add__ = __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = __or__
    __truediv__ = __rtruediv__ = __pow__ = __neg__ = __or__


class StandInModule(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return StandIn()


class StandInFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, _path=None, _target=None):
        if name.split(".")[0] in OFFLINE_STAND_INS:
            return importlib.machinery.ModuleSpec(name, self, is_package=True)
        return None

    def create_module(self, spec):
        module = StandInModule(spec.name)
        module.__path__ = []
        return module

    def exec_module(self, _module):
        pass


def load_pack_offline():
    """Import the pack with no ComfyUI and stand-ins for its heavy libraries."""
    sys.meta_path.insert(0, StandInFinder())
    stub_server()
    spec = importlib.util.spec_from_file_location(
        "ausboss_node_api_offline", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
    )
    pack = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = pack
    spec.loader.exec_module(pack)
    return pack


def describe_offline() -> tuple[dict, list[str]]:
    """describe() of an offline load, run in a fresh standard-library Python."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "api.json"
        # -S leaves out site-packages, so every machine loads what CI loads.
        result = subprocess.run(
            [sys.executable, "-S", str(Path(__file__).resolve()), "--describe-offline", str(out)],
            cwd=ROOT, capture_output=True, text=True, timeout=120,
            env={key: value for key, value in os.environ.items() if key != "AUSBOSS_COMFY_ROOT"},
        )
        if result.returncode or not out.exists():
            raise AssertionError(f"The offline load failed:\n{result.stdout}\n{result.stderr}")
        found = json.loads(out.read_text(encoding="utf-8"))
    return found["api"], found["failed"]


def describe(pack) -> dict:
    api = {}
    for key, cls in sorted(pack.NODE_CLASS_MAPPINGS.items()):
        inputs = cls.INPUT_TYPES()
        types_ = [str(kind) if isinstance(kind, str) else "COMBO" for kind in cls.RETURN_TYPES]
        names = list(getattr(cls, "RETURN_NAMES", None) or types_)
        api[key] = {
            "required": list(inputs.get("required", {})),
            "optional": list(inputs.get("optional", {})),
            "outputs": [[kind, name] for kind, name in zip(types_, names)],
        }
    return api


def breaking_changes(old: dict, new: dict) -> list[str]:
    problems = []
    for key, was in old.items():
        now = new.get(key)
        if now is None:
            problems.append(f"{key}: removed")
            continue
        old_inputs = was["required"] + was["optional"]
        new_inputs = now["required"] + now["optional"]
        if new_inputs[: len(old_inputs)] != old_inputs:
            problems.append(f"{key}: inputs {old_inputs} became {new_inputs}; only appending is safe")
        added = [name for name in now["required"] if name not in was["required"]]
        if added:
            problems.append(f"{key}: {added} became required; API prompts without them stop validating")
        if now["outputs"][: len(was["outputs"])] != was["outputs"]:
            problems.append(f"{key}: outputs {was['outputs']} became {now['outputs']}; only appending is safe")
    return problems


@unittest.skipUnless(COMFY_ROOT, "set AUSBOSS_COMFY_ROOT to a ComfyUI checkout")
class NodeApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = load_pack()
        cls.api = describe(cls.pack)
        cls.snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    def test_every_node_module_loads(self):
        self.assertEqual(self.pack._failed_modules, [])

    def test_no_breaking_changes(self):
        self.assertEqual(breaking_changes(self.snapshot, self.api), [])

    def test_snapshot_is_current(self):
        self.assertEqual(
            self.snapshot, self.api,
            "The node API grew compatibly; refresh the snapshot with --update (see this file's docstring).",
        )

    def test_the_offline_load_describes_the_pack_as_comfyui_does(self):
        # OfflineSnapshotTests stand in for these tests in CI; this keeps
        # the stand-ins honest.
        offline, failed = describe_offline()
        self.assertEqual(failed, [])
        self.assertEqual(offline, self.api)


class OfflineSnapshotTests(unittest.TestCase):
    """The snapshot comparison without ComfyUI, so CI catches a renamed input."""

    @classmethod
    def setUpClass(cls):
        cls.api, cls.failed = describe_offline()
        cls.snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    def test_every_node_module_loads(self):
        self.assertEqual(self.failed, [])

    def test_no_breaking_changes(self):
        self.assertEqual(breaking_changes(self.snapshot, self.api), [])

    def test_snapshot_is_current(self):
        self.assertEqual(
            self.snapshot, self.api,
            "The node API grew compatibly; refresh the snapshot with --update (see this file's docstring).",
        )


class BreakingChangeRuleTests(unittest.TestCase):
    OLD = {"N": {"required": ["a", "b"], "optional": ["c"], "outputs": [["IMAGE", "image"]]}}

    def check(self, old=None, **now):
        old = old or self.OLD
        return breaking_changes(old, {"N": {**old["N"], **now}})

    def test_appending_an_optional_input_or_an_output_is_safe(self):
        self.assertEqual(self.check(optional=["c", "d"]), [])
        self.assertEqual(self.check(outputs=[["IMAGE", "image"], ["INT", "width"]]), [])

    def test_a_new_required_input_breaks_api_prompts(self):
        # Each case keeps the saved input order intact, so only the
        # "became required" rule can catch it.
        promoted = self.check(required=["a", "b", "c"], optional=[])
        self.assertEqual(promoted, ["N: ['c'] became required; API prompts without them stop validating"])
        no_optionals = {"N": {"required": ["a", "b"], "optional": [], "outputs": []}}
        appended = self.check(no_optionals, required=["a", "b", "d"])
        self.assertEqual(appended, ["N: ['d'] became required; API prompts without them stop validating"])

    def test_reordering_renaming_or_removing_breaks(self):
        self.assertTrue(self.check(required=["b", "a"]))
        self.assertTrue(self.check(optional=[]))
        self.assertTrue(self.check(outputs=[["IMAGE", "picture"]]))
        self.assertTrue(breaking_changes(self.OLD, {}))


if __name__ == "__main__":
    if "--describe-offline" in sys.argv:
        loaded = load_pack_offline()
        target = Path(sys.argv[sys.argv.index("--describe-offline") + 1])
        target.write_text(json.dumps({"api": describe(loaded), "failed": loaded._failed_modules}), encoding="utf-8")
    elif "--update" in sys.argv:
        if not COMFY_ROOT:
            sys.exit("Set AUSBOSS_COMFY_ROOT to a ComfyUI checkout.")
        current = describe(load_pack())
        if SNAPSHOT.exists():
            problems = breaking_changes(json.loads(SNAPSHOT.read_text(encoding="utf-8")), current)
            for problem in problems:
                print(f"BREAKING: {problem}")
            if problems and "--allow-breaking" not in sys.argv:
                sys.exit(
                    "Not written: saved workflows and API prompts would break. Restore the "
                    "inputs and outputs, or pass --allow-breaking for a node no release has shipped."
                )
        SNAPSHOT.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {SNAPSHOT.relative_to(ROOT)} ({len(current)} nodes).")
    else:
        unittest.main()
