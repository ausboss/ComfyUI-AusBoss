"""The Chinese node names in locales/zh/nodeDefs.json still fit the pack.

ComfyUI reads locales/<language>/nodeDefs.json from a node pack and shows
those names and descriptions when the frontend runs in that language. A
translation keyed to a node, input or output that no longer exists does
nothing, so this test holds every entry to tests/fixtures/node_api.json and
asks for an entry for every public node.
"""

from __future__ import annotations

from pathlib import Path
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from validate_nodes import PUBLIC_NODE_IDS  # noqa: E402

LOCALES = ROOT / "locales"
API = json.loads((ROOT / "tests" / "fixtures" / "node_api.json").read_text(encoding="utf-8"))


class LocaleTests(unittest.TestCase):
    def load(self, language):
        return json.loads((LOCALES / language / "nodeDefs.json").read_text(encoding="utf-8"))

    def test_every_entry_matches_the_node_api(self):
        for path in sorted(LOCALES.glob("*/nodeDefs.json")):
            defs = json.loads(path.read_text(encoding="utf-8"))
            for key, entry in defs.items():
                with self.subTest(file=path.parent.name, node=key):
                    self.assertIn(key, API, "no such node")
                    self.assertTrue(entry.get("display_name", "").endswith(" 🆎"))
                    node = API[key]
                    inputs = set(node["required"]) | set(node["optional"])
                    for name in entry.get("inputs", {}):
                        self.assertIn(name, inputs, f"no input {name!r}")
                    for index, item in entry.get("outputs", {}).items():
                        self.assertTrue(index.isdigit() and int(index) < len(node["outputs"]), f"no output {index}")
                        self.assertTrue(item.get("name"))

    def test_chinese_covers_every_public_node(self):
        missing = sorted(set(PUBLIC_NODE_IDS) - set(self.load("zh")))
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
