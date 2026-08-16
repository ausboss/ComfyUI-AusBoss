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
        self.assertEqual(problems_for("good_module.py.txt"), [])

    def test_its_keys_are_readable_without_importing_it(self):
        source = (FIXTURES / "good_module.py.txt").read_text(encoding="utf-8")
        self.assertEqual(contract.class_mapping_keys(source), {"AUSBOSS_NODES_Good"})

    def test_an_id_named_only_in_prose_is_not_a_registration(self):
        # What separates the parsed keys from grepping the file for
        # AUSBOSS_NODES_*: a retired id can go on being mentioned in a
        # docstring or a search alias long after it stopped being registered.
        source = (
            '"""Replaces AUSBOSS_NODES_Old."""\n'
            "\n"
            "class New:\n"
            '    SEARCH_ALIASES = ["AUSBOSS_NODES_Old", "ausboss"]\n'
            "\n"
            '# AUSBOSS_NODES_Old moved here in wave three.\n'
            'NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_New": New}\n'
            'NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_New": "New (AusBoss)"}\n'
        )
        self.assertEqual(contract.class_mapping_keys(source), {"AUSBOSS_NODES_New"})
        self.assertEqual(contract.mapping_problems(source, "inline"), [])

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
        self.assert_rejected(
            "bad_variable_key.py.txt", "NODE_ID", "string literal")

    def test_a_dict_call_is_rejected(self):
        self.assert_rejected(
            "bad_dict_call.py.txt", "dictionary literal", "dict(...)")

    def test_a_helper_return_is_rejected(self):
        self.assert_rejected(
            "bad_helper_return.py.txt", "dictionary literal", "_build(...)")

    def test_reassignment_is_rejected(self):
        self.assert_rejected(
            "bad_reassigned.py.txt", "exactly once")

    def test_a_later_update_is_rejected(self):
        self.assert_rejected(
            "bad_update.py.txt", "update()")

    def test_item_assignment_is_rejected(self):
        self.assert_rejected(
            "bad_item_assignment.py.txt", "has an entry assigned after assignment"
        )

    def test_empty_mappings_are_rejected(self):
        # Two empty literals agree with each other, so the key-match rule is
        # happy: only the emptiness check catches a module registering nothing.
        self.assert_rejected(
            "bad_empty.py.txt",
            "NODE_CLASS_MAPPINGS is empty",
            "NODE_DISPLAY_NAME_MAPPINGS is empty",
        )

    def test_a_delete_is_rejected(self):
        self.assert_rejected(
            "bad_delete.py.txt", "has an entry deleted after assignment"
        )

    def test_an_alias_is_rejected_where_it_is_made(self):
        # _registry.update(...) never says NODE_CLASS_MAPPINGS, so the only
        # place this is still visible is the line that binds the alias.
        problems = problems_for("bad_alias.py.txt")
        joined = " | ".join(problems)
        self.assertIn("NODE_CLASS_MAPPINGS is aliased after assignment", joined)
        self.assertIn("NODE_DISPLAY_NAME_MAPPINGS is aliased after assignment", joined)

    def test_a_bare_read_after_assignment_is_rejected(self):
        # Strict on purpose: once the name can travel, no checker can promise
        # where it ends up, so the contract is that it does not travel at all.
        source = (
            "class Node:\n"
            "    pass\n"
            'NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_A": Node}\n'
            'NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_A": "A (AusBoss)"}\n'
            "print(len(NODE_CLASS_MAPPINGS))\n"
        )
        problems = contract.mapping_problems(source, "inline")
        self.assertEqual(len(problems), 1)
        self.assertIn("NODE_CLASS_MAPPINGS is used after assignment", problems[0])

    def test_a_delete_of_the_whole_mapping_is_rejected(self):
        source = (
            "class Node:\n"
            "    pass\n"
            'NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_A": Node}\n'
            'NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_A": "A (AusBoss)"}\n'
            "del NODE_CLASS_MAPPINGS\n"
        )
        problems = contract.mapping_problems(source, "inline")
        self.assertEqual(len(problems), 1)
        self.assertIn("NODE_CLASS_MAPPINGS is deleted after assignment", problems[0])

    def test_mismatched_keys_are_rejected(self):
        self.assert_rejected(
            "bad_key_mismatch.py.txt",
            "AUSBOSS_NODES_Two has no NODE_DISPLAY_NAME_MAPPINGS entry",
        )

    def test_a_repeated_key_is_rejected(self):
        self.assert_rejected(
            "bad_duplicate_key.py.txt", "twice")

    def test_unpacking_another_mapping_is_rejected(self):
        self.assert_rejected(
            "bad_unpacked.py.txt", "unpacks another")

    def test_a_missing_mapping_is_rejected(self):
        self.assert_rejected(
            "bad_missing_display.py.txt", "NODE_DISPLAY_NAME_MAPPINGS", "exactly once"
        )

    def test_every_bad_fixture_is_rejected(self):
        fixtures = sorted(FIXTURES.glob("bad_*.py.txt"))
        self.assertGreaterEqual(len(fixtures), 13)
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


class ModuleListTests(unittest.TestCase):
    """NODE_MODULES is parsed, not matched anywhere in the text.

    A name left behind in a comment used to satisfy the on-disk check, so a
    module nobody imports passed with no output at all.
    """

    def test_the_real_init_declares_every_node_module(self):
        listed = contract.module_list((ROOT / "__init__.py").read_text(encoding="utf-8"))
        on_disk = {path.stem for path in sorted((ROOT / "nodes").glob("node_*.py"))}
        self.assertEqual(listed, on_disk)

    def test_a_name_only_in_a_comment_is_not_a_registration(self):
        source = 'NODE_MODULES = ["node_a"]\n# TODO re-enable "node_b" after the refactor\n'
        self.assertEqual(contract.module_list(source), {"node_a"})

    def test_quoting_style_does_not_change_the_answer(self):
        self.assertEqual(
            contract.module_list("NODE_MODULES = ['node_a', 'node_b']\n"),
            {"node_a", "node_b"},
        )

    def test_an_unreadable_declaration_reports_none_rather_than_empty(self):
        # None means "cannot be read" and is an error; an empty set would be
        # indistinguishable from a pack that registers nothing.
        self.assertIsNone(contract.module_list("NODE_MODULES = [name for name in x]\n"))
        self.assertIsNone(contract.module_list("NODE_MODULES = build()\n"))
        self.assertIsNone(contract.module_list("SOMETHING_ELSE = []\n"))

    def test_no_module_outside_nodes_declares_mapping_keys(self):
        # Registry scanners read the whole checkout: a fixture or sample that
        # names AUSBOSS_NODES_* in a mapping literal is advertised as an
        # installable node the pack never registers.
        stray = {}
        for path in sorted(ROOT.rglob("*.py")):
            parts = path.relative_to(ROOT).parts
            if any(part.startswith(".") or part == "__pycache__" for part in parts):
                continue
            if path.parent == ROOT / "nodes":
                continue
            keys = contract.class_mapping_keys(path.read_text(encoding="utf-8"))
            if keys:
                stray[str(path.relative_to(ROOT))] = sorted(keys)
        self.assertEqual(stray, {})


if __name__ == "__main__":
    unittest.main()
