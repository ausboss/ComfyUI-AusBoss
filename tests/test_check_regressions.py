"""Offline checks must reject source and saved graphs that cannot work."""

import ast
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import changelog_notes
import compat_boot
from registry_contract import mapping_problems, module_list
from workflow_contract import named_copy_problems, workflow_problems


class SourceTests(unittest.TestCase):
    def test_module_list_cannot_change_after_its_declaration(self):
        declaration = 'NODE_MODULES = ["node_a"]\n'
        self.assertEqual(module_list(declaration + 'for name in NODE_MODULES:\n    pass\n'), {"node_a"})
        for extra in (
            'NODE_MODULES.clear()\n', 'NODE_MODULES = []\n',
            'NODE_MODULES[0] = "node_b"\n', 'NODE_MODULES += ["node_b"]\n',
            'alias = NODE_MODULES\n', 'change(NODE_MODULES)\n',
            'from other import NODE_MODULES\n', 'del NODE_MODULES\n',
        ):
            with self.subTest(extra=extra):
                self.assertIsNone(module_list(declaration + extra))
        self.assertIsNone(module_list('NODE_MODULES = ["node_a", 7]\n'))

    def test_reserved_mapping_names_cannot_be_rebound(self):
        valid = ('class Node: pass\nNODE_CLASS_MAPPINGS = {"A": Node}\n'
                 'NODE_DISPLAY_NAME_MAPPINGS = {"A": "A"}\n')
        for binding in (
            'from other import NODE_CLASS_MAPPINGS',
            'from other import value as NODE_CLASS_MAPPINGS',
            'import other as NODE_CLASS_MAPPINGS',
            'def NODE_CLASS_MAPPINGS(): pass',
            'class NODE_CLASS_MAPPINGS: pass',
            'try:\n    pass\nexcept Exception as NODE_CLASS_MAPPINGS:\n    pass',
            'match value:\n    case {"key": NODE_CLASS_MAPPINGS}: pass',
        ):
            with self.subTest(binding=binding):
                self.assertTrue(mapping_problems(valid + binding + '\n', "sample.py"))


class WorkflowTests(unittest.TestCase):
    def klein(self):
        return json.loads((ROOT / "example_workflows" / "Klein 9B Outpaint (AusBoss).json").read_text())

    def test_subgraph_links_widgets_and_local_counters_are_checked(self):
        data = self.klein()
        graph = data["definitions"]["subgraphs"][0]
        graph["links"][0]["target_id"] = 999999
        self.assertIn("missing node", " ".join(workflow_problems(data)))
        data = self.klein()
        graph = data["definitions"]["subgraphs"][0]
        graph["nodes"][0]["widgets_values_named"]["upscale_method"] = "wrong"
        self.assertIn("stale named", " ".join(workflow_problems(data)))
        for counter in ("lastNodeId", "lastLinkId"):
            data = self.klein()
            data["definitions"]["subgraphs"][0]["state"][counter] = 0
            self.assertIn("behind the graph", " ".join(workflow_problems(data)))

    def test_subgraph_boundary_links_are_checked_in_both_directions(self):
        data = self.klein()
        self.assertEqual(workflow_problems(data), [])
        graph = data["definitions"]["subgraphs"][0]
        graph["inputs"][0]["linkIds"] = []
        self.assertIn("source output", " ".join(workflow_problems(data)))
        data = self.klein()
        graph = data["definitions"]["subgraphs"][0]
        graph["outputs"][0]["linkIds"] = [999999]
        self.assertIn("stale link", " ".join(workflow_problems(data)))

    def test_named_values_follow_widget_slots_instead_of_object_order(self):
        node = {"id": 1, "type": "AUSBOSS_NODES_Resolution",
                "widgets_values": [640, 480, "16ch", 1],
                "widgets_values_named": {"height": 640, "width": 480, "latent": "16ch", "batch_size": 1}}
        self.assertTrue(named_copy_problems(node))
        node["widgets_values_named"].update(height=480, width=640)
        self.assertEqual(named_copy_problems(node), [])
        node["widgets_values"].append("unmatched")
        self.assertTrue(named_copy_problems(node))
        node["widgets_values"] = [640, 480, "16ch"]
        self.assertTrue(named_copy_problems(node))
        node["widgets_values"] = [640, 480, "16ch", 1]
        del node["widgets_values_named"]["width"]
        self.assertTrue(named_copy_problems(node))

    def test_frontend_seed_control_has_its_own_slot(self):
        node = {"id": 1, "type": "AUSBOSS_NODES_Seed", "widgets_values": [7, "fixed", ""],
                "widgets_values_named": {"control_after_generate": "fixed", "seed": 7, "ausboss_seed_panel": ""}}
        self.assertEqual(named_copy_problems(node), [])
        node["widgets_values"] = [7]
        self.assertTrue(named_copy_problems(node))

    def test_dict_values_report_unmatched_real_entries(self):
        node = {"id": 1, "widgets_values": {"width": 640}, "widgets_values_named": {"width": 640, "height": 480}}
        self.assertTrue(named_copy_problems(node))
        node["widgets_values_named"] = {}
        self.assertTrue(named_copy_problems(node))

    def test_download_metadata_must_name_the_selected_url_file(self):
        data = self.klein()
        node = next(n for n in data["nodes"] if n.get("properties", {}).get("models"))
        model = node["properties"]["models"][0]
        original = copy.deepcopy(model)
        for field in ("name", "url", "directory"):
            for value in (None, "", 7):
                model.clear()
                model.update(original)
                model[field] = value
                self.assertTrue(workflow_problems(data), (field, value))
        model.clear()
        model.update(original, url="https://example.invalid/wrong.safetensors")
        self.assertIn("URL", " ".join(workflow_problems(data)))
        model["url"] = "https://example.invalid/" + original["name"].replace("-", "%2D") + "?download=1"
        self.assertEqual(workflow_problems(data), [])


class CompatibilityTests(unittest.TestCase):
    def problems(self, data, offered):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "sample.json").write_text(json.dumps(data))
            return compat_boot.example_problems(Path(folder), offered)

    def test_only_defined_subgraph_types_are_skipped(self):
        kind = "12345678-1234-4234-8234-123456789abc"
        data = {"nodes": [{"id": 1, "type": kind}]}
        self.assertTrue(self.problems(data, {}))
        data["definitions"] = {"subgraphs": [{"id": kind, "nodes": [{"id": 2, "type": "Missing"}]}]}
        self.assertIn("Missing", " ".join(self.problems(data, {})))
        self.assertEqual(self.problems(data, {"Missing": {}}), [])

    def test_required_socket_needs_a_link_even_in_older_saves(self):
        offered = {"NeedsImage": {"input": {"required": {"image": ["IMAGE", {"forceInput": True}]}}}}
        node = {"id": 1, "type": "NeedsImage", "inputs": [{"name": "image", "link": None}],
                "widgets_values_named": {"image": None}}
        self.assertTrue(self.problems({"nodes": [node]}, offered))
        node["inputs"][0]["link"] = 1
        self.assertEqual(self.problems({"nodes": [node]}, offered), [])
        node["inputs"][0]["link"] = None
        del node["widgets_values_named"]
        node["widgets_values"] = ["an unrelated legacy value"]
        self.assertTrue(self.problems({"nodes": [node]}, offered))

    def test_serialized_false_and_zero_are_usable_widget_values(self):
        offered = {"Options": {"input": {"required": {"count": ["INT", {}], "enabled": ["BOOLEAN", {}]}}}}
        node = {"id": 1, "type": "Options", "widgets_values_named": {"count": 0, "enabled": False}}
        self.assertEqual(self.problems({"nodes": [node]}, offered), [])


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for folder in ("scripts", "nodes", "js", "example_workflows", "locales", "assets"):
            shutil.copytree(ROOT / folder, self.root / folder, ignore=shutil.ignore_patterns("__pycache__"))
        for name in ("__init__.py", "pyproject.toml", "README.md", "LICENSE", "CHANGELOG.md", ".comfyignore", "ausboss_presets_example.json"):
            shutil.copy2(ROOT / name, self.root / name)

    def run_check(self, script):
        return subprocess.run([sys.executable, str(self.root / "scripts" / script)],
                              capture_output=True, text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})

    def test_network_imports_and_qualified_fetch_are_rejected_without_execution(self):
        path = self.root / "nodes" / "_network_probe.py"
        for source in ('from requests import get\n', 'from httpx import Client\n',
                       'import requests as r\n', 'from urllib import request\n',
                       'from http import client\n', 'from aiohttp import ClientSession\n'):
            path.write_text(source)
            result = self.run_check("release_preflight.py")
            self.assertNotEqual(result.returncode, 0, source)
            self.assertIn("network", result.stdout)
        path.unlink()
        path = self.root / "js" / "shared" / "network_probe.mjs"
        for call in ('fetch ("https://example.invalid")', 'globalThis.fetch("https://example.invalid")',
                     'window . fetch ("https://example.invalid")', 'self.fetch\n("https://example.invalid")'):
            path.write_text("export function lookup() { return " + call + "; }\n")
            result = self.run_check("release_preflight.py")
            self.assertNotEqual(result.returncode, 0, call)
            self.assertIn("calls fetch", result.stdout)

    def test_unrelated_class_cannot_supply_registered_transform_outputs(self):
        path = self.root / "nodes" / "node_image_crop_rotate_pad.py"
        source = path.read_text().replace('RETURN_TYPES = ("IMAGE", "MASK",', 'RETURN_TYPES = ("MASK", "IMAGE",', 1)
        source = source.replace('RETURN_NAMES = ("image", "mask",', 'RETURN_NAMES = ("mask", "image",', 1)
        source += '\nclass ExtraMetadata:\n    RETURN_TYPES = ("IMAGE", "MASK", "AUSBOSS_STITCHER", "IMAGE")\n    RETURN_NAMES = ("image", "mask", "stitcher", "original")\n'
        path.write_text(source)
        result = self.run_check("validate_nodes.py")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("first outputs", result.stdout)

    def test_helper_cannot_advertise_an_unregistered_node(self):
        (self.root / "nodes" / "_extra_helpers.py").write_text(
            'class Extra: pass\nNODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Extra": Extra}\n'
            'NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Extra": "Extra"}\n')
        result = self.run_check("validate_nodes.py")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("_extra_helpers.py", result.stdout)

    def test_toml_description_limit_uses_decoded_utf8_bytes(self):
        path = self.root / "pyproject.toml"
        lines = path.read_text().splitlines()
        path.write_text("\n".join('description = "\\\"' + 'x' * 1001 + '"' if line.startswith("description =") else line for line in lines) + "\n")
        result = self.run_check("release_preflight.py")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("1002 bytes", result.stdout)

    def test_literal_version_uses_project_table_in_all_readers(self):
        path = self.root / "pyproject.toml"
        source = path.read_text()
        version = changelog_notes.pyproject_version()
        path.write_text(source.replace('version = "' + version + '"', "version = '" + version + "'"))
        result = self.run_check("release_preflight.py")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with patch.object(changelog_notes, "ROOT", self.root):
            self.assertEqual(changelog_notes.pyproject_version(), version)
        tree = ast.parse((ROOT / "__init__.py").read_text())
        body = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom)) or isinstance(n, ast.FunctionDef) and n.name == "_read_version"]
        scope = {"__file__": str(self.root / "__init__.py")}
        exec(compile(ast.Module(body=body, type_ignores=[]), "version_reader", "exec"), scope)
        self.assertEqual(scope["_read_version"](), version)


if __name__ == "__main__":
    unittest.main()
