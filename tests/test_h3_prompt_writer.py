from __future__ import annotations

from pathlib import Path
import re
import sys
import unittest

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._h3_prompt_helpers import (
    put_on_from_pictures,
    NO_SCRIPT,
    VOICE_NO_WORDS,
    add_task,
    clean_words,
    find_beats,
    find_speech,
    join_sections,
    place_lines,
    snap_cuts,
    split_sections,
    write_prompt,
)
from nodes._h3_cast_helpers import Cast, number_pictures
from nodes._h3_script_helpers import read_script, script_report, script_warning, timeline
from nodes import node_h3_prompt_writer
from nodes.node_h3_prompt_writer import AusBossH3PromptWriter, clip_frames, video_frames, with_sound_and_music

SIX = """subject_definitions:
<Subject 1> is the main person in <Picture 1>, with the same face.

summary:
[reference generation] The target video is a trailer.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - the face is retained.

detailed_description:
The target video is live-action.
[Shot 1] A wide shot shows <Subject 1>.
[Shot 2] At 00:02.500, the camera cuts to the title "THE HOLLOW".

overall_soundscape:
A low wind continues throughout.

non_diegetic_music:
A dark orchestral score rises to the end."""

LINES = "She lowers the camera.\nShe looks at us and smiles.\nShe raises the camera again and a bright flash fires."
SAYS = 'She looks up and says "we are late."\nShe runs.'


VOICE, SONG, UNDER, FRAMES = 7, 8, 9, 10  # Where these sit in the node's outputs.
PICTURE = torch.zeros(1, 8, 8, 3)


def clicks(bpm, rate=22050, seconds=15.0, first=0.31):
    """A click track: one short thump on every beat, over a whisper of noise."""
    samples = np.zeros(int(seconds * rate), dtype=np.float32)
    length = int(0.05 * rate)
    thump = np.sin(2 * np.pi * 90 * np.arange(length) / rate) * np.exp(-np.arange(length) / (0.012 * rate))
    noise = np.random.default_rng(1)
    time = first
    while time < seconds - 0.1:
        start = int(time * rate)
        samples[start : start + length] += (thump + 0.3 * noise.normal(size=length) * np.exp(-np.arange(length) / (0.012 * rate))).astype(np.float32)
        time += 60 / bpm
    return samples + 0.005 * noise.normal(size=len(samples)).astype(np.float32)


def moments(text):
    return [moment.text for moment in read_script(text).moments]


def shots(text, **options):
    return split_sections(write_prompt(text, **options))["detailed_description"].split("\n")[1:]


def parts_of(text, **options):
    return split_sections(write_prompt(text, **options))


def count_moments(line):
    return 1 + len(re.findall(r"\bAt \d\d:", line))


class ReadingTests(unittest.TestCase):
    def test_every_line_is_a_moment_in_the_order_typed(self):
        self.assertEqual(moments(LINES), ["She lowers the camera", "She looks at us and smiles", "She raises the camera again and a bright flash fires"])

    def test_a_line_splits_on_sentences_and_on_then(self):
        self.assertEqual(moments("She walks in. The lights go out; she screams"), ["She walks in", "The lights go out", "She screams"])
        self.assertEqual(moments("she opens the door, then she walks in, and then she sits"), ["She opens the door", "She walks in", "She sits"])

    def test_a_list_keeps_its_words_not_its_numbers(self):
        self.assertEqual(moments("1. she stands\n2) she sits\n- she sleeps"), ["She stands", "She sits", "She sleeps"])

    def test_a_blank_line_is_a_cut_and_so_is_cut_to(self):
        cuts = [moment.cut for moment in read_script("she walks\n\nshe stops\ncut to her face").moments]
        self.assertEqual(cuts, [False, True, True])

    def test_seconds_can_be_asked_for(self):
        script = read_script("she stands\n3s: she sits\nat 5 seconds she sleeps")
        self.assertEqual([moment.at for moment in script.moments], [None, 3.0, 5.0])
        self.assertEqual([moment.text for moment in script.moments], ["She stands", "She sits", "She sleeps"])
        self.assertEqual(moments("0-3s: she stands\n3-6s: she sits"), ["She stands", "She sits"])

    def test_lines_that_all_name_their_second_play_by_the_second(self):
        self.assertEqual(moments("5s: she sits\n2s: she stands"), ["@0 holds still", "She stands", "She sits"])

    def test_an_opening_and_an_ending_go_where_they_belong(self):
        script = read_script("ends on her crying\nstarts on a wide shot of the city\nshe walks out")
        self.assertEqual([moment.text for moment in script.moments], ["A wide shot of the city", "She walks out", "Her crying"])
        self.assertTrue(script.moments[0].start)
        self.assertTrue(script.moments[2].end)

    def test_labels_go_to_their_own_part(self):
        script = read_script("camera: handheld\nlook: anime\nsound: rain\nmusic: none\nshe runs")
        self.assertEqual((script.camera, script.look, script.sound, script.music), ("handheld", "anime", "rain", "N/A"))
        self.assertEqual(len(script.moments), 1)

    def test_camera_and_sound_lines_belong_to_their_shot(self):
        script = read_script("she runs\ncamera: orbit\n\nshe stops\nsound: rain on glass\n\nmusic: a slow piano")
        self.assertEqual((script.moments[0].camera, script.moments[1].sound), ("orbit", "rain on glass"))
        self.assertEqual((script.camera, script.sound, script.music), ("", "", "a slow piano"))

    def test_camera_and_sound_lines_on_their_own_are_for_the_whole_clip(self):
        script = read_script("camera: orbit\n\nshe runs\n\nshe stops")
        self.assertEqual((script.camera, script.moments[0].camera), ("orbit", ""))

    def test_a_side_note_is_not_a_moment(self):
        script = read_script("she runs. no music, just rain")
        self.assertEqual(len(script.moments), 1)
        self.assertEqual((script.music, script.sound), ("N/A", "rain"))
        self.assertTrue(read_script("no sound\nshe runs").silent)
        self.assertTrue(read_script("one long shot. she runs\n\nshe stops").one_take)

    def test_quotes_are_speech_unless_they_are_on_a_sign(self):
        self.assertEqual(read_script('she says "hello there." then she runs').moments[0].speech, "hello there.")
        self.assertEqual(read_script('"hello there"').moments[0].speech, "hello there")
        self.assertEqual(read_script('a sign reads "OPEN"').moments[0].speech, "")
        self.assertEqual(read_script('a huge "EXIT" glows').moments[0].speech, "")

    def test_a_full_stop_inside_a_quote_stays_with_it(self):
        self.assertEqual(len(moments('she says "stop. right there." and leaves')), 1)

    def test_curly_quotes_and_dashes_count(self):
        self.assertEqual(read_script("she says \u201chello\u201d").moments[0].speech, "hello")

    def test_nothing_typed_is_no_moments(self):
        self.assertEqual(moments("   \n\n "), [])
        self.assertEqual(moments("camera: handheld"), [])


class SplitTests(unittest.TestCase):
    def test_and_does_not_hang_off_a_moment(self):
        self.assertEqual(moments("First she smiles, then she waves, and finally she leaves."), ["She smiles", "She waves", "She leaves"])

    def test_a_title_keeps_its_full_stop(self):
        self.assertEqual(moments("Mr. Smith walks in. Dr. Jones looks up."), ["Mr. Smith walks in", "Dr. Jones looks up"])

    def test_it_ends_with_stays_in_one_piece(self):
        self.assertEqual(moments("She waits.\nIt ends with her walking into the sea."), ["She waits", "Her walking into the sea"])

    def test_next_as_a_plain_word_stays(self):
        self.assertEqual(moments("She picks up the next card."), ["She picks up the next card"])
        self.assertEqual(moments("She waits, next she runs."), ["She waits", "She runs"])

    def test_cut_to_inside_a_line_is_a_cut(self):
        script = read_script("She walks away, cut to the door opening.")
        self.assertEqual([(moment.text, moment.cut) for moment in script.moments], [("She walks away", False), ("The door opening", True)])

    def test_cut_to_black(self):
        self.assertIn("the camera cuts to black.", shots("She waits.\nCut to black.", seconds=6)[1])

    def test_a_quote_can_end_a_sentence(self):
        self.assertEqual(moments('A voiceover says "this is how it ended." She walks away.'), ['A voiceover says "this is how it ended."', "She walks away"])

    def test_an_at_after_a_quote_starts_a_new_moment(self):
        self.assertEqual(moments('@1 says "Hi." @1 waves and says "Bye."'), ['@1 says "Hi."', '@1 waves and says "Bye."'])
        self.assertEqual(moments('@1 says "Hi" and @2 says "Bye."'), ['@1 says "Hi"', '@2 says "Bye."'])
        self.assertEqual(moments('"Hi," she says. @1 laughs.'), ['"Hi," she says', "@1 laughs"])

    def test_every_line_in_a_row_is_spoken(self):
        def said(script, jobs):
            return re.findall(r"<d>\[English\] (.*?)</d>", write_prompt(script, seconds=8.0, jobs=jobs))

        self.assertEqual(said('@1 says "Hi!" @2 answers "Hello." @1 says "Bye."', {1: "person", 2: "person"}), ["Hi!", "Hello.", "Bye."])
        self.assertEqual(said('@1 says "Hi" and @2 says "Bye."', {1: "person", 2: "person"}), ["Hi.", "Bye."])
        self.assertEqual(said('"Hi," @1 says.', {1: "person"}), ["Hi."])
        self.assertEqual(said('@1 says "我有冰淇淋。" @1 says "好吗？" @1 says "但是，"', {1: "person"}), ["我有冰淇淋。", "好吗？", "但是。"])

    def test_the_timeline_shows_plain_words_for_a_hold(self):
        self.assertEqual(script_report("3s: she jumps", 8)["moments"][0]["text"], "Holds still")


class OrderTests(unittest.TestCase):
    def test_something_that_starts_is_not_how_the_clip_starts(self):
        for line in ("It starts to rain.", "It begins to snow.", "Starts running away.", "It opens slowly."):
            self.assertEqual(moments(f"She waits.\n{line}\nShe runs."), ["She waits", line.rstrip("."), "She runs"])

    def test_something_that_ends_is_not_how_the_clip_ends(self):
        for line in ("It ends badly for her.", "Closes the door behind her.", "Finishes the drink in one go."):
            self.assertEqual(moments(f"{line}\nShe runs."), [line.rstrip("."), "She runs"])

    def test_an_opening_and_an_ending_move_to_their_place(self):
        self.assertEqual(moments("She waits.\nStarts with a wide view of the hall.\nends on the door closing\nShe runs."),
                         ["A wide view of the hall", "She waits", "She runs", "The door closing"])
        self.assertEqual(moments("She waits.\nend: the door closes behind her\nstart: an empty hall at night"),
                         ["An empty hall at night", "She waits", "The door closes behind her"])


class TimelineTests(unittest.TestCase):
    def test_moments_share_the_clip(self):
        self.assertEqual(timeline(read_script(LINES), 6), [0.0, 2.0, 4.0])

    def test_a_second_asked_for_stays_and_the_rest_share_what_is_left(self):
        self.assertEqual(timeline(read_script("a\nb\n6s: c\nd"), 10), [0.0, 3.0, 6.0, 8.0])

    def test_a_first_moment_set_later_waits_on_a_still_start(self):
        script = read_script("at 3 seconds the lights go out\nshe runs")
        self.assertEqual(script.moments[0].text, "@0 holds still")
        self.assertEqual(timeline(script, 8), [0.0, 3.0, 5.5])

    def test_times_never_run_backwards_or_past_the_end(self):
        self.assertEqual(timeline(read_script("a\n7s: b\n3s: c"), 5), [0.0, 5.0, 5.0])

    def test_too_many_moments_says_so(self):
        self.assertEqual(script_warning(read_script(LINES), 5), "")
        self.assertIn("6 moments in 5 seconds", script_warning(read_script("a\nb\nc\nd\ne\nf"), 5))

    def test_a_moment_after_the_end_says_so(self):
        self.assertIn("after the clip ends", script_warning(read_script("a\n9s: b"), 5))

    def test_the_report_is_what_the_timeline_draws(self):
        report = script_report("a\n\nb", 10)
        self.assertEqual([(row["start"], row["end"]) for row in report["moments"]], [(0.0, 5.0), (5.0, 10)])
        self.assertEqual([row["cut"] for row in report["moments"]], [False, True])
        self.assertEqual(script_report("", 10), {"moments": [], "seconds": 10, "warning": ""})


class ScriptPartsTests(unittest.TestCase):
    def test_lines_become_timed_moments_in_one_take(self):
        self.assertEqual(
            shots(LINES, seconds=6),
            [
                "[Shot 1] <Subject 1> lowers the camera. At 00:02.000, <Subject 1> looks at us and smiles. "
                "At 00:04.000, <Subject 1> raises the camera again and a bright flash fires."
            ],
        )

    def test_one_take_says_so_and_a_cut_is_a_new_shot(self):
        self.assertIn("One continuous shot with no cuts.", parts_of(LINES)["detailed_description"].split("\n")[0])
        self.assertNotIn("One continuous", parts_of("She runs.")["detailed_description"])
        lines = shots("she walks\nshe stops\n\nshe sits\nshe sleeps", seconds=8)
        self.assertEqual([count_moments(line) for line in lines], [2, 3])
        self.assertTrue(lines[1].startswith("[Shot 2] At 00:04.000, the camera cuts to a new place."))

    def test_the_six_parts_are_all_there(self):
        parts = split_sections(write_prompt(LINES, seconds=6))
        self.assertEqual(parts["subject_definitions"], "<Subject 1> is the person in <Picture 1>, with the same face, hair and clothes.")
        self.assertEqual(parts["summary"], "[reference generation] In the target video, <Subject 1> lowers the camera.")
        self.assertEqual(parts["retention_analysis"], "<Subject 1> (appears in [Shot 1]): fully_preserved - the face, hair and clothes are retained. The background of <Picture 1> is not kept.")
        self.assertEqual(parts["non_diegetic_music"], "N/A")
        self.assertTrue(parts["overall_soundscape"])

    def test_an_end_picture_is_where_the_clip_lands(self):
        parts = parts_of("She turns away.\nShe looks up.", seconds=8, jobs={1: "start on it", 2: "end on it"})
        self.assertIn("<Picture 2> is the final frame of [Shot 1]", parts["subject_definitions"])
        self.assertEqual(
            parts["summary"], "[keyframe completion] In the target video, <Subject 1> turns away, moving from <Picture 1> to <Picture 2>."
        )
        self.assertIn("<Picture 2> ([Shot 1] last frame): fully_preserved", parts["retention_analysis"])
        line = parts["detailed_description"].split("\n")[1]
        self.assertEqual(line, "[Shot 1] The shot begins from <Picture 1>. <Subject 1> turns away. At 00:04.000, <Subject 1> looks up. The shot ends on <Picture 2>.")

    def test_a_moving_camera_keeps_moving_between_moments(self):
        self.assertIn("At 00:04.000, the camera keeps moving the same way.", shots("We walk in.\nThe screens flicker.", seconds=8, camera="walking pov")[0])
        self.assertNotIn("keeps moving the same way", shots("We wait.\nThe screens flicker.", seconds=8, camera="push in")[0])

    def test_a_typed_moving_camera_counts_too(self):
        lines = shots("camera: we run forward through the room\nThe door opens.\nThe light goes out.", seconds=8)
        self.assertIn("keeps moving the same way", lines[0])

    def test_a_cut_says_cut(self):
        lines = shots("she walks\n\na close-up of her hand\n\nthe door opens", seconds=9)
        self.assertEqual(lines[1], "[Shot 2] At 00:03.000, the camera cuts to a close-up of her hand.")
        self.assertEqual(lines[2], "[Shot 3] At 00:06.000, the camera cuts to a new place. The door opens.")

    def test_one_take_overrides_a_blank_line(self):
        self.assertNotIn("cuts to", " ".join(shots("one take\nshe walks\n\nshe stops")))

    def test_an_opening_and_an_ending_are_said(self):
        line = shots("starts on a wide shot of the city\nends on her crying", seconds=6)[0]
        self.assertIn("The shot opens on a wide shot of the city.", line)
        self.assertIn("At 00:03.000, the shot ends on her crying.", line)

    def test_camera_and_look_picks(self):
        detail = split_sections(write_prompt(LINES, camera="handheld", look="pencil sketch"))["detailed_description"]
        self.assertIn("black pencil sketch", detail.split("\n")[0])
        self.assertIn("handheld and shakes slightly", detail.split("\n")[0])

    def test_typed_words_win_over_the_picks(self):
        text = write_prompt("camera: the camera spins\nlook: pure neon\n" + LINES, camera="handheld", look="pencil sketch")
        self.assertIn("Pure neon".lower(), text.lower())
        self.assertIn("the camera spins.", text)
        self.assertNotIn("pencil", text)

    def test_a_typed_look_can_name_a_listed_one(self):
        self.assertIn("redrawn as a hand-drawn", write_prompt("look: Anime\n" + LINES))

    def test_a_redraw_changes_the_subject_and_what_is_kept(self):
        parts = split_sections(write_prompt(LINES, look="watercolor"))
        self.assertIn("redrawn as a hand-painted watercolour", parts["subject_definitions"])
        self.assertIn("attribute_transfer", parts["retention_analysis"])

    def test_later_shots_say_the_look_again(self):
        lines = split_sections(write_prompt(LINES.replace("\n", "\n\n"), look="pencil sketch"))["detailed_description"].split("\n")
        self.assertNotIn("Still a black pencil sketch", lines[1])
        self.assertIn("Still a black pencil sketch", lines[2])
        self.assertIn("Still a black pencil sketch", lines[3])

    def test_a_typed_look_is_not_repeated(self):
        self.assertNotIn("Still", write_prompt("look: pure neon\n" + LINES))

    def test_who_speaks_is_not_left_behind_as_a_moment(self):
        for line in ('She says "hello."', 'The old man says "hello."', 'She quietly says "hello."'):
            self.assertRegex(shots(line + "\nShe runs.", seconds=8, voice=True)[0], r"^\[Shot 1\] <Subject 1> \(S1\)")
        for line, kept in (
            ('She looks up and says "hello."', "<Subject 1> looks up."),
            ('She turns to him and quietly says "hello."', "<Subject 1> turns to him."),
            ('She turns, says "hello."', "<Subject 1> turns."),
            ('Looking up, she says "hello."', "Looking up."),
        ):
            self.assertIn(f"{kept} <Subject 1> (S1)", shots(line, seconds=8, voice=True)[0])

    def test_the_moments_around_a_spoken_line_stay_silent(self):
        line = shots('She looks at us.\nShe says "hello."\nShe looks away.', seconds=8, voice=True)[0]
        self.assertIn("<Subject 1> looks at us. <Subject 1> stays silent", line)
        self.assertIn("<Subject 1> looks away. <Subject 1> stays silent", line)
        self.assertEqual(line.count("stays silent"), 2)
        self.assertNotIn("stays silent", write_prompt(LINES))
        self.assertIn("No other words are spoken.", split_sections(write_prompt('She says "hello."'))["overall_soundscape"])
        self.assertNotIn("No other words", write_prompt(LINES))

    def test_a_quote_with_small_letters_is_still_speech(self):
        self.assertEqual(read_script('"We are late."').moments[0].speech, "We are late.")

    def test_sound_and_music_lines(self):
        parts = split_sections(write_prompt("sound: rain on metal\nmusic: a slow piano\n" + LINES))
        self.assertEqual(parts["overall_soundscape"], "Rain on metal.")
        self.assertEqual(parts["non_diegetic_music"], "A slow piano.")

    def test_silent(self):
        parts = split_sections(write_prompt("no sound\n" + LINES))
        self.assertEqual((parts["overall_soundscape"], parts["non_diegetic_music"]), ("N/A", "N/A"))
        self.assertNotIn("shutter", parts["detailed_description"])

    def test_a_moment_says_only_what_was_typed(self):
        self.assertTrue(shots("She stops.\nIt starts to rain.")[0].endswith("it starts to rain."))
        self.assertTrue(shots("She stops.\nShe runs away.")[0].endswith("<Subject 1> runs away."))
        self.assertTrue(shots("She smiles.")[0].endswith("<Subject 1> smiles."))
        self.assertTrue(shots("Thunder booms overhead.")[0].endswith("Thunder booms overhead."))

    def test_nothing_is_carried_into_later_moments(self):
        line = shots("The lights go out.\nShe turns around.\nShe runs.", seconds=9)[0]
        self.assertTrue(line.endswith("<Subject 1> runs."), line)
        self.assertNotIn("stay off", line)
        self.assertNotIn("goes dark", line)

    def test_nothing_typed_says_what_to_do(self):
        for text in ("", "   ", "camera: handheld"):
            with self.assertRaises(ValueError) as caught:
                write_prompt(text)
            self.assertEqual(str(caught.exception), NO_SCRIPT)

    def test_h3s_own_six_parts_go_through(self):
        self.assertEqual(split_sections(write_prompt(SIX)), split_sections(SIX))

    def test_a_task_tag_joins_the_ones_there(self):
        self.assertEqual(add_task("[a] text", "b"), "[a + b] text")
        self.assertEqual(add_task("[a + b] text", "b"), "[a + b] text")
        self.assertEqual(add_task("text", "b"), "[b] text")


class SpeechTests(unittest.TestCase):
    def test_the_words_go_in_their_moment_once(self):
        text = write_prompt(SAYS, seconds=6)
        self.assertEqual(text.count("We are late"), 0)
        self.assertEqual(text.count("we are late."), 1)
        first = shots(SAYS, seconds=6)[0]
        self.assertIn("<Subject 1> looks up.", first)
        self.assertIn("(S1) says, <d>[English] we are late.</d>", first)
        self.assertIn("closes the lips", first)

    def test_the_summary_never_repeats_them(self):
        self.assertNotIn("late", split_sections(write_prompt('"we are late"'))["summary"])

    def test_a_voice_carries_the_line(self):
        parts = split_sections(write_prompt(SAYS, voice=True))
        self.assertIn("<Audio 1> is the voice-timbre reference for <Subject 1> (S1).", parts["subject_definitions"])
        self.assertTrue(parts["summary"].startswith("[reference generation + audio reference]"))
        self.assertIn("<Audio 1>: reference", parts["retention_analysis"])
        self.assertIn("speaks using the voice timbre referenced from <Audio 1> and says, <d>[English] we are late.</d>", parts["detailed_description"])

    def test_a_voice_with_nobody_speaking_says_what_to_do(self):
        with self.assertRaises(ValueError) as caught:
            write_prompt(LINES, voice=True)
        self.assertEqual(str(caught.exception), VOICE_NO_WORDS)

    def test_a_narrator_is_heard_not_seen(self):
        text = write_prompt('a voice says "in a world without sound."\nshe runs')
        self.assertIn("says in an off-screen voiceover, <d>[English] in a world without sound.</d>", text)
        self.assertIn("keeps the lips completely closed", text)

    def test_language(self):
        self.assertIn("<d>[Spanish] hola.</d>", write_prompt('she says "hola"', language="Spanish"))

    def test_words_are_cleaned(self):
        self.assertEqual(clean_words("  go\n home "), "go home.")
        self.assertEqual(clean_words("really?"), "really?")
        self.assertEqual(clean_words("<d>hi</d>!"), "dhi/d!")


class PictureJobTests(unittest.TestCase):
    def test_h3_counts_only_what_is_connected(self):
        pictures = number_pictures({1: "person", 3: "place"})
        self.assertEqual([(picture.slot, picture.picture, picture.subject) for picture in pictures], [(1, 1, 1), (3, 2, 2)])
        parts = parts_of("@1 sits down in @3.", jobs={1: "person", 3: "place"})
        self.assertIn("<Subject 2> is the place in <Picture 2>", parts["subject_definitions"])
        self.assertIn("<Subject 1> sits down in <Subject 2>.", parts["detailed_description"])

    def test_a_number_with_no_picture_says_what_to_do(self):
        with self.assertRaisesRegex(ValueError, "@2 has no picture. Turn Picture 2 on"):
            write_prompt("@2 runs", jobs={1: "person"})

    def test_the_timeline_warns_before_the_run(self):
        self.assertIn("@2 has no picture", script_report("@2 runs", 8, {1: "person"})["warning"])
        self.assertIn("no line names @2", script_report("@1 runs", 8, {1: "person", 2: "person"})["warning"])
        self.assertEqual(script_report("@1 runs", 8, {1: "person"})["warning"], "")

    def test_lines_with_no_numbers_still_work_with_two_people(self):
        parts = parts_of("They sit down on a bench.", jobs={1: "person", 2: "person"})
        self.assertIn("<Subject 1> and <Subject 2> are in the shot. They sit down on a bench.", parts["detailed_description"])
        self.assertNotIn("left", parts["detailed_description"])
        self.assertIn("<Subject 2> (appears in [Shot 1])", parts["retention_analysis"])

    def test_nobody_is_placed_where_the_script_does_not_say(self):
        self.assertNotIn("of the frame", write_prompt("@1 stands behind @2.", jobs={1: "person", 2: "person"}))
        text = write_prompt("@1 and @2 stand side by side.", jobs={1: "person", 2: "person"})
        self.assertNotIn("on the left", text)
        self.assertNotIn("on the right", text)

    def test_she_is_only_the_person_when_there_is_one(self):
        self.assertIn("<Subject 1> runs.", write_prompt("She runs."))
        self.assertIn("She runs.", write_prompt("She runs.", jobs={1: "person", 2: "person"}))

    def test_each_person_appears_where_they_are_named(self):
        parts = parts_of("@1 walks.\n\n@2 sits.", jobs={1: "person", 2: "person"})
        self.assertIn("<Subject 1> (appears in [Shot 1])", parts["retention_analysis"])
        self.assertIn("<Subject 2> (appears in [Shot 2])", parts["retention_analysis"])

    def test_the_background_of_a_person_is_always_let_go_of(self):
        # With a place typed, H3 brought the picture's own back halfway through unless told not to.
        for script, jobs in (("She walks.\n\nShe sits.", None), ("She walks.\nShe sits.", None), ("@1 sits.", {1: "person", 2: "place"})):
            self.assertIn("The background of <Picture 1> is not kept.", parts_of(script, jobs=jobs)["retention_analysis"])
        self.assertNotIn("The background", parts_of("She walks.", jobs={1: "start on it"})["retention_analysis"])

    def test_every_new_place_is_said(self):
        parts = parts_of("She walks.\n\nShe sits.")
        self.assertIn("Every shot is a new place.", parts["summary"])
        self.assertIn("Every shot is a new place.", parts["detailed_description"])
        self.assertEqual(parts["overall_soundscape"], "The sound of each place carries through its shot.")

    def test_a_closer_view_stays_in_the_place(self):
        parts = parts_of("She walks.\n\nA close-up of her hand.")
        self.assertNotIn("new place", parts["detailed_description"])

    def test_a_place_picture_holds_every_shot(self):
        parts = parts_of("She walks.\n\nShe sits.", jobs={1: "person", 2: "place"})
        self.assertEqual(parts["detailed_description"].count("The shot takes place in <Subject 2>."), 2)
        self.assertIn("the camera cuts to a new view.", parts["detailed_description"])
        self.assertNotIn("new place", parts["detailed_description"])

    def test_a_shot_can_name_its_place_picture(self):
        lines = shots("@1 walks through @2.\n\n@1 sits in @3.", jobs={1: "person", 2: "place", 3: "place"})
        self.assertIn("the camera cuts to <Subject 3>.", lines[1])

    def test_an_outfit_goes_on_the_person(self):
        parts = parts_of("@1 walks.\n\n@1 sits wearing @2.", jobs={1: "person", 2: "outfit"})
        self.assertIn("<Subject 1> is the person in <Picture 1>, with the same face and hair.", parts["subject_definitions"])
        self.assertIn("partially_preserved - the face and hair are retained, and the clothes change to <Subject 2>.", parts["retention_analysis"])
        self.assertIn("attribute_transfer - put only this outfit on <Subject 1>.", parts["retention_analysis"])
        self.assertIn("<Subject 1> wears <Subject 2>.", parts["detailed_description"].split("\n")[1])

    def test_an_outfit_goes_on_who_it_is_named_with(self):
        parts = parts_of("@1 waves.\n@2 turns wearing @3.", jobs={1: "person", 2: "person", 3: "outfit"})
        self.assertIn("put only this outfit on <Subject 2>", parts["retention_analysis"])

    def test_a_style_picture_is_the_look_of_every_shot(self):
        parts = parts_of("She walks.\n\nShe sits.", jobs={1: "person", 2: "style"}, look="anime")
        first = parts["detailed_description"].split("\n")
        self.assertIn("uses the visual style of <Subject 2>", first[0])
        self.assertIn("Still in the visual style of <Subject 2>.", first[2])
        self.assertNotIn("anime", first[0])
        self.assertIn("<Subject 2> (appears in [Shot 1], [Shot 2]): attribute_transfer", parts["retention_analysis"])

    def test_a_character_sheet_shows_one_character(self):
        parts = parts_of("She walks.", jobs={1: "character sheet"})
        self.assertIn("single character shown in the views of <Picture 1>", parts["subject_definitions"])
        self.assertIn("without the panels, labels or other views of <Picture 1>.", parts["detailed_description"])

    def test_starting_on_a_picture_stays_in_it(self):
        parts = parts_of("She walks.", jobs={1: "start on it"})
        self.assertIn("<Subject 1> is as in <Picture 1>.", parts["detailed_description"])
        self.assertIn("keeps the look, the light and the colours of <Picture 1>", parts["detailed_description"])
        self.assertNotIn("The background", parts["retention_analysis"])

    def test_a_person_can_end_on_a_picture(self):
        parts = parts_of("She walks.", jobs={1: "person", 2: "end on it"})
        self.assertTrue(parts["summary"].startswith("[reference generation + keyframe completion]"))
        self.assertIn("<Picture 2> is the final frame of [Shot 1]", parts["subject_definitions"])
        self.assertTrue(parts["detailed_description"].endswith("The shot ends on <Picture 2>."))

    def test_the_end_picture_cant_be_named(self):
        with self.assertRaisesRegex(ValueError, "@2 can't be in a line"):
            write_prompt("@2 runs", jobs={1: "person", 2: "end on it"})

    def test_each_person_speaks_in_their_own_number(self):
        text = write_prompt('@1 says "hi"\n@2 says "hello"', jobs={1: "person", 2: "person"})
        self.assertIn("<Subject 1> (S1) says, <d>[English] hi.</d>", text)
        self.assertIn("<Subject 2> (S2) says, <d>[English] hello.</d>", text)

    def test_the_voice_goes_to_who_speaks_first(self):
        parts = parts_of('@2 says "hello"\n@1 says "hi"', jobs={1: "person", 2: "person"}, voice=True)
        self.assertIn("<Audio 1> is the voice-timbre reference for <Subject 2> (S1).", parts["subject_definitions"])
        self.assertIn("<Subject 2> (S1) speaks using the voice timbre", parts["detailed_description"])
        self.assertIn("<Subject 1> (S2) says,", parts["detailed_description"])

    def test_a_camera_line_stays_in_its_shot(self):
        lines = shots("She walks.\ncamera: orbit\n\nShe sits.")
        self.assertIn("The camera arcs around <Subject 1>", lines[0])
        self.assertNotIn("The camera arcs", lines[1])

    def test_a_sound_line_stays_in_its_shot(self):
        lines = shots("She walks.\n\nShe sits.\nsound: rain on the glass")
        self.assertTrue(lines[1].endswith("Rain on the glass."))

    def test_every_label_used_is_defined_and_kept(self):
        for jobs in (
            {1: "person"},
            {1: "person", 2: "person"},
            {1: "person", 2: "place"},
            {1: "person", 2: "outfit"},
            {1: "thing", 2: "style"},
            {1: "character sheet", 2: "place", 3: "outfit", 4: "style"},
            {1: "start on it", 2: "end on it"},
        ):
            people = set(jobs.values()) & {"person", "character sheet", "start on it"}
            for video in ("", "copy its moves") if people else ("",):
                parts = parts_of("They walk.\n\nThey sit.", jobs=jobs, video=video)
                said = set(re.findall(r"<Subject \d>", join_sections(parts)))
                self.assertEqual(said, set(re.findall(r"<Subject \d>", parts["subject_definitions"])), jobs)
                self.assertEqual(said, set(re.findall(r"^<Subject \d>", parts["retention_analysis"], re.M)), jobs)


class ShotFlowTests(unittest.TestCase):
    def test_the_summary_covers_every_shot(self):
        summary = parts_of("She walks through a market.\nShe stops.\n\nShe sits on a rooftop.", seconds=8)["summary"]
        self.assertIn("<Subject 1> walks through a market.", summary)
        self.assertIn("Then <Subject 1> sits on a rooftop.", summary)
        self.assertNotIn("stops", summary)

    def test_two_places_each_keep_their_own_colours(self):
        parts = parts_of("@1 sits in @2.\n\n@1 walks across @3.", seconds=8, jobs={1: "person", 2: "place", 3: "place"})
        self.assertIn("Each place keeps its own light and colours.", parts["detailed_description"])
        self.assertNotIn("colours and the film grain", parts["detailed_description"])

    def test_one_place_gives_the_colours(self):
        parts = parts_of("@1 sits in @2.", seconds=8, jobs={1: "person", 2: "place"})
        self.assertIn("the film grain of <Picture 2>", parts["detailed_description"])

    def test_a_thing_leaves_its_background_behind(self):
        parts = parts_of("@1 spins on a glass table.", seconds=8, jobs={1: "thing"})
        self.assertIn("The background of <Picture 1> is not kept.", parts["retention_analysis"])
        self.assertNotIn("film grain", parts["detailed_description"])


EVERYDAY = [
    line
    for line in (Path(__file__).parent / "fixtures" / "h3_everyday_lines.txt").read_text(encoding="utf-8").splitlines()
    if line.strip() and not line.startswith("#")
]
LABELS = re.compile(r"<[^>]+> is in the shot\.|<[^>]+>|\[Shot \d+\]|\bAt \d\d:\d\d\.\d+,")


def words_of(text):
    return set(re.findall(r"[a-z0-9']+", LABELS.sub(" ", text).lower()))


class EverydayLineTests(unittest.TestCase):
    """Ordinary lines go in as typed: the writer lays them out for H3 and adds
    no sound, state or setting of its own."""

    def test_no_word_is_added_to_an_everyday_line(self):
        for line in EVERYDAY:
            added = words_of(" ".join(shots(line, seconds=8))) - words_of(line)
            self.assertEqual(added, set(), line)

    def test_an_everyday_line_switches_nothing_off(self):
        for line in EVERYDAY:
            script = read_script(line)
            self.assertFalse(script.silent, line)
            self.assertNotEqual(script.music, "N/A", line)
            self.assertFalse(script.one_take, line)
            self.assertFalse(any(moment.start or moment.end for moment in script.moments), line)

    def test_words_stay_where_they_were_typed(self):
        for line, moments in (
            ("First person view of a busy market.", ["First person view of a busy market"]),
            ("First aid arrives.", ["First aid arrives"]),
            ("Step 2 feet to the left.", ["Step 2 feet to the left"]),
            ("1: She waves.", ["She waves"]),
            ("She finally finds the keys.", ["She finally finds the keys"]),
            ("The leaves suddenly turn red.", ["The leaves suddenly turn red"]),
            ("The rope is cut to length.", ["The rope is cut to length"]),
            ("The dance ends with a spin.", ["The dance ends with a spin"]),
            ("At the end of the pier she waves.", ["At the end of the pier she waves"]),
            ("It starts at nine every day.", ["It starts at nine every day"]),
            ("It starts at 9 every day.", ["It starts at 9 every day"]),
            ("It starts in ten seconds.", ["It starts in ten seconds"]),
            ("It starts on 3 March.", ["It starts on 3 March"]),
            ("She smiles, smash cut to black.", ["She smiles", "Black"]),
        ):
            self.assertEqual([moment.text for moment in read_script(line).moments], moments, line)

    def test_an_opening_can_start_with_a_number(self):
        script = read_script("She walks away.\nStarts with two people sitting at a table.")
        self.assertEqual([moment.text for moment in script.moments], ["Two people sitting at a table", "She walks away"])
        self.assertTrue(script.moments[0].start)
        script = read_script("She walks away.\nIt starts on one knee by the window.")
        self.assertEqual([moment.text for moment in script.moments], ["One knee by the window", "She walks away"])

    def test_only_a_sequence_word_starts_a_moment(self):
        for line, moments in (
            ("She sits, next to her sister.", ["She sits, next to her sister"]),
            ("Back then people wore hats.", ["Back then people wore hats"]),
            ("By then she is asleep.", ["By then she is asleep"]),
            ("She shows her U.S. passport.", ["She shows her U.S. passport"]),
            ("She smiles then waves.", ["She smiles", "Waves"]),
            ("She smiles. Then she waves.", ["She smiles", "She waves"]),
            ("She walks away, later she returns.", ["She walks away", "She returns"]),
        ):
            self.assertEqual([moment.text for moment in read_script(line).moments], moments, line)

    def test_a_time_is_a_time_only_when_it_is_marked(self):
        for line, at in (
            ("7 seconds remain on the scoreboard.", None),
            ("3s: she jumps", 3.0),
            ("3s she jumps", 3.0),
            ("at 3 seconds the lights go out", 3.0),
            ("3 seconds: she sits", 3.0),
            ("[00:02-00:04] She waves.", 2.0),
        ):
            moment = read_script(line).moments[-1]
            self.assertEqual(moment.at, at, line)
            self.assertNotIn("]", moment.text, line)

    def test_each_shot_keeps_its_own_camera_and_sound(self):
        script = read_script("Shot 1: She nods.\ncamera: still\nShot 2: She turns.\ncamera: handheld\nsound: rain")
        self.assertEqual([(moment.camera, moment.sound) for moment in script.moments], [("still", ""), ("handheld", "rain")])
        script = read_script("She nods.\nShot 2:\nShe turns.")
        self.assertEqual([moment.cut for moment in script.moments], [False, True])
        self.assertEqual(read_script("camera: handheld").camera, "handheld")

    def test_every_quote_is_said_by_who_says_it(self):
        script = read_script('Maya says "Hi" while Ben replies "Bye".')
        self.assertEqual([moment.speech for moment in script.moments], ["Hi", "Bye"])
        self.assertEqual(read_script("She says 'come here' and waves.").moments[0].speech, "come here")
        self.assertEqual(read_script("She can't wait, it's 'late'.").moments[0].speech, "")
        for line in ('She says "Wait" in voiceover.', 'VO: "Come back."'):
            moment = read_script(line).moments[0]
            self.assertTrue(moment.voiceover, line)
        line = parts_of('@1 listens as @2 says "Hi."', jobs={1: "person", 2: "person"})["detailed_description"]
        self.assertIn("<Subject 2> (S1) says", line)
        for line, speaker in (
            ('@1 turns to @2 and says "Hello."', 1),
            ('@1 turns to @2 and, smiling, says "Hello."', 1),
            ('@1 glares at @2, who says "Fine."', 2),
            ('@1 nods at @2 as she says "Yes."', 2),
            ('@1 looks at @2 and @2 says "Go."', 2),
        ):
            text = parts_of(line, jobs={1: "person", 2: "person"})["detailed_description"]
            self.assertIn(f"<Subject {speaker}> (S1)", text, line)
            self.assertNotIn(f"<Subject {3 - speaker}> (S1)", text, line)
        self.assertEqual(read_script("She says \"He said 'come here'.\"").moments[0].speech, "He said 'come here'.")
        self.assertNotIn("In voiceover", parts_of('She says "Wait" in voiceover.')["detailed_description"])

    def test_a_cut_back_and_a_one_word_ending(self):
        lines = shots("She walks into the hallway.\n\nShe sits in the kitchen.\n\nCut back to the hallway.", seconds=9)
        self.assertIn("the camera cuts back to the hallway.", lines[2])
        self.assertNotIn("Every shot is a new place.", write_prompt("She walks into the hallway.\n\nCut back to the hallway."))
        self.assertTrue(read_script("She waves.\nStart on black.").moments[0].start)
        self.assertTrue(read_script("End: black\nShe waves.").moments[-1].end)
        self.assertFalse(read_script("It ends.").moments[0].end)

    def test_clip_notes_mean_only_what_they_say(self):
        self.assertFalse(read_script("She walks through a field, muted colours.").silent)
        self.assertFalse(read_script("No soundtrack.\nShe walks.").silent)
        self.assertEqual(read_script("No soundtrack.\nShe walks.").music, "N/A")
        self.assertEqual(read_script("No background music.\nShe walks.").music, "N/A")
        self.assertTrue(read_script("Without sound.\nShe walks.").silent)
        self.assertNotEqual(read_script('She says "No music until the show is over."').music, "N/A")
        self.assertFalse(read_script("He takes one shot at the basket.").one_take)
        self.assertTrue(read_script("No camera cuts.\nShe walks.\n\nShe stops.").one_take)
        self.assertFalse(read_script('The TV plays without audio while she says "Hello."').silent)
        self.assertFalse(read_script("She watches a silent film on her laptop.").silent)
        self.assertTrue(read_script("Silent film.\nShe walks.").silent)
        self.assertTrue(read_script("She walks. Completely silent.").silent)

    def test_who_says_the_words_and_what_is_written(self):
        for line, said in (
            ('Her T-shirt says "Be kind".', ""),
            ('The sign says "OPEN".', ""),
            ('A neon sign reads "OPEN" and flickers.', ""),
            ('She holds up a sign and shouts "Vote today!"', "Vote today!"),
            ('He says a few words: "Thank you all."', "Thank you all."),
            ('She reads aloud "Welcome home".', "Welcome home"),
            ('She waves at the camera saying "hi everyone".', "hi everyone"),
        ):
            self.assertEqual(read_script(line).moments[0].speech, said, line)
        for line in ('Her voice cracks as she says "Sorry."', 'She looks off screen and says "Hello."'):
            self.assertFalse(read_script(line).moments[0].voiceover, line)


class VideoJobTests(unittest.TestCase):
    def test_change_something_keeps_the_video_person_and_changes_only_the_named_thing(self):
        for job in ("outfit", "thing"):
            text = write_prompt("He wears @1 in place of his blue cap.", seconds=8.0, jobs={1: job}, video="change something")
            self.assertIn("<Subject 2> is the person in <Video 1>, kept as they are", text)
            self.assertIn("[video editing + audio reuse] <Subject 2> wears <Subject 1> in place of his blue cap. Everything else in <Video 1> is kept.", text)
            self.assertIn("Retain the look of <Video 1>.", text)
            self.assertIn("<Subject 2> has the same words, mouth movements and moves as in <Video 1>.", text)
            self.assertIn("The original sound of <Video 1> continues throughout.", text)
            self.assertNotIn("selected for replacement", text)
            self.assertNotIn("No other words are spoken.", text)

    def test_change_something_reads_a_picture_left_as_person_as_what_he_puts_on(self):
        # A newcomer leaves Picture 1 on its opening job, person, and types plainly.
        for script in ("He wears @1 in place of his blue cap.", "He wears the propeller hat instead of his cap.",
                       "He is wearing a @1 now.", "He puts on the red scarf."):
            text = write_prompt(script, seconds=8.0, jobs={1: "person"}, video="change something")
            self.assertIn("<Subject 1> is the outfit in <Picture 1>.", text)
            self.assertIn("put only this outfit on <Subject 2>", text)
            self.assertNotIn("<Subject 1> is the person in <Picture 1>", text)
        text = write_prompt("He wears the propeller hat instead of his cap.", seconds=8.0, jobs={1: "person"}, video="change something")
        self.assertIn("[video editing + audio reuse] <Subject 2> wears <Subject 1> instead of his cap.", text)

    def test_change_something_keeps_a_person_picture_that_is_not_put_on(self):
        self.assertEqual(put_on_from_pictures("@1 stands next to him.", {1: "person"}), ("@1 stands next to him.", {1: "person"}))
        self.assertEqual(put_on_from_pictures("He waves.", {1: "person"}), ("He waves.", {1: "person"}))
        # Two pictures and no @ typed: nothing is guessed.
        self.assertEqual(put_on_from_pictures("He wears a hat.", {1: "person", 2: "person"}), ("He wears a hat.", {1: "person", 2: "person"}))
        self.assertEqual(put_on_from_pictures("He wears @2 and waves at @1.", {1: "person", 2: "person"})[1], {1: "person", 2: "outfit"})

    def test_change_something_keeps_the_clip_sound_with_the_switch_off(self):
        node = AusBossH3PromptWriter()
        frames = torch.zeros(40, 8, 8, 3)
        hat = torch.zeros(1, 8, 8, 3)
        self.assertTrue(node.write("He wears @1.", 6, picture_1=hat, video=frames, video_job="change something")[-1])
        self.assertFalse(node.write("@1 dances.", 6, picture_1=hat, video=frames, video_job="copy its moves")[-1])
        self.assertTrue(node.write("@1 dances.", 6, picture_1=hat, video=frames, video_job="copy its moves", clip_sound=True)[-1])
        self.assertFalse(node.write("@1 dances.", 6, picture_1=hat, clip_sound=True)[-1])

    def test_a_clip_that_keeps_its_sound_gets_no_score_from_the_music_box(self):
        node = AusBossH3PromptWriter()
        frames = torch.zeros(40, 8, 8, 3)
        hat = torch.zeros(1, 8, 8, 3)
        score = "a dark score with deep drum hits"
        edit = node.write("He wears @1.", 6, picture_1=hat, video=frames, video_job="change something", music=score)[0]
        swap = node.write("", 6, picture_1=hat, video=frames, video_job="swap the person", clip_sound=True, music=score)[0]
        moves = node.write("@1 dances.", 6, picture_1=hat, video=frames, video_job="copy its moves", music=score)[0]
        self.assertNotIn("dark score", edit)
        self.assertNotIn("dark score", swap)
        self.assertIn("dark score", moves.lower())

    def test_change_something_with_nothing_typed_says_what_to_type(self):
        with self.assertRaises(ValueError) as caught:
            write_prompt("", seconds=8.0, jobs={1: "outfit"}, video="change something")
        self.assertIn("Type what changes in the video", str(caught.exception))

    def test_a_hat_with_no_person_picture_points_to_change_something(self):
        for job in ("outfit", "thing"):
            cast = Cast(number_pictures({1: job}, "swap the person"), "swap the person")
            self.assertIn('pick the video job "change something"', cast.problem("He wears @1."))

    def test_copying_moves_keeps_the_performer_out(self):
        parts = parts_of("@1 dances on a rooftop.", jobs={1: "person"}, video="copy its moves")
        self.assertIn("<Subject 2> is the body motion in <Video 1>", parts["subject_definitions"])
        self.assertIn("<Video 1> provides the camera movement.", parts["subject_definitions"])
        self.assertIn("keep the source performer's face, body, clothes, props, background and colours out", parts["retention_analysis"])
        self.assertIn("<Subject 1> performs the same moves as <Subject 2>", parts["detailed_description"])
        self.assertIn("One continuous shot", parts["detailed_description"])

    def test_the_timeline_says_so_when_nothing_is_connected(self):
        self.assertIn("Connect a picture or a video", script_report("She runs.", 6, {})["warning"])
        self.assertEqual(script_report("She runs.", 6, {}, "copy its moves")["warning"], "")

    def test_copying_moves_with_no_person_picture_keeps_the_person_in_the_video(self):
        cast = Cast(number_pictures({1: "place"}, "copy its moves"), "copy its moves")
        self.assertEqual(cast.problem("She dances in @1."), "")
        parts = parts_of("She dances in @1.", jobs={1: "place"}, video="copy its moves")
        self.assertIn("<Subject 2> is the person in <Video 1>, with the same face, hair, body and clothes", parts["subject_definitions"])
        self.assertIn("the background of <Video 1> is not kept, and the place is <Subject 1>", parts["retention_analysis"])
        self.assertIn("<Subject 2> dances in <Subject 1>. <Subject 2> moves exactly as in <Video 1>", parts["detailed_description"])
        self.assertNotIn("performs the same moves as", parts["detailed_description"])

    def test_restyling_an_empty_clip_names_no_person_and_drops_the_look(self):
        parts = parts_of("It looks real, like @1.", jobs={1: "style"}, video="change something")
        self.assertIn("<Video 1> supplies the place, the action, the timing, the camera movement and the sound.", parts["subject_definitions"])
        self.assertNotIn("the person in <Video 1>", parts["subject_definitions"])
        self.assertNotIn("the look", parts["retention_analysis"])
        self.assertNotIn("Retain the look of <Video 1>", parts["detailed_description"])

    def test_an_edit_with_a_place_picture_takes_the_place_and_look_from_it(self):
        parts = parts_of("The hallway looks like @1.", jobs={1: "place"}, video="change something")
        self.assertIn("<Video 1> supplies the action, the timing, the camera movement and the sound.", parts["subject_definitions"])
        self.assertIn("the colours and the film grain of <Picture 1>", parts["detailed_description"])
        self.assertNotIn("is in the shot", parts["detailed_description"])

    def test_an_edit_about_someone_still_keeps_them(self):
        parts = parts_of("She looks real, like @1.", jobs={1: "style"}, video="change something")
        self.assertIn("is the person in <Video 1>, kept as they are", parts["subject_definitions"])
        self.assertIn("the person", parts["subject_definitions"].splitlines()[0])

    def test_copying_only_a_camera_move_names_no_person(self):
        parts = parts_of("The camera glides down @1.", jobs={1: "place"}, video="copy its moves")
        self.assertNotIn("the person in <Video 1>", parts["subject_definitions"])
        self.assertIn("apply only its camera movement", parts["retention_analysis"])
        self.assertNotIn("moves exactly as in", parts["detailed_description"])

    def test_a_thing_that_does_the_action_takes_the_moves(self):
        parts = parts_of("@1 waves its finger.", jobs={1: "thing"}, video="copy its moves")
        self.assertIn("<Subject 1> is the character in <Picture 1>, with the same shape, colours and drawing style.", parts["subject_definitions"])
        self.assertIn("apply only the body motion, choreography and timing to <Subject 1>", parts["retention_analysis"])
        self.assertIn("<Subject 1> performs the same moves as <Subject 2>", parts["detailed_description"])

    def test_a_thing_can_come_in_for_the_one_in_a_swap(self):
        parts = parts_of("@1 replaces the yellow hand.", jobs={1: "thing"}, video="swap the person")
        self.assertIn("<Subject 1> is the yellow hand in <Video 1>, selected for replacement.", parts["subject_definitions"])
        self.assertIn("has the shape, colours and drawing style of the character in <Picture 1>", parts["detailed_description"])
        self.assertEqual(script_report("", 6, {1: "thing"}, "swap the person")["warning"], "")

    def test_a_held_thing_stays_a_prop(self):
        parts = parts_of("He holds @1 and dances.", jobs={1: "thing"}, video="copy its moves")
        self.assertIn("<Subject 1> is the object in <Picture 1>", parts["subject_definitions"])
        self.assertIn("<Subject 2> moves exactly as in <Video 1>", parts["detailed_description"])

    def test_copying_moves_with_only_an_outfit_dresses_the_person_in_the_video(self):
        parts = parts_of("He wears @1.", jobs={1: "outfit"}, video="copy its moves")
        self.assertIn("the clothes change to <Subject 1>", parts["retention_analysis"])
        self.assertIn("keep its place unless the script names a new one", parts["retention_analysis"])

    def test_a_swap_with_nobody_to_put_in_says_so(self):
        with self.assertRaisesRegex(ValueError, "new person"):
            write_prompt("", jobs={}, video="swap the person")
        with self.assertRaisesRegex(ValueError, "new person"):
            write_prompt("", jobs={1: "place"}, video="swap the person")

    def test_a_swap_needs_no_words_and_keeps_the_video(self):
        parts = parts_of("", jobs={1: "person"}, video="swap the person")
        self.assertTrue(parts["summary"].startswith("[video editing] Replace <Subject 1> with <Subject 2>"))
        self.assertIn("<Subject 1>: removed", parts["retention_analysis"])
        self.assertLess(
            parts["subject_definitions"].index("<Subject 1> is the original person"),
            parts["subject_definitions"].index("<Subject 2> is the person in <Picture 1>"),
        )
        self.assertIn("<Video 1>: partially_preserved", parts["retention_analysis"])
        self.assertIn("the background of <Picture 1> is not transferred", parts["retention_analysis"])

    def test_a_connected_model_writes_the_new_persons_looks_in_a_swap(self):
        from nodes._h3_cast_helpers import add_looks
        asked = []

        def describe(slot):
            asked.append(slot)
            return '"A man with curly brown hair, wearing glasses."\nExtra line.'

        script = add_looks("Replace the guy with @1.", {1: "person"}, describe)
        self.assertEqual(script, "Replace the guy with @1.\n@1 looks like a man with curly brown hair, wearing glasses")
        self.assertEqual(asked, [1])
        text = write_prompt(script, seconds=8.0, jobs={1: "person"}, video="swap the person")
        self.assertIn("<Subject 2> has the defined appearance from <Picture 1>: a man with curly brown hair", text)
        # A typed line wins, places and empty answers add nothing.
        typed = "Replace the guy with @1.\n@1 looks like a tall woman."
        self.assertEqual(add_looks(typed, {1: "person"}, describe), typed)
        self.assertEqual(add_looks("Swap him for @1.", {1: "place"}, describe), "Swap him for @1.")
        self.assertEqual(add_looks("Swap him for @1.", {1: "person"}, lambda slot: ""), "Swap him for @1.")
        said = "a man with curly brown hair, wearing dark-framed glasses, and no visible beard or facial hair."
        self.assertEqual(add_looks("Swap him for @1.", {1: "person"}, lambda slot: said),
                         "Swap him for @1.\n@1 looks like a man with curly brown hair, wearing dark-framed glasses")

    def test_a_swap_reads_the_looks_sentence_on_the_same_line(self):
        from nodes._h3_cast_helpers import add_looks
        typed = "replace the girl on the car with @1 .@1 looks like a young woman with long dark hair"
        text = write_prompt(typed, seconds=8.0, jobs={1: "person"}, video="swap the person")
        self.assertIn("<Subject 1> is the girl on the car in <Video 1>", text)
        self.assertIn("this appearance: a young woman with long dark hair.", text)
        self.assertNotIn("looks like", text)
        # A typed sentence still wins over the model, wherever it sits on the line.
        self.assertNotIn("bald", add_looks(typed, {1: "person"}, lambda slot: "a bald man"))
        # A spoken line that happens to hold the words is left alone.
        said = 'Replace the guy with @1.\n@1 says: "He said @1 looks like trouble."'
        self.assertNotIn("this appearance", write_prompt(said, seconds=8.0, jobs={1: "person"}, video="swap the person"))
        # Only a new sentence is split off: inside a sentence the words are left where they are.
        from nodes._h3_cast_helpers import looks_on_own_lines
        self.assertEqual(looks_on_own_lines("Put @1 looks like a friend here."), "Put @1 looks like a friend here.")
        self.assertEqual(looks_on_own_lines("Swap him for @1! @1 looks like a pilot"), "Swap him for @1!\n@1 looks like a pilot")

    def test_a_swap_reads_clothes_typed_on_their_own_line(self):
        swap = dict(seconds=8.0, jobs={1: "person"}, video="swap the person")
        text = write_prompt("Replace the man in the checked shirt with @1.\n@1 is wearing a black suit.", **swap)
        self.assertIn("this appearance: the same hair, wearing a black suit.", text)
        both = "Replace the guy with @1.\n@1 looks like a man with short dark hair.\n@1 wears a black suit."
        self.assertIn("this appearance: a man with short dark hair, wearing a black suit.", write_prompt(both, **swap))

    def test_a_swap_gets_the_firm_wording_without_a_looks_like_line(self):
        text = write_prompt("Replace the guy with @1.", seconds=8.0, jobs={1: "person"}, video="swap the person")
        self.assertIn("<Subject 2> has the face, hair and clothes of the person in <Picture 1>", text)
        self.assertIn("stays present throughout, from the first frame", text)
        self.assertIn("Do not show the guy in that role at any time", text)

    def test_a_swap_with_a_model_adds_no_moments(self):
        node = AusBossH3PromptWriter()
        calls = []
        import nodes.node_h3_prompt_writer as writer
        real = writer.model_asker
        writer.model_asker = lambda clip, image: (lambda question, longest: calls.append(question) or "a woman with a dark bob")
        try:
            text = node.write("Swap the woman for @1.", 6, clip=object(), picture_1=torch.zeros(1, 8, 8, 3),
                              video=torch.zeros(40, 8, 8, 3), video_job="swap the person")[0]
        finally:
            writer.model_asker = real
        self.assertEqual(len(calls), 1)
        self.assertIn("a woman with a dark bob", text)
        self.assertNotIn("[Shot 2]", text)

    def test_a_plain_swap_sentence_names_only_who_goes(self):
        for script, who in (
            ("Replace the man in the red shirt with @1.", "the man in the red shirt"),
            ("swap the guy with @1", "the guy"),
            ("swap out the guy in the hat for @1 in the clip", "the guy in the hat"),
            ("the cashier is now @1", "the cashier"),
            ("make the dancer look like @1", "the dancer"),
            ("swap @1 in for the drummer", "the drummer"),
            ("Replace the woman with black hair with @1.\n@1 looks like a woman with platinum hair.", "the woman with black hair"),
        ):
            text = write_prompt(script, seconds=8.0, jobs={1: "person"}, video="swap the person")
            self.assertIn(f"<Subject 1> is {who} in <Video 1>, selected for replacement.", text)
            self.assertNotIn("@1", text)

    def test_typed_words_in_a_swap_say_who_goes(self):
        parts = parts_of("The child in the seat.", jobs={1: "person"}, video="swap the person")
        self.assertIn("<Subject 1> is the child in the seat in <Video 1>", parts["subject_definitions"])
        self.assertIn("replace the child in the seat with <Subject 2>", parts["retention_analysis"])
        self.assertIn("Everyone else stays", parts["detailed_description"])
        self.assertNotIn("Show one person", parts["detailed_description"])

    def test_a_swap_with_two_people_puts_each_in_one_place(self):
        parts = parts_of("", jobs={1: "person", 2: "person"}, video="swap the person")
        self.assertIn("Replace <Subject 1> with <Subject 3> and <Subject 2> with <Subject 4>", parts["summary"])
        self.assertIn("<Subject 1> is the person on the left in <Video 1>", parts["subject_definitions"])
        self.assertIn("<Subject 2> is the person on the right in <Video 1>", parts["subject_definitions"])
        self.assertIn("<Subject 4> is the person in <Picture 2>", parts["subject_definitions"])
        self.assertIn("replace the person on the right with <Subject 4>", parts["retention_analysis"])
        self.assertIn("change only the people", parts["retention_analysis"])
        self.assertIn("<Subject 4> occupies the starting position of the person on the right", parts["detailed_description"])
        self.assertIn("<Subject 4> has the face, hair and clothes of the person in <Picture 2>", parts["detailed_description"])
        self.assertNotIn("Show one person", parts["detailed_description"])

    def test_a_swap_with_two_people_reads_who_goes_from_the_script(self):
        for script in ("@2 is the woman in red. @1 replaces the man in the hat", "The man in the hat.\nThe woman in red."):
            parts = parts_of(script, jobs={1: "person", 2: "character sheet"}, video="swap the person")
            self.assertIn("replace the man in the hat with <Subject 3>", parts["retention_analysis"])
            self.assertIn("replace the woman in red with <Subject 4>", parts["retention_analysis"])
            self.assertNotIn("@", join_sections(parts))

    def test_one_swap_takes_the_at_out_of_who_goes(self):
        parts = parts_of("@1 replaces the child in the seat", jobs={1: "person"}, video="swap the person")
        self.assertIn("replace the child in the seat with <Subject 2>", parts["retention_analysis"])

    def test_a_swap_reads_who_goes_out_of_a_longer_line(self):
        parts = parts_of("Elon is @1, he replaces the person at the counter", jobs={1: "person"}, video="swap the person")
        self.assertIn("<Subject 1> is the person at the counter in <Video 1>", parts["subject_definitions"])
        self.assertNotIn("Elon", join_sections(parts))
        parts = parts_of("Elon is @1", jobs={1: "person"}, video="swap the person")
        self.assertIn("<Subject 1> is the original person in <Video 1>", parts["subject_definitions"])
        script = "Elon is @1, he replaces the man on the left. Sam is @2, she takes the place of the woman in red"
        parts = parts_of(script, jobs={1: "person", 2: "person"}, video="swap the person")
        self.assertIn("replace the man on the left with <Subject 3>", parts["retention_analysis"])
        self.assertIn("replace the woman in red with <Subject 4>", parts["retention_analysis"])

    def test_a_swap_carries_the_words_in_quotes_onto_the_lips(self):
        script = 'Elon is @1, he replaces the person at the counter.\n@1 says "Welcome in, what can I get you?"'
        parts = parts_of(script, jobs={1: "person"}, video="swap the person")
        self.assertIn("<Subject 1> is the person at the counter in <Video 1>", parts["subject_definitions"])
        line = parts["detailed_description"]
        self.assertIn("<d>[English] Welcome in, what can I get you?</d>", line)
        self.assertIn("<Subject 2> (S1) says, each word landing exactly on the lip movement of <Video 1>", line)
        self.assertNotIn("Elon", join_sections(parts))

    def test_a_swap_gives_each_named_person_their_own_words(self):
        script = (
            "Altman is @1, the man on the left. Dario is @2, the man on the right.\n"
            'Dario says "We should talk."\nAltman says "Again?"\nHe says "Fine."'
        )
        parts = parts_of(script, jobs={1: "person", 2: "person"}, video="swap the person")
        self.assertIn("replace the man on the left with <Subject 3>", parts["retention_analysis"])
        self.assertIn("replace the man on the right with <Subject 4>", parts["retention_analysis"])
        line = parts["detailed_description"]
        self.assertIn("<Subject 4> (S1) says, each word landing exactly on the lip movement of <Video 1>, <d>[English] We should talk.</d>", line)
        self.assertIn("<Subject 3> (S2) says, each word landing exactly on the lip movement of <Video 1>, <d>[English] Again?</d>", line)
        self.assertIn("<Subject 3> (S2) says, each word landing exactly on the lip movement of <Video 1>, <d>[English] Fine.</d>", line)
        parts = parts_of("Altman is @1, the man on the left, Dario is @2, the man on the right", jobs={1: "person", 2: "person"}, video="swap the person")
        self.assertIn("replace the man on the left with <Subject 3>", parts["retention_analysis"])

    def test_a_thing_in_a_swap_speaks_from_off_screen(self):
        script = '@1 replaces the man at the till.\nThe card reader beeps and says "Card declined."\n@1 says "Again?"'
        line = parts_of(script, jobs={1: "person"}, video="swap the person")["detailed_description"]
        self.assertIn("card reader (S2) says from off screen, <d>[English] Card declined.</d> Nobody on screen moves", line)
        self.assertIn("<Subject 2> (S1) says, each word landing exactly on the lip movement of <Video 1>, <d>[English] Again?</d>", line)

    def test_a_person_off_screen_in_a_swap_gets_their_own_voice(self):
        for said_by, voice in (('A woman off screen says', "A woman"), ('The cashier, off camera, says', "The cashier"),
                               ('Someone behind the camera yells', "Someone"), ('Mom (O.S.) says', "Mom")):
            script = f'@1 replaces the man at the till.\n{said_by} "Card declined."\n@1 says "Again?"'
            line = parts_of(script, jobs={1: "person"}, video="swap the person")["detailed_description"]
            self.assertIn(f"{voice} (S2) says from off screen, <d>[English] Card declined.</d> Nobody on screen moves", line)
            self.assertIn("<Subject 2> (S1) says, each word landing exactly on the lip movement of <Video 1>, <d>[English] Again?</d>", line)
            self.assertNotIn("<Subject 2> (S1) says in an off-screen voiceover", line)

    def test_a_person_off_screen_is_not_the_person_on_screen(self):
        line = parts_of('@1 stands at the till.\nA woman off screen says "Card declined."\n@1 says "Again?"', jobs={1: "person"})["detailed_description"]
        self.assertIn("a woman (S2) says from off screen, <d>[English] Card declined.</d>", line)
        self.assertIn("<Subject 1> (S1) says, <d>[English] Again?</d>", line)
        self.assertNotIn("woman stays silent", line)

    def test_a_thing_marked_off_screen_speaks_for_itself_in_every_mode(self):
        for video in ("", "copy its moves"):
            script = '@1 stands at the till.\nA card reader off screen says "Card declined."\n@1 says "Again?"'
            line = parts_of(script, jobs={1: "person"}, video=video)["detailed_description"]
            self.assertIn("a card reader (S2) says from off screen, <d>[English] Card declined.</d> Nobody on screen moves", line)
            self.assertNotIn("<Subject 1> (S1) says in an off-screen voiceover", line)

    def test_an_unnamed_voiceover_stays_the_main_persons(self):
        for script in ('@1 stands at the till.\nVoiceover: "I was broke."', '@1 stands at the till.\n@1, off screen, says "I was broke."',
                       '@1 stands at the till.\nShe says off camera "I was broke."'):
            line = parts_of(script, jobs={1: "person"})["detailed_description"]
            self.assertIn("<Subject 1> (S1) says in an off-screen voiceover, <d>[English] I was broke.</d>", line)

    def test_a_swap_can_keep_the_clips_clothes(self):
        for script in ('@1 replaces the girl in the hoodie and keeps her outfit.', "@1 replaces the girl in the hoodie, in the clip's clothes.",
                       '@1 replaces the girl in the hoodie.\nKeep the clothes from the video.'):
            parts = parts_of(script, jobs={1: "person"}, video="swap the person")
            self.assertIn("<Subject 1> is the girl in the hoodie in <Video 1>, selected for replacement.", parts["subject_definitions"])
            self.assertIn("<Subject 2> is the person in <Picture 1>, with the same face and hair, wearing the clothes of the girl in the hoodie in <Video 1>.",
                          parts["subject_definitions"])
            self.assertIn("the clothes of the girl in the hoodie in <Video 1> stay as they are", parts["retention_analysis"])
            self.assertNotIn("same face, hair and clothes", parts["subject_definitions"])

    def test_a_swap_wears_the_pictures_clothes_unless_told(self):
        for script in ('@1 replaces the girl in the hoodie.', '@1 replaces the girl in the hoodie and keeps her own clothes.'):
            parts = parts_of(script, jobs={1: "person"}, video="swap the person")
            self.assertIn("<Subject 2> is the person in <Picture 1>, with the same face, hair and clothes.", parts["subject_definitions"])

    def test_how_a_swap_line_is_said_stays_out_of_who_says_it(self):
        script = '@1 replaces the man at the till.\nThe card reader says in a flat robot voice "Card declined."'
        line = parts_of(script, jobs={1: "person"}, video="swap the person")["detailed_description"]
        self.assertIn("card reader (S1) says in a flat robot voice from off screen, <d>[English] Card declined.</d>", line)
        self.assertNotIn("reader says in", line)

    def test_a_swap_line_keeps_the_decimals_of_its_time(self):
        for script in ('@1 replaces the man at the till.\n3.2s: @1 says "Again?"', '@1 replaces the man at the till.\nAt 3.2 seconds @1 says "Again?"',
                       '@1 replaces the man at the till.\nThe card reader, at 3.2s, says "Card declined."'):
            line = parts_of(script, jobs={1: "person"}, video="swap the person", seconds=8)["detailed_description"]
            self.assertIn("At 00:03.200,", line)
        self.assertEqual(read_script("1.5s: she waves").moments[-1].at, 1.5)

    def test_a_swap_line_that_raps_keeps_the_verb_out_of_who_goes(self):
        parts = parts_of('@1 replaces the man on the left.\n@2 replaces the man on the right and raps "Yo, yo."', jobs={1: "person", 2: "person"}, video="swap the person")
        self.assertIn("replace the man on the right with <Subject 4>", parts["retention_analysis"])
        self.assertNotIn("and raps", join_sections(parts))
        self.assertIn("replace the man on the left with <Subject 3>", parts["retention_analysis"])
        self.assertIn("<Subject 4> (S1) says, each word landing", parts["detailed_description"])

    def test_a_swap_with_a_voice_takes_its_words(self):
        parts = parts_of('@1 replaces the man in the hat. He says "Hi there."', jobs={1: "person"}, video="swap the person", voice=True)
        self.assertIn("replace the man in the hat with <Subject 2>", parts["retention_analysis"])
        self.assertIn("voice timbre referenced from <Audio 1>, each word landing exactly on the lip movement of <Video 1>", parts["detailed_description"])
        self.assertIn("<d>[English] Hi there.</d>", parts["detailed_description"])

    def test_keeping_going_needs_no_words_and_no_picture(self):
        parts = parts_of("", jobs={}, video="keep going")
        self.assertTrue(parts["summary"].startswith("[video continuation]"))
        self.assertIn("The action keeps going the way it was heading", parts["detailed_description"])
        self.assertNotIn("<Audio", join_sections(parts))

    def test_keeping_going_carries_the_sound_on_and_counts_it(self):
        parts = parts_of('she says "hello"', jobs={}, video="keep going", soundtrack=True, voice=True)
        self.assertTrue(parts["summary"].startswith("[video continuation + audio reference]"))
        self.assertIn("<Audio 1> is the soundtrack of <Video 1>", parts["subject_definitions"])
        self.assertIn("<Audio 2> is the voice-timbre reference", parts["subject_definitions"])

    def test_a_new_voice_lands_on_the_lips(self):
        parts = parts_of('she says "hello"', jobs={}, video="new voice", voice=True)
        self.assertTrue(parts["summary"].startswith("[video editing + audio reference]"))
        self.assertIn("each word landing exactly on the lip movement of <Video 1>", parts["detailed_description"])
        self.assertIn("Quiet room tone", parts["overall_soundscape"])

    def test_a_swap_keeps_every_line_the_new_person_says(self):
        script = (
            "Replace the young man in the black t-shirt with @1.\n"
            '@1 holds a phone up and says: "How do I get rich?" The phone answers: "Get a job." '
            '@1 looks up, confused, and says: "Bro, what are they talking about?"'
        )
        text = write_prompt(script, seconds=8.0, jobs={1: "person"}, video="swap the person")
        self.assertEqual(re.findall(r"<d>\[English\] (.*?)</d>", text),
                         ["How do I get rich?", "Get a job.", "Bro, what are they talking about?"])
        # With the clip's sound kept, the phone's words come from the clip and only the new person's own lines are written.
        text = write_prompt(script, seconds=8.0, jobs={1: "person"}, video="swap the person", clip_sound=True)
        self.assertEqual(re.findall(r"<d>\[English\] (.*?)</d>", text), ["How do I get rich?", "Bro, what are they talking about?"])

    def test_a_looks_line_keeps_only_the_looks(self):
        script = (
            "Replace the young man with @1.\n"
            "@1 looks like a cartoon wooden log, no clothes. The trees behind @1 stay the same."
        )
        parts = parts_of(script, jobs={1: "person"}, video="swap the person")
        self.assertIn("this appearance: a cartoon wooden log, no clothes. The background", parts["subject_definitions"])
        self.assertNotIn("trees", parts["subject_definitions"])
        for name, part in parts.items():
            self.assertNotRegex(part, r"@\d", name)

    def test_a_video_needs_words_unless_it_can_go_without(self):
        with self.assertRaises(ValueError):
            write_prompt("", jobs={1: "person"}, video="copy its moves")


class AskTests(unittest.TestCase):
    def ask(self, moments="She lifts off the ground.\nBats scatter around her.\nShe vanishes into the sky.", sound="Wind in the grass, distant bats."):
        self.asked = []

        def answer(question, longest):
            self.asked.append(question)
            return sound if "List the sounds" in question else moments

        return answer

    def test_a_one_line_idea_gets_moments_after_it(self):
        line = shots("she flies away", seconds=10, ask=self.ask())[0]
        self.assertEqual(count_moments(line), 4)
        self.assertIn("<Subject 1> flies away.", line)
        self.assertIn("At 00:02.500, <Subject 1> lifts off the ground.", line)

    def test_it_asks_for_what_the_clip_has_time_for(self):
        shots("she flies away", seconds=15, ask=self.ask())
        self.assertIn("Write 5 short lines", self.asked[0])
        shots("she flies away", seconds=5, ask=self.ask())
        self.assertIn("Write 1 short lines", self.asked[0])

    def test_it_never_goes_past_that_number(self):
        self.assertEqual(count_moments(shots("she flies away", seconds=5, ask=self.ask())[0]), 2)

    def test_lines_someone_typed_are_left_alone(self):
        text = write_prompt(LINES, ask=self.ask())
        self.assertNotIn("Bats", text)
        self.assertEqual(sum(question.startswith("This is a") for question in self.asked), 0)

    def test_numbers_and_bullets_come_off(self):
        lines = shots("she flies away", seconds=10, ask=self.ask(moments="1. She rises.\n- She turns around.\n3) She vanishes from sight."))
        self.assertIn("<Subject 1> turns around.", lines[0])

    def test_a_bad_answer_costs_nothing(self):
        for moments in ("", "ok", "a" * 3, "word " * 40, 'She says "hello there."', "She flies away."):
            self.assertEqual(count_moments(shots("she flies away", seconds=10, ask=self.ask(moments=moments))[0]), 1, moments)

    def test_a_line_that_fails_is_left_out_and_the_rest_stay(self):
        lines = shots("she flies away", seconds=10, ask=self.ask(moments='She rises.\nShe says "bye."\nShe vanishes from sight.'))
        self.assertEqual(count_moments(lines[0]), 3)

    def test_the_small_model_reads_each_picture_by_its_job(self):
        asked = []

        def ask(question, longest):
            asked.append(question)
            return "She stands up."

        write_prompt("@1 sits in @2 wearing @3.", seconds=10, ask=ask, jobs={1: "person", 2: "place", 3: "outfit"})
        self.assertIn("the person sits in the place wearing the outfit", asked[0])

    def test_the_small_model_sees_the_scene_and_never_a_persons_photo(self):
        pictures = {1: "photo", 2: "laundry"}
        self.assertEqual(node_h3_prompt_writer.fill_picture(pictures, {1: "person", 2: "place"}), "laundry")
        self.assertEqual(node_h3_prompt_writer.fill_picture({1: "photo"}, {1: "start on it"}), "photo")
        self.assertIsNone(node_h3_prompt_writer.fill_picture({1: "photo"}, {1: "person"}))

    def test_a_spoken_line_is_not_filled_in(self):
        self.assertEqual(count_moments(shots('she says "hello"', seconds=10, ask=self.ask())[0]), 1)

    def test_the_model_hears_the_script_without_at_numbers(self):
        write_prompt("@1 runs through a forest", seconds=10, jobs={1: "person"}, ask=self.ask())
        self.assertIn("the person runs through a forest", self.asked[-1].lower())
        self.assertNotIn("@1", "".join(self.asked))

    def test_the_sound_fits_the_place(self):
        self.assertEqual(split_sections(write_prompt(LINES, ask=self.ask()))["overall_soundscape"], "Wind in the grass, distant bats.")
        self.assertIn("She lowers the camera", self.asked[-1])

    def test_typed_sound_stays_and_silence_stays(self):
        self.assertEqual(split_sections(write_prompt("sound: rain\n" + LINES, ask=self.ask()))["overall_soundscape"], "Rain.")
        self.assertEqual(split_sections(write_prompt("no sound\n" + LINES, ask=self.ask()))["overall_soundscape"], "N/A")

    def test_a_bad_sound_answer_keeps_the_stock_line(self):
        plain = split_sections(write_prompt(LINES))["overall_soundscape"]
        for sound in ("", "wind", "word " * 40, 'She says "hello."'):
            self.assertEqual(split_sections(write_prompt(LINES, ask=self.ask(sound=sound)))["overall_soundscape"], plain, sound)

    def test_six_parts_are_never_asked_about(self):
        write_prompt(SIX, ask=self.ask())
        self.assertEqual(self.asked, [])


class SongTests(unittest.TestCase):
    BEATS = [0.3 + 0.7 * index for index in range(16)]

    def test_song_replaces_the_score_and_the_ambience(self):
        parts = split_sections(write_prompt(LINES, song_beats=self.BEATS))
        self.assertIn("<Audio 1> is the complete source soundtrack", parts["subject_definitions"])
        self.assertIn("Every moment lands on a beat of <Audio 1>.", parts["summary"])
        self.assertTrue(parts["summary"].startswith("[reference generation + audio reuse]"))
        self.assertIn("<Audio 1>: fully_copy", parts["retention_analysis"])
        self.assertEqual(parts["overall_soundscape"], "N/A")
        self.assertEqual(parts["non_diegetic_music"], "<Audio 1> is directly reused as the complete audience-only score.")

    def test_moments_and_cuts_move_to_the_nearest_beat(self):
        lines = shots("a\nb\n\nc", seconds=9, song_beats=self.BEATS)
        self.assertIn("At 00:03.100, B.", lines[0])
        self.assertIn("[Shot 2] At 00:05.900, the camera cuts on the beat to", lines[1])

    def test_they_stay_in_order_and_apart(self):
        detail = "[Shot 2] At 00:01.000, a\n[Shot 3] At 00:01.100, b"
        self.assertEqual(snap_cuts(detail, [1.0, 1.2, 1.5]), "[Shot 2] At 00:01.000, a\n[Shot 3] At 00:01.500, b")

    def test_no_beats_keep_the_seconds(self):
        text = write_prompt(LINES, seconds=6, song_beats=[])
        self.assertIn("At 00:02.000,", text)
        self.assertIn("<Audio 1>: fully_copy", text)

    def test_with_a_voice_h3_hears_no_song(self):
        parts = split_sections(write_prompt(SAYS, voice=True, song_beats=self.BEATS))
        self.assertIn("<Audio 1> is the voice-timbre", parts["subject_definitions"])
        self.assertNotIn("<Audio 2>", join_sections(parts))
        self.assertEqual(parts["non_diegetic_music"], "N/A")
        self.assertNotEqual(parts["overall_soundscape"], "N/A")
        self.assertTrue(parts["summary"].startswith("[reference generation + audio reference]"))

    def test_minutes_carry_over(self):
        self.assertIn("At 01:00.100,", snap_cuts("[Shot 2] At 00:59.900, a", [60.1]))

    def test_six_parts_take_a_song_and_a_voice_too(self):
        for voice in (False, True):
            for song in (None, [2.0, 4.0, 6.0]):
                text = write_prompt(SIX, voice=voice, song_beats=song)
                self.assertIsNotNone(split_sections(text))


class WarningTests(unittest.TestCase):
    def test_what_a_camera_cant_see_is_named(self):
        self.assertIn('"feels"', script_warning(read_script("She feels happy."), 8))

    def test_words_someone_says_are_left_alone(self):
        self.assertEqual(script_warning(read_script('She says "I think we are late."'), 8), "")

    def test_a_plain_script_has_no_warning(self):
        self.assertEqual(script_warning(read_script(LINES), 8), "")

    def test_a_line_too_long_for_its_moment_says_so(self):
        line = 'She says "' + "word " * 12 + '"\nShe runs.'
        self.assertIn("takes about 4 seconds", script_warning(read_script(line), 5))
        self.assertEqual(script_warning(read_script(line), 15), "")


class ShapeTests(unittest.TestCase):
    def test_every_mix_stays_six_parts(self):
        for voice in (False, True):
            for song in (None, [2.0, 4.0, 6.0]):
                for look in ("", "anime", "comic book"):
                    for camera in ("", "handheld"):
                        for text in (SAYS, 'she walks\n\nshe says "hello"'):
                            done = write_prompt(text, voice=voice, song_beats=song, look=look, camera=camera)
                            parts = split_sections(done)
                            self.assertIsNotNone(parts)
                            self.assertNotIn("\n\n", parts["detailed_description"])
                            self.assertNotIn("  ", done)
                            self.assertEqual(done.count("<d>"), 1)


class BeatTests(unittest.TestCase):
    def test_click_tracks_land_on_the_clicks(self):
        for bpm in (70, 84.7, 100, 128):
            beats = find_beats(clicks(bpm), 22050)
            self.assertAlmostEqual(beats[1] - beats[0], 60 / bpm, delta=0.01, msg=bpm)
            nearest = min(abs(beat - 0.31) for beat in beats)
            self.assertLess(nearest, 0.03, bpm)

    def test_the_rate_does_not_matter(self):
        low = find_beats(clicks(100), 22050)
        high = find_beats(clicks(100, rate=44100), 44100)
        self.assertLess(abs(low[0] - high[0]), 0.03)

    def test_silence_has_no_beats(self):
        self.assertEqual(find_beats(np.zeros(44100), 44100), [])

    def test_a_tiny_clip_has_no_beats(self):
        self.assertEqual(find_beats(np.ones(100), 44100), [])


class NodeTests(unittest.TestCase):
    def audio(self, seconds=15.0):
        return {"waveform": torch.from_numpy(clicks(100, seconds=seconds)).reshape(1, 1, -1).repeat(1, 2, 1), "sample_rate": 22050}

    def test_a_connected_model_is_asked_with_the_picture(self):
        class Output:
            result = ("Wind in the grass.",)

        class Generate:
            calls = []

            @classmethod
            def execute(cls, **given):
                cls.calls.append(given)
                return Output

        keep = node_h3_prompt_writer._core_nodes
        node_h3_prompt_writer._core_nodes = lambda: {"TextGenerate": Generate}
        try:
            picture = torch.zeros(1, 8, 8, 3)
            text = AusBossH3PromptWriter().write("she runs\nshe stops", 6, clip="the clip", picture_1=picture, job_1="start on it")[0]
        finally:
            node_h3_prompt_writer._core_nodes = keep
        self.assertIn("Wind in the grass.", text)
        self.assertEqual((Generate.calls[0]["clip"], Generate.calls[0]["image"]), ("the clip", picture))

    def test_no_generate_text_says_so(self):
        with self.assertRaisesRegex(RuntimeError, "Generate Text"):
            AusBossH3PromptWriter().write("she runs", 6, clip="the clip")

    def test_the_length_is_one_h3_can_make(self):
        self.assertEqual([clip_frames(seconds) for seconds in (5, 10, 15)], [124, 243, 362])
        for seconds in range(5, 16):
            self.assertEqual((clip_frames(seconds) - 5) % 17, 0)

    def test_connected_means_on(self):
        node = AusBossH3PromptWriter()
        text, *pictures, video, video_sound, voice, song, under, frames, width, height, keeps = node.write(LINES, 6, picture_1=PICTURE)
        self.assertFalse(keeps)
        self.assertIs(pictures[0], PICTURE)
        self.assertEqual(pictures[1:], [None, None, None])
        self.assertIsNone(video)
        self.assertIsNone(video_sound)
        self.assertNotIn("<Audio", text)
        self.assertIsNone(voice)
        self.assertIsNone(song)
        self.assertIsNone(under)
        self.assertEqual(frames, 141)
        self.assertIn("<Audio 1>", node.write(SAYS, 6, picture_1=PICTURE, voice=self.audio())[0])

    def test_an_edited_full_prompt_is_sent_and_the_written_one_shown(self):
        node = AusBossH3PromptWriter()
        written = node.write(LINES, 6, picture_1=PICTURE)
        plain = node.run(LINES, 6, picture_1=PICTURE)
        self.assertEqual(plain["ui"]["written_prompt"], [written[0]])
        self.assertEqual(plain["result"][0], written[0])
        self.assertEqual(plain["result"][1:11], written[1:11])
        edited = node.run(LINES, 6, picture_1=PICTURE, full_prompt="my own prompt\nno push in")
        self.assertEqual(edited["result"][0], "my own prompt\nno push in")
        self.assertEqual(edited["ui"]["written_prompt"], [written[0]])
        self.assertEqual(edited["result"][11], written[11])
        self.assertEqual(node.run(LINES, 6, picture_1=PICTURE, full_prompt="  \n")["result"][0], written[0])

    def test_the_picks_that_change_nothing_add_nothing(self):
        node = AusBossH3PromptWriter()
        self.assertEqual(node.write(LINES, 6, picture_1=PICTURE)[0], node.write(LINES, 6, picture_1=PICTURE, camera="as typed", look="from the picture")[0])

    def test_the_voice_is_held_to_15_seconds(self):
        voice = AusBossH3PromptWriter().write(SAYS, 6, picture_1=PICTURE, voice=self.audio(40.0))[VOICE]
        self.assertEqual(voice["waveform"].shape, (1, 2, 15 * 22050))

    def test_the_song_is_cut_to_the_clip_from_its_start(self):
        audio = self.audio(30.0)
        song = AusBossH3PromptWriter().write(LINES, 10, picture_1=PICTURE, song=audio, song_start=5.0)[SONG]
        self.assertEqual(song["waveform"].shape, (1, 2, round(10.125 * 22050)))
        self.assertTrue(torch.equal(song["waveform"][..., 0], audio["waveform"][..., 5 * 22050]))

    def test_a_song_shorter_than_its_start_says_so(self):
        with self.assertRaisesRegex(ValueError, "earlier start"):
            AusBossH3PromptWriter().write(LINES, 6, picture_1=PICTURE, song=self.audio(5.0), song_start=9.0)

    def test_the_beat_is_read_from_the_part_that_plays(self):
        audio = self.audio(30.0)
        whole = AusBossH3PromptWriter().write(LINES, 10, picture_1=PICTURE, song=audio)[0]
        moved = AusBossH3PromptWriter().write(LINES, 10, picture_1=PICTURE, song=audio, song_start=0.2)[0]
        self.assertNotEqual(whole, moved)

    def test_song_is_read_for_its_beat(self):
        text = AusBossH3PromptWriter().write("a\n\nb", 10, picture_1=PICTURE, song=self.audio())[0]
        self.assertIn("cuts on the beat to", text)
        self.assertNotIn("At 00:05.000", text)

    def test_with_a_voice_the_song_goes_under_the_clip(self):
        audio = self.audio(30.0)
        text, *_, voice, song, under, _, _, _, _ = AusBossH3PromptWriter().write(SAYS, 10, picture_1=PICTURE, voice=self.audio(), song=audio)
        self.assertNotIn("<Audio 2>", text)
        self.assertIsNotNone(voice)
        self.assertIsNone(song)
        self.assertEqual(under["waveform"].shape, (1, 2, round(10.125 * 22050)))
        self.assertLess(under["waveform"].abs().max(), audio["waveform"].abs().max())

    def under_level(self, peak):
        noise = np.random.default_rng(0).uniform(-peak, peak, (1, 2, 11 * 22050)).astype(np.float32)
        under = AusBossH3PromptWriter().write(
            SAYS, 10, picture_1=PICTURE, voice=self.audio(), song={"waveform": torch.from_numpy(noise), "sample_rate": 22050}
        )[UNDER]
        return under["waveform"].pow(2).mean().sqrt().item()

    def test_a_loud_and_a_soft_master_sit_at_the_same_level(self):
        self.assertAlmostEqual(self.under_level(0.9), 0.035, places=3)
        self.assertAlmostEqual(self.under_level(0.2), 0.035, places=3)

    def test_a_quiet_song_is_not_turned_up(self):
        self.assertLess(self.under_level(0.01), 0.01)

    def test_without_a_voice_the_song_goes_to_h3(self):
        text, *_, song, under, _, _, _, _ = AusBossH3PromptWriter().write(LINES, 6, picture_1=PICTURE, song=self.audio())
        self.assertIsNotNone(song)
        self.assertIsNone(under)
        self.assertIn("<Audio 1>: fully_copy", text)

    def test_pictures_come_out_in_the_order_the_prompt_counts_them(self):
        a, d = torch.zeros(1, 8, 8, 3), torch.ones(1, 8, 8, 3)
        text, one, two, three, four, *_ = AusBossH3PromptWriter().write("@1 sits in @4", 6, picture_1=a, picture_4=d, job_4="place")
        self.assertEqual((one, two, three, four), (a, d, None, None))
        self.assertIn("<Subject 2> is the place in <Picture 2>", text)

    def test_with_nothing_connected_it_says_so(self):
        with self.assertRaisesRegex(ValueError, "Connect a picture or a video"):
            AusBossH3PromptWriter().write("We walk in.", 6)

    def test_a_pasted_prompt_needs_nothing_connected(self):
        output = AusBossH3PromptWriter().write(SIX, 6)
        self.assertEqual(output[0], SIX)
        self.assertEqual(output[-3:-1], (1344, 756))

    def test_a_video_comes_out_with_its_job(self):
        frames = torch.zeros(100, 8, 8, 3)
        picture = torch.zeros(1, 8, 8, 3)
        output = AusBossH3PromptWriter().write("@1 dances.", 6, picture_1=picture, video=frames, video_sound=self.audio())
        self.assertIn("<Video 1>", output[0])
        self.assertIs(output[5], frames)
        self.assertIsNone(output[6])

    def test_only_keep_going_hands_on_the_sound(self):
        sound = self.audio()
        output = AusBossH3PromptWriter().write("", 6, video=torch.zeros(100, 8, 8, 3), video_sound=sound, video_job="keep going")
        self.assertEqual(output[6]["sample_rate"], sound["sample_rate"])

    def test_keep_going_hands_on_only_the_end_of_the_clip(self):
        frames = torch.arange(100.0).reshape(100, 1, 1, 1).repeat(1, 2, 2, 3)
        sound = {"waveform": torch.arange(48000.0).reshape(1, 1, -1), "sample_rate": 12000}
        output = AusBossH3PromptWriter().write("", 6, video=frames, video_sound=sound, video_job="keep going")
        video, heard = output[5], output[6]
        self.assertEqual(video.shape[0], 44)
        self.assertEqual(float(video[-1, 0, 0, 0]), 99.0)
        self.assertEqual(heard["waveform"].shape[-1], 22000)
        self.assertEqual(float(heard["waveform"][0, 0, -1]), 47999.0)

    def test_the_clip_takes_the_shape_of_the_video_or_else_the_first_picture(self):
        node = AusBossH3PromptWriter()
        tall = torch.zeros(1, 736, 560, 3)
        wide = torch.zeros(1, 480, 832, 3)
        video = torch.zeros(100, 720, 1280, 3)
        self.assertEqual(node.write("@1 sits in @2.", 6, picture_1=tall, picture_2=wide, job_2="place")[-3:-1], (560, 736))
        self.assertEqual(node.write("@2 waves.", 6, picture_2=wide, job_2="person")[-3:-1], (832, 480))
        self.assertEqual(node.write("@1 dances.", 6, picture_1=tall, video=video)[-3:-1], (1280, 720))

    def test_a_short_clip_keeps_all_it_has(self):
        frames = torch.zeros(20, 2, 2, 3)
        self.assertEqual(AusBossH3PromptWriter().write("", 6, video=frames, video_job="keep going")[5].shape[0], 20)

    def test_a_swap_keeps_the_videos_length(self):
        frames = torch.zeros(100, 8, 8, 3)
        picture = torch.zeros(1, 8, 8, 3)
        output = AusBossH3PromptWriter().write("", 6, picture_1=picture, video=frames, video_job="swap the person")
        self.assertEqual(output[FRAMES], 90)

    def test_a_video_length_is_one_h3_can_make(self):
        self.assertEqual([video_frames(count) for count in (124, 125, 141, 5000)], [124, 124, 141, 345])

    def test_cut_on_beat_off_keeps_the_times(self):
        text = AusBossH3PromptWriter().write(LINES, 6, picture_1=PICTURE, song=self.audio(), cut_on_beat=False)[0]
        self.assertIn("At 00:02.000", text)
        self.assertIn("<Audio 1>: fully_copy", text)


class MomentLineTests(unittest.TestCase):
    """The timeline drags a moment's start into the line it was typed on."""

    def test_each_moment_names_its_typed_line(self):
        text = "\n\n@1 walks in. Then she sits.\n3s: @1 stops at the fridge.\n\n6s: a close-up of her hand.\nmusic: piano"
        lines = [(moment["line"], moment["start"]) for moment in script_report(text, 8)["moments"]]
        self.assertEqual(lines, [(2, 0.0), (None, 1.5), (3, 3.0), (5, 6.0)])

    def test_a_held_opening_has_no_line(self):
        report = script_report("3s: @1 waves.", 8)
        self.assertEqual([moment["line"] for moment in report["moments"]], [None, 0])


class SoundAndMusicBoxTests(unittest.TestCase):
    def write(self, script, **boxes):
        picture = torch.zeros(1, 8, 8, 3)
        return AusBossH3PromptWriter().write(script, 8, picture_1=picture, **boxes)[0]

    def part(self, text, name):
        return text.split(f"{name}:\n", 1)[1].split("\n\n", 1)[0]

    def test_the_boxes_fill_the_sound_and_music_parts(self):
        text = self.write("she runs", sound="rain on a tin roof", music="slow sad piano")
        self.assertEqual(self.part(text, "overall_soundscape"), "Rain on a tin roof.")
        self.assertEqual(self.part(text, "non_diegetic_music"), "Slow sad piano.")

    def test_empty_boxes_change_nothing(self):
        self.assertEqual(self.write("she runs"), self.write("she runs", sound="", music="  "))

    def test_a_box_is_the_same_as_the_line_typed_on_its_own(self):
        self.assertEqual(self.write("she runs", music="slow sad piano"), self.write("she runs\n\nmusic: slow sad piano"))

    def test_the_boxes_leave_a_pasted_prompt_alone(self):
        pasted = "subject_definitions:\na\n\nsummary:\nb\n\nretention_analysis:\nc\n\ndetailed_description:\nd\n\noverall_soundscape:\ne\n\nnon_diegetic_music:\nf"
        self.assertIsNotNone(split_sections(pasted))
        self.assertEqual(with_sound_and_music(pasted, "rain", "piano"), pasted)

    def test_the_boxes_are_appended_after_every_older_input(self):
        names = list(AusBossH3PromptWriter.INPUT_TYPES()["optional"])
        self.assertEqual(names[-4:], ["sound", "music", "clip_sound", "full_prompt"])


def spoken(stretches, seconds, rate=16000, noise=0.002, seed=3):
    """A mono track: a voice-band buzz over each (start, end), soft hiss elsewhere."""
    noise_maker = np.random.default_rng(seed)
    times = np.arange(int(seconds * rate)) / rate
    track = noise * noise_maker.standard_normal(len(times))
    for start, end in stretches:
        inside = (times >= start) & (times < end)
        syllables = 0.5 + 0.5 * np.sin(2 * np.pi * 4 * times[inside]) ** 2  # Words rise and fall.
        track[inside] += 0.2 * syllables * (np.sin(2 * np.pi * 220 * times[inside]) + 0.6 * np.sin(2 * np.pi * 880 * times[inside]))
    return track.astype(np.float32)


# The "state property" clip: who said what and when, read from its words.
STATE = (
    '@1 replaces the older man in the white pickup truck.\n'
    'A man off screen says "Who told you you could fish here?"\n'
    'The older man says "I thought it was state property."\n'
    'A man off screen says "State?"\n'
    'He says "Yeah."\n'
    'A man off screen says "This?"\n'
    'He says "Yeah."'
)
STATE_TIMES = [(0.08, 1.94), (2.28, 3.44), (4.66, 4.9), (5.32, 5.52), (5.86, 6.22), (6.32, 6.66)]
# What find_speech heard in that clip's real sound: (start, end, pitch in Hz, seconds of clear voice). The man
# filming sits near 270 Hz and the man in the truck near 150 Hz. Whisper put the lines at 0.08, 2.28, 4.66,
# 5.32, 5.86 and 6.32 s.
STATE_HEARD = [
    (0.0, 1.13, 204, 0.5), (1.5, 1.66, 179, 0.1), (1.74, 1.91, 355, 0.1), (2.21, 2.41, 166, 0.14), (2.53, 2.92, 154, 0.3),
    (3.01, 3.46, 160, 0.3), (4.59, 4.91, 269, 0.24), (5.27, 5.53, 125, 0.16), (5.83, 6.2, 296, 0.28), (6.45, 6.67, 121, 0.12),
]


def heard(stretches):
    return [(start, end, None if hz is None else float(np.log2(hz)), voiced) for start, end, hz, voiced in stretches]


def plain(times, hz=150.0):
    """Stretches at times, all in one voice."""
    return heard([(start, end, hz, (end - start) * 0.6) for start, end in times])


SWAP_JOBS = {"jobs": {1: "person"}, "video": "swap the person", "seconds": 6.8}


class ClipSoundTests(unittest.TestCase):
    def test_speech_is_found_where_the_words_are(self):
        found = find_speech(spoken(STATE_TIMES, 7.0), 16000)
        self.assertEqual(len(found), len(STATE_TIMES))
        for (start, end), (heard_from, heard_to, pitch, voiced) in zip(STATE_TIMES, found):
            self.assertAlmostEqual(heard_from, start, delta=0.06)
            self.assertAlmostEqual(heard_to, end, delta=0.08)
            self.assertAlmostEqual(2 ** pitch, 220, delta=8)
            self.assertGreater(voiced, 0)

    def test_silence_has_no_speech(self):
        self.assertEqual(find_speech(np.zeros(16000 * 3, np.float32), 16000), [])
        self.assertEqual(find_speech(spoken([], 3.0), 16000), [])

    def test_a_breath_inside_a_line_stays_in_the_line(self):
        found = find_speech(spoken([(0.5, 1.2), (1.35, 2.0), (3.0, 4.0)], 5.0), 16000)
        starts = place_lines(found, [("Let me tell you about the night", "new"), ("It was cold", "new")])
        self.assertAlmostEqual(starts[0], 0.5, delta=0.06)
        self.assertAlmostEqual(starts[1], 3.0, delta=0.06)

    def test_lines_start_after_the_longest_quiet(self):
        stretches = plain([(0.0, 0.7), (1.0, 1.6), (2.3, 3.0), (3.2, 4.0)])
        self.assertEqual(place_lines(stretches, [("Five in the morning and do ten", "new"), ("So this is not a joke", "new")]), [0.0, 2.3])
        self.assertIsNone(place_lines(stretches, [("a", "new")] * 5))
        self.assertIsNone(place_lines([], [("a", "new")]))

    def test_two_voices_taking_turns_are_told_apart_by_pitch(self):
        lines = [("Who told you you could fish here?", "other"), ("I thought it was state property.", "new"), ("State?", "other"),
                 ("Yeah.", "new"), ("This?", "other"), ("Yeah.", "new")]
        starts = place_lines(heard(STATE_HEARD), lines)
        for start, (truth, _) in zip(starts, STATE_TIMES):
            self.assertAlmostEqual(start, truth, delta=0.15)

    def test_only_the_new_persons_lines_stay_timed_from_the_sound(self):
        parts = parts_of(STATE, clip_sound=True, speech=heard(STATE_HEARD), **SWAP_JOBS)
        line = parts["detailed_description"]
        for gone in ("Who told you", "State?", "This?", "Nobody on screen moves", "off screen"):
            self.assertNotIn(gone, line)
        self.assertIn("<Subject 2> keeps the lips closed whenever <Subject 2> is not saying a line of <Subject 2>'s own.", line)
        self.assertIn("At 00:02.210, <Subject 2> (S1) says, each word landing exactly on the lip movement of <Video 1>, "
                      "<d>[English] I thought it was state property.</d>", line)
        self.assertIn("At 00:05.270, <Subject 2> (S1) says", line)
        self.assertIn("At 00:06.450, <Subject 2> (S1) says", line)
        self.assertNotIn("No other words are spoken", parts["overall_soundscape"])

    def test_without_the_clips_sound_every_line_is_written(self):
        line = parts_of(STATE, **SWAP_JOBS)["detailed_description"]
        self.assertIn("Who told you you could fish here?", line)
        self.assertIn("Nobody on screen moves their lips to these words.", line)
        self.assertNotIn("keeps the lips closed whenever", line)

    def test_someone_who_stays_is_left_out_and_the_new_person_says_nothing(self):
        script = (
            '@1 replaces the man in the black jacket at the counter.\n'
            'The man in the cap at the left edge says "Why would we take EBT here? We don\'t sell groceries."\n'
            'The man in the cap says "Maybe that\'s something y\'all need to look into."'
        )
        parts = parts_of(script, clip_sound=True, speech=plain([(0.0, 2.58), (3.76, 4.74)]), **SWAP_JOBS)
        line = parts["detailed_description"]
        self.assertNotIn("<d>", line)
        self.assertNotIn("EBT", line)
        self.assertIn("<Subject 2> keeps the lips closed and says nothing the whole time.", line)

    def test_a_short_name_for_who_goes_keeps_their_line(self):
        for said_by in ("The man in the car says", "The man says", "The man in the police car says"):
            script = f'@1 replaces the man in the back of the police car.\n{said_by} "I did nothing wrong."'
            line = parts_of(script, clip_sound=True, speech=plain([(0.5, 2.0)]), **SWAP_JOBS)["detailed_description"]
            self.assertIn("<Subject 2> (S1) says, each word landing exactly on the lip movement of <Video 1>, <d>[English] I did nothing wrong.</d>", line)
        line = parts_of('@1 replaces the man in the back of the police car.\nThe man in the cap says "Move."', clip_sound=True,
                        speech=plain([(0.5, 2.0)]), **SWAP_JOBS)["detailed_description"]
        self.assertNotIn("Move.", line)

    def test_a_swap_with_no_words_typed_speaks_as_the_video_does(self):
        for script in ("@1 replaces the man in the hat.", ""):
            parts = parts_of(script, clip_sound=True, speech=plain([(0.4, 1.9), (2.3, 4.0)]), **SWAP_JOBS)
            line = parts["detailed_description"]
            self.assertIn("<Subject 2> speaks as in <Video 1>, each word landing exactly on the lip movement of <Video 1>.", line)
            self.assertNotIn("says nothing", line)
            self.assertNotIn("keeps the lips closed", line)
            self.assertEqual(parts["overall_soundscape"], "The original sound of <Video 1> continues throughout.")

    def test_no_words_typed_and_no_speech_heard_says_nothing_of_the_lips(self):
        line = parts_of("@1 replaces the man in the hat.", clip_sound=True, speech=[], **SWAP_JOBS)["detailed_description"]
        self.assertNotIn("lips", line)
        self.assertNotIn("speaks as in", line)

    def test_loud_sound_with_no_voice_does_not_make_them_speak(self):
        # The subway clip: one long stretch of train noise, loud in the voice band, no clear pitch.
        noise = heard([(1.1, 5.42, None, 0.0)])
        line = parts_of("@1 replaces the woman on the platform.", clip_sound=True, speech=noise, **SWAP_JOBS)["detailed_description"]
        self.assertNotIn("speaks as in", line)
        self.assertNotIn("lips", line)
        a_word = heard([(1.0, 1.3, 150.0, 0.2)])  # A cough or one short sound: under half a second of voice.
        line = parts_of("@1 replaces the woman on the platform.", clip_sound=True, speech=a_word, **SWAP_JOBS)["detailed_description"]
        self.assertNotIn("speaks as in", line)

    def test_a_typed_sound_wins_over_the_clips_sound(self):
        parts = parts_of("@1 replaces the man in the hat.\nsound: rain on the roof", clip_sound=True, speech=plain([(0.4, 1.9)]), **SWAP_JOBS)
        self.assertIn("rain on the roof", parts["overall_soundscape"].lower())

    def test_a_typed_time_wins_over_the_sound(self):
        script = '@1 replaces the man at the till.\n3.5s: @1 says "Again?"'
        line = parts_of(script, clip_sound=True, speech=plain([(1.0, 2.0)]), **SWAP_JOBS)["detailed_description"]
        self.assertIn("At 00:03.500, <Subject 2> (S1) says", line)

    def test_too_little_speech_keeps_the_writers_own_timing(self):
        line = parts_of(STATE, clip_sound=True, speech=plain([(0.1, 6.5)]), **SWAP_JOBS)["detailed_description"]
        self.assertIn("<d>[English] I thought it was state property.</d>", line)
        self.assertNotIn("Who told you", line)

    def test_the_node_times_a_swap_from_the_videos_sound(self):
        rate = 16000
        sound = {"waveform": torch.from_numpy(spoken(STATE_TIMES, 7.0, rate)).reshape(1, 1, -1), "sample_rate": rate}
        frames = torch.zeros(163, 8, 8, 3)
        node = AusBossH3PromptWriter()
        on = node.write(STATE, 6, picture_1=PICTURE, video=frames, video_sound=sound, video_job="swap the person", clip_sound=True)
        self.assertIn("At 00:02.2", on[0])
        self.assertNotIn("Who told you", on[0])
        self.assertIsNone(on[6])  # A swap still sends H3 none of the video's sound itself.
        off = node.write(STATE, 6, picture_1=PICTURE, video=frames, video_sound=sound, video_job="swap the person")
        self.assertIn("Who told you", off[0])
        hat = node.write("@1 replaces the man in the hat.", 6, picture_1=PICTURE, video=frames, video_sound=sound, video_job="swap the person",
                         clip_sound=True)[0]
        self.assertIn("<Subject 2> speaks as in <Video 1>", hat)
        self.assertNotIn("says nothing", hat)
        moves = node.write('@1 dances.', 6, picture_1=PICTURE, video=frames, video_sound=sound, video_job="copy its moves", clip_sound=True)
        self.assertEqual(moves[0], node.write('@1 dances.', 6, picture_1=PICTURE, video=frames, video_sound=sound, video_job="copy its moves")[0])


class PromptBugBatchTests(unittest.TestCase):
    def test_a_swap_action_line_does_not_name_who_goes(self):
        for script in ("@1 dances.", "He dances."):
            text = write_prompt(script, seconds=6, jobs={1: "person"}, video="swap the person")
            self.assertIn("<Subject 1> is the original person in <Video 1>, selected for replacement.", text)
            self.assertNotIn("dances", text)

    def test_two_people_need_a_named_speaker(self):
        jobs = {1: "person", 2: "person"}
        with self.assertRaisesRegex(ValueError, r"name who speaks: @2 says"):
            write_prompt('@1 and @2 talk. She says "hi". He says "hello".', seconds=6, jobs=jobs)
        parts = parts_of('@1 says "hi". @2 says "hello".', seconds=6, jobs=jobs)
        self.assertIn("<Subject 1> and <Subject 2> speak", parts["summary"])

    def test_keep_going_uses_the_person_picture_as_the_main_person(self):
        parts = parts_of("He walks.", seconds=6, jobs={1: "person"}, video="keep going")
        text = join_sections(parts)
        self.assertNotIn("<Subject 2>", text)
        self.assertNotIn("main subject in <Video 1>", text)
        self.assertIn("<Subject 1> walks", parts["detailed_description"])
        placed = parts_of("He walks in @2.", seconds=6, jobs={1: "person", 2: "place"}, video="keep going")
        self.assertNotIn("same place", join_sections(placed))
        empty = parts_of("The room is empty.", seconds=6, jobs={}, video="keep going")
        self.assertNotIn("is in the shot", join_sections(empty))
        self.assertNotIn("main subject", join_sections(empty))

    def test_an_outfit_with_no_person_goes_on_the_person_in_the_shot(self):
        parts = parts_of("He wears @1.", seconds=6, jobs={1: "outfit"})
        self.assertIn("put only this outfit on the person in the shot", parts["retention_analysis"])
        self.assertNotIn("on <Subject 1>", parts["retention_analysis"])

    def test_in_the_shot_is_only_for_defined_people_and_things(self):
        for jobs in ({1: "style"}, {1: "end on it"}, {1: "outfit"}):
            self.assertNotIn("is in the shot", write_prompt("A calm lake.", seconds=6, jobs=jobs), jobs)
        self.assertIn("<Subject 1> is in the shot", write_prompt("A calm lake.", seconds=6, jobs={1: "thing"}))

    def test_new_voice_keeps_the_clips_person(self):
        with self.assertRaisesRegex(ValueError, "swap the person"):
            write_prompt('She says "hi".', seconds=6, jobs={1: "person"}, video="new voice")
        text = write_prompt('She says "hi".', seconds=6, jobs={}, video="new voice")
        self.assertNotIn("faces the camera", text)

    def test_he_or_she_binds_the_only_person_picture(self):
        parts = parts_of("She walks in @2.", seconds=6, jobs={1: "person", 2: "place"})
        self.assertIn("<Subject 1> walks in <Subject 2>", parts["detailed_description"])
        with self.assertRaisesRegex(ValueError, "no line names @1"):
            write_prompt("A dog sits in @2.", seconds=6, jobs={1: "person", 2: "place"})

    def test_a_swap_with_a_thing_or_place_gets_its_own_advice(self):
        with self.assertRaisesRegex(ValueError, "He holds @1"):
            write_prompt("He holds @1.", seconds=6, jobs={1: "thing"}, video="swap the person")
        with self.assertRaisesRegex(ValueError, "keeps the place"):
            write_prompt("He dances.", seconds=6, jobs={1: "place"}, video="swap the person")

    def test_the_task_tag_adds_audio_reuse_when_the_clips_sound_stays(self):
        edit = parts_of("She wears a red coat.", seconds=6, jobs={}, video="change something")["summary"]
        self.assertTrue(edit.startswith("[video editing + audio reuse]"))
        kept = parts_of("", seconds=6, jobs={1: "person"}, video="swap the person", clip_sound=True)["summary"]
        self.assertTrue(kept.startswith("[video editing + audio reuse]"))
        plain = parts_of("", seconds=6, jobs={1: "person"}, video="swap the person")["summary"]
        self.assertNotIn("audio reuse", plain)

    def test_only_a_place_or_start_picture_sets_the_look(self):
        for job in ("outfit", "thing"):
            self.assertNotIn("film grain", write_prompt("He wears @1.", seconds=6, jobs={1: job}), job)
        self.assertIn("film grain of <Picture 1>", write_prompt("He sits in @1.", seconds=6, jobs={1: "place"}))

    def test_change_something_puts_an_unnamed_outfit_on_the_video_person(self):
        parts = parts_of("Add a hat.", seconds=6, jobs={1: "outfit"}, video="change something")
        self.assertIn("<Subject 2> wears <Subject 1>.", parts["detailed_description"])



class SpeechAcrossCutTests(unittest.TestCase):
    CARRIED = 'She looks out the window. She says "I never thought this would happen..."\n\nA close-up of the road ahead.'

    def test_a_trailing_line_carries_across_the_cut(self):
        first, second = shots(self.CARRIED, seconds=8)
        self.assertTrue(first.endswith("<scenetrans>"))
        self.assertNotIn("closes the lips", first)
        self.assertIn("<scenetrans> The line from the previous shot continues", second)
        self.assertNotIn("stays silent", second)
        self.assertNotIn("<Video 1>", second)
        self.assertEqual(write_prompt(self.CARRIED, seconds=8).count("I never thought"), 1)

    def test_a_trailing_last_line_is_cut_off(self):
        (only,) = shots('She says "Wait, I was going to tell you that..."', seconds=4)
        self.assertTrue(only.endswith("<cutoff>"))
        self.assertNotIn("closes the lips", only)

    def test_a_carried_line_is_not_warned_about(self):
        long = 'She says "this is a very long line that would never fit inside two short seconds of video"\n\nA close-up of the road.'
        self.assertEqual(script_warning(read_script(long), 4), "")
        self.assertIn("<scenetrans>", write_prompt(long, seconds=4))

    def test_plain_lines_carry_nothing(self):
        text = write_prompt('She says "hello."\n\nHe waves back.', seconds=6)
        self.assertNotIn("<scenetrans>", text)
        self.assertNotIn("<cutoff>", text)

    def test_four_seconds_is_allowed(self):
        seconds = AusBossH3PromptWriter.INPUT_TYPES()["optional"].get("seconds") or AusBossH3PromptWriter.INPUT_TYPES()["required"]["seconds"]
        self.assertEqual(seconds[1]["min"], 4)


if __name__ == "__main__":
    unittest.main()
