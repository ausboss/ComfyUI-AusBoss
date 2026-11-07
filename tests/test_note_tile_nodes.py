"""The renderer identities keep the legacy data contract intact."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "nodes" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TileContractTests(unittest.TestCase):
    def test_callout_preserves_storage_and_no_execution(self):
        module = load("node_callout")
        plain, tile = module.AusBossCallout, module.AusBossCalloutTile
        self.assertEqual(plain.INPUT_TYPES(), tile.INPUT_TYPES())
        self.assertEqual(tile.RETURN_TYPES, ())
        self.assertFalse(getattr(tile, "OUTPUT_NODE", False))
        self.assertEqual(tile().noop("exact\ntext"), ())

    def test_note_defaults_are_independent_and_tile_is_explicit(self):
        module = load("node_workflow_note")
        plain, tile = module.AusBossWorkflowNote, module.AusBossWorkflowNoteTile
        original = plain.INPUT_TYPES()
        tile_inputs = tile.INPUT_TYPES()
        self.assertEqual(list(original["required"]), list(tile_inputs["required"]))
        self.assertEqual(json.loads(tile_inputs["required"]["note"][1]["default"])["layout"], "tile")
        self.assertEqual(plain.INPUT_TYPES(), original)
        self.assertEqual(tile.RETURN_TYPES, ())
        self.assertFalse(getattr(tile, "OUTPUT_NODE", False))


if __name__ == "__main__":
    unittest.main()
