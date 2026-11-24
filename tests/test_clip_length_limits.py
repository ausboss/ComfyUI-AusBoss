"""limit_clip_length: the min/max seconds rule of Video Crop + Rotate + Pad -> Clip.

Pure arithmetic, no video: runs on the CPU in a blink. The node test in
test_video_clip_transform.py runs the same rule on a real decode.
js/shared/timeline_math.mjs limitClipSeconds mirrors it; tests/timeline_math.test.mjs
holds the same rows.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._video_load_helpers import limit_clip_length

DURATION = 15.4
FRAME = 1 / 24


def limit(start=0.0, end=0.0, cap=0, duration=DURATION, step=FRAME, low=5.0, high=8.0):
    return limit_clip_length(start, end, cap, duration, step, low, high)


class LimitClipLengthTests(unittest.TestCase):
    def assertWindow(self, got, start, end, cap):
        self.assertAlmostEqual(got[0], start, places=6)
        self.assertAlmostEqual(got[1], end, places=6)
        self.assertEqual(got[2], cap)

    def test_no_limits_change_nothing(self):
        self.assertEqual(limit_clip_length(1.0, 0.0, 30, DURATION, FRAME, 0, 0), (1.0, 0.0, 30))

    def test_the_whole_video_is_cut_to_the_max(self):
        self.assertWindow(limit(), 0.0, 8.0, 0)

    def test_a_window_inside_the_limits_is_kept(self):
        self.assertEqual(limit(start=3.0, cap=192), (3.0, 0.0, 192))
        self.assertEqual(limit(start=2.0, end=8.5), (2.0, 8.5, 0))

    def test_a_short_window_grows_to_the_min(self):
        self.assertWindow(limit(start=2.0, end=4.0), 2.0, 7.0, 0)
        # A cap that would cut it under the min is dropped.
        self.assertWindow(limit(start=2.0, cap=48), 2.0, 7.0, 0)

    def test_a_cap_longer_than_the_max_stays(self):
        self.assertWindow(limit(start=1.0, cap=300), 1.0, 9.0, 300)

    def test_the_start_moves_back_where_the_video_ends_first(self):
        self.assertWindow(limit(start=13.0), DURATION - 5.0, DURATION, 0)

    def test_a_video_shorter_than_the_min_is_used_whole(self):
        self.assertEqual(limit(start=1.0, end=2.0, duration=4.2), (0.0, 0.0, 0))

    def test_a_max_below_the_min_counts_as_the_min(self):
        self.assertWindow(limit(low=6.0, high=2.0), 0.0, 6.0, 0)

    def test_only_a_max(self):
        self.assertWindow(limit(start=1.0, low=0.0), 1.0, 9.0, 0)
        self.assertEqual(limit(start=1.0, end=3.0, low=0.0), (1.0, 3.0, 0))

    def test_unknown_duration_still_cuts_to_the_max(self):
        self.assertWindow(limit(start=1.0, duration=0, low=0.0), 1.0, 9.0, 0)

    def test_a_backwards_window_is_left_for_the_decode_to_refuse(self):
        self.assertEqual(limit(start=4.0, end=2.0), (4.0, 2.0, 0))


if __name__ == "__main__":
    unittest.main()
