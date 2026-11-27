"""Tidy up on H3 Prompt Writer: the model rewrites the lines, code keeps the spoken words."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import node_h3_prompt_writer
from nodes._h3_tidy_helpers import TIDY_SYSTEM, hold, tidy_script
from nodes.node_h3_prompt_writer import TIDY_NEEDS_CLIP, TIDY_NEEDS_UPDATE, AusBossH3PromptWriter

PICTURE = torch.zeros(1, 8, 8, 3)


def answering(answer):
    calls = []

    def ask(system, line, longest):
        calls.append((system, line, longest))
        return answer

    return ask, calls


def fake_generate(answer, system_prompt=True):
    class Output:
        result = (answer,)

    class Generate:
        calls = []

        if system_prompt:
            @classmethod
            def execute(cls, clip, prompt, max_length, sampling_mode, image=None, system_prompt=""):
                cls.calls.append(dict(clip=clip, prompt=prompt, sampling_mode=sampling_mode, image=image, system_prompt=system_prompt))
                return Output
        else:
            @classmethod
            def execute(cls, clip, prompt, max_length, sampling_mode, image=None):
                cls.calls.append(dict(clip=clip, prompt=prompt, image=image))
                return Output

    return Generate


class HoldTests(unittest.TestCase):
    def test_each_quote_is_held_out_as_a_marker(self):
        self.assertEqual(hold('@1 asks "Ready?" and @2 says "Go."'), ("@1 asks SPOKEN1 and @2 says SPOKEN2", ["SPOKEN1", "SPOKEN2"], ["Ready?", "Go."]))
        self.assertEqual(hold('@1 waves "Hi"'), ("@1 waves SPOKEN", ["SPOKEN"], ["Hi"]))
        self.assertEqual(hold("@1 waves"), ("@1 waves", [], []))

    def test_the_model_never_sees_the_spoken_words(self):
        ask, calls = answering("@1 stares at @2. @2 says SPOKEN.")
        tidy_script('@1 stares at @2 who goes "No way, not again."', ask)
        system, line, _ = calls[0]
        self.assertEqual(system, TIDY_SYSTEM)
        self.assertEqual(line, "Line: @1 stares at @2 who goes SPOKEN\nCleaned:")
        self.assertNotIn("No way", line)

    def test_the_words_come_back_exactly_as_typed(self):
        ask, _ = answering("Cleaned: @1 asks SPOKEN1. @2 shrugs. @2 says SPOKEN2.")
        self.assertEqual(
            tidy_script('@1 asks "u comin??" n @2 shrugs "nah, SPOKEN is a word"', ask),
            ('@1 asks "u comin??". @2 shrugs. @2 says "nah, SPOKEN is a word".', True),
        )

    def test_a_curly_or_single_quoted_line_is_held_too(self):
        ask, calls = answering("@1 says SPOKEN.")
        self.assertEqual(tidy_script("@1 says 'hi there'", ask), ('@1 says "hi there".', True))
        self.assertEqual(calls[0][1], "Line: @1 says SPOKEN\nCleaned:")
        ask, _ = answering("@1 says SPOKEN.")
        self.assertEqual(tidy_script("@1 says “hi”", ask), ('@1 says "hi".', True))

    def test_an_answer_that_breaks_a_rule_leaves_the_lines_as_typed(self):
        typed = '@1 waves at @2 and says "Hello."'
        for answer in (
            "",
            "@1 waves at @2.",  # lost the words
            "@1 says SPOKEN. @1 says SPOKEN.",  # said twice
            "@1 waves at @2. @1 says SPOKEN1.",  # a marker that was never there
            "@1 waves at @3. @1 says SPOKEN.",  # someone else
            "@1 waves. @1 says SPOKEN.",  # dropped a person
            "@1 waves at @2. @1 says SPOKEN. " + "The sun sets over the hills in gold. " * 6,  # added a scene
        ):
            with self.subTest(answer=answer):
                self.assertEqual(tidy_script(typed, answering(answer)[0]), (typed, False))

    def test_lines_with_no_words_are_tidied_too(self):
        ask, _ = answering("The cat jumps on the table.")
        self.assertEqual(tidy_script("teh cat jumps on teh table", ask), ("The cat jumps on the table.", True))


class NodeTests(unittest.TestCase):
    def write(self, generate, script, **inputs):
        keep = node_h3_prompt_writer._core_nodes
        node_h3_prompt_writer._core_nodes = lambda: {"TextGenerate": generate}
        try:
            return AusBossH3PromptWriter().write(script, 5, **inputs)[0]
        finally:
            node_h3_prompt_writer._core_nodes = keep

    def test_tidy_on_sends_the_tidied_lines_to_h3(self):
        generate = fake_generate("@1 stares at @2. @2 says SPOKEN.")
        text = self.write(generate, '@1 stares at @2 who goes "No way."', clip="the clip", picture_1=PICTURE, picture_2=PICTURE, tidy=True)
        tidy = generate.calls[0]
        self.assertEqual((tidy["clip"], tidy["image"], tidy["system_prompt"]), ("the clip", None, TIDY_SYSTEM))
        self.assertEqual(tidy["sampling_mode"], {"sampling_mode": "off"})
        self.assertIn("No way.", text)
        self.assertNotIn("who goes", text)

    def test_tidy_off_never_asks_for_a_tidy(self):
        generate = fake_generate("unused")
        self.write(generate, '@1 waves at @2 and says "Hi."', clip="the clip", picture_1=PICTURE, picture_2=PICTURE)
        self.assertFalse(any(call.get("system_prompt") == TIDY_SYSTEM for call in generate.calls))

    def test_tidy_needs_a_model(self):
        with self.assertRaisesRegex(ValueError, TIDY_NEEDS_CLIP):
            AusBossH3PromptWriter().write("she waves", 5, tidy=True)

    def test_tidy_on_an_older_comfyui_says_to_update(self):
        with self.assertRaisesRegex(RuntimeError, "newer ComfyUI"):
            self.write(fake_generate("x", system_prompt=False), "she waves", clip="the clip", tidy=True)
        self.assertIn("0.46.1", TIDY_NEEDS_UPDATE)

    def test_h3s_own_six_parts_are_not_tidied(self):
        generate = fake_generate("unused")
        six = (
            "subject_definitions:\n<Subject 1> is the main person in <Picture 1>.\n\nsummary:\n[reference generation] A wave.\n\n"
            "retention_analysis:\n<Picture 1>: fully_preserved.\n\ndetailed_description:\n[Shot 1] She waves.\n\n"
            "overall_soundscape:\nWind.\n\nnon_diegetic_music:\nN/A"
        )
        text = self.write(generate, six, clip="the clip", picture_1=PICTURE, tidy=True)
        self.assertIn("[Shot 1] She waves.", text)
        self.assertFalse(any(call.get("system_prompt") == TIDY_SYSTEM for call in generate.calls))

    def test_an_empty_script_is_not_sent(self):
        generate = fake_generate("unused")
        try:
            self.write(generate, "", clip="the clip", picture_1=PICTURE, tidy=True)
        except Exception:
            pass
        self.assertFalse(any(call.get("system_prompt") == TIDY_SYSTEM for call in generate.calls))


if __name__ == "__main__":
    unittest.main()
