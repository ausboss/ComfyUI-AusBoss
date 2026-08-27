from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._batch_helpers import (
    merge_batches,
    select_every_nth,
    select_one_based_frame,
    split_batch,
)


def numbered_batch(count: int, height: int = 2, width: int = 2) -> torch.Tensor:
    """A BHWC batch where every frame is filled with its one-based number."""
    batch = torch.zeros((count, height, width, 3), dtype=torch.float32)
    for index in range(count):
        batch[index] = float(index + 1)
    return batch


def frame_numbers(batch: torch.Tensor) -> list[float]:
    return [float(frame[0, 0, 0]) for frame in batch]


class SelectFrameTests(unittest.TestCase):
    def test_one_based_selection_returns_the_right_frame(self):
        frames = numbered_batch(5)
        self.assertEqual(float(select_one_based_frame(frames, 1)[0, 0, 0, 0]), 1.0)
        self.assertEqual(float(select_one_based_frame(frames, 5)[0, 0, 0, 0]), 5.0)

    def test_negative_numbers_count_from_the_end(self):
        frames = numbered_batch(5)
        self.assertEqual(float(select_one_based_frame(frames, -1)[0, 0, 0, 0]), 5.0)
        self.assertEqual(float(select_one_based_frame(frames, -2)[0, 0, 0, 0]), 4.0)
        self.assertEqual(float(select_one_based_frame(frames, -5)[0, 0, 0, 0]), 1.0)

    def test_selection_stays_a_one_image_batch_either_way(self):
        frames = numbered_batch(3)
        self.assertEqual(tuple(select_one_based_frame(frames, 2).shape), (1, 2, 2, 3))
        self.assertEqual(tuple(select_one_based_frame(frames, -1).shape), (1, 2, 2, 3))

    def test_out_of_range_reports_the_available_range(self):
        frames = numbered_batch(3)
        for number in (0, 4):
            with self.assertRaisesRegex(ValueError, "frames 1 through 3"):
                select_one_based_frame(frames, number)

    def test_zero_and_past_the_start_negatives_stay_invalid(self):
        frames = numbered_batch(3)
        for number in (0, -4):
            with self.assertRaisesRegex(ValueError, "-1 through -3"):
                select_one_based_frame(frames, number)


class SelectEveryNthTests(unittest.TestCase):
    def test_keeps_every_other_frame_from_the_first(self):
        frames = numbered_batch(6)
        self.assertEqual(frame_numbers(select_every_nth(frames, 2, 0)), [1.0, 3.0, 5.0])

    def test_offset_skips_frames_before_the_first_kept_one(self):
        frames = numbered_batch(6)
        self.assertEqual(frame_numbers(select_every_nth(frames, 2, 1)), [2.0, 4.0, 6.0])
        self.assertEqual(frame_numbers(select_every_nth(frames, 3, 2)), [3.0, 6.0])

    def test_nth_of_one_keeps_everything_after_the_offset(self):
        frames = numbered_batch(4)
        self.assertEqual(frame_numbers(select_every_nth(frames, 1, 2)), [3.0, 4.0])

    def test_offset_beyond_the_batch_reports_the_count(self):
        frames = numbered_batch(3)
        with self.assertRaisesRegex(ValueError, "only\\s+contains 3"):
            select_every_nth(frames, 2, 3)

    def test_invalid_nth_and_offset_are_refused(self):
        frames = numbered_batch(3)
        with self.assertRaisesRegex(ValueError, "at least 1"):
            select_every_nth(frames, 0, 0)
        with self.assertRaisesRegex(ValueError, "0 or more"):
            select_every_nth(frames, 2, -1)


class SplitBatchTests(unittest.TestCase):
    def test_splits_after_the_one_based_index(self):
        frames = numbered_batch(5)
        first, second = split_batch(frames, 2)
        self.assertEqual(frame_numbers(first), [1.0, 2.0])
        self.assertEqual(frame_numbers(second), [3.0, 4.0, 5.0])

    def test_neither_side_may_be_empty(self):
        frames = numbered_batch(3)
        for index in (0, 3, 4):
            with self.assertRaisesRegex(ValueError, "between 1 and 2"):
                split_batch(frames, index)

    def test_a_single_frame_cannot_be_split(self):
        with self.assertRaisesRegex(ValueError, "at least 2 frames"):
            split_batch(numbered_batch(1), 1)


class MergeBatchesTests(unittest.TestCase):
    def test_concatenates_a_first(self):
        merged = merge_batches(numbered_batch(2), numbered_batch(3))
        self.assertEqual(frame_numbers(merged), [1.0, 2.0, 1.0, 2.0, 3.0])

    def test_resize_to_a_brings_b_to_a_size(self):
        batch_a = numbered_batch(2, height=4, width=6)
        batch_b = numbered_batch(1, height=2, width=2)
        merged = merge_batches(batch_a, batch_b, "resize to a")
        self.assertEqual(tuple(merged.shape), (3, 4, 6, 3))
        # A constant frame survives bilinear resizing exactly.
        self.assertEqual(float(merged[2, 0, 0, 0]), 1.0)

    def test_resize_to_b_brings_a_to_b_size(self):
        batch_a = numbered_batch(2, height=4, width=6)
        batch_b = numbered_batch(1, height=2, width=2)
        merged = merge_batches(batch_a, batch_b, "resize to b")
        self.assertEqual(tuple(merged.shape), (3, 2, 2, 3))

    def test_error_policy_names_both_sizes(self):
        batch_a = numbered_batch(1, height=4, width=6)
        batch_b = numbered_batch(1, height=2, width=2)
        with self.assertRaisesRegex(ValueError, "6x4.*2x2"):
            merge_batches(batch_a, batch_b, "error")

    def test_matching_sizes_never_resize(self):
        batch_a = numbered_batch(2)
        batch_b = numbered_batch(2)
        merged = merge_batches(batch_a, batch_b, "error")
        self.assertEqual(tuple(merged.shape), (4, 2, 2, 3))

    def test_channel_mismatch_is_refused(self):
        batch_a = numbered_batch(1)
        batch_b = torch.zeros((1, 2, 2, 4), dtype=torch.float32)
        with self.assertRaisesRegex(ValueError, "3-channel and 4-channel"):
            merge_batches(batch_a, batch_b)

    def test_unknown_policy_is_refused(self):
        with self.assertRaisesRegex(ValueError, "mismatch policy"):
            merge_batches(numbered_batch(1), numbered_batch(1), "stretch")


if __name__ == "__main__":
    unittest.main()
