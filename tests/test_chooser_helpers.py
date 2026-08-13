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
    effective_indices,
    indices_string,
    keep_frames,
    normalize_selection,
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


class ReportTests(unittest.TestCase):
    def test_effective_indices_expand_keep_all(self):
        self.assertEqual(effective_indices([], 4), [1, 2, 3, 4])
        self.assertEqual(effective_indices([2, 4], 4), [2, 4])

    def test_indices_string_is_one_based_and_comma_joined(self):
        self.assertEqual(indices_string([1, 4, 9]), "1,4,9")
        self.assertEqual(indices_string([]), "")


if __name__ == "__main__":
    unittest.main()
