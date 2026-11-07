"""Opt-in replacement descriptions; old selectors/ports remain unchanged."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import torch
from nodes._h3_cast_helpers import swap_appearances
from nodes._h3_prompt_helpers import split_sections, write_prompt
from nodes._h3_script_helpers import script_report
from nodes.node_h3_prompt_writer import AusBossH3PromptWriter

LOOK = 'a woman with pale skin, shoulder-length platinum-blonde hair, a black oversized hoodie, neck tattoos and layered silver necklaces with a cross pendant'
SELECTOR = 'the woman with black hair walking toward the camera'
SCRIPT = SELECTOR + '\n@1 looks like ' + LOOK + '.'

class SwapAppearanceTests(unittest.TestCase):
    def parts(self, script=SCRIPT, jobs=None, **kw):
        return split_sections(write_prompt(script, jobs={1: 'person'} if jobs is None else jobs, video='swap the person', **kw))

    def test_description_does_not_become_the_original_selector(self):
        parts = self.parts()
        self.assertIn(f'<Subject 1> is {SELECTOR} in <Video 1>', parts['subject_definitions'])
        self.assertIn(f'<Subject 2> is the person in <Picture 1>, with the same face and this appearance: {LOOK}', parts['subject_definitions'])
        self.assertNotIn('looks like', parts['subject_definitions'])
        shot = parts['detailed_description']
        self.assertIn(LOOK, shot)
        self.assertIn('same route, movements, timing and pace', shot)
        self.assertIn('no transition or morph', shot)
        self.assertEqual(shot.count('[Shot 1]'), 1)

    def test_blank_selector_still_selects_the_original_person(self):
        p = self.parts('@1 looks like a woman with red hair.')
        self.assertIn('<Subject 1> is the original person in <Video 1>', p['subject_definitions'])
        self.assertIn('Show one person throughout.', p['detailed_description'])

    def test_two_people_keep_their_selectors_and_separate_looks(self):
        text = '@1 the man on the left\n@2 the woman on the right\n@2 looks like a woman with red hair.\n@1 looks like a man in a black jacket.'
        p = self.parts(text, jobs={1: 'person', 2: 'person'})
        d = p['subject_definitions']
        self.assertIn('<Subject 1> is the man on the left in <Video 1>', d)
        self.assertIn('<Subject 2> is the woman on the right in <Video 1>', d)
        self.assertIn('<Subject 3> is the person in <Picture 1>, with the same face and this appearance: a man in a black jacket', d)
        self.assertIn('<Subject 4> is the person in <Picture 2>, with the same face and this appearance: a woman with red hair', d)
        self.assertIn('Everyone else stays as they are', p['detailed_description'])

    def test_visible_slot_binds_to_compact_picture_ordinal(self):
        p = self.parts('@4 looks like a woman in a blue coat.', jobs={1: 'place', 4: 'person'})
        self.assertIn('<Subject 3> is the person in <Picture 2>, with the same face and this appearance: a woman in a blue coat', p['subject_definitions'])
        self.assertNotIn('from <Picture 4>', p['subject_definitions'])

    def test_character_sheet_can_supply_the_replacement(self):
        p = self.parts('@1 looks like a robot with a yellow body.', jobs={1: 'character sheet'})
        self.assertIn('this appearance: a robot with a yellow body', p['subject_definitions'])
        self.assertIn('without the panels', p['detailed_description'])

    def test_missing_picture_and_wrong_role_are_clear_errors(self):
        for jobs, phrase in [({}, 'not connected'), ({1: 'place'}, 'person or character sheet')]:
            with self.assertRaisesRegex(ValueError, phrase):
                self.parts('@1 looks like a woman in a blue coat.', jobs=jobs)

    def test_duplicate_or_empty_description_is_not_silently_used(self):
        for text in ['@1 looks like .', '@1 looks like a woman.\n@1 looks like another woman.']:
            with self.assertRaises(ValueError):
                self.parts(text)

    def test_anchored_line_only_and_other_jobs_are_untouched(self):
        for text in ['Put @1 looks like a friend here.', '@1 looks like a woman and says "Hello".']:
            self.assertEqual(swap_appearances(text, {1: 'person'}, 'swap the person'), (text, {}))
        for job in ['', 'copy its moves', 'change something', 'keep going']:
            self.assertEqual(swap_appearances(SCRIPT, {1: 'person'}, job), (SCRIPT, {}))
        legacy = '\r\n  @1 replaces the man in the hat.\r\n'
        self.assertEqual(swap_appearances(legacy, {1: 'person'}, 'swap the person'), (legacy, {}))

    def test_description_is_not_a_timed_action_in_the_report(self):
        r = script_report(SCRIPT, 6, {1: 'person'}, 'swap the person')
        self.assertEqual(len(r['moments']), 1)
        self.assertEqual(r['moments'][0]['text'].lower(), SELECTOR)
        self.assertFalse(r['warning'])

    def test_spoken_words_survive_the_separate_description(self):
        p = self.parts('@1 the man on the left\n@1 looks like a man with red hair.\n@1 says "We are late."')
        self.assertIn('<d>[English] We are late.</d>', p['detailed_description'])
        self.assertNotIn('red hair', p['retention_analysis'])

    def test_appearance_hint_does_not_contradict_keep_clip_clothes(self):
        with self.assertRaisesRegex(ValueError, 'replaces the whole look'):
            self.parts(SCRIPT + '\nkeep the original clothes')

    def test_node_sound_on_off_changes_no_reference_or_output_contract(self):
        picture = torch.zeros((1, 8, 8, 3))
        video = torch.zeros((124, 8, 8, 3))
        audio = {'sample_rate': 16000, 'waveform': torch.zeros((1, 1, 16000))}
        for keep in (False, True):
            result = AusBossH3PromptWriter().write(SCRIPT, 12, picture_1=picture, video=video, video_sound=audio, video_job='swap the person', clip_sound=keep, sound='footsteps synchronized with the walk and quiet rooftop ambience')
            self.assertEqual(len(result), 14)
            self.assertIs(result[1], picture)
            self.assertIs(result[5], video)
            self.assertIsNone(result[6])
            self.assertEqual(result[10], 124)
            self.assertEqual(result[13], keep)
            self.assertIn(LOOK, result[0])
            self.assertIn('footsteps synchronized with the walk', result[0].lower())

if __name__ == '__main__':
    unittest.main()
