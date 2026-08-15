"""Offline tests for the Frame Chooser's pure selection helpers.

The blocking pause, the websocket event, and the answer route need a live
PromptServer and are exercised in the browser acceptance pass instead.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._chooser_helpers import (
    TIMEOUT_CANCEL,
    done_payload,
    TIMEOUT_KEEP_ALL,
    TIMEOUT_KEEP_FIRST,
    TIMEOUT_KEEP_LAST,
    effective_indices,
    indices_string,
    keep_frames,
    normalize_selection,
    parse_pick_list,
    pick_list_fingerprint,
    resolve_timeout_policy,
    token_matches,
    usable_remembered,
)


def batch(count: int) -> torch.Tensor:
    """A BHWC batch where frame i is filled with the value i (zero-based)."""
    frames = torch.zeros((count, 2, 3, 3), dtype=torch.float32)
    for index in range(count):
        frames[index] = float(index)
    return frames


class NormalizeSelectionTests(unittest.TestCase):
    def test_sorts_and_dedupes_into_source_order(self):
        self.assertEqual(normalize_selection([9, 1, 4, 1, 9], 10), [1, 4, 9])

    def test_empty_selection_is_valid_and_means_keep_all(self):
        self.assertEqual(normalize_selection([], 10), [])

    def test_rejects_non_list_payloads(self):
        with self.assertRaises(ValueError):
            normalize_selection("1,2,3", 10)

    def test_rejects_non_integer_entries(self):
        for bad in ([1.5], ["2"], [True], [None]):
            with self.assertRaises(ValueError):
                normalize_selection(bad, 10)

    def test_rejects_out_of_range_entries(self):
        with self.assertRaises(ValueError):
            normalize_selection([0], 10)
        with self.assertRaises(ValueError):
            normalize_selection([11], 10)


class UsableRememberedTests(unittest.TestCase):
    def test_trims_to_the_current_batch(self):
        self.assertEqual(usable_remembered([2, 5, 40], 10), [2, 5])

    def test_empty_memory_means_keep_all(self):
        self.assertEqual(usable_remembered([], 10), [])

    def test_entirely_stale_memory_is_useless(self):
        self.assertIsNone(usable_remembered([40, 41], 10))

    def test_garbage_memory_is_useless(self):
        self.assertIsNone(usable_remembered("not a list", 10))
        self.assertIsNone(usable_remembered([True, "3"], 10))


class KeepFramesTests(unittest.TestCase):
    def test_keeps_the_chosen_frames_in_source_order(self):
        kept = keep_frames(batch(6), [2, 5])
        self.assertEqual(kept.shape[0], 2)
        self.assertEqual(float(kept[0, 0, 0, 0]), 1.0)
        self.assertEqual(float(kept[1, 0, 0, 0]), 4.0)

    def test_empty_selection_keeps_the_whole_batch(self):
        frames = batch(4)
        self.assertIs(keep_frames(frames, []), frames)

    def test_rejects_non_bhwc_input(self):
        with self.assertRaises(ValueError):
            keep_frames(torch.zeros((3, 3)), [1])


class ParsePickListTests(unittest.TestCase):
    def test_blank_widget_means_no_pre_answer(self):
        for blank in (None, "", "   ", ", ,"):
            self.assertIsNone(parse_pick_list(blank, 10))

    def test_parses_commas_and_whitespace_into_a_sorted_selection(self):
        self.assertEqual(parse_pick_list("1,4,9", 10), [1, 4, 9])
        self.assertEqual(parse_pick_list(" 9 1\t4, 4 ", 10), [1, 4, 9])

    def test_validates_exactly_like_the_answer_route(self):
        with self.assertRaises(ValueError):
            parse_pick_list("0", 10)
        with self.assertRaises(ValueError):
            parse_pick_list("11", 10)

    def test_rejects_non_numeric_tokens_loudly(self):
        for bad in ("1,two", "1.5", "-3", "3;4"):
            with self.assertRaises(ValueError):
                parse_pick_list(bad, 10)

    def test_rejects_unicode_digits_with_the_widget_message(self):
        # str.isdigit() is true for both of these. int() throws on the
        # superscript, and silently accepts the Arabic-Indic one as a frame
        # number nobody typed - so both have to fail the widget's own guard.
        for bad in ("\u00b2", "\u0663", "\uff11", "1,\u00b3"):
            with self.assertRaises(ValueError) as caught:
                parse_pick_list(bad, 10)
            self.assertIn("one-based frame number", str(caught.exception))

    def test_fingerprints_unicode_digits_without_raising(self):
        # IS_CHANGED calls this during validation, where a raw ValueError
        # surfaces with no mention of Frame Chooser or pick_list.
        for bad in ("\u00b2", "\u0663", "1,\u00b3"):
            self.assertTrue(pick_list_fingerprint(bad).startswith("picks:"))


class PickListFingerprintTests(unittest.TestCase):
    def test_equivalent_spellings_share_one_fingerprint(self):
        self.assertEqual(
            pick_list_fingerprint("1, 4, 9"), pick_list_fingerprint("4 1\t9 9")
        )

    def test_different_picks_get_different_fingerprints(self):
        self.assertNotEqual(pick_list_fingerprint("1,4,9"), pick_list_fingerprint("1,4"))

    def test_fingerprints_are_namespaced_and_stable_for_bad_text(self):
        self.assertTrue(pick_list_fingerprint("1,4").startswith("picks:"))
        self.assertEqual(pick_list_fingerprint("1,oops"), pick_list_fingerprint("1, oops"))


class PauseTokenTests(unittest.TestCase):
    def test_only_the_exact_nonempty_token_matches(self):
        self.assertTrue(token_matches("pause-token", "pause-token"))
        for supplied in ("", "older-token", None, 123):
            self.assertFalse(token_matches("pause-token", supplied))

    def test_empty_or_nonstring_expected_tokens_never_match(self):
        self.assertFalse(token_matches("", ""))
        self.assertFalse(token_matches(None, None))

    def test_non_ascii_tokens_are_refused_rather_than_raising(self):
        # hmac.compare_digest raises TypeError on non-ASCII text; letting that
        # out of the route turned a malformed answer into an HTTP 500 and left
        # the pause stranded behind it.
        self.assertFalse(token_matches("pause-token", "tok\u00e9n"))
        self.assertFalse(token_matches("tok\u00e9n", "pause-token"))
        self.assertFalse(token_matches("tok\u00e9n", "tok\u00e9n"))


class ResolveTimeoutPolicyTests(unittest.TestCase):
    def test_keep_all_is_the_empty_keep_all_selection(self):
        self.assertEqual(resolve_timeout_policy(TIMEOUT_KEEP_ALL, 8), [])

    def test_keep_first_and_last_pick_the_batch_edges(self):
        self.assertEqual(resolve_timeout_policy(TIMEOUT_KEEP_FIRST, 8), [1])
        self.assertEqual(resolve_timeout_policy(TIMEOUT_KEEP_LAST, 8), [8])

    def test_cancel_returns_none_for_the_caller_to_interrupt(self):
        self.assertIsNone(resolve_timeout_policy(TIMEOUT_CANCEL, 8))

    def test_unknown_policy_falls_back_to_keep_all(self):
        self.assertEqual(resolve_timeout_policy("keep some", 8), [])

    def test_empty_batch_edges_degrade_to_keep_all(self):
        self.assertEqual(resolve_timeout_policy(TIMEOUT_KEEP_FIRST, 0), [])
        self.assertEqual(resolve_timeout_policy(TIMEOUT_KEEP_LAST, 0), [])


class ReportTests(unittest.TestCase):
    def test_effective_indices_expand_keep_all(self):
        self.assertEqual(effective_indices([], 4), [1, 2, 3, 4])
        self.assertEqual(effective_indices([2, 4], 4), [2, 4])

    def test_indices_string_is_one_based_and_comma_joined(self):
        self.assertEqual(indices_string([1, 4, 9]), "1,4,9")
        self.assertEqual(indices_string([]), "")


class DonePayloadTests(unittest.TestCase):
    def test_keep_all_stays_the_empty_answer_it_was_posted_as(self):
        # The panel writes `indices` into pick_list. Expanding keep-all to
        # "1,...,N" pinned it to one batch size: a later, longer batch
        # silently lost its extra frames and a shorter one failed outright.
        payload = done_payload("7", "tok", [], 8, "answered")
        self.assertEqual(payload["indices"], "")
        self.assertEqual(payload["kept"], 8)
        self.assertEqual(payload["count"], 8)

    def test_a_real_pick_is_reported_verbatim(self):
        payload = done_payload("7", "tok", [2, 5], 8, "answered")
        self.assertEqual(payload["indices"], "2,5")
        self.assertEqual(payload["kept"], 2)

    def test_a_written_back_keep_all_survives_any_later_batch_size(self):
        indices = done_payload("7", "tok", [], 8, "answered")["indices"]
        for later in (1, 4, 8, 40):
            self.assertIsNone(parse_pick_list(indices, later))


if __name__ == "__main__":
    unittest.main()
