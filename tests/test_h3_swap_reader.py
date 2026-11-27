"""How H3 Prompt Writer reads a swap's typed lines: who goes, how each new person looks, and what it did not use.

Each row is a way people really type a swap. Before the reader, about a third of these lost words without a word
to the user, or put the new person's description where the person who goes belongs.
"""
from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nodes._h3_swap_reader import read_swap

ONE = {1: "person"}
TWO = {1: "person", 2: "person"}
THREE = {1: "person", 2: "person", 3: "person"}

# (typed, jobs, who goes by slot, words each slot's look must hold, words the not-used list must hold)
ROWS = [
    ("Replace the man in red with @1", ONE, {1: "the man in red"}, {}, []),
    ("swap the guy on the left for @1", ONE, {1: "the guy on the left"}, {}, []),
    ("the guy on the left (@1)", ONE, {1: "the guy on the left"}, {}, []),
    ("@1 replaces the guy on the left", ONE, {1: "the guy on the left"}, {}, []),
    ("@1 is the new guy, replacing the old bartender", ONE, {1: "the old bartender"}, {}, []),
    ("Elon is @1, he replaces the man at the counter", ONE, {1: "the man at the counter"}, {}, []),
    ("Elon is @1 and he replaces the man at the counter", ONE, {1: "the man at the counter"}, {}, []),
    ("put @1 in place of the dancer in the back", ONE, {1: "the dancer in the back"}, {}, []),
    ("Replace the man in red with @1, a guy with a beard and glasses", ONE, {1: "the man in red"}, {1: "a guy with a beard and glasses"}, []),
    ("Replace the man in red with @1 who has a beard", ONE, {1: "the man in red"}, {1: "a beard"}, []),
    ("replace the man in red with @1 (bearded, glasses)", ONE, {1: "the man in red"}, {1: "bearded, glasses"}, []),
    ("replace the singer with @1. @1 is a tall woman with red hair.", ONE, {1: "the singer"}, {1: "a tall woman with red hair"}, []),
    ("replace the singer with @1. she has red hair", ONE, {1: "the singer"}, {1: "red hair"}, []),
    ("replace the singer with @1\nshe has red hair", ONE, {1: "the singer"}, {1: "red hair"}, []),
    ("replace the singer with @1, wearing a black suit", ONE, {1: "the singer"}, {1: "a black suit"}, []),
    ("replace the singer with @1 in a black suit", ONE, {1: "the singer"}, {1: "a black suit"}, []),
    ("replace the singer with @1\n@1 wears a black suit", ONE, {1: "the singer"}, {1: "a black suit"}, []),
    ("replace the man in the clip with @1's face", ONE, {1: "the man"}, {}, []),
    ("the barista is replaced by @1, a woman in her 40s with short grey hair", ONE, {1: "the barista"}, {1: "short grey hair"}, []),
    ("Replace the man on the left, who is wearing a hat, with @1", ONE, {1: "the man on the left, who is wearing a hat"}, {}, []),
    ("replace the woman who is walking with @1", ONE, {1: "the woman who is walking"}, {}, []),
    ("@1 replaces the man, and the camera zooms in", ONE, {1: "the man"}, {}, ["the camera zooms in"]),
    ("@1 replaces the man; the camera zooms in at 3s", ONE, {1: "the man"}, {}, ["the camera zooms in"]),
    ('replace the man with @1, a guy with a beard. he says "hi there"', ONE, {1: "the man"}, {1: "a guy with a beard"}, []),
    ('Replace the man with @1, a guy with a beard, and he says "hi there"', ONE, {1: "the man"}, {1: "a guy with a beard"}, []),
    ('replace the man at the counter with @1 and have him say "i\'ll take two"', ONE, {1: "the man at the counter"}, {}, []),
    ("replace the man with @1 (a tall woman)", ONE, {1: "the man"}, {1: "a tall woman"}, []),
    ("@1 is Elon, a man with a beard, and he replaces the man at the counter", ONE, {1: "the man at the counter"}, {1: "a man with a beard"}, []),
    ("Elon (@1) replaces the man at the counter", ONE, {1: "the man at the counter"}, {}, []),
    ("replace the man at the counter with Elon (@1)", ONE, {1: "the man at the counter"}, {}, []),
    ("replace the man at the counter with Elon, @1", ONE, {1: "the man at the counter"}, {}, []),
    ("REPLACE THE MAN WITH @1. @1 LOOKS LIKE A TALL WOMAN", ONE, {1: "THE MAN"}, {1: "A TALL WOMAN"}, []),
    ("replace the man with @1. make the background a beach", ONE, {1: "the man"}, {}, ["make the background a beach"]),
    ("replace the man with @1 and make her smile", ONE, {1: "the man"}, {}, ["make her smile"]),
    ("replace the man with @1 and add a hat", ONE, {1: "the man"}, {}, ["add a hat"]),
    ("replace the man with @1. she is happy", ONE, {1: "the man"}, {}, ["she is happy"]),
    ("replace Mr. Smith with @1", ONE, {1: "Mr. Smith"}, {}, []),
    ("@1 dances", ONE, {}, {}, ["@1 dances"]),
    ("Swap him out for @1", ONE, {}, {}, []),
    ("The man in front is replaced by @1, a 3D animated game character with a blue body suit, brown hair tied in buns.", ONE,
     {1: "the man in front"}, {1: "a 3D animated game character with a blue body suit, brown hair tied in buns"}, []),
    ("replace the singer with @1. keep the clip's clothes", ONE, {1: "the singer"}, {}, []),
    ("the man in the hat", ONE, {1: "the man in the hat"}, {}, []),
    # Two or three people.
    ("@1 replaces the man on the left, @2 replaces the woman on the right", TWO, {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("@1 the man on the left. @2 the woman in red.", TWO, {1: "the man on the left", 2: "the woman in red"}, {}, []),
    ("replace the man with @1 and the woman with @2", TWO, {1: "the man", 2: "the woman"}, {}, []),
    ("replace the man with @1 and replace the woman with @2", TWO, {1: "the man", 2: "the woman"}, {}, []),
    ("Replace the man in red with @1 and the girl in blue with @2", TWO, {1: "the man in red", 2: "the girl in blue"}, {}, []),
    ("swap @1 for the guy on the left and @2 for the girl on the right", TWO, {1: "the guy on the left", 2: "the girl on the right"}, {}, []),
    ("@1 is Elon, he replaces the man on the left. @2 is Dario, he replaces the woman on the right", TWO,
     {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("the guy on the left (@1) and the guy on the right (@2)", TWO, {1: "the guy on the left", 2: "the guy on the right"}, {}, []),
    ("the guy on the left is @1, the guy on the right is @2", TWO, {1: "the guy on the left", 2: "the guy on the right"}, {}, []),
    ("left guy -> @1, right guy -> @2", TWO, {1: "left guy", 2: "right guy"}, {}, []),
    ("@1: the man on the left\n@2: the woman on the right", TWO, {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("replace the man on the left with @1, a bearded man. replace the woman on the right with @2, a girl with pigtails", TWO,
     {1: "the man on the left", 2: "the woman on the right"}, {1: "a bearded man", 2: "a girl with pigtails"}, []),
    ("@1, a bearded man, replaces the one on the left. @2, a girl with pigtails, replaces the one on the right.", TWO,
     {1: "the one on the left", 2: "the one on the right"}, {1: "a bearded man", 2: "a girl with pigtails"}, []),
    ("@1 looks like a bearded man\n@2 looks like a girl with pigtails\nswap the left person for @1 and the right person for @2", TWO,
     {1: "the left person", 2: "the right person"}, {1: "a bearded man", 2: "a girl with pigtails"}, []),
    ("both people are replaced, @1 on the left and @2 on the right", TWO, {1: "the person on the left", 2: "the person on the right"}, {}, []),
    ('@1 replaces the man on the left and says "hello". @2 replaces the woman on the right and says "hi"', TWO,
     {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("the woman on the right is replaced by @2 and the man on the left is replaced by @1", TWO,
     {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("replace the man with @2 and the woman with @1", TWO, {1: "the woman", 2: "the man"}, {}, []),
    ("@2 replaces the man and @1 replaces the woman", TWO, {1: "the woman", 2: "the man"}, {}, []),
    ("@1 replaces the man on the left and @2 the woman on the right", TWO, {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("@1 (bearded man) replaces the man on the left, @2 (girl with pigtails) replaces the woman on the right", TWO,
     {1: "the man on the left", 2: "the woman on the right"}, {1: "bearded man", 2: "girl with pigtails"}, []),
    ("Elon is @1, Dario is @2. Elon replaces the man on the left and Dario the woman on the right.", TWO,
     {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("the man on the left becomes @1 and the woman on the right becomes @2", TWO, {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("@1 replaces Mr. Smith. @2 replaces Dr. Jones.", TWO, {1: "Mr. Smith", 2: "Dr. Jones"}, {}, []),
    ("The young man in the grey cardigan with headphones on the left is replaced by @1, a cartoon 3D wooden log character with big eyes.\n"
     "The young woman with dark bangs in the white blouse on the right is replaced by @2, a young woman with long red hair.", TWO,
     {1: "the young man in the grey cardigan with headphones on the left", 2: "the young woman with dark bangs in the white blouse on the right"},
     {1: "a cartoon 3D wooden log character with big eyes", 2: "a young woman with long red hair"}, []),
    ("the man on the left\nthe woman on the right", TWO, {1: "the man on the left", 2: "the woman on the right"}, {}, []),
    ("@1 replaces the man at the bar, @2 replaces the woman, and @3 replaces the kid", THREE,
     {1: "the man at the bar", 2: "the woman", 3: "the kid"}, {}, []),
]


class SwapReaderTests(unittest.TestCase):
    def test_each_way_people_type_a_swap(self):
        for typed, jobs, goes, looks, unused in ROWS:
            with self.subTest(typed=typed):
                read = read_swap(typed, jobs)
                self.assertEqual({slot: who.lower() for slot, who in read.goes.items()},
                                 {slot: who.lower() for slot, who in goes.items()}, "who goes")
                for slot, words in looks.items():
                    self.assertIn(words.lower(), read.descriptions.get(slot, "").lower(), f"how @{slot} looks")
                self.assertEqual(set(read.descriptions) - set(looks), set(), "a look nobody typed")
                said = " | ".join(read.unused).lower()
                for words in unused:
                    self.assertIn(words.lower(), said, "not used")
                if not unused:
                    self.assertEqual(read.unused, [], "words left over")

    def test_a_looks_line_for_a_picture_that_is_not_connected_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "Picture 2 is not connected"):
            read_swap("@2 looks like a pilot", ONE)

    def test_a_picture_described_twice_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "once"):
            read_swap("@1 looks like a pilot\n@1 looks like a chef", ONE)

    def test_spoken_words_are_never_listed_as_not_used(self):
        read = read_swap('replace the barista with @1. 2s: "coffee is ready"', ONE)
        self.assertEqual(read.unused, [])
        self.assertEqual(read.goes, {1: "the barista"})


if __name__ == "__main__":
    unittest.main()


class ReportTests(unittest.TestCase):
    """The node's report shows what was read, from the same reading the prompt uses."""

    def report(self, text, jobs):
        from nodes._h3_script_helpers import script_report
        return script_report(text, 6.0, jobs, "swap the person")["read"]

    def test_the_report_says_who_goes_and_how_they_look(self):
        read = self.report("The man in front is replaced by @1, a game character with a blue suit.", ONE)
        self.assertEqual(read["people"], [{"slot": 1, "goes": "the man in front", "looks": "a game character with a blue suit", "named": True}])
        self.assertEqual(read["unused"], [])

    def test_the_report_says_when_nobody_was_named(self):
        read = self.report("", TWO)
        self.assertEqual([person["goes"] for person in read["people"]], ["the person on the left", "the person on the right"])
        self.assertEqual([person["named"] for person in read["people"]], [False, False])
        self.assertEqual(read["people"][0]["looks"], "")

    def test_the_report_lists_words_a_swap_does_not_use(self):
        read = self.report("replace the man with @1 and make her smile", ONE)
        self.assertEqual(read["unused"], ["make her smile"])

    def test_a_line_the_writer_would_refuse_shows_its_reason(self):
        read = self.report("@3 looks like a man in red.", ONE)
        self.assertEqual(read["people"], [])
        self.assertIn("Picture 3 is not connected", read["problem"])

    def test_other_jobs_have_no_reading(self):
        from nodes._h3_script_helpers import script_report
        self.assertNotIn("read", script_report("@1 waves", 6.0, ONE, ""))
