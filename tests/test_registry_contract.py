"""The registry contract, checked against fixtures that really break it.

Every ``bad_*.py`` under tests/fixtures/registry is a way a node module can
load and run perfectly while a registry scanner -- which parses the source
rather than importing it -- sees no nodes at all. That failure is invisible
from inside ComfyUI, so each shape is pinned here.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "registry"


def _load_contract():
    spec = importlib.util.spec_from_file_location(
        "ausboss_registry_contract", ROOT / "scripts" / "registry_contract.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


contract = _load_contract()


def problems_for(fixture: str) -> list[str]:
    path = FIXTURES / fixture
    return contract.mapping_problems(path.read_text(encoding="utf-8"), fixture)


class GoodModuleTests(unittest.TestCase):
    def test_a_conforming_module_reports_nothing(self):
        self.assertEqual(problems_for("good_module.py"), [])

    def test_its_keys_are_readable_without_importing_it(self):
        source = (FIXTURES / "good_module.py").read_text(encoding="utf-8")
        self.assertEqual(contract.class_mapping_keys(source), {"AUSBOSS_NODES_Good"})

    def test_every_shipped_node_module_conforms(self):
        modules = sorted((ROOT / "nodes").glob("node_*.py"))
        self.assertTrue(modules, "no node modules found")
        for path in modules:
            with self.subTest(module=path.name):
                source = path.read_text(encoding="utf-8")
                self.assertEqual(contract.mapping_problems(source, path.name), [])
                self.assertTrue(
                    contract.class_mapping_keys(source),
                    "a scanner would find no keys in this module",
                )


class BadModuleTests(unittest.TestCase):
    """Each fixture must be rejected, and for the stated reason."""

    def assert_rejected(self, fixture: str, *expected: str):
        problems = problems_for(fixture)
        self.assertTrue(problems, f"{fixture} was accepted")
        joined = " | ".join(problems)
        for fragment in expected:
            self.assertIn(fragment, joined)

    def test_a_variable_key_is_rejected(self):
        # The original bug: the pack loaded fine and was invisible to Manager.
        self.assert_rejected("bad_variable_key.py", "NODE_ID", "string literal")

    def test_a_dict_call_is_rejected(self):
        self.assert_rejected("bad_dict_call.py", "dictionary literal", "dict(...)")

    def test_a_helper_return_is_rejected(self):
        self.assert_rejected("bad_helper_return.py", "dictionary literal", "_build(...)")

    def test_reassignment_is_rejected(self):
        self.assert_rejected("bad_reassigned.py", "exactly once")

    def test_a_later_update_is_rejected(self):
        self.assert_rejected("bad_update.py", "update()")

    def test_item_assignment_is_rejected(self):
        self.assert_rejected("bad_item_assignment.py", "modified after assignment")

    def test_mismatched_keys_are_rejected(self):
        self.assert_rejected(
            "bad_key_mismatch.py",
            "AUSBOSS_NODES_Two has no NODE_DISPLAY_NAME_MAPPINGS entry",
        )

    def test_a_repeated_key_is_rejected(self):
        self.assert_rejected("bad_duplicate_key.py", "twice")

    def test_unpacking_another_mapping_is_rejected(self):
        self.assert_rejected("bad_unpacked.py", "unpacks another")

    def test_a_missing_mapping_is_rejected(self):
        self.assert_rejected(
            "bad_missing_display.py", "NODE_DISPLAY_NAME_MAPPINGS", "exactly once"
        )

    def test_every_bad_fixture_is_rejected(self):
        fixtures = sorted(FIXTURES.glob("bad_*.py"))
        self.assertGreaterEqual(len(fixtures), 10)
        for path in fixtures:
            with self.subTest(fixture=path.name):
                self.assertTrue(problems_for(path.name), "fixture was accepted")


class DuplicateKeyTests(unittest.TestCase):
    def test_one_key_claimed_by_two_modules_is_reported(self):
        problems = contract.duplicate_key_problems(
            {
                "node_a.py": {"AUSBOSS_NODES_Shared", "AUSBOSS_NODES_OnlyA"},
                "node_b.py": {"AUSBOSS_NODES_Shared"},
            }
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("AUSBOSS_NODES_Shared", problems[0])
        self.assertIn("node_a.py", problems[0])
        self.assertIn("node_b.py", problems[0])

    def test_distinct_keys_report_nothing(self):
        self.assertEqual(
            contract.duplicate_key_problems(
                {"node_a.py": {"AUSBOSS_NODES_A"}, "node_b.py": {"AUSBOSS_NODES_B"}}
            ),
            [],
        )

    def test_the_shipped_pack_has_no_collisions(self):
        keys = {
            path.name: contract.class_mapping_keys(path.read_text(encoding="utf-8"))
            for path in sorted((ROOT / "nodes").glob("node_*.py"))
        }
        self.assertEqual(contract.duplicate_key_problems(keys), [])


if __name__ == "__main__":
    unittest.main()
