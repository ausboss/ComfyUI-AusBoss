"""Tidy up on H3 Prompt Writer: the model rewrites the lines, code keeps the spoken words."""

from __future__ import annotations

from contextlib import redirect_stdout
from io import StringIO
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
from nodes.node_h3_prompt_writer import TIDY_NEEDS_UPDATE, AusBossH3PromptWriter

PICTURE = torch.zeros(1, 8, 8, 3)


def answering(*answers):
    """A fake model: one answer per call, the last one again after that."""
    calls = []

    def ask(system, line, longest):
        calls.append((system, line, longest))
        return answers[min(len(calls), len(answers)) - 1]

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
        ask, _ = answering("The cat jumps on the table.", "The dog barks.")
        self.assertEqual(tidy_script("teh cat jumps on teh table\nteh dog barks", ask), ("The cat jumps on the table.\nThe dog barks.", True))

    def test_a_second_quote_the_writer_cant_voice_may_become_its_own_line(self):
        ask, _ = answering("@1 says SPOKEN1 to @2. @2 says SPOKEN2.")
        self.assertEqual(tidy_script('@1 says "Hi" to @2, who says "Bye."', ask), ('@1 says "Hi" to @2. @2 says "Bye.".', True))

    def test_each_line_is_sent_on_its_own(self):
        ask, calls = answering("@1 waves.", "@2 nods.")
        self.assertEqual(tidy_script("@1 wavs\n\n@2 nodds", ask), ("@1 waves.\n\n@2 nods.", True))
        self.assertEqual([line for _, line, _ in calls], ["Line: @1 wavs\nCleaned:", "Line: @2 nodds\nCleaned:"])

    def test_speakers_cannot_swap(self):
        ask, _ = answering("@2 says SPOKEN. @1 says it too.")
        self.assertEqual(tidy_script('@1 says "Hi." and @2 waves\n@2 nods', ask)[0].split("\n")[0], '@1 says "Hi." and @2 waves')

    def test_timings_and_cuts_stay_on_their_lines(self):
        ask, _ = answering("3s: @1 sits.", "0s: @2 stands.")
        script = "0s: @1 sits\n3s: @2 stands"
        self.assertEqual(tidy_script(script, ask), (script, False))

    def test_a_line_that_comes_back_as_two_is_not_used(self):
        ask, _ = answering("@1 sits.\n\n@1 stands.", "@2 nods.")
        self.assertEqual(tidy_script("@1 sits and stands\n@2 nodds", ask), ("@1 sits and stands\n@2 nods.", True))

    def test_setting_lines_are_not_sent(self):
        ask, calls = answering("@1 waves.", "@2 nods.")
        out, _ = tidy_script("@1 wavs\ncamera: slow push in\n@2 nodds", ask)
        self.assertEqual(out, "@1 waves.\ncamera: slow push in\n@2 nods.")
        self.assertEqual(len(calls), 2)

    def test_a_curly_quoted_sign_is_never_voiced(self):
        ask, _ = answering("@1 points at a sign. @1 says SPOKEN.", "@2 nods.")
        line = "@1 points at a sign reading \u201cEXIT\u201d"
        self.assertEqual(tidy_script(line + "\n@2 nodds", ask), (line + "\n@2 nods.", True))

    def test_a_shout_next_to_a_sign_can_be_tidied(self):
        ask, _ = answering("@1 holds up a sign and shouts SPOKEN.", "@2 nods.")
        out, _ = tidy_script('@1 holds up a sign and shouts "Run!"\n@2 nodds', ask)
        self.assertEqual(out, '@1 holds up a sign and shouts "Run!".\n@2 nods.')

    def test_a_softly_said_line_keeps_its_speaker(self):
        ask, _ = answering("@1 waits while @2 says SPOKEN.", "@2 nods.")
        line = '@1 says softly "Hi." while @2 waits.'
        self.assertEqual(tidy_script(line + "\n@2 nodds", ask), (line + "\n@2 nods.", True))

    def test_a_sign_beside_dialogue_is_not_voiced(self):
        ask, _ = answering("@1 says SPOKEN1 beside the sign. @1 says SPOKEN2.", "@1 waves.")
        line = '@1 says "Hi." beside a sign reading "EXIT".'
        self.assertEqual(tidy_script(line + "\n@1 wavs", ask), (line + "\n@1 waves.", True))

    def test_a_timed_line_cannot_speak_earlier(self):
        ask, _ = answering("@1 waves.", "0s: @1 says SPOKEN. 3s: @1 nods.")
        script = '@1 waves.\n3s: @1 says "Hi." and nods.'
        self.assertEqual(tidy_script(script, ask), (script, False))

    def test_a_typed_cut_cannot_vanish(self):
        ask, _ = answering("@1 waves.", "@1 sits.")
        script = "@1 waves.\nCut to @1 sits."
        self.assertEqual(tidy_script(script, ask), (script, False))

    def test_a_one_line_idea_is_left_for_the_model_to_fill_out(self):
        ask, calls = answering("The woman checks a chart. She walks to the door.")
        self.assertEqual(tidy_script("the woman checks a chart and walks to the door", ask), ("the woman checks a chart and walks to the door", False))
        self.assertEqual(calls, [])

    def test_a_quote_that_reads_like_a_marker_comes_back_as_typed(self):
        ask, _ = answering("@1 says SPOKEN1. @2 says SPOKEN2.")
        self.assertEqual(tidy_script('@1 says "SPOKEN2" and @2 says "Bye."', ask)[0], '@1 says "SPOKEN2". @2 says "Bye.".')

    def test_a_quote_inside_a_quote_stays_held_out(self):
        ask, calls = answering("@1 says SPOKEN.")
        typed = '@1 says "She said “secret” yesterday." and @2 nods'
        tidy_script(typed, ask)
        self.assertNotIn("secret", calls[0][1])

    def test_a_longer_number_is_not_the_same_person(self):
        typed = '@1 says "Hi." and @2 waves.'
        self.assertEqual(tidy_script(typed, answering("@12 says SPOKEN. @2 waves.")[0]), (typed, False))

    def test_a_tidy_that_changes_what_the_writer_reads_is_not_used(self):
        for typed, answer in (
            ('@1 says "Hi." and @2 says "Bye."', "@1 says SPOKEN1 to @2, who says SPOKEN2."),  # Bye is no longer spoken
            ('3s: @1 says "Hi."\n\n@1 waves.', "@1 says SPOKEN. @1 waves."),  # the cut and the timing are gone
            ('@1 wears a shirt that says "HELLO" and @2 laughs.', "@1 wears a shirt. @1 says SPOKEN. @2 laughs."),  # the shirt now talks
        ):
            with self.subTest(typed=typed):
                self.assertEqual(tidy_script(typed, answering(answer)[0]), (typed, False))


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
        self.assertIn("<Subject 2> says <d>[English] No way.</d>", text)
        self.assertNotIn("who goes", text)

    def test_tidy_off_never_asks_for_a_tidy(self):
        generate = fake_generate("unused")
        self.write(generate, '@1 waves at @2 and says "Hi."', clip="the clip", picture_1=PICTURE, picture_2=PICTURE)
        self.assertFalse(any(call.get("system_prompt") == TIDY_SYSTEM for call in generate.calls))

    def test_tidy_with_no_model_keeps_the_lines_as_typed(self):
        on = AusBossH3PromptWriter().write('@1 waves at @2 and says "Hi."', 5, picture_1=PICTURE, picture_2=PICTURE, tidy=True)[0]
        off = AusBossH3PromptWriter().write('@1 waves at @2 and says "Hi."', 5, picture_1=PICTURE, picture_2=PICTURE)[0]
        self.assertEqual(on, off)

    def test_tidy_on_an_older_comfyui_keeps_the_lines_and_says_why_in_the_log(self):
        log = StringIO()
        with redirect_stdout(log):
            on = self.write(fake_generate("x", system_prompt=False), "@1 waves\n@1 sits", clip="the clip", picture_1=PICTURE, tidy=True)
        self.assertEqual(on, self.write(fake_generate("x", system_prompt=False), "@1 waves\n@1 sits", clip="the clip", picture_1=PICTURE))
        self.assertIn(TIDY_NEEDS_UPDATE, log.getvalue())
        TIDY_NEEDS_UPDATE.encode("ascii")

    def test_tidied_lines_the_writer_turns_down_go_as_typed(self):
        # Tidied, the line no longer names @2 before the words; as typed it is fine.
        generate = fake_generate("@1 waves at @2. @1 smiles. SPOKEN is said.")
        typed = '@1 waves at @2 and says "Hi."'
        on = self.write(generate, typed, clip="the clip", picture_1=PICTURE, picture_2=PICTURE, tidy=True)
        self.assertIn("<Subject 1> waves at <Subject 2> and says <d>[English] Hi.</d>", on)

    def test_a_one_line_idea_is_still_filled_out_with_tidy_on(self):
        generate = fake_generate("She opens the door.\nShe steps outside.")
        self.write(generate, "@1 checks a chart", clip="the clip", picture_1=PICTURE, tidy=True)
        self.assertFalse(any(call.get("system_prompt") == TIDY_SYSTEM for call in generate.calls))
        self.assertTrue(any(call.get("system_prompt") in (None, "") for call in generate.calls))

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
