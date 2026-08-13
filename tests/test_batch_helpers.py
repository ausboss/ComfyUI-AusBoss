from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._batch_helpers import select_one_based_frame, select_one_based_frame_range


def numbered_batch(count: int) -> torch.Tensor:
    """A BHWC batch where every frame is filled with its one-based number."""
    batch = torch.zeros((count, 2, 2, 3), dtype=torch.float32)
    for index in range(count):
        batch[index] = float(index + 1)
    return batch


class SelectFrameTests(unittest.TestCase):
    def test_one_based_selection_returns_the_right_frame(self):
        frames = numbered_batch(5)
        self.assertEqual(float(select_one_based_frame(frames, 1)[0, 0, 0, 0]), 1.0)
        self.assertEqual(float(select_one_based_frame(frames, 5)[0, 0, 0, 0]), 5.0)

    def test_out_of_range_reports_the_available_range(self):
        frames = numbered_batch(3)
        for number in (0, 4):
            with self.assertRaisesRegex(ValueError, "frames 1 through 3"):
                select_one_based_frame(frames, number)


class SelectFrameRangeTests(unittest.TestCase):
    def test_middle_range_returns_the_requested_frames_unchanged(self):
        frames = numbered_batch(6)
        selected = select_one_based_frame_range(frames, 2, 3)
        self.assertEqual(tuple(selected.shape), (3, 2, 2, 3))
        self.assertTrue(torch.equal(selected, frames[1:4]))

    def test_zero_count_runs_through_the_last_frame(self):
        frames = numbered_batch(4)
        selected = select_one_based_frame_range(frames, 3, 0)
        self.assertTrue(torch.equal(selected, frames[2:]))
        self.assertTrue(torch.equal(select_one_based_frame_range(frames, 1, 0), frames))

    def test_start_at_last_frame_yields_one_frame(self):
        frames = numbered_batch(4)
        for count in (0, 1):
            selected = select_one_based_frame_range(frames, 4, count)
            self.assertEqual(int(selected.shape[0]), 1)
            self.assertEqual(float(selected[0, 0, 0, 0]), 4.0)

    def test_out_of_range_start_reports_the_available_range(self):
        frames = numbered_batch(3)
        for start in (0, 4):
            with self.assertRaisesRegex(ValueError, "frames 1 through 3"):
                select_one_based_frame_range(frames, start, 1)

    def test_count_past_the_end_errors_instead_of_clamping(self):
        # Matches Select Frame's philosophy: explicit out-of-range requests
        # stop with the available range; 0 is the sanctioned "to the end".
        frames = numbered_batch(5)
        with self.assertRaisesRegex(ValueError, "only 2 remain through frame 5"):
            select_one_based_frame_range(frames, 4, 3)

    def test_negative_count_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "0 or more"):
            select_one_based_frame_range(numbered_batch(3), 1, -1)

    def test_bad_batches_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "BHWC IMAGE batch"):
            select_one_based_frame_range(torch.zeros((2, 2, 3)), 1, 0)
        with self.assertRaisesRegex(ValueError, "empty IMAGE batch"):
            select_one_based_frame_range(torch.zeros((0, 2, 2, 3)), 1, 0)


class SelectFrameRangeNodeTests(unittest.TestCase):
    def test_node_returns_sub_batch_and_actual_count(self):
        from nodes.node_select_frame_range import AusBossSelectFrameRange

        frames = numbered_batch(6)
        images, count = AusBossSelectFrameRange().select_frame_range(frames, 5, 0)
        self.assertEqual(count, 2)
        self.assertTrue(torch.equal(images, frames[4:]))


if __name__ == "__main__":
    unittest.main()
