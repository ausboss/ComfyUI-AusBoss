"""Released node inputs and outputs only ever grow.

Saved workflows keep widget values by position and links by slot index, and
an API prompt must supply every required input. So an input may only be
appended as optional and an output only appended; nothing is renamed,
reordered, removed or made required. tests/fixtures/node_api.json pins the
current API. After a deliberate, compatible change (or a new node), refresh
it with ComfyUI's Python:

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_node_api.py --update
"""

from __future__ import annotations

from pathlib import Path
import importlib.util
import json
import os
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "tests" / "fixtures" / "node_api.json"
COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")


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
    stub_server()
    spec = importlib.util.spec_from_file_location(
        "ausboss_node_api", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
    )
    pack = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = pack
    spec.loader.exec_module(pack)
    return pack


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


class BreakingChangeRuleTests(unittest.TestCase):
    OLD = {"N": {"required": ["a", "b"], "optional": ["c"], "outputs": [["IMAGE", "image"]]}}

    def check(self, **now):
        return breaking_changes(self.OLD, {"N": {**self.OLD["N"], **now}})

    def test_appending_an_optional_input_or_an_output_is_safe(self):
        self.assertEqual(self.check(optional=["c", "d"]), [])
        self.assertEqual(self.check(outputs=[["IMAGE", "image"], ["INT", "width"]]), [])

    def test_a_new_required_input_breaks_api_prompts(self):
        self.assertTrue(self.check(required=["a", "b", "d"]))

    def test_reordering_renaming_or_removing_breaks(self):
        self.assertTrue(self.check(required=["b", "a"]))
        self.assertTrue(self.check(optional=[]))
        self.assertTrue(self.check(outputs=[["IMAGE", "picture"]]))
        self.assertTrue(breaking_changes(self.OLD, {}))


if __name__ == "__main__":
    if "--update" in sys.argv:
        if not COMFY_ROOT:
            sys.exit("Set AUSBOSS_COMFY_ROOT to a ComfyUI checkout.")
        current = describe(load_pack())
        if SNAPSHOT.exists():
            for problem in breaking_changes(json.loads(SNAPSHOT.read_text(encoding="utf-8")), current):
                print(f"BREAKING: {problem}")
        SNAPSHOT.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {SNAPSHOT.relative_to(ROOT)} ({len(current)} nodes).")
    else:
        unittest.main()
