from __future__ import annotations

import sys
import unittest
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._video_bundle_helpers import (
    build_video_bundle,
    edit_video_bundle,
    unbundle_video,
)
from nodes.node_video_bundle import (
    AusBossVideoBundle,
    AusBossVideoBundleEdit,
    AusBossVideoUnbundle,
)


def frame_batch(count: int, height: int, width: int) -> torch.Tensor:
    return torch.rand(count, height, width, 3)


class VideoBundleHelperTests(unittest.TestCase):
    def test_bundle_derives_count_size_and_duration(self):
        frames = frame_batch(8, 32, 48)
        bundle = build_video_bundle(frames, 16.0)
        self.assertIs(bundle["frames"], frames)
        self.assertIsNone(bundle["audio"])
        self.assertEqual(bundle["fps"], 16.0)
        self.assertEqual(bundle["frame_count"], 8)
        self.assertEqual(bundle["width"], 48)
        self.assertEqual(bundle["height"], 32)
        self.assertAlmostEqual(bundle["duration"], 0.5)

    def test_bundle_rejects_bad_frames_and_fps(self):
        with self.assertRaisesRegex(ValueError, "BHWC"):
            build_video_bundle(torch.rand(32, 48, 3), 16.0)
        with self.assertRaisesRegex(ValueError, "fps"):
            build_video_bundle(frame_batch(2, 8, 8), 0.0)

    def test_edit_overrides_only_what_is_provided(self):
        frames = frame_batch(4, 16, 16)
        audio = {"waveform": torch.zeros(1, 1, 100), "sample_rate": 32000}
        original = build_video_bundle(frames, 8.0, audio)

        replacement_audio = {"waveform": torch.ones(1, 2, 50), "sample_rate": 44100}
        edited = edit_video_bundle(original, audio=replacement_audio)

        self.assertIs(edited["frames"], frames)
        self.assertIs(edited["audio"], replacement_audio)
        self.assertEqual(edited["fps"], 8.0)
        self.assertAlmostEqual(edited["duration"], 0.5)
        # The original bundle is never modified in place.
        self.assertIs(original["audio"], audio)

    def test_edit_with_new_frames_rederives_fields(self):
        original = build_video_bundle(frame_batch(4, 16, 16), 8.0)
        bigger = frame_batch(12, 24, 40)
        edited = edit_video_bundle(original, frames=bigger)
        self.assertIs(edited["frames"], bigger)
        self.assertEqual(edited["frame_count"], 12)
        self.assertEqual(edited["width"], 40)
        self.assertEqual(edited["height"], 24)
        self.assertAlmostEqual(edited["duration"], 1.5)

    def test_edit_fps_change_recomputes_duration(self):
        frames = frame_batch(16, 16, 16)
        original = build_video_bundle(frames, 16.0)
        edited = edit_video_bundle(original, fps=8.0)
        self.assertIs(edited["frames"], frames)
        self.assertEqual(edited["frame_count"], 16)
        self.assertEqual(edited["fps"], 8.0)
        self.assertAlmostEqual(edited["duration"], 2.0)
        self.assertAlmostEqual(original["duration"], 1.0)

    def test_unbundle_order_and_none_audio(self):
        frames = frame_batch(6, 20, 30)
        outputs = unbundle_video(build_video_bundle(frames, 12.0))
        self.assertIs(outputs[0], frames)
        self.assertIsNone(outputs[1])
        self.assertEqual(outputs[2:], (12.0, 6, 30, 20, 0.5))

    def test_unbundle_rejects_non_bundles(self):
        with self.assertRaisesRegex(ValueError, "AUSBOSS_VIDEO"):
            unbundle_video({"fps": 8.0})
        with self.assertRaisesRegex(ValueError, "AUSBOSS_VIDEO"):
            edit_video_bundle("not a bundle")


class VideoBundleNodeTests(unittest.TestCase):
    def test_nodes_round_trip_through_the_wire(self):
        frames = frame_batch(5, 16, 24)
        audio = {"waveform": torch.zeros(1, 1, 10), "sample_rate": 8000}
        (bundle,) = AusBossVideoBundle().bundle(frames, 10.0, audio)
        (edited,) = AusBossVideoBundleEdit().edit(bundle, fps=5.0)
        outputs = AusBossVideoUnbundle().unbundle(edited)
        self.assertEqual(len(outputs), 7)
        self.assertIs(outputs[0], frames)
        self.assertIs(outputs[1], audio)
        self.assertEqual(outputs[2:], (5.0, 5, 24, 16, 1.0))


if __name__ == "__main__":
    unittest.main()
