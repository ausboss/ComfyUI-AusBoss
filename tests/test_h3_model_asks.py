"""H3 Prompt Writer: the words its small model is asked, and a node's own wording for each."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nodes._h3_model_asks import BUILT_IN, fill, parse_asks
from nodes._h3_prompt_helpers import write_prompt
from nodes._h3_script_helpers import HEARD, NEXT
from nodes._h3_tidy_helpers import TIDY_SYSTEM, tidy_script


class ParseTests(unittest.TestCase):
    def test_empty_or_broken_text_means_the_built_in_wording(self):
        for value in ("", None, "not json", "[1, 2]", '{"next": 5}', '{"next": "   "}'):
            with self.subTest(value=value):
                self.assertEqual(parse_asks(value), {})

    def test_only_the_four_known_asks_are_kept(self):
        asks = parse_asks(json.dumps({"next": " Write {count} lines. ", "elsewhere": "x", "tidy": "Be brief."}))
        self.assertEqual(asks, {"next": "Write {count} lines.", "tidy": "Be brief."})

    def test_json_nested_too_deep_means_the_built_in_wording(self):
        self.assertEqual(parse_asks("[" * 100000 + "]" * 100000), {})

    def test_a_very_long_wording_is_cut(self):
        self.assertEqual(len(parse_asks(json.dumps({"heard": "a" * 50000}))["heard"]), 8000)

    def test_the_built_in_wordings_are_the_ones_the_writer_uses(self):
        self.assertEqual(BUILT_IN["next"], NEXT)
        self.assertEqual(BUILT_IN["heard"], HEARD)
        self.assertEqual(BUILT_IN["tidy"], TIDY_SYSTEM)


class FillTests(unittest.TestCase):
    def test_fill_matches_format_for_the_built_in_wording(self):
        self.assertEqual(fill(NEXT, seconds=8, first="she waves", count=3), NEXT.format(seconds=8, first="she waves", count=3))

    def test_braces_in_the_filled_in_words_stay_as_typed(self):
        line = "A worker pins a sign reading {count} to the wall."
        self.assertIn(line, fill(NEXT, seconds=8, first=line, count=2))

    def test_other_braces_in_a_users_wording_stay_as_typed(self):
        self.assertEqual(fill("Make {count} lines {like this} {seconds}", count=2), "Make 2 lines {like this} {seconds}")


class UseTests(unittest.TestCase):
    def test_the_next_moments_and_the_sound_use_the_nodes_wording(self):
        asked = []

        def ask(question, longest):
            asked.append(question)
            return ""

        write_prompt("A woman walks into the kitchen.", seconds=8.0, ask=ask, asks={"next": "NEXT {count} after {first}", "heard": "HEAR {lines}"})
        self.assertTrue(asked[0].startswith("NEXT "), asked)
        self.assertIn("after A woman walks into the kitchen", asked[0])
        self.assertTrue(asked[1].startswith("HEAR A woman walks"), asked)

    def test_without_its_own_wording_the_writer_asks_as_before(self):
        asked = []
        write_prompt("A woman walks into the kitchen.", seconds=8.0, ask=lambda question, longest: asked.append(question) or "")
        self.assertTrue(asked[0].startswith("This is a 8.0 second video."), asked)

    def test_tidy_up_uses_the_nodes_instructions(self):
        systems = []

        def ask(system, line, longest):
            systems.append(system)
            return ""

        tidy_script("@1 waves\n@2 says \"hi\"", ask, system="MY RULES")
        self.assertEqual(set(systems), {"MY RULES"})


class NodeTests(unittest.TestCase):
    def test_the_wording_is_one_optional_input_after_the_others(self):
        from nodes.node_h3_prompt_writer import AusBossH3PromptWriter
        optional = list(AusBossH3PromptWriter.INPUT_TYPES()["optional"])
        self.assertEqual(optional[-1], "model_asks")

    def test_a_run_with_the_nodes_wording_and_no_model_still_writes(self):
        from nodes.node_h3_prompt_writer import AusBossH3PromptWriter
        import torch
        result = AusBossH3PromptWriter().run(
            "@1 waves.", 8, picture_1=torch.zeros(1, 64, 64, 3), model_asks=json.dumps({"next": "x"}), tidy=True)
        self.assertIn("waves", result["result"][0])


if __name__ == "__main__":
    unittest.main()
