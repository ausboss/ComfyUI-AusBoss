"""A saved-value fallback is the input's own default.

An input added to a node with a card or panel opens older workflows holding
that card's or panel's empty value (tests/saved_widget_values.test.mjs), and
the node puts a fallback there instead: its card's resetUnknown, or
RESET_UNKNOWN beside NODE_CLASS in its own js/<name>/index.js. The fallback
must be what a new node shows and what an API prompt without the input runs
with, or the same workflow gives two results. Needs ComfyUI's Python:

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_saved_fallbacks.py
"""

from __future__ import annotations

from pathlib import Path
import inspect
import json
import re
import unittest

from test_node_api import COMFY_ROOT, load_pack

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "js"


def literal(text: str) -> dict:
    return json.loads(re.sub(r"(\w+):", r'"\1":', text))


def saved_fallbacks() -> dict[str, dict]:
    """{node id: {input: fallback}} from the cards and the nodes' own files."""
    found = {}
    source = (JS / "widget_cards" / "index.js").read_text(encoding="utf-8")
    starts = [(m.start(), m.group(1)) for m in re.finditer(r"\n  (AUSBOSS_NODES_\w+): \{", source)]
    for index, (start, node_id) in enumerate(starts):
        end = starts[index + 1][0] if index + 1 < len(starts) else len(source)
        match = re.search(r"resetUnknown: (\{[^}]*\})", source[start:end])
        if match:
            found[node_id] = literal(match.group(1))
    for path in sorted(JS.glob("*/index.js")):
        text = path.read_text(encoding="utf-8")
        node = re.search(r'^const NODE_CLASS = "(\w+)";$', text, re.M)
        own = re.search(r"^const RESET_UNKNOWN = (\{[^}]*\});$", text, re.M)
        if node and own:
            found[node.group(1)] = literal(own.group(1))
    return found


def input_default(cls, name):
    inputs = cls.INPUT_TYPES()
    spec = inputs.get("optional", {}).get(name) or inputs.get("required", {}).get(name)
    kind, options = spec[0], (spec[1] if len(spec) > 1 else {})
    if "default" in options:
        return options["default"]
    return kind[0] if isinstance(kind, (list, tuple)) else None


@unittest.skipUnless(COMFY_ROOT, "set AUSBOSS_COMFY_ROOT to a ComfyUI checkout")
class SavedFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = load_pack()
        cls.fallbacks = saved_fallbacks()

    def test_the_known_fallbacks_are_read(self):
        self.assertEqual(self.fallbacks["AUSBOSS_NODES_StitchInpaint"], {"seam": "classic"})
        self.assertEqual(self.fallbacks["AUSBOSS_NODES_CropForInpaint"], {"keep_inside": True})
        self.assertEqual(self.fallbacks["AUSBOSS_NODES_RefineMask"], {"preview": True, "max_hole_size": 0})
        for node_id in ("AUSBOSS_NODES_LaMaInpaint", "AUSBOSS_NODES_SelectFrame"):
            self.assertEqual(self.fallbacks[node_id], {"preview": True})
        self.assertEqual(self.fallbacks["AUSBOSS_NODES_LoraLoader"], {"on_missing": "error"})

    def test_each_fallback_is_the_new_node_default_and_the_api_default(self):
        for node_id, fallbacks in self.fallbacks.items():
            cls = self.pack.NODE_CLASS_MAPPINGS[node_id]
            parameters = inspect.signature(getattr(cls, cls.FUNCTION)).parameters
            for name, fallback in fallbacks.items():
                with self.subTest(node=node_id, input=name):
                    self.assertEqual(fallback, input_default(cls, name), "a new node's default")
                    self.assertIn(name, parameters, f"{cls.FUNCTION}() does not take {name}")
                    self.assertEqual(
                        fallback, parameters[name].default,
                        "what an API prompt without the input runs with",
                    )


if __name__ == "__main__":
    unittest.main()
