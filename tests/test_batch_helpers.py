from __future__ import annotations

from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._batch_helpers import select_one_based_frame


class SelectFrameTests(unittest.TestCase):
    def test_one_based_selection_preserves_frame_and_batch_axis(self):
        frames = torch.stack(
            [
                torch.full((4, 5, 3), value, dtype=torch.float32)
                for value in (0.1, 0.5, 0.9)
            ]
        )
        selected = select_one_based_frame(frames, 2)
        self.assertEqual(tuple(selected.shape), (1, 4, 5, 3))
        self.assertTrue(torch.equal(selected, frames[1:2]))

    def test_invalid_frame_number_reports_available_range(self):
        frames = torch.zeros((3, 4, 5, 3))
        for number in (0, 4):
            with self.subTest(number=number), self.assertRaisesRegex(
                ValueError, "frames 1 through 3"
            ):
                select_one_based_frame(frames, number)

    def test_empty_batch_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "empty IMAGE batch"):
            select_one_based_frame(torch.zeros((0, 4, 5, 3)), 1)


if __name__ == "__main__":
    unittest.main()
