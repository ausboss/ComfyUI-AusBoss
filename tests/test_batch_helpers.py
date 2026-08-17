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


if __name__ == "__main__":
    unittest.main()
