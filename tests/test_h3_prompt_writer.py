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
    NO_SCRIPT,
    VOICE_NO_WORDS,
    add_task,
    clean_words,
    find_beats,
    join_sections,
    snap_cuts,
    split_sections,
    write_prompt,
)
from nodes._h3_cast_helpers import Cast, number_pictures
from nodes._h3_script_helpers import Moment, moment_sound, read_script, script_report, script_warning, timeline
from nodes import node_h3_prompt_writer
from nodes.node_h3_prompt_writer import AusBossH3PromptWriter, clip_frames, video_frames

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
                "At 00:04.000, <Subject 1> raises the camera again and a bright flash fires. The camera shutter clicks loudly."
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
        self.assertIn("At 00:04.000, the camera keeps moving forward.", shots("We walk in.\nThe screens flicker.", seconds=8, camera="walking pov")[0])
        self.assertNotIn("keeps moving forward", shots("We wait.\nThe screens flicker.", seconds=8, camera="push in")[0])

    def test_a_typed_moving_camera_counts_too(self):
        lines = shots("camera: we run forward through the room\nThe door opens.\nThe light goes out.", seconds=8)
        self.assertIn("keeps moving forward", lines[0])

    def test_a_cut_says_cut(self):
        lines = shots("she walks\n\na close-up of her hand\n\nthe door opens", seconds=9)
        self.assertEqual(lines[1], "[Shot 2] At 00:03.000, the camera cuts to a close-up of her hand.")
        self.assertEqual(lines[2], "[Shot 3] At 00:06.000, the camera cuts to a new place. The door opens. The door creaks and thuds.")

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

    def test_a_moment_names_its_own_sound(self):
        self.assertIn("it starts to rain. Rain hisses on the ground.", shots("She stops.\nIt starts to rain.")[0])
        self.assertIn("<Subject 1> runs away. Fast footsteps hit the ground.", shots("She stops.\nShe runs away.")[0])
        self.assertTrue(shots("She smiles.")[0].endswith("<Subject 1> smiles."))

    def test_a_sound_someone_typed_is_not_said_twice(self):
        self.assertTrue(shots("Thunder booms overhead.")[0].endswith("Thunder booms overhead."))
        self.assertTrue(shots("sound: wind and waves\nThe wind picks up.")[0].endswith("The wind picks up."))

    def test_what_changed_stays_changed(self):
        line = shots("The lights go out.\nShe turns around.\nShe runs.", seconds=9)[0]
        self.assertIn("The lights go out. The whole place goes dark.", line)
        self.assertIn("<Subject 1> turns around. The lights stay off.", line)
        self.assertIn("<Subject 1> runs. The lights stay off.", line)

    def test_a_new_place_starts_clean(self):
        lines = shots("The lights go out.\n\nShe sits on a beach.", seconds=9)
        self.assertNotIn("stay off", lines[1])
        lines = shots("The lights go out.\n\nA close-up of her hand.", seconds=9)
        self.assertIn("stay off", lines[1])

    def test_a_moment_about_the_same_thing_decides_for_itself(self):
        line = shots("The lights go out.\nThe lights come back on.\nShe smiles.", seconds=9)[0]
        self.assertNotIn("stay off", line.partition("At 00:06.000")[0])

    def test_snow_on_a_screen_is_not_weather(self):
        self.assertNotIn("keeps falling", write_prompt("Screens blur into static snowstorms.\nShe stops."))
        self.assertNotIn("keeps falling", write_prompt("She catches a snowflake.\nShe stops."))
        self.assertIn("The snow keeps falling.", write_prompt("A snowstorm blows in.\nShe stops."))
        self.assertIn("The snow keeps falling.", write_prompt("It starts to snow.\nShe stops."))

    def test_a_door_only_sounds_when_it_moves(self):
        self.assertIn("Footsteps", shots("She walks to the door.")[0])
        self.assertIn("The door creaks", shots("She opens the door.")[0])
        self.assertTrue(shots("A close-up of her hand on the door.")[0].endswith("on the door."))

    def test_a_kept_song_is_all_the_sound_there_is(self):
        self.assertNotIn("shutter", write_prompt(LINES, song_beats=[]))
        self.assertIn("shutter", write_prompt('She says "hi".\nA bright flash fires.', voice=True, song_beats=[]))

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
        self.assertIn("<Subject 1> is on the left and <Subject 2> is on the right of the frame.", parts["detailed_description"])
        self.assertIn("<Subject 2> (appears in [Shot 1])", parts["retention_analysis"])

    def test_a_line_that_places_them_is_left_alone(self):
        self.assertNotIn("of the frame", write_prompt("@1 stands behind @2.", jobs={1: "person", 2: "person"}))

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


class SoundWordTests(unittest.TestCase):
    """A word that reads two ways gets the sound only when it means the sound."""

    def sound(self, line):
        return moment_sound(Moment(line), read_script(line))

    def test_words_that_mean_something_else_stay_quiet(self):
        for line in (
            "She raises one hand and waves.",
            "He waves at the crowd.",
            "She eats breakfast at the window.",
            "He explores the old house.",
            "She runs her hand through her hair.",
            "She falls asleep on the sofa.",
            "Night falls over the town.",
            "She flashes a smile.",
            "She breaks into a smile.",
            "He takes a break on the steps.",
        ):
            self.assertEqual(self.sound(line), "", line)

    def test_the_real_thing_keeps_its_sound(self):
        for line, heard in (
            ("The waves crash on the rocks.", "water"),
            ("She stands in the big grey waves.", "water"),
            ("The house explodes.", "boom"),
            ("The window shatters.", "shatters"),
            ("He breaks the bottle on the bar.", "shatters"),
            ("She runs down the platform.", "footsteps"),
            ("He falls off the roof.", "thud"),
            ("A flash goes off.", "shutter"),
            ("She crosses a rainy street.", "Rain"),
        ):
            self.assertIn(heard, self.sound(line), line)


class VideoJobTests(unittest.TestCase):
    def test_copying_moves_keeps_the_performer_out(self):
        parts = parts_of("@1 dances on a rooftop.", jobs={1: "person"}, video="copy its moves")
        self.assertIn("<Subject 2> is the body motion in <Video 1>", parts["subject_definitions"])
        self.assertIn("<Video 1> provides the camera movement.", parts["subject_definitions"])
        self.assertIn("keep the source performer's face, body, clothes, props, background and colours out", parts["retention_analysis"])
        self.assertIn("<Subject 1> performs the same moves as <Subject 2>", parts["detailed_description"])
        self.assertIn("One continuous shot", parts["detailed_description"])

    def test_the_timeline_says_so_when_nothing_is_connected(self):
        self.assertIn("Connect a picture or a video", script_report("She runs.", 6, {})["warning"])
        self.assertIn("To copy the moves", script_report("She runs.", 6, {}, "copy its moves")["warning"])

    def test_copying_moves_with_nobody_to_give_them_to_says_so(self):
        cast = Cast(number_pictures({1: "place"}, "copy its moves"), "copy its moves")
        self.assertIn("To copy the moves", cast.problem("She dances."))

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

    def test_typed_words_in_a_swap_say_who_goes(self):
        parts = parts_of("The child in the seat.", jobs={1: "person"}, video="swap the person")
        self.assertIn("<Subject 1> is the child in the seat in <Video 1>", parts["subject_definitions"])
        self.assertIn("replace the child in the seat with <Subject 2>", parts["retention_analysis"])
        self.assertIn("Everyone else stays", parts["detailed_description"])
        self.assertNotIn("Show one person", parts["detailed_description"])

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
        text, *pictures, video, video_sound, voice, song, under, frames, width, height = node.write(LINES, 6, picture_1=PICTURE)
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
        text, *_, voice, song, under, _, _, _ = AusBossH3PromptWriter().write(SAYS, 10, picture_1=PICTURE, voice=self.audio(), song=audio)
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
        text, *_, song, under, _, _, _ = AusBossH3PromptWriter().write(LINES, 6, picture_1=PICTURE, song=self.audio())
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
        self.assertEqual(output[-2:], (1344, 756))

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
        self.assertEqual(node.write("@1 sits in @2.", 6, picture_1=tall, picture_2=wide, job_2="place")[-2:], (560, 736))
        self.assertEqual(node.write("@2 waves.", 6, picture_2=wide, job_2="person")[-2:], (832, 480))
        self.assertEqual(node.write("@1 dances.", 6, picture_1=tall, video=video)[-2:], (1280, 720))

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


if __name__ == "__main__":
    unittest.main()
