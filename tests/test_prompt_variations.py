from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._prompt_variations_helpers import pick_variations


class PickVariationsTests(unittest.TestCase):
    def test_one_pick_from_each_set(self):
        text, picks = pick_variations("a {red|blue} {sweater|jacket|coat}", 7)
        self.assertEqual(len(picks), 2)
        self.assertIn(picks[0], ("red", "blue"))
        self.assertIn(picks[1], ("sweater", "jacket", "coat"))
        self.assertEqual(text, f"a {picks[0]} {picks[1]}")

    def test_same_seed_same_prompt(self):
        prompt = "{a|b|c|d|e|f} {g|h|i|j|k|l} {m|n|o|p|q|r}"
        self.assertEqual(pick_variations(prompt, 123), pick_variations(prompt, 123))

    def test_seeds_give_different_mixes(self):
        prompt = "{a|b|c|d|e|f} {g|h|i|j|k|l} {m|n|o|p|q|r}"
        mixes = {pick_variations(prompt, seed)[0] for seed in range(50)}
        self.assertGreater(len(mixes), 30)

    def test_every_option_can_come_up(self):
        seen = {pick_variations("{one|two|three}", seed)[0] for seed in range(200)}
        self.assertEqual(seen, {"one", "two", "three"})

    def test_text_without_sets_is_unchanged(self):
        for text in ("", "plain words,  two spaces\nand a line", '{"subject": "a cat", "light": {"key": "soft"}}'):
            self.assertEqual(pick_variations(text, 5), (text, []))

    def test_spaces_around_options_are_trimmed(self):
        text, _ = pick_variations("a { red | red } hat", 1)
        self.assertEqual(text, "a red hat")

    def test_empty_choice_leaves_no_double_space(self):
        texts = {pick_variations("a {|striped} shirt", seed)[0] for seed in range(40)}
        self.assertEqual(texts, {"a shirt", "a striped shirt"})

    def test_sets_inside_sets(self):
        texts = {pick_variations("{a {red|blue} hat|a scarf}", seed)[0] for seed in range(80)}
        self.assertEqual(texts, {"a red hat", "a blue hat", "a scarf"})

    def test_choice_inside_json_braces(self):
        text, picks = pick_variations('{"top": "{tank top|tank top}"}', 3)
        self.assertEqual(text, '{"top": "tank top"}')
        self.assertEqual(picks, ["tank top"])

    def test_large_seed(self):
        text, _ = pick_variations("{x|y}", 0xFFFFFFFFFFFFFFFF)
        self.assertIn(text, ("x", "y"))


class NodeTests(unittest.TestCase):
    def test_node_returns_a_tuple(self):
        from nodes.node_prompt_variations import AusBossPromptVariations

        (prompt,) = AusBossPromptVariations().pick("no sets here", 0)
        self.assertEqual(prompt, "no sets here")


if __name__ == "__main__":
    unittest.main()
