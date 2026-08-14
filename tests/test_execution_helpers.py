from __future__ import annotations

import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._execution_helpers import advance_progress, frame_progress, raise_if_interrupted


class FakeInterrupt(BaseException):
    """Mirrors ComfyUI's InterruptProcessingException: not an Exception."""


class RecordingBar:
    def __init__(self):
        self.updates = []

    def update_absolute(self, value, total=None, preview=None):
        self.updates.append((value, total, preview))


class BrokenBar:
    def update_absolute(self, *_args, **_kwargs):
        raise RuntimeError("the websocket went away")


class InterruptingBar:
    """ComfyUI's progress hook raises its interrupt straight through here."""

    def update_absolute(self, *_args, **_kwargs):
        raise FakeInterrupt()


class FrameProgressTests(unittest.TestCase):
    def test_an_unknown_total_tracks_nothing(self):
        self.assertIsNone(frame_progress(0))
        self.assertIsNone(frame_progress(-7))

    def test_a_known_total_either_tracks_or_fails_soft(self):
        # A bar only exists when ComfyUI is importable; either way no throw.
        bar = frame_progress(10)
        self.assertTrue(bar is None or hasattr(bar, "update_absolute"))


class AdvanceProgressTests(unittest.TestCase):
    def test_an_absent_bar_is_a_no_op(self):
        advance_progress(None, 3, 10)

    def test_updates_are_absolute_and_carry_no_preview(self):
        bar = RecordingBar()
        advance_progress(bar, 3, 10)
        advance_progress(bar, 4, 10)
        self.assertEqual(bar.updates, [(3, 10, None), (4, 10, None)])

    def test_a_broken_bar_never_breaks_the_operation(self):
        advance_progress(BrokenBar(), 1, 10)

    def test_an_interrupt_raised_by_the_bar_still_gets_out(self):
        with self.assertRaises(FakeInterrupt):
            advance_progress(InterruptingBar(), 1, 10)


class InterruptSeamTests(unittest.TestCase):
    def test_an_uninterrupted_queue_lets_the_loop_continue(self):
        self.assertIsNone(raise_if_interrupted())


if __name__ == "__main__":
    unittest.main()
